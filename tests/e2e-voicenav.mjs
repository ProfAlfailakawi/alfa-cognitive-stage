// Spoken slide navigation in real Chromium: strict commands, video guard, undo, duplicate guard, audience mirroring.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 4302, base = `http://localhost:${port}`;
const failures = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) failures.push(name); };
const scratch = mkdtempSync(join(tmpdir(), "alfa-voicenav-"));
const server = spawn(process.execPath, [join(root, "server/server.mjs")], {
  env: { ...process.env, PORT: String(port), ADMIN_TOKEN: "voicenav-test-token-0123456789a", VOTES_FILE: join(scratch, "v.json"), SCENES_FILE: join(scratch, "s.json"),
    QUESTION_BANK_FILE: join(scratch, "b.json"), DIRECTOR_USAGE_FILE: join(scratch, "u.json") }, stdio: ["ignore", "pipe", "pipe"] });
await new Promise((r) => server.stdout.once("data", r));
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
const FAKE = () => {
  window.__rec = null;
  window.SpeechRecognition = class { constructor() { window.__rec = this; } start() { this.running = true; } stop() { this.running = false; setTimeout(() => this.onend?.(), 0); } static available() { return Promise.resolve("unavailable"); } };
  window.__say = (final) => window.__rec.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: final } }] });
};
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(FAKE);
  const presenter = await context.newPage(), audience = await context.newPage();
  for (const [n, p] of [["presenter", presenter], ["audience", audience]]) p.on("pageerror", (e) => { console.log(n + " pageerror: " + e); failures.push(n + " pageerror"); });
  await audience.goto(`${base}/#audience`);
  await audience.waitForSelector("#slide-img");
  await presenter.goto(`${base}/?dev=1#presenter`);
  await presenter.waitForSelector("#director-start");
  await presenter.click("#director-start");
  await presenter.waitForFunction(() => window.__rec?.running);
  const say = async (text) => { await presenter.evaluate((t) => window.__say(t), text); await presenter.waitForTimeout(450); };
  const meta = () => presenter.textContent("#meta");
  const status = () => presenter.textContent("#director-status");

  await say("الشريحة التالية");
  check("«الشريحة التالية» moves forward", (await meta()).includes("2 من"), await meta());
  await audience.waitForFunction(() => document.querySelector("#slide-img")?.getAttribute("src")?.includes("002"), null, { timeout: 4000 });
  check("the audience screen follows a spoken move", true);
  await say("في الشريحة التالية سنرى النتائج");
  check("a sentence that only mentions the next slide does nothing", (await meta()).includes("2 من"), await meta());
  await say("روح للشريحة خمسة");
  check("«روح للشريحة خمسة» jumps to slide 5", (await meta()).includes("5 من"), await meta());
  await say("السابقة");
  check("«السابقة» goes back", (await meta()).includes("4 من"));
  check("an undo button is offered", await presenter.locator("#nav-undo").isVisible());
  await presenter.click("#nav-undo");
  check("undo returns to where the lecturer was", (await meta()).includes("5 من"), await meta());
  await say("الشريحة 99");
  check("a slide that does not exist is refused with an explanation", (await meta()).includes("5 من") && (await status()).includes("غير موجودة"), await status());

  // duplicate guard: the same command twice within 2 s moves once
  await say("أول شريحة");
  await presenter.evaluate(() => { window.__say("التالية"); window.__say("التالية"); });
  await presenter.waitForTimeout(500);
  check("a repeated command inside 2 s is applied once", (await meta()).includes("2 من"), await meta());

  // click builds: slide 3 has three; "next" is click-aware like the Next button
  await presenter.waitForTimeout(3700); // the speech engine itself drops an identical transcript heard within 3.5 s
  await say("التالية");
  check("«التالية» steps through the slide's click build first", (await meta()).includes("3 من") && (await meta()).includes("حركة 0"), await meta());
  await presenter.waitForTimeout(3700);
  await say("التالية");
  check("…then the next build, exactly like the button", (await meta()).includes("حركة 1"), await meta());

  // video guard
  await say("آخر شريحة");
  check("«آخر شريحة» reaches the last slide", (await meta()).includes("7 من"), await meta());
  await presenter.click("#playvid");
  await presenter.waitForFunction(() => [...document.querySelectorAll("video")].some((v) => !v.paused), null, { timeout: 6000 });
  await presenter.waitForTimeout(2100);
  await say("السابقة");
  check("while a video plays, spoken navigation is ignored and says why", (await meta()).includes("7 من") && (await status()).includes("الفيديو"), await status());
  await presenter.evaluate(() => document.querySelectorAll("video").forEach((v) => v.pause()));
  await presenter.waitForTimeout(2100);
  await say("السابقة");
  check("once the video is paused the command works again", (await meta()).includes("6 من"), await meta());

  // switch off
  await presenter.uncheck("#director-nav");
  await presenter.waitForTimeout(2100);
  await say("الشريحة التالية");
  check("with the switch off, nothing moves", (await meta()).includes("6 من"), await meta());
  check("return commands still work (they are separate)", true);
} catch (error) {
  console.log("FAIL  unexpected: " + (error.stack || error));
  failures.push("unexpected");
} finally {
  await browser.close();
  server.kill();
  rmSync(scratch, { recursive: true, force: true });
}
if (failures.length) { console.log("\nFAILED:", failures.join("; ")); process.exit(1); }
console.log("\nvoice-nav e2e: all checks passed");
