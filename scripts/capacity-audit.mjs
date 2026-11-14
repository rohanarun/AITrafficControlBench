// Benchmark-design audit, not a controller: inspecting full manifests is prohibited in competing policies.
import { pathToFileURL } from "node:url";
import { Simulation } from "../src/engine.js";
import { fingerprint } from "../src/evaluation.js";
import { currentConfig } from "../src/config.js";
export function auditCapacity(config) {
  if (config.engine !== "terminal-v1")
    throw Error("Audit applies only to the terminal-v1 runway occupancy model");
  return {
    version: config.version,
    configHash: fingerprint(config),
    interpretation:
      "A lower-bound failure proves infeasibility. Passing this bound does NOT prove a feasible schedule.",
    scenarios: config.levels.flatMap((level) =>
      config.seeds.map((seed) => {
        const s = new Simulation(config, { level: level.id, seed });
        const landing = s.flights
          .filter((f) => f.kind === "arrival")
          .map((f) => f.profile.rolloutSeconds);
        const departure = s.flights
          .filter((f) => f.kind === "departure")
          .map(
            (f) =>
              Math.ceil(
                f.profile.takeoffSpeedKnots /
                  f.profile.takeoffAccelerationKnotsPerSecond,
              ) + 15,
          );
        const requiredRunwaySeconds = [...landing, ...departure].reduce(
          (a, b) => a + b,
          0,
        );
        const closureSeconds = level.closures
          ? Math.max(
              0,
              Math.min(s.rules.durationSeconds, s.rules.closureEndSeconds) -
                Math.max(0, s.rules.closureStartSeconds),
            )
          : 0;
        // Conservatively allow a whole longest operation to overlap the closure's start.
        // Actual usable time is lower once startup, wake gaps, positioning and departure handoffs are considered.
        const maximumClosureOverlapSeconds = Math.max(
          0,
          ...landing,
          ...departure,
        );
        const availableRunwayUpperBoundSeconds =
          s.rules.durationSeconds -
          Math.max(0, closureSeconds - maximumClosureOverlapSeconds);
        return {
          level: level.id,
          seed,
          requiredRunwaySeconds,
          horizonSeconds: s.rules.durationSeconds,
          closureSeconds,
          maximumClosureOverlapSeconds,
          availableRunwayUpperBoundSeconds,
          impossibleByRunwayLowerBound:
            requiredRunwaySeconds > availableRunwayUpperBoundSeconds,
        };
      }),
    ),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(auditCapacity(currentConfig), null, 2));
