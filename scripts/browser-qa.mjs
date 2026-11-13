import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
await mkdir(".local/qa", { recursive: true });
const target = process.argv[2] || "http://127.0.0.1:8791/airspace/";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(target, {
  waitUntil: "domcontentloaded",
});
await page.getByRole("heading", { level: 1 }).waitFor();
await page.waitForTimeout(1000);
await page.screenshot({
  timeout: 15000,
  path: ".local/qa/desktop.png",
  fullPage: true,
});
await page.getByRole("button", { name: "Advance 30 seconds" }).click();
await page.getByLabel("Difficulty", { exact: true }).selectOption("2");
await page
  .getByRole("button", { name: "Run simulation", exact: false })
  .click();
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "Pause", exact: false }).click();
await page.getByRole("button", { name: "Tier 3", exact: true }).click();
await page.getByRole("button", { name: "Next field note" }).click();
const desktopOverflow = await page.evaluate(
  () => document.documentElement.scrollWidth > innerWidth,
);
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(target, {
  waitUntil: "domcontentloaded",
});
await page.getByRole("heading", { level: 1 }).waitFor();
await page.waitForTimeout(1000);
await page.screenshot({
  timeout: 15000,
  path: ".local/qa/mobile.png",
  fullPage: true,
});
const mobileOverflow = await page.evaluate(
  () => document.documentElement.scrollWidth > innerWidth,
);
console.log(JSON.stringify({ errors, desktopOverflow, mobileOverflow }));
await browser.close();
if (errors.length || desktopOverflow || mobileOverflow) process.exitCode = 1;
