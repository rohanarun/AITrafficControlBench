import test from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, mkdir } from "node:fs/promises";
import { ArenaService } from "../server/service.js";
const config = JSON.parse(
  await readFile(
    new URL("../config/releases/0.1.0.json", import.meta.url),
    "utf8",
  ),
);
async function setup(t, { short = true } = {}) {
  const c = structuredClone(config);
  if (short) {
    c.rules.durationSeconds = 60;
    c.rules.arrivalWindowSeconds = 1;
    c.levels[0].flights = 1;
  }
  const base = new URL("../.local/", import.meta.url);
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(fileURLToPath(new URL("test-service-", base)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { s: await new ArenaService(c, dir).init(), dir, c };
}
test("sessions require secret token and reject stale revisions", async (t) => {
  const { s } = await setup(t);
  const r = await s.start({ agentName: "tester", practice: true });
  await assert.rejects(
    s.observe({ sessionId: r.sessionId, sessionToken: "x" }),
  );
  const args = {
    sessionId: r.sessionId,
    sessionToken: r.sessionToken,
    revision: 0,
    actions: [],
  };
  const a = await s.act(args);
  assert.equal(a.revision, 1);
  await assert.rejects(s.act(args), /Stale/);
});
test("session state survives restart and hides future arrivals", async (t) => {
  const { s, dir, c } = await setup(t, { short: false });
  const r = await s.start({ agentName: "test", practice: true });
  const auth = { sessionId: r.sessionId, sessionToken: r.sessionToken };
  const a = await s.act({ ...auth, revision: 0, actions: [], steps: 2 });
  const reopened = await new ArenaService(c, dir).init();
  assert.deepEqual(await reopened.observe(auth), a);
  assert.ok(a.observation.aircraft.every((f) => f.spawn <= a.observation.time));
});
test("competition requires all three scenarios and finalization is idempotent", async (t) => {
  const { s } = await setup(t);
  let r = await s.start({ agentName: "idle-check" });
  const auth = { sessionId: r.sessionId, sessionToken: r.sessionToken };
  await assert.rejects(s.next({ ...auth, revision: r.revision }), /Finish/);
  for (let i = 0; i < 3; i++) {
    r = await s.act({ ...auth, revision: r.revision, actions: [], steps: 2 });
    r = await s.next({ ...auth, revision: r.revision });
  }
  assert.equal(r.finished, true);
  assert.equal((await s.leaderboard()).rows.length, 1);
  await s.next({ ...auth, revision: r.revision });
  assert.equal((await s.leaderboard()).rows.length, 1);
  const replay = await s.replay(r.sessionId);
  assert.equal(replay.episodes.length, 3);
  assert.equal(JSON.stringify(replay).includes(auth.sessionToken), false);
});
test("practice never enters public leaderboard", async (t) => {
  const { s } = await setup(t);
  let r = await s.start({ agentName: "practice", practice: true });
  const auth = { sessionId: r.sessionId, sessionToken: r.sessionToken };
  r = await s.act({ ...auth, revision: r.revision, actions: [], steps: 2 });
  r = await s.next({ ...auth, revision: r.revision });
  assert.equal(r.finished, true);
  assert.equal((await s.leaderboard()).rows.length, 0);
});
test("concurrent actions serialize; exactly one revision succeeds", async (t) => {
  const { s } = await setup(t);
  const r = await s.start({ agentName: "race", practice: true });
  const a = {
    sessionId: r.sessionId,
    sessionToken: r.sessionToken,
    revision: 0,
    actions: [],
  };
  const results = await Promise.allSettled([s.act(a), s.act(a)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});
test("invalid command cannot mutate session or revision", async (t) => {
  const { s } = await setup(t);
  const r = await s.start({ agentName: "invalid", practice: true });
  const auth = { sessionId: r.sessionId, sessionToken: r.sessionToken };
  await assert.rejects(
    s.act({ ...auth, revision: 0, actions: [{ id: "not-real", clear: true }] }),
  );
  assert.equal((await s.observe(auth)).revision, 0);
});
test("public live feed excludes credentials, future arrivals and practice sessions", async (t) => {
  const { s } = await setup(t, { short: false });
  await s.start({ agentName: "private-practice", practice: true });
  assert.equal((await s.live()).run, null);
  const r = await s.start({ agentName: "public-competition" });
  s.liveCache = null;
  const feed = await s.live();
  assert.equal(feed.run.agentName, "public-competition");
  assert.equal(JSON.stringify(feed).includes(r.sessionToken), false);
  assert.equal("sessionToken" in feed.run, false);
  assert.ok(
    feed.run.observation.aircraft.every(
      (f) => f.spawn <= feed.run.observation.time,
    ),
  );
});
test("old sessions retain their original version after service upgrade", async (t) => {
  const { s, dir, c } = await setup(t);
  const oldRun = await s.start({ agentName: "legacy", practice: true });
  const next = structuredClone(c);
  next.version = "test-upgrade";
  next.rules.fuelSeconds = 1;
  const upgraded = await new ArenaService(next, dir, {
    versions: { [c.version]: c },
  }).init();
  const view = await upgraded.observe({
    sessionId: oldRun.sessionId,
    sessionToken: oldRun.sessionToken,
  });
  assert.equal(view.observation.version, c.version);
  assert.equal(view.observation.rules.fuelSeconds, c.rules.fuelSeconds);
});
