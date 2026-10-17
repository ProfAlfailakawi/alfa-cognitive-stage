// End-to-end checks for the presenter/audience player.
// Run: node tests/e2e.mjs   (needs the `playwright` package and a Chromium build)
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 4199;
const base = `http://localhost:${port}`;
const bundleId = JSON.parse(readFileSync(join(root, "bundles/current.json"), "utf8")).id;
const manifest = JSON.parse(readFileSync(join(root, "bundles", bundleId, "manifest.json"), "utf8"));
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures.push(name);
};

const server = spawn(process.execPath, [join(root, "server/server.mjs")], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
await new Promise((resolve) => server.stdout.once("data", resolve));

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || chromium.executablePath(),
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const presenter = await context.newPage();
const audience = await context.newPage();
const audienceErrors = [];
audience.on("pageerror", (e) => audienceErrors.push(String(e)));
presenter.on("pageerror", (e) => { console.log("presenter pageerror: " + e); failures.push("presenter pageerror"); });

try {
  // Range requests must work so videos can seek.
  const range = await fetch(`${base}/bundles/${bundleId}/${manifest.slides[6].videos[0].src}`, {
    headers: { Range: "bytes=0-99" },
  });
  check("video range request returns 206", range.status === 206, `status ${range.status}`);
  await range.body?.cancel();

  await presenter.goto(`${base}/#presenter`);
  await presenter.waitForSelector("#meta");
  check("presenter shows slide 1 of N", (await presenter.textContent("#meta")).includes(`1 من ${manifest.slideCount}`));

  await audience.goto(`${base}/#audience`);
  await audience.waitForSelector("#slide-img");
  await presenter.bringToFront();
  await presenter.waitForTimeout(400);
  check("audience shows no buttons", (await audience.locator("button").count()) === 0);

  for (let i = 0; i < 3; i++) await presenter.keyboard.press("ArrowRight");
  await presenter.waitForTimeout(500);
  check("keyboard moves presenter to slide 4", (await presenter.textContent("#meta")).includes("4 من"));
  await audience.waitForTimeout(400);
  const audienceSrc = await audience.getAttribute("#slide-img", "src");
  check("audience follows presenter to slide 4", audienceSrc.endsWith("004.png"), audienceSrc);

  // Slide 7 holds a video; move there.
  for (let i = 0; i < 3; i++) await presenter.keyboard.press("ArrowRight");
  await presenter.waitForTimeout(600);
  const pv = await presenter.locator("video.clip").count();
  check("presenter video appears on slide 7", pv === 1);
  const av = await audience.locator("video.clip").count();
  await audience.waitForTimeout(300);
  check("audience video appears on slide 7", av === 1);
  const box = await presenter.locator("video.clip").evaluate((v) => {
    const s = v.parentElement.getBoundingClientRect();
    const r = v.getBoundingClientRect();
    return { x: (r.left - s.left) / s.width, y: (r.top - s.top) / s.height, w: r.width / s.width, h: r.height / s.height };
  });
  const expect = manifest.slides[6].videos[0];
  const close = (a, b) => Math.abs(a - b) < 0.01;
  check("video box matches manifest position",
    close(box.x, expect.x) && close(box.y, expect.y) && close(box.w, expect.w) && close(box.h, expect.h),
    JSON.stringify(box));

  await presenter.keyboard.press("v");
  await presenter.waitForTimeout(1500);
  const presenterTime = await presenter.locator("video.clip").evaluate((v) => v.currentTime);
  const audienceTime = await audience.locator("video.clip").evaluate((v) => v.currentTime);
  check("video plays on presenter", presenterTime > 0.5, `t=${presenterTime.toFixed(2)}`);
  check("video plays on audience in sync", audienceTime > 0.5, `t=${audienceTime.toFixed(2)}`);

  // Emergency return: restore the current safe slide, not slide 1; pause its video.
  await presenter.keyboard.press("e");
  await presenter.waitForTimeout(600);
  check("emergency preserves presenter slide 7", (await presenter.textContent("#meta")).includes(`7 من`));
  await audience.waitForTimeout(400);
  check("emergency preserves audience slide 7", (await audience.getAttribute("#slide-img", "src")).endsWith("007.png"));
  const paused = await presenter.locator("video.clip").first().evaluate((v) => v.paused);
  check("emergency pauses video without removing it", paused);

  // Infographic: lecturer sends a stat card, audience shows it, emergency hides it.
  await presenter.bringToFront();
  await presenter.click("#toggle-info");
  await presenter.waitForFunction(() => !document.getElementById("info-form").hidden);
  await presenter.selectOption("#info-type", "stat");
  await presenter.fill("#info-title", "نسبة الاستفادة");
  await presenter.fill("#info-lines", "68%\nمن المشاركين استفادوا");
  await presenter.click("#info-show");
  await audience.waitForSelector(".info-layer svg", { timeout: 6000 });
  check("audience shows the infographic", (await audience.textContent(".info-layer")).includes("68%"));
  await presenter.keyboard.press("e");
  await audience.waitForTimeout(400);
  check("emergency hides the infographic", (await audience.locator(".info-layer").count()) === 0);

  check("audience page has no JavaScript errors", audienceErrors.length === 0, audienceErrors.join(" | "));

  await presenter.screenshot({ path: join(root, "tests/presenter.png") });
  await audience.screenshot({ path: join(root, "tests/audience.png") });
} catch (err) {
  failures.push("exception: " + err.message);
  console.error(err);
} finally {
  await browser.close();
  server.kill();
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
