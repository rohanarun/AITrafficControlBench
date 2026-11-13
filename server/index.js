import express from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ArenaService } from "./service.js";
import { createMcp } from "./mcp.js";
const root = fileURLToPath(new URL("../", import.meta.url));
const config = JSON.parse(
  await readFile(path.join(root, "config/benchmark.json"), "utf8"),
);
const service = await new ArenaService(
  config,
  process.env.ATC_DATA_DIR || path.join(root, ".local/server-data"),
).init();
if (process.argv.includes("--stdio")) {
  await createMcp(service).connect(new StdioServerTransport());
} else {
  const app = express(),
    base = process.env.ATC_BASE_PATH || "/airspace";
  app.enable("strict routing");
  app.disable("x-powered-by");
  app.set(
    "trust proxy",
    (process.env.ATC_TRUSTED_PROXIES || "loopback").split(","),
  );
  const limits = new Map();
  app.use(base, (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    const origin = req.headers.origin;
    const allowed = (
      process.env.ATC_ALLOWED_ORIGINS ||
      "https://getsupers.com,https://www.getsupers.com,http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:8791,http://localhost:8791"
    ).split(",");
    if (origin && !allowed.includes(origin))
      return res.status(403).json({ error: "Origin not allowed" });
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization,Content-Type,MCP-Protocol-Version,MCP-Session-Id",
      );
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    const now = Date.now(),
      key = req.ip;
    let limit = limits.get(key);
    if (!limit || now - limit.time > 60000) {
      limit = { time: now, count: 0, starts: 0 };
      limits.set(key, limit);
    }
    if (limits.size > 10000)
      for (const [k, v] of limits) if (now - v.time > 60000) limits.delete(k);
    if (++limit.count > 240)
      return res
        .status(429)
        .json({ error: "Request rate exceeded; wait one minute" });
    req.arenaLimit = limit;
    next();
  });
  app.use(base, express.json({ limit: "128kb" }));
  const route = (fn) => async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(await fn(req));
    } catch (e) {
      res.status(e.status || 400).json({ error: e.message });
    }
  };
  const auth = (req) => ({
    ...req.body,
    sessionId: req.params.id,
    sessionToken: req.headers.authorization?.replace(/^Bearer /, ""),
  });
  app.get(
    `${base}/api/health`,
    route(async () => ({ status: "ok", version: config.version })),
  );
  app.get(
    `${base}/api/rules`,
    route(async () => config),
  );
  app.get(
    `${base}/api/leaderboard`,
    route(() => service.leaderboard()),
  );
  app.get(
    `${base}/api/results/:id`,
    route((req) => service.replay(req.params.id)),
  );
  app.post(
    `${base}/api/sessions`,
    route((req) => {
      if (++req.arenaLimit.starts > 10)
        throw Object.assign(new Error("Session creation rate exceeded"), {
          status: 429,
        });
      return service.start(req.body);
    }),
  );
  app.get(
    `${base}/api/sessions/:id`,
    route((req) => service.observe(auth(req))),
  );
  app.post(
    `${base}/api/sessions/:id/actions`,
    route((req) => service.act(auth(req))),
  );
  app.post(
    `${base}/api/sessions/:id/next`,
    route((req) => service.next(auth(req))),
  );
  app.post(`${base}/mcp`, async (req, res) => {
    if (
      req.body?.method === "tools/call" &&
      req.body?.params?.name === "airspace_start" &&
      ++req.arenaLimit.starts > 10
    )
      return res.status(429).json({ error: "Session creation rate exceeded" });
    const server = createMcp(service),
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      if (!res.headersSent)
        res.status(500).json({ error: "MCP request failed" });
    }
  });
  app.all(`${base}/mcp`, (req, res) =>
    res
      .status(405)
      .set("Allow", "POST")
      .json({ error: "Use MCP Streamable HTTP POST" }),
  );
  app.use(`${base}/api`, (req, res) =>
    res.status(404).json({ error: "Unknown API endpoint" }),
  );
  app.get(base, (req, res) => res.redirect(`${base}/`));
  app.use(`${base}/`, express.static(path.join(root, "dist")));
  app.use((err, req, res, next) =>
    res
      .status(err.status || 500)
      .json({
        error: err.status === 413 ? "Request too large" : "Invalid request",
      }),
  );
  const port = Number(process.env.PORT || 8791),
    host = process.env.HOST || "127.0.0.1";
  const server = app.listen(port, host, () =>
    console.log(`Airspace Arena http://${host}:${port}${base}/`),
  );
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}
