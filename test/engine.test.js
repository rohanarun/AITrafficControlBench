import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Simulation, sweptConflict } from "../src/engine.js";
import { verifyRun, fingerprint, aggregate } from "../src/evaluation.js";
const config = JSON.parse(
  readFileSync(new URL("../config/benchmark.json", import.meta.url), "utf8"),
);
const one = () => {
  const c = structuredClone(config);
  c.levels[0].flights = 1;
  c.rules.arrivalWindowSeconds = 1;
  return new Simulation(c, { seed: 42 });
};
const finish = (s) => {
  while (!s.done) s.step([]);
  return s.summary();
};
test("identical seeds and actions replay exactly", () => {
  const a = new Simulation(config),
    b = new Simulation(config);
  finish(a);
  finish(b);
  assert.deepEqual(a.events, b.events);
  assert.deepEqual(a.summary(), b.summary());
});
test("seed changes arrival manifest", () =>
  assert.notDeepEqual(
    new Simulation(config, { seed: 1 }).flights,
    new Simulation(config, { seed: 2 }).flights,
  ));
test("uncontrolled holding earns zero and fuel expires", () => {
  const s = one();
  assert.equal(finish(s).safeLandings, 0);
  assert.equal(s.summary().fuelExhausted, 1);
});
test("isolated cleared aircraft lands safely exactly once", () => {
  const s = one();
  s.step([{ id: s.flights[0].id, clear: true }]);
  const score = finish(s);
  assert.equal(score.safeLandings, 1);
  assert.equal(score.totalLandings, 1);
  assert.equal(score.eligible, true);
  assert.throws(() => s.step([]));
});
test("continuous separation catches tunneling between endpoints", () => {
  const a = { x: -4, y: 0, altitudeFt: 5000 },
    b = { x: 4, y: 0, altitudeFt: 5000 };
  assert.equal(sweptConflict(a, b, b, a, 3, 1000), true);
  assert.equal(
    sweptConflict(
      a,
      b,
      { ...b, altitudeFt: 7000 },
      { ...a, altitudeFt: 7000 },
      3,
      1000,
    ),
    false,
  );
});
test("horizontal and vertical violation intervals must overlap", () => {
  assert.equal(
    sweptConflict(
      { x: 0, y: 0, altitudeFt: 5000 },
      { x: 10, y: 0, altitudeFt: 0 },
      { x: 0, y: 0, altitudeFt: 0 },
      { x: 0, y: 0, altitudeFt: 0 },
      1,
      100,
    ),
    false,
  );
});
test("invalid action batch is atomic and ineligible", () => {
  const s = one();
  s.step([
    { id: s.flights[0].id, clear: true },
    { id: "unknown", clear: true },
  ]);
  assert.equal(s.flights[0].status, "holding");
  assert.equal(s.errors, 1);
  assert.equal(s.summary().eligible, false);
});
test("reject NaN, out-of-range speeds and duplicate commands", () => {
  const s = one(),
    id = s.flights[0].id;
  for (const speedKnots of [NaN, Infinity, 0, 999])
    assert.throws(() => s.validate([{ id, speedKnots }]));
  assert.throws(() => s.validate([{ id }, { id }]));
});
test("occupied runway cannot yield a safe landing", () => {
  const s = one();
  s.airports[0].busyUntil = 10000;
  s.step([{ id: s.flights[0].id, clear: true }]);
  finish(s);
  assert.equal(s.summary().safeLandings, 0);
  assert.equal(s.summary().runwayIncidents, 1);
});
test("closed runway is enforced at touchdown", () => {
  const s = one();
  s.level.closures = true;
  s.rules.closureStartSeconds = 0;
  s.rules.closureEndSeconds = 3600;
  s.step([{ id: s.flights[0].id, clear: true }]);
  finish(s);
  assert.equal(s.summary().runwayIncidents, 1);
});
test("unsafe aircraft never earns safe landing credit", () => {
  const s = one();
  s.flights[0].unsafe = true;
  s.step([{ id: s.flights[0].id, clear: true }]);
  assert.equal(finish(s).safeLandings, 0);
  assert.equal(s.summary().totalLandings, 1);
});
test("collision removes both aircraft before landing credit", () => {
  const s = one(),
    f = s.flights[0];
  s.flights.push({ ...f, id: "AA9999" });
  s.step([
    { id: f.id, clear: true },
    { id: "AA9999", clear: true },
  ]);
  assert.equal(s.summary().collisions, 1);
  assert.equal(s.summary().safeLandings, 0);
  assert.equal(s.flights.filter((f) => f.status === "crashed").length, 2);
});
test("verifier rejects forged scores, truncation, noncanonical and duplicate episodes", () => {
  const s = new Simulation(config, { seed: 42 });
  finish(s);
  const e = { level: 1, seed: 42, trace: s.actions, score: s.summary() };
  const run = {
    schema: 1,
    version: config.version,
    configHash: fingerprint(config),
    agent: "idle",
    episodes: [e],
    score: aggregate([e]),
  };
  assert.deepEqual(verifyRun(config, run), run.score);
  assert.throws(() => verifyRun(config, run, { official: true }));
  const forged = structuredClone(run);
  forged.episodes[0].score.safeLandings = 999;
  assert.throws(() => verifyRun(config, forged));
  const short = structuredClone(run);
  short.episodes[0].trace.pop();
  assert.throws(() => verifyRun(config, short));
  assert.throws(() => verifyRun(config, { ...run, episodes: [e, e] }));
});
test("difficulty raises airports and traffic; stress is practice only", () => {
  for (let i = 1; i < config.levels.length; i++) {
    assert.ok(config.levels[i].airports > config.levels[i - 1].airports);
    assert.ok(config.levels[i].flights > config.levels[i - 1].flights);
  }
  assert.equal(
    new Simulation(config, { level: 5, stress: 2 }).flights.length,
    768,
  );
});
