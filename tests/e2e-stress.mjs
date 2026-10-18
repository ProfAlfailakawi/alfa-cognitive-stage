// Stability under a long, busy lecture: no CSP violations, no leaks, consistent presenter/audience state.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 4192, base = `http://localhost:${port}`, ADMIN = "stress-test-token-0123456789abcdef";
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures.push(name);
};
const server = spawn(process.execPath, [join(root, "server/server.mjs")], {
  env: { ...process.env, PORT: String(port), ADMIN_TOKEN: ADMIN, VOTES_FILE: "/tmp/alfa-stress-votes.json", SCENES_FILE: "/tmp/alfa-stress-scenes-" + Date.now() + ".json" },
  stdio: ["ignore", "pipe", "pipe"] });
await new Promise((r) => server.stdout.once("data", r));
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--enable-precise-memory-info", "--js-flags=--expose-gc"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const violations = [], errors = [];
const watch = (name, page) => {
  page.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) violations.push(name + ": " + t.slice(0, 160)); else if (m.type() === "error" && !/Failed to load resource.*(404|403|401)/.test(t)) errors.push(name + ": " + t.slice(0, 160)); });
  page.on("pageerror", (e) => errors.push(name + " pageerror: " + e));
};
const presenter = await context.newPage(), audience = await context.newPage();
watch("presenter", presenter); watch("audience", audience);
const stats = (page) => page.evaluate(() => globalThis.__alfaStats?.());
const cdp = await context.newCDPSession(presenter);
const heap = async () => { await cdp.send("HeapProfiler.collectGarbage"); await cdp.send("HeapProfiler.collectGarbage"); return (await cdp.send("Runtime.getHeapUsage")).usedSize; };
try {
  await audience.goto(`${base}/#audience`); await audience.waitForSelector("#slide-img");
  await presenter.goto(`${base}/?dev=1#presenter`); await presenter.waitForSelector("#meta");
  await presenter.waitForTimeout(1500);
  const before = await stats(presenter), heapBefore = await heap();

  // Idle cost of the lecturer window.
  await cdp.send("Performance.enable");
  const m0 = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
  await presenter.waitForTimeout(4000);
  const m1 = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
  const busy = (m1.TaskDuration - m0.TaskDuration) / (m1.Timestamp - m0.Timestamp);
  check("an idle lecturer window uses little CPU", busy < 0.25, (busy * 100).toFixed(1) + "% of one core");

  // 300 rapid navigation keys across animated and video slides, interleaved with scenes and returns.
  const form = async () => { if (await presenter.locator("#info-form").isHidden()) await presenter.click("#toggle-info"); };
  for (let round = 0; round < 10; round++) {
    for (let i = 0; i < 12; i++) await presenter.keyboard.press("ArrowRight");
    await presenter.waitForTimeout(120);
    for (let i = 0; i < 8; i++) await presenter.keyboard.press("ArrowLeft");
    await form();
    await presenter.fill("#info-title", "مشهد " + round); await presenter.fill("#info-lines", (10 + round) + "%\nمن حديث المحاضر");
    await presenter.click("#info-show");
    await presenter.locator("#info-title").evaluate((e) => e.blur());
    await presenter.keyboard.press("Escape");
    await presenter.keyboard.press("Home");
  }
  // Scene churn on a single slide.
  for (let i = 0; i < 50; i++) { await presenter.fill("#info-lines", (i % 90) + "%\nمن حديث المحاضر"); await presenter.click("#info-show"); await presenter.keyboard.press("e"); }
  // Video slide in and out many times.
  for (let i = 0; i < 12; i++) {
    for (let k = 0; k < 12 && !(await presenter.textContent("#meta")).includes("7 من"); k++) await presenter.keyboard.press("ArrowRight");
    await presenter.keyboard.press("v"); await presenter.waitForTimeout(80);
    await presenter.keyboard.press("Home"); await presenter.waitForTimeout(40);
  }
  await presenter.keyboard.press("Home"); await presenter.waitForTimeout(800);
  await presenter.keyboard.press("ArrowRight"); await presenter.waitForTimeout(800);
  const meta = await presenter.textContent("#meta");
  const audienceSrc = await audience.getAttribute("#slide-img", "src");
  const presenterSrc = await presenter.getAttribute("#slide-img", "src");
  check("audience ends on exactly the presenter's slide after the storm", audienceSrc === presenterSrc, meta + " | " + audienceSrc?.slice(-14) + " vs " + presenterSrc?.slice(-14));

  await presenter.keyboard.press("Home"); await presenter.waitForTimeout(600);
  const after = await stats(presenter), heapAfter = await heap();
  check("at most one video element and no leftover overlays or fades", after.videos === 0 && after.overlays === 0 && after.fades === 0, JSON.stringify(after));
  check("prefetch cache stays bounded", after.prefetched <= 8, String(after.prefetched));
  check("DOM does not grow with use", after.nodes <= before.nodes + 60, `${before.nodes} -> ${after.nodes}`);
  check("return context is empty after returning home", after.stack === 0);
  const growthMb = (heapAfter - heapBefore) / 1048576;
  check("JS heap growth after ~600 actions is small", growthMb < 25, growthMb.toFixed(1) + " MB");
  console.log(`      heap ${(heapBefore / 1048576).toFixed(1)} -> ${(heapAfter / 1048576).toFixed(1)} MB, nodes ${before.nodes} -> ${after.nodes}`);

  // Every page loads without CSP violations (the policy forbids inline scripts and foreign origins).
  const admin = await context.newPage(); watch("vote-admin", admin);
  await admin.goto(`${base}/vote-admin.html`); await admin.fill("#token", ADMIN); await admin.click("#save-token"); await admin.waitForSelector("#qr svg");
  await admin.fill("#q-text", "هل ننتقل؟"); await admin.fill("#q-opts", "نعم\nلا"); await admin.click("#add-poll"); await admin.waitForSelector("button[data-act=open]");
  const code = (await admin.textContent("#session-line")).split(":")[1].trim();
  const phone = await (await browser.newContext()).newPage(); watch("vote", phone);
  await phone.goto(`${base}/vote.html?s=${code}`); await phone.waitForTimeout(1500);
  await presenter.locator("#readiness-drawer summary").click(); await presenter.click("#rehearsal-run");
  await presenter.waitForFunction(() => [...document.querySelectorAll("#rehearsal-results li")].some((li) => li.textContent.includes("فيديو تالف")), null, { timeout: 30000 });
  check("no Content-Security-Policy violation on any page or flow", violations.length === 0, violations.join(" | "));
  check("no console or page errors during the whole session", errors.length === 0, errors.join(" | "));
} catch (error) {
  console.error(error); failures.push("exception");
} finally {
  await browser.close(); server.kill();
}
if (failures.length) { console.log(`\n${failures.length} check(s) failed`); process.exit(1); }
console.log("\nall stability and CSP checks passed");
