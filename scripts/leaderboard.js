import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { verifyRun, digest } from "../src/evaluation.js";
const config = JSON.parse(
  await readFile(new URL("../config/benchmark.json", import.meta.url), "utf8"),
);
const root = new URL("../submissions/", import.meta.url),
  rows = [];
for (const file of (await readdir(root))
  .filter((f) => f.endsWith(".json"))
  .sort()) {
  const raw = await readFile(new URL(file, root), "utf8");
  if (Buffer.byteLength(raw) > 20 * 1024 * 1024)
    throw new Error(`${file}: submission too large`);
  const run = JSON.parse(raw),
    score = verifyRun(config, run, { official: true });
  rows.push({
    agent: run.agent,
    score,
    runHash: digest(run),
    file,
    verification: "action-replay",
    episodes: run.episodes.map((e) => ({
      level: e.level,
      seed: e.seed,
      score: e.score,
    })),
  });
}
rows.sort(
  (a, b) =>
    b.score.safeLandings - a.score.safeLandings ||
    a.score.totalDelaySeconds - b.score.totalDelaySeconds ||
    a.agent.localeCompare(b.agent),
);
await mkdir(new URL("../public/data/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../public/data/leaderboard.json", import.meta.url),
  JSON.stringify(
    {
      version: config.version,
      suite: config.suite,
      scenarioCount: config.levels.length * config.seeds.length,
      verification:
        "Replay verifies actions and outcomes, not agent identity or generalization.",
      rows,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Verified ${rows.length} leaderboard entries`);
