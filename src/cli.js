#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { configFor } from "./config.js";
import { spawn } from "node:child_process";
import { once } from "node:events";
import readline from "node:readline";
import { Simulation } from "./engine.js";
import { aggregate, fingerprint, verifyRun } from "./evaluation.js";
const config = JSON.parse(
  await readFile(new URL("../config/benchmark.json", import.meta.url), "utf8"),
);
const args = process.argv.slice(2),
  command = args.shift();
const opt = (key, fallback) =>
  args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const help = `Airspace Arena\n  node src/cli.js run --agent agents/idle.js --name idle --out .local/idle.json\n  node src/cli.js run --agent agents/model.js --name my-model --suite --out .local/run.json\n  node src/cli.js run --command '["python3","my_agent.py"]' --level 1 --seed 42 --out .local/run.json\n  node src/cli.js verify --file .local/run.json [--official]\nSingle episodes are practice. --suite runs all 15 fixed scenarios. Model agents may incur provider charges.\nAgents are local subprocesses, not sandboxed; run only trusted code locally.`;
class Agent {
  constructor(argv) {
    this.child = spawn(argv[0], argv.slice(1), {
      stdio: ["pipe", "pipe", "inherit"],
    });
    this.pending = null;
    this.failed = null;
    this.bytes = 0;
    const fail = (err) => {
      this.failed = err;
      if (this.pending) {
        this.pending.reject(err);
        this.pending = null;
      }
    };
    this.child.on("error", fail);
    this.child.on("exit", (code) => fail(new Error(`Agent exited (${code})`)));
    this.child.stdout.on("data", (chunk) => {
      this.bytes += chunk.length;
      if (this.bytes > 1024 * 1024) {
        fail(new Error("Agent output limit exceeded"));
        this.child.kill();
      }
    });
    this.child.stdin.on("error", fail);
    this.lines = readline.createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => {
      if (!this.pending) {
        fail(new Error("Unsolicited agent output"));
        return;
      }
      const p = this.pending;
      this.pending = null;
      try {
        const value = JSON.parse(line);
        if (!Array.isArray(value.actions))
          throw new Error("Agent must return {actions: [...]}");
        p.resolve(value.actions);
      } catch (e) {
        p.reject(e);
      }
    });
  }
  act(observation) {
    if (this.failed) return Promise.reject(this.failed);
    this.bytes = 0;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        this.child.kill();
        reject(new Error("Agent response timeout"));
      }, 60000);
      this.pending = {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      this.child.stdin.write(JSON.stringify(observation) + "\n");
    });
  }
  async close() {
    this.lines.close();
    this.child.stdin.end();
    if (
      !this.child.pid ||
      this.child.exitCode !== null ||
      this.child.signalCode !== null
    )
      return;
    const exited = once(this.child, "exit").catch(() => {});
    this.child.kill();
    const timer = setTimeout(() => this.child.kill("SIGKILL"), 1000);
    await exited;
    clearTimeout(timer);
  }
}
try {
  if (command === "verify") {
    const run = JSON.parse(await readFile(opt("--file"), "utf8"));
    console.log(
      JSON.stringify(
        {
          verified: true,
          score: verifyRun(configFor(run.version), run, {
            official: args.includes("--official"),
          }),
        },
        null,
        2,
      ),
    );
  } else if (command === "run") {
    let argv = opt("--command")
      ? JSON.parse(opt("--command"))
      : [process.execPath, path.resolve(opt("--agent", "agents/idle.js"))];
    if (
      !Array.isArray(argv) ||
      !argv.length ||
      argv.some((a) => typeof a !== "string")
    )
      throw new Error("--command must be a JSON array");
    const suite = args.includes("--suite"),
      levels = suite
        ? config.levels.map((l) => l.id)
        : [Number(opt("--level", "1"))],
      seeds = suite ? config.seeds : [Number(opt("--seed", "42"))];
    const run = {
      schema: 1,
      version: config.version,
      configHash: fingerprint(config),
      agent: opt("--name", "local-agent"),
      track: suite ? "fixed-suite" : "practice",
      createdAt: new Date().toISOString(),
      episodes: [],
    };
    for (const level of levels)
      for (const seed of seeds) {
        const sim = new Simulation(config, { level, seed }),
          agent = new Agent(argv);
        try {
          while (!sim.done) {
            const actions = await agent.act({
              ...sim.observation(),
              scenario: { level, closures: sim.level.closures },
            });
            sim.validate(actions);
            sim.step(actions);
          }
        } finally {
          await agent.close();
        }
        run.episodes.push({
          level,
          seed,
          score: sim.summary(),
          trace: sim.actions,
        });
        console.error(
          `Level ${level} / ${seed}: ${sim.summary().safeLandings} safe landings`,
        );
      }
    run.score = aggregate(run.episodes);
    verifyRun(config, run, { official: false });
    const dest = path.resolve(opt("--out", ".local/run.json"));
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, JSON.stringify(run, null, 2) + "\n");
    console.log(JSON.stringify({ file: dest, score: run.score }, null, 2));
  } else console.log(help);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
