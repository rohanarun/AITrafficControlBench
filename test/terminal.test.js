import test from "node:test";
import assert from "node:assert/strict";
import { currentConfig } from "../src/config.js";
import { Simulation } from "../src/engine.js";
import {
  aggregate,
  compareScores,
  fingerprint,
  verifyRun,
} from "../src/evaluation.js";
import { ArenaService } from "../server/service.js";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
function isolated() {
  const c = structuredClone(currentConfig);
  c.levels[0].flights = 1;
  c.levels[0].departures = 0;
  c.levels[0].closures = false;
  c.rules.windBaseKnots = 0;
  c.rules.windVariationKnots = 0;
  c.rules.windShearKnotsPer1000Ft = 0;
  return new Simulation(c);
}
function onFinal(s, d = 8) {
  const f = s.flights[0],
    p = s.waypoint(d);
  Object.assign(f, p, {
    status: "approach",
    altitudeFt: 2000,
    targetAltitudeFt: 2000,
    headingDeg: s.airports[0].runway.headingDeg,
    speedKnots: f.profile.approachSpeedKnots,
    targetSpeedKnots: f.profile.approachSpeedKnots,
  });
  return f;
}
test("pilot delay, speed acceleration and bank-limited turn do not teleport", () => {
  const s = isolated(),
    f = s.flights[0],
    start = { ...f };
  s.step([{ id: f.id, headingDeg: 180, altitudeFt: 4000, speedKnots: 150 }]);
  assert.ok(f.speedKnots > 150);
  assert.ok(f.altitudeFt > 4000);
  assert.ok(Math.hypot(f.x - start.x, f.y - start.y) < 1);
  assert.ok(
    s.events.find((e) => e.type === "pilot-acknowledged").time >=
      s.rules.pilotDelayMinSeconds,
  );
  assert.ok(f.headingDeg < 90 || f.headingDeg > 270);
});
test("radar is delayed and does not expose truth history or command execution deadline", () => {
  const s = isolated();
  s.step([]);
  const f = s.observation().aircraft[0];
  assert.ok(f.trackTime < s.time);
  assert.equal("history" in f, false);
  assert.equal("track" in f, false);
  assert.equal("pending" in f, false);
  assert.equal("pilotDelaySeconds" in f, false);
  assert.notEqual(f.x, s.flights[0].x);
});
test("stabilized runway-aligned approach completes landing rollout", () => {
  const s = isolated(),
    f = onFinal(s);
  while (!s.done && f.status !== "landed") s.step([]);
  assert.equal(f.status, "landed");
  assert.equal(s.summary().safeLandings, 1);
  assert.ok(f.completedAt > f.landedAt);
  assert.equal(s.summary().eligible, true);
});
test("occupied runway triggers missed approach and no credit", () => {
  const s = isolated(),
    f = onFinal(s, 1.8);
  s.airports[0].busyUntil = 5000;
  s.step([]);
  assert.equal(f.status, "go-around");
  assert.equal(s.summary().safeLandings, 0);
  assert.ok(f.targetAltitudeFt >= 5000);
});
test("misaligned and high arrival cannot get landing credit", () => {
  const s = isolated(),
    f = onFinal(s, 1);
  f.altitudeFt = 5000;
  s.step([]);
  assert.equal(f.status, "go-around");
  assert.equal(s.summary().safeLandings, 0);
});
test("swept collision removes two aircraft; separation and collision distinct", () => {
  const s = isolated(),
    f = onFinal(s);
  s.flights.push(structuredClone({ ...f, id: "AA9999" }));
  s.step([]);
  assert.equal(s.summary().collisions, 1);
  assert.equal(s.summary().separationLosses, 1);
  assert.equal(s.summary().safeLandings, 0);
  assert.equal(s.summary().eligible, false);
});
test("heavy leader requires more separation than generic radar minimum", () => {
  const s = isolated(),
    lead = onFinal(s, 8);
  lead.profile.wake = "H";
  const follow = structuredClone({
    ...lead,
    id: "AA9999",
    ...s.waypoint(12),
    altitudeFt: 2000,
  });
  follow.profile.wake = "M";
  s.flights.push(follow);
  s.step([]);
  assert.equal(s.summary().separationLosses, 1);
  assert.equal(s.summary().collisions, 0);
});
test("fuel exhaustion cannot reduce unmet-demand time penalty", () => {
  const a = isolated(),
    b = isolated();
  a.flights[0].fuelSeconds = 1;
  for (let i = 0; i < 10; i++) {
    a.step([]);
    b.step([]);
  }
  assert.equal(
    a.summary().unservedTimeSeconds,
    b.summary().unservedTimeSeconds,
  );
  assert.equal(a.summary().fuelExhausted, 1);
});
test("wind changes ground trajectory without instantaneous heading change", () => {
  const a = isolated(),
    b = isolated();
  b.rules.windBaseKnots = 30;
  for (const s of [a, b]) {
    s.flights[0].status = "vector";
    s.step([]);
  }
  assert.ok(b.flights[0].x > a.flights[0].x);
  assert.equal(a.flights[0].headingDeg, b.flights[0].headingDeg);
});
test("departure shares runway, takes time to lift off, and hands off at sector boundary", () => {
  const s = isolated(),
    f = s.flights[0];
  Object.assign(f, {
    kind: "departure",
    status: "ready",
    x: 0,
    y: 0,
    altitudeFt: 17,
    speedKnots: 0,
  });
  s.step([{ id: f.id, takeoff: true }]);
  assert.equal(f.status, "takeoff-roll");
  assert.equal(s.summary().safeDepartures, 0);
  while (!s.done && !["departed", "crashed"].includes(f.status)) s.step([]);
  assert.equal(f.status, "departed");
  assert.equal(s.summary().safeDepartures, 1);
});
test("takeoff into occupied runway fails safety gate", () => {
  const s = isolated(),
    f = s.flights[0];
  Object.assign(f, { kind: "departure", status: "ready" });
  s.airports[0].busyUntil = 100;
  s.step([{ id: f.id, takeoff: true }]);
  assert.equal(s.summary().runwayIncidents, 1);
  assert.equal(s.summary().eligible, false);
});
test("efficiency aggregation preserves counts and lexicographic ranking", () => {
  const s = isolated();
  s.step([]);
  const score = aggregate([{ score: s.summary() }, { score: s.summary() }]);
  assert.equal(score.unservedTimeSeconds, 20);
  assert.equal(score.safeCompletionPercent, 0);
  assert.ok(
    compareScores(
      { safeLandings: 2, safeDepartures: 0, unservedTimeSeconds: 999 },
      { safeLandings: 1, safeDepartures: 8, unservedTimeSeconds: 1 },
    ) < 0,
  );
  assert.ok(
    compareScores(
      { safeLandings: 2, safeDepartures: 1, unservedTimeSeconds: 100 },
      { safeLandings: 2, safeDepartures: 1, unservedTimeSeconds: 200 },
    ) < 0,
  );
});
test("new engine deterministic replay and score forgery rejection", () => {
  const s = isolated();
  s.rules.durationSeconds = 60;
  s.config.rules.durationSeconds = 60;
  while (!s.done) s.step([]);
  const episodes = [
      { level: 6, seed: s.seed, trace: s.actions, score: s.summary() },
    ],
    run = {
      schema: 1,
      version: s.config.version,
      configHash: fingerprint(s.config),
      agent: "test",
      episodes,
      score: aggregate(episodes),
    };
  assert.deepEqual(verifyRun(s.config, run), run.score);
  run.score.unservedTimeSeconds = 0;
  assert.throws(() => verifyRun(s.config, run));
});
test("terminal pilot queues and sensor state survive service restart", async (t) => {
  const base = new URL("../.local/", import.meta.url);
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(fileURLToPath(new URL("terminal-service-", base)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const c = structuredClone(currentConfig),
    s = await new ArenaService(c, dir).init();
  let r = await s.start({ agentName: "test", practice: true });
  const auth = { sessionId: r.sessionId, sessionToken: r.sessionToken };
  r = await s.act({ ...auth, revision: r.revision, actions: [], steps: 2 });
  const reopened = await new ArenaService(c, dir).init();
  assert.deepEqual(await reopened.observe(auth), r);
  const a = await s.act({ ...auth, revision: r.revision, actions: [] });
  assert.equal(a.observation.time, 30);
});
test("all-flight completion time is null for incomplete runs and fixed after safe completion", () => {
  const s = isolated();
  assert.equal(s.summary().timeToCompleteSeconds, null);
  const f = onFinal(s);
  while (f.status !== "landed" && !s.done) s.step([]);
  const done = s.summary().timeToCompleteSeconds;
  assert.equal(done, f.completedAt);
  s.step([]);
  assert.equal(s.summary().timeToCompleteSeconds, done);
  assert.equal(aggregate([{ score: s.summary() }]).timeToCompleteSeconds, done);
});
test("ground rollout moves along the runway before vacation and cannot earn early credit", () => {
  const s = isolated(),
    f = onFinal(s);
  while (f.status === "approach" && !s.done) s.step([]);
  assert.equal(f.status, "landing-roll");
  assert.equal(s.summary().safeLandings, 0);
  const p = s.runwayCoordinates(f).along;
  s.step([]);
  assert.ok(s.runwayCoordinates(f).along > p);
});
