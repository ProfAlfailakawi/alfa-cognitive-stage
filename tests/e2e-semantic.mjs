// Local semantic slide matching in the real lecturer page. With the embedding model installed (npm run fetch:embedder)
// a sentence that is clearly about another slide offers a jump; without it the page says so and stays silent.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createNeuralEmbedder } from "../server/neural-embed.mjs";
import { slides as GOLD } from "./fixtures/slide-gold.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 4341, base = `http://localhost:${port}`, ADMIN = "semantic-test-token-0123456789ab", A = "abcdef012345";
const failures = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) failures.push(name); };
const installed = createNeuralEmbedder({ dir: process.env.ALFA_EMBED_DIR || join(root, "data", "embedder") }).status().available;
const scratch = mkdtempSync(join(tmpdir(), "alfa-semantic-e2e-"));
const bundles = join(scratch, "bundles");
cpSync(join(root, "bundles/testfixture1"), join(bundles, A), { recursive: true });
const manifest = JSON.parse(readFileSync(join(bundles, A, "manifest.json"), "utf8"));
manifest.id = A; manifest.slides.forEach((s, i) => { s.text = GOLD[i] || ""; });
writeFileSync(join(bundles, A, "manifest.json"), JSON.stringify(manifest));
writeFileSync(join(bundles, "current.json"), JSON.stringify({ id: A }));
writeFileSync(join(bundles, "lectures.json"), JSON.stringify([{ id: A, title: "اختبار", slideCount: manifest.slides.length }]));
const server = spawn(process.execPath, [join(root, "server/server.mjs")], { env: { ...process.env, PORT: String(port), ADMIN_TOKEN: ADMIN, ALFA_BUNDLES_DIR: bundles,
  LIBRARY_FILE: join(scratch, "l.json"), VOTES_FILE: join(scratch, "v.json"), SCENES_FILE: join(scratch, "s.json"), QUESTION_BANK_FILE: join(scratch, "b.json"), DIRECTOR_USAGE_FILE: join(scratch, "u.json") }, stdio: ["ignore", "pipe", "pipe"] });
await new Promise((r) => server.stdout.once("data", r));
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ["--no-sandbox"] });
const FAKE = () => {
  window.__rec = null;
  window.SpeechRecognition = class { constructor() { window.__rec = this; } start() { this.running = true; } stop() { this.running = false; setTimeout(() => this.onend?.(), 0); } static available() { return Promise.resolve("unavailable"); } };
  window.__say = (final) => window.__rec.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: final } }] });
};
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1500 } });
  await ctx.addInitScript(FAKE);
  await ctx.addInitScript((t) => { try { sessionStorage.setItem("alfa-admin-token", t); } catch {} }, ADMIN);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { console.log("pageerror: " + e); failures.push("pageerror"); });
  await page.goto(`${base}/?dev=1#presenter`);
  await page.waitForSelector("#director-start");
  await page.fill("#director-admin-token", ADMIN);
  await page.click("#director-start");
  await page.waitForSelector("#semantic-status:not([hidden])", { timeout: 8000 });
  const status = await page.textContent("#semantic-status");
  check("the page states whether local semantic matching is available", installed ? status.includes("متاحة") : status.includes("غير مثبتة"), status);
  await page.evaluate(() => window.__say("نقسمهم مجموعات خمسة خمسة ويشتغلون سوا على مشروع"));
  if (installed) {
    await page.waitForSelector("#slide-hint:not([hidden])", { timeout: 20000 });
    check("a sentence clearly about slide 5 offers a jump to it", (await page.textContent("#slide-hint-text")).includes("الشريحة 5"), await page.textContent("#slide-hint-text"));
    check("the stage did not move by itself", (await page.textContent("#meta")).includes("1 من"));
    await page.click("#slide-hint-go");
    await page.waitForFunction(() => document.querySelector("#meta")?.textContent?.includes("5 من"), null, { timeout: 5000 });
    check("accepting the hint moves the stage", true);
    check("the hint closes once used", await page.locator("#slide-hint").isHidden());
    await page.evaluate(() => window.__say("نقسمهم مجموعات خمسة خمسة ويشتغلون سوا على مشروع"));
    await page.waitForTimeout(1500);
    check("no hint when the sentence matches the slide already on screen", await page.locator("#slide-hint").isHidden());
  } else {
    await page.waitForTimeout(1500);
    check("without the model no hint is ever shown", await page.locator("#slide-hint").isHidden());
  }
  await ctx.close();
} finally { await browser.close(); server.kill("SIGTERM"); }
if (failures.length) { console.log("FAILED: " + failures.join(", ")); process.exit(1); }
console.log("semantic e2e: all checks passed" + (installed ? "" : " (model not installed: hint path SKIPPED)"));
