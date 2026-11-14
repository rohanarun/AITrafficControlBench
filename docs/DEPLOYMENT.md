# Deployment

The production service is isolated from the main getsupers.com application. The public website host proxies `/airspace/` over verified TLS to the application host. `deploy/nginx-public.conf` shows this outer route; `deploy/nginx.conf` shows the application-host route. The outer route resets forwarded client IPs after validating Cloudflare source networks, and `ATC_TRUSTED_PROXIES` names only the trusted upstream host.

Production layout:

- Public route: `/airspace/`, REST `/airspace/api`, MCP `/airspace/mcp`.
- Source/build: `/var/www/airspace-arena`.
- Dedicated Node.js 22 runtime: `/opt/airspace-arena-node`.
- Dedicated unprivileged systemd service: `airspace-arena`.
- Durable sessions/results: `/var/lib/airspace-arena` (private; back it up).
- Loopback listener: `127.0.0.1:8791`; nginx terminates TLS.

Build with `npm ci && npm test && npm run build`. Install production dependencies with `npm ci --omit=dev`. Use the templates in `deploy/`, adapting paths/port as needed. Preserve the persistent data directory across releases. Keep one service process: the file store serializes writes within that process and does not support multiple workers. Use a transactional shared store before horizontal scaling.

Before changing nginx, back up its owning configuration, add only the route include to the intended TLS server, run `nginx -t`, and reload. Existing application services need no restart. Verify the homepage, health API, REST session lifecycle and `node scripts/mcp-smoke.mjs https://YOUR_HOST/airspace/mcp` after deployment. Smoke runs are practice-only.

The UI is built for `/airspace/`. Set `VITE_BASE_PATH` for another path, `ATC_BASE_PATH` on the server, and `VITE_API_URL` for the UI's API origin. Server environment: `PORT`, `HOST`, `ATC_DATA_DIR`, `ATC_ALLOWED_ORIGINS` and `ATC_TRUSTED_PROXIES` (comma separated). A single-process disk queue limits concurrency; monitor latency, disk growth and memory before expanding public load.

Sessions expire after 24 hours and are removed during new-session creation. Public results are retained. There are no per-IP request or session-creation rate limits on REST or MCP. The active-session capacity cap and JSON body limit remain. The service accepts action JSON, never executable user code or arbitrary model URLs. Agent identities are not authenticated. Completed results are public; do not put private data in controller names.

Rollback: restore the prior source/build, restart only `airspace-arena`, and retain durable data. Version changes must preserve archived configurations and dispatch existing sessions/replay verification to their recorded version. If an engine change cannot replay a historical version, retain a separate old service/data directory rather than reinterpreting stored state. To remove the route, restore only its nginx include, validate, and reload; do not replace unrelated concurrent configuration changes.
