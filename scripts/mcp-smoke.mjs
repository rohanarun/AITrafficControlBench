import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import assert from "node:assert/strict";
const endpoint = process.argv[2] || "http://127.0.0.1:8791/airspace/mcp";
const c = new Client({ name: "airspace-smoke", version: "1.0" });
await c.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
const tools = await c.listTools();
assert.equal(tools.tools.length, 6);
const call = async (name, args = {}) => {
  const r = await c.callTool({ name, arguments: args });
  if (r.isError) throw new Error(r.content[0].text);
  return JSON.parse(r.content[0].text);
};
let r = await call("airspace_start", {
  agentName: "MCP integration smoke test",
  practice: true,
  level: 1,
  seed: 42,
});
const auth = { sessionId: r.sessionId, sessionToken: r.sessionToken };
const observed = await call("airspace_observe", auth);
assert.equal(observed.revision, 0);
while (!r.scenarioComplete)
  r = await call("airspace_act", {
    ...auth,
    revision: r.revision,
    actions: [],
    steps: 10,
  });
r = await call("airspace_next", { ...auth, revision: r.revision });
assert.equal(r.finished, true);
assert.equal(r.mode, "practice");
const board = await call("airspace_leaderboard");
assert.ok(!board.rows.some((x) => x.id === auth.sessionId));
console.log(
  JSON.stringify({
    endpoint,
    tools: tools.tools.map((t) => t.name),
    complete: r.finished,
    practiceExcluded: true,
  }),
);
await c.close();
