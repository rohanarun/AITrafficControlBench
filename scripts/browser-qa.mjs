import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
await mkdir(".local/qa", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const target = process.argv[2] || "http://127.0.0.1:8791/airspace/";
for (const [name, width, height] of [
  ["desktop", 1440, 1000],
  ["mobile", 390, 844],
]) {
  await page.setViewportSize({ width, height });
  await page.goto(target, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Copy prompt" }).waitFor();
  await page.waitForTimeout(1500);
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Horizontal overflow");
  if (await page.getByText("Every landing", { exact: false }).count())
    throw Error("Removed hero still present");
  await page.screenshot({
    path: `.local/qa/${name}-minimal.png`,
    fullPage: true,
    timeout: 15000,
  });
}
await page.getByRole("button", { name: "Copy prompt" }).click();
await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
console.log(
  JSON.stringify({ errors, desktopMobile: "passed", clipboard: "passed" }),
);
await browser.close();
if (errors.length) process.exitCode = 1;
