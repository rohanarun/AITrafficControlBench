// Built by gpt-6.1-sol; scripted decisions with observation-only forecasts.
import { Simulation } from "../../../src/engine.js";
import fs from 'node:fs';
const dir = decodeURIComponent(new URL('.', import.meta.url).pathname);
const began = Date.now();
let lastRequest=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const log=x=>fs.appendFileSync(dir+'compact.jsonl',JSON.stringify(x)+'\n');
async function request(path,body,token){
 await sleep(Math.max(0,1150-(Date.now()-lastRequest)));lastRequest=Date.now();
 const r=await fetch('https://getsupers.com/airspace/api'+path,{method:body?'POST':'GET',headers:{'User-Agent':'AirspaceArena-Sol61/0.3.1','Content-Type':'application/json',...(token?{'Authorization':'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
 if(r.status===429){await sleep(10000);return request(path,body,token)}
 if(!r.ok)throw Error('HTTP '+r.status+' '+await r.text());return r.json();
}
const config=await request('/rules');fs.writeFileSync(dir+'live-rules.json',JSON.stringify(config,null,2));
const name='gpt-6.1-sol / script-assisted / urgency-distance-'+Date.now().toString().slice(-5);
let run=await request('/sessions',{agentName:name,level:6});
const auth={sessionId:run.sessionId,sessionToken:run.sessionToken};
fs.writeFileSync(dir+'credentials.json',JSON.stringify(auth),{mode:0o600});
fs.writeFileSync(dir+'.gitignore','credentials.json\n');
console.log(JSON.stringify({sessionId:run.sessionId,name}));log({started:Date.now(),sessionId:run.sessionId,name});
const call=async(name,args={})=>{
 if(name==='airspace_act')return request('/sessions/'+auth.sessionId+'/actions',{revision:args.revision,actions:args.actions,steps:args.steps},auth.sessionToken);
 if(name==='airspace_next')return request('/sessions/'+auth.sessionId+'/next',{revision:args.revision},auth.sessionToken);
 if(name==='airspace_leaderboard')return request('/leaderboard');
};
function forecast(observation, command, pilotDelaySeconds) {
  if (command.takeoff) {
    const airport = observation.airports[0];
    if (
      airport.closed ||
      airport.busyUntil > observation.time ||
      (airport.lastWake &&
        observation.time - airport.lastWake.time <
          observation.rules.departureWakeSeconds)
    )
      return false;
  }
  const c = structuredClone(config),
    w = observation.airports[0].wind;
  c.rules.windBaseKnots = w.eastKnots;
  c.rules.windVariationKnots = 0;
  c.rules.windShearKnotsPer1000Ft = 0;
  const s = new Simulation(c, { level: run.level, seed: 0 });
  s.time = observation.time;
  s.airports = structuredClone(observation.airports);
  s.flights = structuredClone(observation.aircraft);
  s.events = [];
  s.actions = [];
  s.lossPairs = new Set();
  s.collisionPairs = new Set();
  // Forecast wind is the observation, not a reconstructed random seed or hidden future.
  s.windAt = () => ({ ...w });
  for (const f of s.flights) {
    const age = Math.max(0, observation.time - f.trackTime),
      h = (f.headingDeg * Math.PI) / 180;
    if (!["ready", "landing-roll", "takeoff-roll"].includes(f.status)) {
      const tas = s.trueAirspeed(f);
      f.x += ((tas * Math.sin(h) + w.eastKnots) * age) / 3600;
      f.y += ((tas * Math.cos(h) + w.northKnots) * age) / 3600;
      f.altitudeFt += (f.verticalSpeedFpm * age) / 60;
    }
    f.pending = [];
    f.history = [];
    f.track = null;
    f.pilotDelaySeconds = pilotDelaySeconds;
  }
  // Quantized tracks and unknown pilot timing require margins. This is still an approximation.
  const bufferNm = Number(process.env.ATC_SEPARATION_BUFFER_NM || 2);
  s.rules.horizontalSeparationNm += bufferNm;
  for (const follower of Object.values(s.rules.wakeSeparationNm))
    for (const category of Object.keys(follower))
      follower[category] += bufferNm;
  s.rules.verticalSeparationFt += 200;
  const target = s.flights.find((f) => f.id === command.id);
  s.step([command]);
  const until = Math.min(
    c.rules.durationSeconds,
    observation.time + (command.hold ? 300 : 2100),
  );
  while (s.time < until) {
    if (
      s.lossPairs.size ||
      s.collisionPairs.size ||
      s.events.some((e) =>
        ["unsafe-takeoff", "runway-overrun", "ground-collision"].includes(
          e.type,
        ),
      )
    )
      return false;
    if (
      ["fuel-exhausted", "escaped", "crashed", "go-around"].includes(
        target.status,
      )
    )
      return false;
    const moving = s.flights.some((f) =>
      [
        "intercept",
        "approach",
        "departure",
        "go-around",
        "takeoff-roll",
        "landing-roll",
      ].includes(f.status),
    );
    if (!moving && !command.hold)
      return ["landed", "departed"].includes(target.status) && !target.unsafe;
    s.step([]);
  }
  return !!command.hold && target.status === "holding" && !target.unsafe;
}
function robustForecast(observation, command) {
  return (
    forecast(observation, command, observation.rules.pilotDelayMinSeconds) &&
    forecast(observation, command, observation.rules.pilotDelayMaxSeconds)
  );
}
let decisions = 0;
try {
  while (!run.finished) {
    if (run.scenarioComplete) {
      run = await call("airspace_next", { ...auth, revision: run.revision });
      console.log(
        JSON.stringify({
          scenarioFinished: run.completedScores.length,
          scores: run.completedScores,
          result: run.result,
        }),
      );
      continue;
    }
    const o = run.observation,
      available = o.aircraft.filter((f) => !f.pendingCommands.length);
    const candidates = available
      .filter((f) => f.status === "holding")
      .sort((a,b)=>{
        const rw=o.airports[0].runway,h=rw.headingDeg*Math.PI/180;
        const ix=rw.thresholdX-12*Math.sin(h),iy=rw.thresholdY-12*Math.cos(h);
        // Distance favors quickly recoverable aircraft; fuel slack prevents starvation.
        const rank=f=>Math.hypot(f.x-ix,f.y-iy)*18+Math.max(0,f.fuelSeconds-1000)*0.15;
        return rank(a)-rank(b);
      });
    const actions = [];
    // An intentionally simple baseline, not a seed-specific schedule or a claimed strong controller.
    for (const f of candidates.slice(0, 16))
      if (robustForecast(o, { id: f.id, clear: true })) {
        actions.push({ id: f.id, clear: true });
        break;
      }
    if (!actions.length) {
      const f = available.find((f) => f.status === "ready");
      if (f && robustForecast(o, { id: f.id, takeoff: true }))
        actions.push({ id: f.id, takeoff: true });
    }
    // Re-vector missed approaches into physical holding rather than abandoning them.
    if (!actions.length) {
      const f = available.find(
        (f) =>
          f.status === "go-around" &&
          f.altitudeFt >= o.rules.goAroundAltitudeFt - 100,
      );
      if (f && robustForecast(o, { id: f.id, hold: true }))
        actions.push({ id: f.id, hold: true });
    }
    await sleep(Number(process.env.ATC_PACE_MS || 300));
    run = await call("airspace_act", {
      ...auth,
      revision: run.revision,
      actions,
      steps: actions.length || o.aircraft.some(f=>["approach","landing-roll","go-around"].includes(f.status)) ? 3 : 6,
    });
    decisions++;
    if (actions.length || decisions % 12 === 0)
      log(
        ({
          scenario: run.scenarioIndex + 1,
          time: run.observation.time,
          actions,
          safe: run.observation.score.safeLandings,
          departures: run.observation.score.safeDepartures,
          losses: run.observation.score.separationLosses,
        }),
      );
  }
  const replay=await request('/results/'+auth.sessionId);
  fs.writeFileSync(dir+'server-replay.json',JSON.stringify(replay));
  fs.writeFileSync(dir+'result.json',JSON.stringify({model:'gpt-6.1-sol',executionMode:'script-assisted; scripted per-action decisions',sessionId:auth.sessionId,result:run.result,wallTimeSeconds:(Date.now()-began)/1000,policy:'Observation-only dual-delay simulation, 2NM/200ft uncertainty margins, distance/fuel-slack ranking over16 arrival candidates, adaptive30/60sec decisions; departure opportunism'},null,2));
  console.log(
    JSON.stringify({
      finished: true,
      result: run.result,
      leaderboard: await call("airspace_leaderboard"),
    }),
  );
} finally {
  fs.writeFileSync(dir+"latest.json",JSON.stringify(run));
}
