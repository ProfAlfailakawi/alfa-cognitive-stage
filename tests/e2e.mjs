// End-to-end checks for the presenter/audience player.
// Run: node tests/e2e.mjs   (needs the `playwright` package and a Chromium build)
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 4199;
const ADMIN = "test-e2e-admin-0123456789abcdef";
const base = `http://localhost:${port}`;
const bundleId = JSON.parse(readFileSync(join(root, "bundles/current.json"), "utf8")).id;
const manifest = JSON.parse(readFileSync(join(root, "bundles", bundleId, "manifest.json"), "utf8"));
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures.push(name);
};

const server = spawn(process.execPath, [join(root, "server/server.mjs")], {
  env: { ...process.env, PORT: String(port), ADMIN_TOKEN: ADMIN },
  stdio: ["ignore", "pipe", "pipe"],
});
await new Promise((resolve) => server.stdout.once("data", resolve));

const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
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

  const slideResponse = await fetch(`${base}/bundles/${bundleId}/slides/001.png`);
  check("slide images are cached privately for faster navigation",
    (slideResponse.headers.get("cache-control") || "").includes("private, max-age=600"));
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

  // Preflight must decode a real video frame without changing the classroom's slide.
  await presenter.locator("#readiness-drawer summary").click();
  await presenter.locator("#media-preflight-run").click();
  await presenter.waitForFunction(() => document.querySelector("#media-preflight-results > p")
    ?.textContent?.includes("فُحص 1 من 1 فيديو"), { timeout: 15000 });
  const mediaReport = await presenter.locator("#media-preflight-results > p").textContent();
  check("one-click media preflight actually decodes the clip", mediaReport.includes("1 نجح فك ترميزه"), mediaReport);
  check("media preflight preserves current slide",
    (await presenter.textContent("#meta")).includes("7 من"));

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

  // Explicitly rejected director proposals are remembered only for this lecture and slide.
  await presenter.selectOption("#director-mode", "safe");
  await presenter.locator("#director-box details").evaluate((el) => { el.open = true; });
  const dismissedStat = "ذكرت دراسة أن نسبة ٦٨٪ من الطلبة تعلموا";
  await presenter.fill("#director-test-text", dismissedStat);
  await presenter.click("#director-test-run");
  check("first stat proposal requires lecturer approval in safe mode",
    await presenter.locator("#director-proposal").isVisible());
  await presenter.click("#director-reject");
  check("rejected proposal immediately disappears",
    await presenter.locator("#director-proposal").isHidden());
  await presenter.reload();
  await presenter.waitForSelector("#director-box");
  await presenter.locator("#director-box details").evaluate((el) => { el.open = true; });
  await presenter.selectOption("#director-mode", "safe");
  await presenter.fill("#director-test-text", dismissedStat);
  await presenter.click("#director-test-run");
  check("previously dismissed stat stays suppressed after refresh",
    await presenter.locator("#director-proposal").isHidden() &&
    (await presenter.locator("#director-status").textContent()).includes("تجاهلته سابقاً"));
  await presenter.fill("#director-test-text", "ذكرت دراسة أن نسبة ٦٩٪ من الطلبة تعلموا");
  await presenter.click("#director-test-run");
  check("corrected percentage must remain eligible",
    await presenter.locator("#director-proposal").isVisible());
  await presenter.click("#director-reject");
  await presenter.click("#director-forget-dismissals");
  await presenter.fill("#director-test-text", dismissedStat);
  await presenter.click("#director-test-run");
  check("lecturer can clear dismissal preferences in the presenter",
    await presenter.locator("#director-proposal").isVisible());
  await presenter.click("#director-reject");

  // Voting is embedded in the presenter, and the presenter can project QR on demand.
  await presenter.click("#open-vote");
  const votingFrame = presenter.frameLocator("#vote-iframe");
  await votingFrame.locator("#token").fill(ADMIN);
  await votingFrame.locator("#save-token").click();
  await votingFrame.locator("#qr svg").waitFor({ timeout: 10000 });
  const sessionBefore = await votingFrame.locator("#session-line").textContent();
  await votingFrame.locator("body").evaluate(() => location.reload());
  await votingFrame.locator("#qr svg").waitFor({ timeout: 10000 });
  const sessionAfter = await votingFrame.locator("#session-line").textContent();
  check("voting console resumes the same session after reload", sessionBefore === sessionAfter);
  await presenter.locator("#director-box details").evaluate((el) => { el.open = true; });
  await presenter.fill("#director-test-text", "تتوقعون الألعاب التعليمية أفضل من غيرها؟");
  await presenter.click("#director-test-run");
  await votingFrame.locator("#q-text").waitFor({ timeout: 8000 });
  await presenter.waitForTimeout(500);
  check("spoken classroom question is prefilled without opening a poll",
    (await votingFrame.locator("#q-text").inputValue()).includes("تتوقعون الألعاب التعليمية"));
  await presenter.waitForTimeout(450);
  await presenter.click("#project-poll");
  await audience.waitForSelector(".vote-projection .vote-qr svg", { timeout: 8000 });
  check("presenter projects voting QR inside the audience stage", true);
  await presenter.click("#hide-poll");
  await audience.waitForTimeout(300);
  check("presenter hides voting QR without changing the slide", await audience.locator(".vote-projection").count() === 0);
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
