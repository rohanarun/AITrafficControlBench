import readline from "node:readline";
import { readFile } from "node:fs/promises";
const prompt = await readFile(
  new URL("../prompts/controller.md", import.meta.url),
  "utf8",
);
const {
  ATC_API_KEY,
  ATC_MODEL,
  ATC_BASE_URL = "https://api.openai.com/v1",
} = process.env;
if (!ATC_MODEL)
  throw new Error(
    "Set ATC_MODEL and optionally ATC_API_KEY / ATC_BASE_URL. This adapter calls your configured provider.",
  );
for await (const line of readline.createInterface({ input: process.stdin })) {
  try {
    const observation = JSON.parse(line);
    const response = await fetch(
      `${ATC_BASE_URL.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        signal: AbortSignal.timeout(45000),
        headers: {
          "Content-Type": "application/json",
          ...(ATC_API_KEY ? { Authorization: `Bearer ${ATC_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          model: ATC_MODEL,
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: JSON.stringify(observation) },
          ],
          response_format: { type: "json_object" },
        }),
      },
    );
    if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
    const body = await response.json(),
      result = JSON.parse(body.choices[0].message.content);
    if (!Array.isArray(result.actions))
      throw new Error("Model response needs actions array");
    process.stdout.write(JSON.stringify({ actions: result.actions }) + "\n");
  } catch (e) {
    console.error(e.message);
    process.stdout.write(JSON.stringify({ error: e.message }) + "\n");
  }
}
