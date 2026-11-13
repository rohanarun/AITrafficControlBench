import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Simulation } from "../src/engine.js";
import { writeFile, mkdir } from "node:fs/promises";
await mkdir(".local", { recursive: true });
const client = new Client({ name: "codex-prompt-test", version: "1.0" });
await client.connect(
  new StreamableHTTPClientTransport(
    new URL("https://getsupers.com/airspace/mcp"),
  ),
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (name, args = {}) => {
  await sleep(280);
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw Error(r.content[0].text);
  return JSON.parse(r.content[0].text);
};
const rules = await call("airspace_rules");
console.log(
  JSON.stringify({
    rulesRead: true,
    version: rules.config.version,
    policy:
      "Observation-only trajectory forecasting; no future arrival manifest",
  }),
);
const results = [];
for (const level of [Number(process.argv[2] || 1)]) {
  const agentName = `Codex-full-horizon-v2-${Date.now()}-L${level}`;
  let run = await call("airspace_start", { agentName, level });
  const auth = { sessionId: run.sessionId, sessionToken: run.sessionToken };
  // Keep the session token in process memory; never print it.
  run = await call("airspace_observe", auth);
  let lastProgress = -1;
  while (!run.finished) {
    if (run.scenarioComplete) {
      console.log(
        JSON.stringify({
          level,
          scenario: run.scenarioIndex + 1,
          score: run.observation.score,
        }),
      );
      run = await call("airspace_next", { ...auth, revision: run.revision });
      continue;
    }
    const obs = run.observation,
      actions = [];
    const candidates = obs.aircraft
      .filter((f) => f.status === "holding")
      .sort(
        (a, b) =>
          a.fuelSeconds - b.fuelSeconds ||
          a.estimatedArrivalSeconds - b.estimatedArrivalSeconds,
      );
    for (const candidate of candidates) {
      const command = {
        id: candidate.id,
        clear: true,
        speedKnots: obs.rules.maxSpeedKnots,
      };
      const forecast = new Simulation(rules.config, { level, seed: 0 });
      // Discard generated manifests entirely. Forecast only the current public observation.
      forecast.flights = structuredClone(obs.aircraft);
      forecast.airports = structuredClone(obs.airports);
      forecast.time = obs.time;
      forecast.events = [];
      let proposed = [...actions, command];
      forecast.step(proposed);
      while (
        !forecast.done &&
        forecast.flights.some((f) => f.status === "approach") &&
        forecast.summary().eligible
      )
        forecast.step([]);
      const f = forecast.flights.find((f) => f.id === candidate.id);
      if (f.status === "landed" && !f.unsafe && forecast.summary().eligible)
        actions.push(command);
    }
    // Use single ticks while managing active approaches; skip only when the sky is empty.
    const steps = obs.aircraft.length ? 1 : 3;
    run = await call("airspace_act", {
      ...auth,
      revision: run.revision,
      actions,
      steps,
    });
    if (Math.floor(run.observation.time / 600) !== lastProgress) {
      lastProgress = Math.floor(run.observation.time / 600);
      console.log(
        JSON.stringify({
          level,
          scenario: run.scenarioIndex + 1,
          time: run.observation.time,
          safe: run.observation.score.safeLandings,
          losses: run.observation.score.separationLosses,
        }),
      );
    }
  }
  results.push(run.result);
  await writeFile(
    ".local/forecast-results.json",
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify({ completed: run.result }));
  const board = await call("airspace_leaderboard");
  console.log(
    JSON.stringify({
      level,
      published: board.rows.some((r) => r.id === run.sessionId),
      rank:
        board.rows
          .filter((r) => r.level === level)
          .findIndex((r) => r.id === run.sessionId) + 1,
    }),
  );
}
await client.close();
