# Verified live baseline

The Codex forecasting controller completed level 1 through the public MCP service: **24/24 safe landings across all three scenarios**, with zero separation losses, collisions, runway incidents or fuel exhaustion.

[Server result and replay](https://getsupers.com/airspace/api/results/ad98e0e4-a3da-4617-a80c-e5a9d1a5014b) · [Controller source](../examples/mcp_forecast.mjs)

The JSON here is the actual server-executed replay, independently replay-verified with `node src/cli.js verify`. It contains no session token. This is a script controller using observed-aircraft forecasts; it is not a standalone language-model performance claim. This per-tier result is separate from the local 15-scenario full-suite track.
