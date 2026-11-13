// Observation-only baseline. This is a script, not a runtime language-model evaluation.
// It deliberately does not load a future arrival manifest or use canonical seed state.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Simulation } from "../src/engine.js";
const endpoint =
  process.env.ATC_MCP_URL || "https://getsupers.com/airspace/mcp";
const client = new Client({
  name: "terminal-forecast-baseline",
  version: "0.3.0",
});
await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw Error(r.content[0].text);
  return JSON.parse(r.content[0].text);
};
const { config } = await call("airspace_rules");
if (config.engine !== "terminal-v1")
  throw Error("This controller requires terminal-v1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const name = `Codex terminal forecast / script / no runtime model ${Date.now().toString().slice(-6)}`;
let run = await call("airspace_start", {
  agentName: name,
  level: config.levels[0].id,
  practice: process.env.ATC_PRACTICE === "1",
});
const auth = { sessionId: run.sessionId, sessionToken: run.sessionToken };
console.log(
  JSON.stringify({
    agent: name,
    sessionId: run.sessionId,
    version: config.version,
    mode: run.mode,
  }),
);
function forecast(observation, command) {
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
    f.pilotDelaySeconds = c.rules.pilotDelayMaxSeconds;
  }
  // Quantized tracks and unknown pilot timing require margins. This is still an approximation.
  s.rules.horizontalSeparationNm += 0.2;
  s.rules.verticalSeparationFt += 100;
  const target = s.flights.find((f) => f.id === command.id);
  s.step([command]);
  const until = Math.min(c.rules.durationSeconds, observation.time + 2100);
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
    if (!moving)
      return ["landed", "departed"].includes(target.status) && !target.unsafe;
    s.step([]);
  }
  return false;
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
      .sort((a, b) => a.fuelSeconds - b.fuelSeconds);
    const actions = [];
    // An intentionally simple baseline, not a seed-specific schedule or a claimed strong controller.
    for (const f of candidates.slice(0, 6))
      if (forecast(o, { id: f.id, clear: true })) {
        actions.push({ id: f.id, clear: true });
        break;
      }
    if (!actions.length) {
      const f = available.find((f) => f.status === "ready");
      if (f && forecast(o, { id: f.id, takeoff: true }))
        actions.push({ id: f.id, takeoff: true });
    }
    // Re-vector missed approaches into physical holding rather than abandoning them.
    if (!actions.length) {
      const f = available.find(
        (f) =>
          f.status === "go-around" &&
          f.altitudeFt >= o.rules.goAroundAltitudeFt - 100,
      );
      if (f && forecast(o, { id: f.id, hold: true }))
        actions.push({ id: f.id, hold: true });
    }
    await sleep(Number(process.env.ATC_PACE_MS || 300));
    run = await call("airspace_act", {
      ...auth,
      revision: run.revision,
      actions,
      steps: 5,
    });
    decisions++;
    if (actions.length || decisions % 12 === 0)
      console.log(
        JSON.stringify({
          scenario: run.scenarioIndex + 1,
          time: run.observation.time,
          actions,
          safe: run.observation.score.safeLandings,
          departures: run.observation.score.safeDepartures,
          losses: run.observation.score.separationLosses,
        }),
      );
  }
  console.log(
    JSON.stringify({
      finished: true,
      result: run.result,
      leaderboard: await call("airspace_leaderboard"),
    }),
  );
} finally {
  await client.close();
}
