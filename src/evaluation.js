import { createHash } from "node:crypto";
import { Simulation } from "./engine.js";
export const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const fingerprint = (config) => digest(config);
export function aggregate(episodes) {
  const keys = [
    "safeLandings",
    "totalLandings",
    "scheduled",
    "separationLosses",
    "collisions",
    "runwayIncidents",
    "fuelExhausted",
    "unfinished",
    "agentErrors",
    "totalDelaySeconds",
  ];
  const out = Object.fromEntries(
    keys.map((k) => [k, episodes.reduce((n, e) => n + e.score[k], 0)]),
  );
  out.eligible = episodes.every((e) => e.score.eligible);
  return out;
}
export function verifyRun(config, run, { official = false } = {}) {
  if (
    run.schema !== 1 ||
    run.configHash !== fingerprint(config) ||
    run.version !== config.version
  )
    throw new Error("Benchmark version or configuration mismatch");
  if (
    typeof run.agent !== "string" ||
    run.agent.length < 1 ||
    run.agent.length > 80
  )
    throw new Error("Agent name required (max 80 characters)");
  if (
    !Array.isArray(run.episodes) ||
    run.episodes.length < 1 ||
    run.episodes.length > config.levels.length * config.seeds.length
  )
    throw new Error("Invalid episode count");
  const seen = new Set();
  const replayed = run.episodes.map((ep) => {
    const key = `${ep.level}:${ep.seed}`;
    if (seen.has(key)) throw new Error("Duplicate episode");
    seen.add(key);
    if (
      official &&
      (!config.seeds.includes(ep.seed) ||
        !config.levels.some((l) => l.id === ep.level))
    )
      throw new Error("Noncanonical scenario");
    const sim = new Simulation(config, { level: ep.level, seed: ep.seed });
    if (
      !Array.isArray(ep.trace) ||
      ep.trace.length !==
        Math.ceil(config.rules.durationSeconds / config.rules.stepSeconds)
    )
      throw new Error("Incomplete or oversized trace");
    for (const tick of ep.trace) {
      if (tick.time !== sim.time || tick.rejected !== false)
        throw new Error("Bad action timestamp or rejected action");
      sim.validate(tick.actions);
      sim.step(tick.actions);
    }
    if (!sim.done || digest(sim.summary()) !== digest(ep.score))
      throw new Error("Claimed score does not match replay");
    return { ...ep, score: sim.summary() };
  });
  if (official)
    for (const l of config.levels)
      for (const s of config.seeds)
        if (!seen.has(`${l.id}:${s}`))
          throw new Error("Full fixed suite required for leaderboard");
  const score = aggregate(replayed);
  if (digest(score) !== digest(run.score))
    throw new Error("Aggregate mismatch");
  if (official && !score.eligible) throw new Error("Safety gate failed");
  return score;
}
