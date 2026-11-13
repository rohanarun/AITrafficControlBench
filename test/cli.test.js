import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
const exec = promisify(execFile),
  cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
test("missing agent executable fails promptly rather than hanging", async () => {
  await assert.rejects(
    exec(
      process.execPath,
      [cli, "run", "--command", '["airspace-nonexistent-agent-command"]'],
      { timeout: 4000 },
    ),
    (e) => {
      assert.equal(e.killed, false);
      assert.match(e.stderr, /ENOENT/);
      return true;
    },
  );
});
test("agent crash fails the run without a claimed score", async () => {
  await assert.rejects(
    exec(
      process.execPath,
      [
        cli,
        "run",
        "--command",
        JSON.stringify([process.execPath, "-e", "process.exit(2)"]),
      ],
      { timeout: 4000 },
    ),
    (e) => {
      assert.equal(e.killed, false);
      assert.match(e.stderr, /Agent exited/);
      return true;
    },
  );
});
