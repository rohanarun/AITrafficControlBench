import fs from 'node:fs';
import { Simulation } from '../../../src/engine.js';
const dir=new URL('./',import.meta.url), base='https://getsupers.com/airspace/api';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let last=0, auth, run;
const started=Date.now();
const log=x=>{fs.appendFileSync(new URL('run.log',dir),JSON.stringify(x)+'\n'); console.log(JSON.stringify(x));};
async function req(path,body){
 await sleep(Math.max(0,1150-(Date.now()-last))); last=Date.now();
 const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'User-Agent':'AirspaceArena-AstraComparison/0.1','Content-Type':'application/json',...(auth?{Authorization:`Bearer ${auth.sessionToken}`}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)});
 if(r.status===429){await sleep(15000);return req(path,body)}
 const x=await r.json(); if(!r.ok)throw Error(JSON.stringify({status:r.status,error:x})); return x;
}
const config=await req('/rules');
fs.writeFileSync(new URL('rules.json',dir),JSON.stringify(config,null,2));
const agentName='gpt-6-astra / script-assisted / speed-slack-1113';
run=await req('/sessions',{agentName,level:6});
auth={sessionId:run.sessionId,sessionToken:run.sessionToken};
fs.writeFileSync(new URL('credentials.json',dir),JSON.stringify(auth),{mode:0o600});
log({started:true,sessionId:auth.sessionId,agentName});
const slowDistance=16;
function speedAction(f,o){
 const a=o.airports[0],h=a.runway.headingDeg*Math.PI/180;
 const along=(f.x-a.runway.thresholdX)*Math.sin(h)+(f.y-a.runway.thresholdY)*Math.cos(h);
 return (f.status==='approach'||(f.status==='intercept'&&-along<slowDistance))&&f.targetSpeedKnots>f.profile.approachSpeedKnots ? {id:f.id,speedKnots:f.profile.approachSpeedKnots}:null;
}
function forecast(o,command,delay,solo=false){
 if(command.takeoff){const a=o.airports[0];if(a.closed||a.busyUntil>o.time||(a.lastWake&&o.time-a.lastWake.time<o.rules.departureWakeSeconds))return false;}
 const c=structuredClone(config),w=o.airports[0].wind,s=new Simulation(c,{level:6,seed:0});
 s.time=o.time;s.airports=structuredClone(o.airports);s.flights=structuredClone(solo?o.aircraft.filter(f=>f.id===command.id):o.aircraft);s.events=[];s.actions=[];s.lossPairs=new Set();s.collisionPairs=new Set();
 // A local linear altitude shear estimated from visible reports; no future winds or schedule.
 const samples=o.aircraft.filter(f=>f.wind&&f.altitudeFt>2000);
 let shear=samples.length?samples.reduce((v,f)=>v+(f.wind.eastKnots-w.eastKnots)/(f.altitudeFt/1000),0)/samples.length:0;
 s.windAt=alt=>({eastKnots:w.eastKnots+shear*alt/1000,northKnots:w.northKnots});
 for(const f of s.flights){const age=Math.max(0,o.time-f.trackTime),h=f.headingDeg*Math.PI/180,v=f.wind||w;if(!['ready','landing-roll','takeoff-roll'].includes(f.status)){const tas=s.trueAirspeed(f);f.x+=(tas*Math.sin(h)+v.eastKnots)*age/3600;f.y+=(tas*Math.cos(h)+v.northKnots)*age/3600;f.altitudeFt+=f.verticalSpeedFpm*age/60;}
 f.pending=(f.pendingCommands||[]).map(p=>({...p,executeAt:Math.max(o.time,p.issuedAt+delay)}));f.history=[];f.track=null;f.pilotDelaySeconds=delay;}
 s.rules.horizontalSeparationNm+=2;for(const row of Object.values(s.rules.wakeSeparationNm))for(const k of Object.keys(row))row[k]+=2;s.rules.verticalSeparationFt+=200;
 const target=s.flights.find(f=>f.id===command.id);s.step([command]);
 const until=Math.min(c.rules.durationSeconds,o.time+(command.hold?400:3000));
 while(s.time<until){
 if(s.lossPairs.size||s.collisionPairs.size||s.events.some(e=>['unsafe-takeoff','runway-overrun','ground-collision'].includes(e.type)))return false;
 if(['fuel-exhausted','escaped','crashed','go-around'].includes(target.status))return false;
 const moving=s.flights.some(f=>['intercept','approach','departure','go-around','takeoff-roll','landing-roll'].includes(f.status));
 if(!moving&&!command.hold)return ['landed','departed'].includes(target.status)&&!target.unsafe ? {eta:target.completedAt-o.time}:false;
 const changes=s.flights.filter(f=>!f.pending.length).map(f=>speedAction(f,{airports:s.airports})).filter(Boolean);s.step(changes);
 }
 return command.hold&&target.status==='holding'&&!target.unsafe?{eta:400}:false;
}
const robust=(o,c)=>forecast(o,c,o.rules.pilotDelayMinSeconds)&&forecast(o,c,o.rules.pilotDelayMaxSeconds);
let decisions=0;
while(!run.finished){
 if(run.scenarioComplete){log({scenarioComplete:run.scenarioIndex+1,score:run.observation.score});run=await req(`/sessions/${auth.sessionId}/next`,{revision:run.revision});continue;}
 const o=run.observation,available=o.aircraft.filter(f=>!f.pendingCommands.length),actions=[];
 // Failure lesson: slow direct-to-final routing spends scarce fuel on transit. Use faster transit,
 // brake early, and rank all visible arrivals by feasible completion and remaining-fuel slack.
 for(const f of available){const c=speedAction(f,o);if(c)actions.push(c);}
 if(!actions.length){
 const candidates=[];
 for(const f of available.filter(f=>f.status==='holding')){
 const c={id:f.id,clear:true,speedKnots:200};const trial=forecast(o,c,8,true);
 if(trial)candidates.push({f,c,eta:trial.eta,slack:f.fuelSeconds-trial.eta});
 }
 candidates.sort((a,b)=>(a.slack<650?0:1)-(b.slack<650?0:1)||a.eta-b.eta||a.slack-b.slack);
 for(const q of candidates.slice(0,10)){if(robust(o,q.c)){actions.push(q.c);break;}}
 }
 if(!actions.length){const f=available.find(f=>f.status==='ready');if(f&&robust(o,{id:f.id,takeoff:true}))actions.push({id:f.id,takeoff:true});}
 if(!actions.length){const f=available.find(f=>f.status==='go-around'&&f.altitudeFt>=o.rules.goAroundAltitudeFt-100);if(f&&robust(o,{id:f.id,hold:true}))actions.push({id:f.id,hold:true});}
 try{run=await req(`/sessions/${auth.sessionId}/actions`,{revision:run.revision,actions,steps:3});}catch(e){log({recovery:String(e)});run=await req(`/sessions/${auth.sessionId}`);}
 decisions++;
 fs.writeFileSync(new URL('latest.json',dir),JSON.stringify(run));
 if(actions.length||decisions%10===0)log({scenario:run.scenarioIndex+1,time:run.observation.time,actions,score:run.observation.score});
}
fs.writeFileSync(new URL('final.json',dir),JSON.stringify(run,null,2));
const id=run.result?.id||run.result?.resultId;
if(id){const replay=await req(`/results/${id}`);fs.writeFileSync(new URL('replay.json',dir),JSON.stringify(replay));}
const result={model:'gpt-6-astra',executionMode:'script-assisted; model-designed scripted per-action policy, no per-action model inference',agentName,sessionId:auth.sessionId,resultId:id,score:run.result,wallTimeSeconds:(Date.now()-started)/1000,policy:'Observation-only delayed-track forecasting at both pilot latency bounds with 2NM/200ft safety margin; altitude wind shear estimated from visible tracks; 200kt transit and early braking at 16NM; solo feasibility screen for all holdings, fuel-slack/ETA admission of up to 10 candidates; 30s observations; departure wake gate; missed-approach recovery.'};
fs.writeFileSync(new URL('result.json',dir),JSON.stringify(result,null,2));log({finished:true,...result});
