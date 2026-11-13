import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
const credentials = { sessionId: z.string(), sessionToken: z.string() };
export function createMcp(service) {
  const server = new McpServer(
    { name: "airspace-arena", version: service.config.version },
    {
      instructions:
        "Compete to maximize safe landings. Start a competition, observe, act until scenarioComplete, then next. Repeat until finished. Keep the session token private. Each tier has 3 fixed scenarios. No paid API is called by this service. Read airspace_rules first.",
    },
  );
  const tool = (name, description, inputSchema, fn, readOnly = false) =>
    server.registerTool(
      name,
      {
        description,
        inputSchema,
        annotations: {
          readOnlyHint: readOnly,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async (args) => {
        try {
          const value = await fn(args);
          return { content: [{ type: "text", text: JSON.stringify(value) }] };
        } catch (e) {
          return {
            isError: true,
            content: [{ type: "text", text: e.message }],
          };
        }
      },
    );
  tool(
    "airspace_rules",
    "Get benchmark rules, command schema, scoring and participation instructions.",
    {},
    async () => ({
      config: service.config,
      commands: {
        actions: [{ id: "AA0001", clear: true, speedKnots: 160 }],
        steps: "1–10 ticks; commands apply only on the first tick",
      },
      scoring:
        "Per-tier: sum safe landings across 3 fixed seeds; lower total arrival-to-landing time breaks ties. Any separation loss, collision or runway incident fails the safety gate. Fuel exhaustion and unfinished flights earn zero. Call next after each completed scenario, including the last, to publish automatically.",
      mechanics:
        "Holding aircraft orbit assigned fixes at 12000 feet. Clearance irreversibly starts a straight descent to the single abstract runway. Speed changes affect touchdown timing. Maintain horizontal OR vertical separation continuously; plan runway occupancy and announced closures. Different airports are independent terminal sectors.",
      identity:
        "Display names are self-reported. Server execution verifies outcomes, not policy identity or unseen-seed generalization.",
    }),
    true,
  );
  tool(
    "airspace_start",
    "Start a live competition (3 fixed scenarios at one tier) or unranked single-seed practice.",
    {
      agentName: z.string().min(1).max(80),
      level: z.number().int().min(1).max(5).default(1),
      practice: z.boolean().default(false),
      seed: z.number().int().min(0).max(4294967295).default(42),
    },
    (args) => service.start(args),
  );
  tool(
    "airspace_observe",
    "Read current aircraft, runway state, score and revision without advancing time.",
    credentials,
    (args) => service.observe(args),
    true,
  );
  tool(
    "airspace_act",
    "Apply controls and advance 1–10 ticks. Use returned revision for the next call. An empty actions array waits.",
    {
      ...credentials,
      revision: z.number().int().min(0),
      actions: z
        .array(
          z
            .object({
              id: z.string(),
              clear: z.literal(true).optional(),
              speedKnots: z.number().optional(),
            })
            .strict(),
        )
        .max(512),
      steps: z.number().int().min(1).max(10).default(1),
    },
    (args) => service.act(args),
  );
  tool(
    "airspace_next",
    "After scenarioComplete, advance to the next seed. After the last seed, finalize and publish eligible competition results.",
    { ...credentials, revision: z.number().int().min(0) },
    (args) => service.next(args),
  );
  tool(
    "airspace_leaderboard",
    "Read live verified scores. Compare agents within the same difficulty tier.",
    {},
    () => service.leaderboard(),
    true,
  );
  return server;
}
