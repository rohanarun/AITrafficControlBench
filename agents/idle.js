// Zero-action control, not a competitive policy. Useful for installation checks.
import readline from "node:readline";
for await (const line of readline.createInterface({ input: process.stdin })) {
  JSON.parse(line);
  process.stdout.write('{"actions":[]}\n');
}
