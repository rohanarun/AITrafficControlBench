import { randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { Simulation } from "../src/engine.js";
import { fingerprint, aggregate, compareScores } from "../src/evaluation.js";
const UUID = /^[a-f0-9-]{36}$/;
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
export class ArenaService {
  constructor(
    config,
    directory,
    { maxSessions = 200, ttlMs = 24 * 3600 * 1000, versions = {} } = {},
  ) {
    this.config = config;
    this.versions = { ...versions, [config.version]: config };
    this.directory = directory;
    this.maxSessions = maxSessions;
    this.ttlMs = ttlMs;
    this.queue = Promise.resolve();
  }
  async init() {
    await mkdir(path.join(this.directory, "sessions"), { recursive: true });
    await mkdir(path.join(this.directory, "results"), { recursive: true });
    return this;
  }
  serial(fn) {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => {});
    return next;
  }
  async save(folder, id, value) {
    const target = path.join(this.directory, folder, `${id}.json`),
      temp = `${target}.tmp`;
    await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
    await rename(temp, target);
  }
  async read(id) {
    if (!UUID.test(id)) throw fail("Unknown session", 404);
    try {
      return JSON.parse(
        await readFile(
          path.join(this.directory, "sessions", `${id}.json`),
          "utf8",
        ),
      );
    } catch (e) {
      if (e.code === "ENOENT") throw fail("Unknown session", 404);
      throw e;
    }
  }
  authorize(record, token) {
    if (
      typeof token !== "string" ||
      token.length !== record.token.length ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(record.token))
    )
      throw fail("Invalid session token", 403);
    if (Date.now() > record.expiresAt) throw fail("Session expired", 410);
  }
  snapshot(sim) {
    return {
      time: sim.time,
      flights: sim.flights,
      airports: sim.airports,
      events: sim.events,
      actions: sim.actions,
      errors: sim.errors,
      lossPairs: [...sim.lossPairs],
      collisionPairs: [...sim.collisionPairs],
    };
  }
  configFor(record) {
    const version = record.version || "0.1.0";
    if (!this.versions[version])
      throw fail("Unsupported stored benchmark version");
    return this.versions[version];
  }
  restore(record) {
    const s = new Simulation(this.configFor(record), {
      level: record.level,
      seed: record.seeds[record.index],
    });
    Object.assign(s, record.state);
    s.lossPairs = new Set(record.state.lossPairs);
    s.collisionPairs = new Set(record.state.collisionPairs);
    return s;
  }
  view(record) {
    const s = this.restore(record);
    return {
      sessionId: record.id,
      revision: record.revision,
      mode: record.practice ? "practice" : "competition",
      agentName: record.agentName,
      level: record.level,
      scenarioIndex: record.index,
      scenarioCount: record.seeds.length,
      scenarioComplete: s.done,
      finished: record.finished,
      expiresAt: record.expiresAt,
      observation: {
        ...s.observation(),
        scenario: { level: record.level, closures: s.level.closures },
      },
      completedScores: record.episodes.map((e) => e.score),
      result: record.result || null,
    };
  }
  async cleanup() {
    const files = await readdir(path.join(this.directory, "sessions"));
    let active = 0;
    for (const f of files.filter((f) => f.endsWith(".json"))) {
      const r = JSON.parse(
        await readFile(path.join(this.directory, "sessions", f), "utf8"),
      );
      if (r.expiresAt < Date.now())
        await unlink(path.join(this.directory, "sessions", f));
      else active++;
    }
    return active;
  }
  async start({
    agentName,
    level = this.config.levels[0].id,
    practice = false,
    seed = 42,
  }) {
    return this.serial(async () => {
      if (
        typeof agentName !== "string" ||
        !agentName.trim() ||
        agentName.length > 80 ||
        /[\x00-\x1f]/.test(agentName)
      )
        throw fail("Provide agentName (1–80 printable characters)");
      if (
        !this.config.levels.some((l) => l.id === level) ||
        typeof practice !== "boolean"
      )
        throw fail("Invalid level or practice flag");
      if ((await this.cleanup()) >= this.maxSessions)
        throw fail("Arena is at capacity. Try again later.", 429);
      const seeds = practice ? [seed] : this.config.seeds,
        id = randomUUID(),
        sim = new Simulation(this.config, { level, seed: seeds[0] });
      const record = {
        id,
        version: this.config.version,
        token: randomBytes(32).toString("hex"),
        agentName: agentName.trim(),
        level,
        practice,
        seeds,
        index: 0,
        revision: 0,
        createdAt: Date.now(),
        expiresAt: Date.now() + this.ttlMs,
        episodes: [],
        finished: false,
        state: this.snapshot(sim),
      };
      await this.save("sessions", id, record);
      return { ...this.view(record), sessionToken: record.token };
    });
  }
  async observe({ sessionId, sessionToken }) {
    return this.serial(async () => {
      const r = await this.read(sessionId);
      this.authorize(r, sessionToken);
      return this.view(r);
    });
  }
  async act({ sessionId, sessionToken, revision, actions, steps = 1 }) {
    return this.serial(async () => {
      const r = await this.read(sessionId);
      this.authorize(r, sessionToken);
      if (revision !== r.revision)
        throw fail(
          "Stale revision. Observe before retrying; action was not applied.",
          409,
        );
      if (r.finished) throw fail("Run finished");
      const sim = this.restore(r);
      if (sim.done) throw fail("Scenario complete; call next");
      if (!Number.isInteger(steps) || steps < 1 || steps > 10)
        throw fail("steps must be an integer from 1 to 10");
      sim.validate(actions);
      sim.step(actions);
      for (let i = 1; i < steps && !sim.done; i++) sim.step([]);
      r.state = this.snapshot(sim);
      r.revision++;
      r.updatedAt = Date.now();
      await this.save("sessions", r.id, r);
      return this.view(r);
    });
  }
  async next({ sessionId, sessionToken, revision }) {
    return this.serial(async () => {
      const r = await this.read(sessionId);
      this.authorize(r, sessionToken);
      if (r.finished) return this.view(r);
      if (revision !== r.revision) throw fail("Stale revision", 409);
      const s = this.restore(r);
      if (!s.done) throw fail("Finish the current scenario before advancing");
      r.episodes.push({
        level: r.level,
        seed: r.seeds[r.index],
        score: s.summary(),
        trace: s.actions,
      });
      r.revision++;
      r.updatedAt = Date.now();
      if (r.index + 1 < r.seeds.length) {
        r.index++;
        r.state = this.snapshot(
          new Simulation(this.configFor(r), {
            level: r.level,
            seed: r.seeds[r.index],
          }),
        );
      } else {
        r.finished = true;
        const result = {
          id: r.id,
          schema: 1,
          agent: r.agentName,
          version: this.configFor(r).version,
          configHash: fingerprint(this.configFor(r)),
          level: r.level,
          createdAt: new Date(r.createdAt).toISOString(),
          completedAt: new Date().toISOString(),
          wallClockSeconds: +((Date.now() - r.createdAt) / 1000).toFixed(3),
          score: aggregate(r.episodes),
          episodes: r.episodes,
          verification: "server-executed",
          practice: r.practice,
        };
        r.result = { ...result };
        delete r.result.episodes;
        // Finalization is idempotent. Neither token nor private session state enters public results.
        if (!r.practice) await this.save("results", r.id, result);
      }
      await this.save("sessions", r.id, r);
      return this.view(r);
    });
  }
  async live() {
    if (this.liveCache && Date.now() - this.liveCache.at < 2000)
      return this.liveCache.value;
    return this.serial(async () => {
      const runs = [];
      for (const file of (
        await readdir(path.join(this.directory, "sessions"))
      ).filter((f) => f.endsWith(".json"))) {
        const r = JSON.parse(
          await readFile(path.join(this.directory, "sessions", file), "utf8"),
        );
        if (
          r.practice ||
          r.expiresAt < Date.now() ||
          r.version !== this.config.version ||
          !this.config.levels.some((l) => l.id === r.level)
        )
          continue;
        runs.push(r);
      }
      runs.sort(
        (a, b) =>
          Number(
            !b.finished && Date.now() - (b.updatedAt || b.createdAt) < 30000,
          ) -
            Number(
              !a.finished && Date.now() - (a.updatedAt || a.createdAt) < 30000,
            ) || (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt),
      );
      const views = runs.slice(0, 12).map((r) => ({
        sessionId: r.id,
        agentName: r.agentName,
        level: r.level,
        scenarioIndex: r.index,
        scenarioCount: r.seeds.length,
        revision: r.revision,
        updatedAt: r.updatedAt || r.createdAt,
        finished: r.finished,
        observation: this.restore(r).observation(),
        commands: r.state.actions.filter((t) => t.actions.length).slice(-8),
      }));
      const value = { run: views[0] || null, runs: views };
      this.liveCache = { at: Date.now(), value };
      return value;
    });
  }
  async leaderboard() {
    return this.serial(async () => {
      const rows = [];
      for (const file of (
        await readdir(path.join(this.directory, "results"))
      ).filter((f) => f.endsWith(".json"))) {
        const r = JSON.parse(
          await readFile(path.join(this.directory, "results", file), "utf8"),
        );
        if (
          !r.practice &&
          r.version === this.config.version &&
          this.config.levels.some((l) => l.id === r.level)
        ) {
          delete r.episodes;
          rows.push(r);
        }
      }
      rows.sort(
        (a, b) =>
          compareScores(a.score, b.score) ||
          a.completedAt.localeCompare(b.completedAt),
      );
      // Keep qualified rankings separate from failed attempts; neither is a model-identity attestation.
      const bestByName = (eligible) => {
        const seen = new Set();
        return rows.filter((r) => {
          if (r.score.eligible !== eligible) return false;
          const key = `${r.version}:${r.level}:${r.agent}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      };
      return {
        version: this.config.version,
        levels: this.config.levels,
        verification: "server-executed",
        rows: bestByName(true),
        failedRows: bestByName(false),
      };
    });
  }
  async replay(id) {
    if (!UUID.test(id)) throw fail("Unknown result", 404);
    try {
      return JSON.parse(
        await readFile(
          path.join(this.directory, "results", `${id}.json`),
          "utf8",
        ),
      );
    } catch (e) {
      if (e.code === "ENOENT") throw fail("Unknown result", 404);
      throw e;
    }
  }
}
