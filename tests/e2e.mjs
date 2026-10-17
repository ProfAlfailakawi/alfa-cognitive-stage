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

// Slide 3 of the fixture has three click builds, so "next" is pressed until the target slide shows.
async function pressNextUntil(page, slide) {
  for (let i = 0; i < 12 && !(await page.textContent("#meta")).includes(`${slide} من`); i++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(120);
  }
}
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

  // A fresh lecturer browser can restore approved scenes from other lecture bundles.
  const archivedBundle = "archive_test_lecture";
  const savedArchive = await fetch(base + "/api/memory/" + archivedBundle, {
    method: "POST",
    headers: { "X-Admin-Token": ADMIN, "Content-Type": "application/json" },
    body: JSON.stringify({ slide: 3, utterance: "في دراسة عن تحفيز الألعاب نسبة 68%",
      spec: { type: "stat", title: "نسبة نطق بها المحاضر",
        lines: ["68%", "من حديث المحاضر"] } })
  });
  check("approved scene can be saved with lecturer token", savedArchive.status === 201);
  const forbiddenIndex = await fetch(base + "/api/memory/library");
  check("student cannot read the approved library", forbiddenIndex.status === 401);
  const completeIndex = await fetch(base + "/api/memory/library", {
    headers: { "X-Admin-Token": ADMIN }
  });
  const indexData = await completeIndex.json();
  check("authorized library includes prior lecture", completeIndex.status === 200 &&
    indexData.scenes.some(x => x.bundle === archivedBundle));
  const separateContext = await browser.newContext();
  const isolated = await separateContext.newPage();
  isolated.on("pageerror", (err) => failures.push("isolated profile: " + err));
  await isolated.goto(`${base}/#presenter`);
  await isolated.waitForSelector("#director-memory-sync");
  check("new lecturer profile has no cross-lecture index at first",
    !(await isolated.evaluate(() => localStorage.getItem("alfa-approved-scenes-cross-v1") || ""))
      .includes(archivedBundle));
  await isolated.fill("#director-admin-token", ADMIN);
  await isolated.click("#director-memory-sync");
  await isolated.waitForFunction(bundle =>
    (localStorage.getItem("alfa-approved-scenes-cross-v1") || "").includes(bundle),
    archivedBundle, { timeout: 6000 });
  const restored = await isolated.evaluate(async () => {
    const { recallScene } = await import("/scene-memory.js");
    return {
      matched: recallScene({ bundle: "testfixture1", slide: 1,
        utterance: "في دراسة عن تحفيز الألعاب نسبة 68%" }),
      changed: recallScene({ bundle: "testfixture1", slide: 1,
        utterance: "في دراسة عن تحفيز الألعاب نسبة 69%" }),
    };
  });
  check("new profile reuses prior approved SVG without API",
    restored.matched?.reusedAcrossLecture === true &&
    restored.matched?.spec.lines[0] === "68%");
  check("server-restored cross-lecture scene respects changed statistics",
    restored.changed === null);
  await separateContext.close();

  const unauthorizedUsage = await fetch(base + "/api/director/status");
  check("cloud consumption summary is lecturer-authenticated", unauthorizedUsage.status === 401);
  const authorizedUsage = await fetch(base + "/api/director/status", {
    headers: { "X-Admin-Token": ADMIN }
  });
  const usageReport = await authorizedUsage.json();
  check("cloud consumption summary starts with no calls and a zero estimated USD cost",
    authorizedUsage.status === 200 && usageReport.callsUsed === 0 &&
    usageReport.inputTokens === 0 && usageReport.costUsd === 0 && usageReport.costIsEstimate === true &&
    usageReport.capUsd === 0.25 && usageReport.pricing?.verifiedAt &&
    usageReport.scope === "server-process" && usageReport.daily?.healthy === true &&
    usageReport.daily.callsUsed === 0 && usageReport.daily.scope === "utc-day");
  await presenter.fill("#director-admin-token", ADMIN);
  await presenter.check("#director-cloud");
  await presenter.waitForFunction(() => document.querySelector("#director-usage")?.textContent
    ?.includes("غير مجهزة"));
  check("lecturer sees cloud availability in existing director panel",
    (await presenter.locator("#director-usage").textContent()).includes("غير مجهزة"));
  await presenter.uncheck("#director-cloud");
  await presenter.locator("#director-cloud").evaluate((el) => el.blur()); // Release focus so slide hotkeys work.


  await audience.goto(`${base}/#audience`);
  await audience.waitForSelector("#slide-img");
  await presenter.bringToFront();
  await presenter.waitForTimeout(400);
  check("audience shows no buttons", (await audience.locator("button").count()) === 0);

  check("voice diagnostics remain lecturer-only and hidden before microphone use",
    await presenter.locator("#director-voice-health").count() === 1 &&
    await presenter.locator("#director-voice-health").isHidden() &&
    await audience.locator("#director-voice-health").count() === 0);


  await pressNextUntil(presenter, 4);
  await presenter.waitForTimeout(500);
  check("keyboard moves presenter to slide 4", (await presenter.textContent("#meta")).includes("4 من"));
  await audience.waitForTimeout(400);
  const audienceSrc = await audience.getAttribute("#slide-img", "src");
  check("audience follows presenter to slide 4", audienceSrc.endsWith("004.png"), audienceSrc);

  // Slide 7 holds a video; move there.
  await pressNextUntil(presenter, 7);
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

  // Open a new audience window *after* playback has started; its snapshot must
  // include slide position and video time, without restarting other audience tabs.
  const lateAudience = await context.newPage();
  lateAudience.on("pageerror", (e) => audienceErrors.push("late audience: " + e));
  await lateAudience.goto(`${base}/#audience`);
  await lateAudience.waitForSelector("video.clip", { timeout: 8000 });
  await lateAudience.waitForFunction(() =>
    document.querySelector("#slide-img")?.getAttribute("src")?.endsWith("007.png"), null, { timeout: 6000 });
  await lateAudience.waitForFunction(() =>
    document.querySelector("video.clip")?.currentTime > 0.7, null, { timeout: 6000 });
  const latePosition = await lateAudience.locator("video.clip").evaluate((v) => v.currentTime);
  const referencePosition = await presenter.locator("video.clip").evaluate((v) => v.currentTime);
  check("late-joining audience restores current slide and live video position",
    (await lateAudience.getAttribute("#slide-img", "src")).endsWith("007.png") &&
    Math.abs(latePosition - referencePosition) < 1.25,
    `presenter=${referencePosition.toFixed(2)} late=${latePosition.toFixed(2)}`);

  await presenter.bringToFront();
  await presenter.keyboard.press("v");
  await audience.waitForFunction(() => document.querySelector("video.clip")?.paused, null, { timeout: 5000 });
  await lateAudience.waitForFunction(() => document.querySelector("video.clip")?.paused, null, { timeout: 5000 });
  check("pause reaches both audience windows", true);
  await presenter.locator("video.clip").evaluate((v) => { v.currentTime = 1.2; });
  await audience.waitForFunction(() => Math.abs(document.querySelector("video.clip")?.currentTime - 1.2) < 0.25,
    null, { timeout: 5000 });
  check("a presenter seek propagates at precise media position",
    Math.abs((await lateAudience.locator("video.clip").evaluate((v) => v.currentTime)) - 1.2) < 0.5);
  await presenter.keyboard.press("v");
  await audience.locator("video.clip").evaluate((v) => { v.currentTime = 0; });
  await audience.waitForFunction(() => {
    const v = document.querySelector("video.clip");
    return v && !v.paused && v.currentTime > 1;
  }, null, { timeout: 5000 });
  // Wait beyond the 1.5 s heartbeat to exercise drift correction, not just natural playback.
  await presenter.waitForTimeout(1800);
  const repairedAudience = await audience.locator("video.clip").evaluate((v) => v.currentTime);
  const repairedPresenter = await presenter.locator("video.clip").evaluate((v) => v.currentTime);
  check("periodic media packets repair audience drift",
    Math.abs(repairedAudience - repairedPresenter) < 1.15,
    `presenter=${repairedPresenter.toFixed(2)} audience=${repairedAudience.toFixed(2)}`);
  await lateAudience.close();

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
  await pressNextUntil(presenter, 7);
  await presenter.waitForFunction(() => document.querySelector("#meta")?.textContent?.includes("7 من"));
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
  // Natural two-percentage classroom phrasing produces a bounded comparison without cloud API.
  await presenter.selectOption("#director-mode", "safe");
  await presenter.fill("#director-test-text", "ارتفعت النسبة من ٣٠٪ إلى ٧٠٪");
  await presenter.click("#director-test-run");
  check("explicit two-number change becomes a reviewable director proposal",
    await presenter.locator("#director-proposal").isVisible());
  await presenter.click("#director-accept");
  await audience.waitForSelector(".info-layer svg", { timeout: 6000 });
  const compareText = await audience.locator(".info-layer").textContent();
  check("classroom comparison shows both spoken percentages",
    compareText.includes("30%") && compareText.includes("70%") && !compareText.includes("50%"));
  await presenter.click("#home");
  await audience.waitForTimeout(300);
  check("emergency return hides speech comparison without changing slide",
    await audience.locator(".info-layer").count() === 0 &&
    (await presenter.textContent("#meta")).includes("7 من"));

  // Natural ordered explanation uses a local 3-step SVG; no cloud prompts or research.
  await presenter.selectOption("#director-mode", "safe");
  await presenter.fill("#director-test-text",
    "عندنا ثلاث خطوات: أول شي نحدد الهدف، ثاني شي نصمم النشاط، ثالث شي نقيس الأثر");
  await presenter.click("#director-test-run");
  check("spoken steps become a reviewable local scene",
    await presenter.locator("#director-proposal").isVisible());
  await presenter.click("#director-accept");
  await audience.waitForSelector(".info-layer svg", { timeout: 6000 });
  const proceduralScene = await audience.locator(".info-layer").textContent();
  check("three spoken educational steps are preserved on student screen",
    ["نحدد الهدف", "نصمم النشاط", "نقيس الاثر"].every((line) => proceduralScene.includes(line)));
  await presenter.click("#home");
  await audience.waitForTimeout(200);
  check("emergency return removes local procedural scene safely",
    await audience.locator(".info-layer").count() === 0 &&
    (await presenter.textContent("#meta")).includes("7 من"));

  const sameSlideNumeric = await presenter.evaluate(async (bundle) => {
    const { rememberScene, recallScene } = await import("/scene-memory.js");
    const scene = { type: "stat", title: "نسبة من قول المحاضر",
      lines: ["68%", "من حديث المحاضر"] };
    rememberScene({ bundle, slide: 7,
      utterance: "في دراسة عن تحفيز الألعاب نسبة 68%", spec: scene });
    return {
      original: recallScene({ bundle, slide: 7,
        utterance: "في دراسة عن تحفيز الألعاب نسبة 68%" }),
      corrected: recallScene({ bundle, slide: 7,
        utterance: "في دراسة عن تحفيز الألعاب نسبة 69%" }),
    };
  }, bundleId);
  check("same-slide approved statistics still replay when unchanged",
    sameSlideNumeric.original?.spec.lines[0] === "68%");
  check("same-slide memory refuses stale 68% after spoken correction to 69%",
    sameSlideNumeric.corrected === null);

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
