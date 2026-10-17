// The whole voice path in real Chromium with a scripted recogniser: engine choice, latency from the
// first transcript to the painted scene, offline fallback, denied microphone, failing service, video silence.
// The recogniser is FAKE: this proves our handling, not recognition quality on a real Mac.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 4193, base = `http://localhost:${port}`;
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures.push(name);
};
const server = spawn(process.execPath, [join(root, "server/server.mjs")], {
  env: { ...process.env, PORT: String(port), ADMIN_TOKEN: "speech-test-token-0123456789abc", VOTES_FILE: "/tmp/alfa-speech-votes.json", SCENES_FILE: "/tmp/alfa-speech-scenes-" + Date.now() + ".json" },
  stdio: ["ignore", "pipe", "pipe"] });
await new Promise((r) => server.stdout.once("data", r));
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });

const FAKE = () => {
  window.__rec = null; window.__starts = 0; window.__stops = 0; window.__localStatus = window.__localStatus || "unavailable";
  window.SpeechRecognition = class {
    constructor() { window.__rec = this; }
    start() { window.__starts++; this.running = true; }
    stop() { window.__stops++; this.running = false; setTimeout(() => this.onend?.(), 0); }
    static available() { return Promise.resolve(window.__localStatus); }
  };
  window.__say = (interim, final, gap = 150) => {
    const r = window.__rec;
    r.onresult({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: interim } }] });
    if (final !== null) setTimeout(() => r.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: final } }] }), gap);
  };
};
async function open(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(FAKE);
  if (options.localStatus) await context.addInitScript((s) => { window.__localStatus = s; }, options.localStatus);
  const presenter = await context.newPage(), audience = await context.newPage();
  for (const [n, p] of [["presenter", presenter], ["audience", audience]]) p.on("pageerror", (e) => { console.log(n + " pageerror: " + e); failures.push(n + " pageerror"); });
  await audience.goto(`${base}/#audience`);
  await presenter.goto(`${base}/#presenter`);
  await presenter.waitForSelector("#director-start");
  return { context, presenter, audience };
}
const status = (p) => p.locator("#director-status").textContent();
try {
  // ---- cloud engine, full path with latency ----
  {
    const { context, presenter, audience } = await open();
    await presenter.click("#director-start");
    await presenter.waitForFunction(() => window.__starts === 1);
    check("cloud engine is used when no on-device language pack is reported", (await status(presenter)).includes("خدمة المتصفح"), await status(presenter));
    await presenter.evaluate(() => window.__say("في دراسة طلعت", "في دراسة طلعت إن ٦٨ بالمية من الطلبة استفادوا"));
    await audience.waitForSelector(".info-layer svg", { timeout: 6000 });
    check("spoken statistic reaches the audience screen", (await audience.locator(".info-layer").textContent()).includes("68%"));
    await presenter.waitForFunction(() => document.querySelector("#director-voice-health")?.textContent?.includes("وسيط"));
    const health = await presenter.locator("#director-voice-health").textContent();
    const local = Number(health.match(/بعد النص النهائي: وسيط (\d+)ms/)?.[1]);
    const total = Number(health.match(/من أول معاينة: وسيط (\d+)ms/)?.[1]);
    check("latency is measured from the first transcript to the painted scene", Number.isFinite(local) && Number.isFinite(total) && total >= 100 && total >= local, health);
    check("local processing (final transcript to painted scene) stays under 500 ms", local < 500, local + " ms");
    check("health line says it is not a waveform measurement", health.includes("لا من موجة الصوت"));
    await context.close();
  }
  // ---- on-device engine when the browser says the pack is installed ----
  {
    const { context, presenter } = await open({ localStatus: "available" });
    await presenter.click("#director-start");
    await presenter.waitForFunction(() => window.__starts === 1);
    const flag = await presenter.evaluate(() => window.__rec.processLocally), text = await status(presenter);
    check("on-device recognition is enabled only when the browser reports it available", flag === true && text.includes("على الجهاز"), JSON.stringify({ flag, text }));
    await context.close();
  }
  {
    const { context, presenter } = await open({ localStatus: "downloadable" });
    await presenter.click("#director-start");
    await presenter.waitForFunction(() => window.__starts === 1);
    check("a language pack that is merely downloadable is NOT claimed as local",
      await presenter.evaluate(() => !window.__rec.processLocally) && (await presenter.locator("#director-voice-health").textContent().catch(() => "")) !== undefined);
    await presenter.evaluate(() => window.__say("اختبار", "اختبار الاستماع الآن"));
    await presenter.waitForFunction(() => document.querySelector("#director-voice-health")?.textContent?.includes("downloadable"));
    check("the health line shows why the cloud engine is used", true);
    await context.close();
  }
  // ---- denied microphone: stop, explain, offer the typed fallback, never loop ----
  {
    const { context, presenter } = await open();
    await presenter.click("#director-start");
    await presenter.waitForFunction(() => window.__starts === 1);
    await presenter.evaluate(() => { window.__rec.onerror({ error: "not-allowed" }); window.__rec.onend(); });
    await presenter.waitForTimeout(3000);
    check("denied microphone does not retry", await presenter.evaluate(() => window.__starts) === 1);
    check("typed fallback is brought forward", await presenter.locator("#director-test-text").isVisible());
    // A microphone plugged in later after an audio-capture failure resumes listening once.
    await presenter.click("#director-start");
    await presenter.waitForFunction(() => window.__starts === 2);
    await presenter.evaluate(() => { window.__rec.onerror({ error: "audio-capture" }); window.__rec.onend(); });
    await presenter.waitForTimeout(1500);
    await presenter.evaluate(() => navigator.mediaDevices.dispatchEvent(new Event("devicechange")));
    await presenter.waitForFunction(() => window.__starts === 3, null, { timeout: 4000 });
    check("a newly connected microphone resumes listening", true);
    await context.close();
  }
  // ---- failing service: bounded back-off ----
  {
    const { context, presenter } = await open();
    await presenter.click("#director-start");
    await presenter.waitForFunction(() => window.__starts === 1);
    await presenter.evaluate(() => { window.__rec.onerror({ error: "network" }); window.__rec.onend(); });
    await presenter.waitForTimeout(2500);
    const afterFirst = await presenter.evaluate(() => window.__starts);
    await presenter.evaluate(() => { window.__rec.onerror({ error: "network" }); window.__rec.onend(); });
    await presenter.waitForTimeout(2500);
    const afterSecond = await presenter.evaluate(() => window.__starts);
    check("a stopped recognition service is retried with growing delays, not in a loop", afterFirst === 2 && afterSecond <= 3, `${afterFirst}, ${afterSecond}`);
    check("the lecture keeps working while the service is down", (await presenter.textContent("#meta")).includes("1 من"));
    await context.close();
  }
  // ---- offline: no cloud service; resumes by itself when the connection returns ----
  {
    const { context, presenter } = await open();
    await context.setOffline(true);
    await presenter.waitForFunction(() => navigator.onLine === false);
    await presenter.click("#director-start");
    await presenter.waitForFunction(() => document.querySelector("#director-status")?.textContent?.includes("لا يوجد إنترنت"));
    check("offline: cloud recognition is not attempted and the typed fallback opens", await presenter.evaluate(() => window.__starts) === 0 &&
      await presenter.locator("#director-test-text").isVisible());
    await presenter.fill("#director-test-text", "في دراسة طلعت إن 41 بالمية من الطلبة استفادوا");
    await presenter.click("#director-test-run");
    check("typed statistic still produces a scene while offline", await presenter.locator("#director-proposal, .info-layer").first().isVisible().catch(() => false));
    await context.setOffline(false);
    await presenter.waitForFunction(() => window.__starts === 1, null, { timeout: 5000 });
    check("listening resumes automatically when the connection returns", true);
    await context.close();
  }
  // ---- video silences listening and ignores speech ----
  {
    const { context, presenter, audience } = await open();
    await presenter.click("#director-start");
    await presenter.waitForFunction(() => window.__starts === 1);
    for (let i = 0; i < 12 && !(await presenter.textContent("#meta")).includes("7 من"); i++) { await presenter.keyboard.press("ArrowRight"); await presenter.waitForTimeout(120); }
    await presenter.waitForSelector("video.clip");
    await presenter.locator("video.clip").evaluate((v) => { v.muted = true; return v.play(); });
    await presenter.waitForFunction(() => window.__stops >= 1);
    await presenter.evaluate(() => window.__rec.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "في دراسة طلعت إن ٦٨ بالمية من الطلبة استفادوا" } }] }));
    await presenter.waitForTimeout(500);
    check("speech recognised while a video plays is ignored", (await audience.locator(".info-layer").count()) === 0 && !(await presenter.locator("#director-proposal").isVisible()));
    await context.close();
  }
  // ---- reversible command from a stable interim transcript ----
  {
    const { context, presenter, audience } = await open();
    await presenter.click("#director-start");
    await presenter.waitForFunction(() => window.__starts === 1);
    await presenter.click("#toggle-info");
    await presenter.fill("#info-title", "نسبة"); await presenter.fill("#info-lines", "68%\nمن حديث المحاضر");
    await presenter.click("#info-show");
    await audience.waitForSelector(".info-layer");
    await presenter.evaluate(() => window.__say("خلونا نرجع للعرض", null));
    await audience.waitForFunction(() => !document.querySelector(".info-layer"), null, { timeout: 3000 });
    check("'return' is honoured from a stable interim transcript before the sentence ends", true);
    await presenter.evaluate(() => window.__say("في دراسة طلعت إن ٦٨ بالمية", null));
    await presenter.waitForTimeout(1500);
    check("a statistic is NEVER shown from an unfinished (interim) transcript", (await audience.locator(".info-layer").count()) === 0);
    await context.close();
  }
} catch (error) {
  console.error(error); failures.push("exception");
} finally {
  await browser.close(); server.kill();
}
if (failures.length) { console.log(`\n${failures.length} check(s) failed`); process.exit(1); }
console.log("\nall voice-path checks passed");
