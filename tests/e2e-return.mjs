// PowerPoint click builds and exact return after digressions, in real Chromium.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 4197;
const base = `http://localhost:${port}`;
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures.push(name);
};
const server = spawn(process.execPath, [join(root, "server/server.mjs")], {
  env: { ...process.env, PORT: String(port), ADMIN_TOKEN: "return-test-token-0123456789", VOTES_FILE: "/tmp/alfa-return-votes.json",
    SCENES_FILE: "/tmp/alfa-return-scenes.json" },
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
presenter.on("pageerror", (e) => { console.log("presenter pageerror: " + e); failures.push("presenter pageerror"); });
audience.on("pageerror", (e) => { console.log("audience pageerror: " + e); failures.push("audience pageerror"); });
const src = (page) => page.getAttribute("#slide-img", "src");
const meta = (page) => page.textContent("#meta");
const settle = (page) => page.waitForTimeout(700);
async function showScene(title, number) {
  const form = presenter.locator("#info-form");
  if (await form.isHidden()) await presenter.click("#toggle-info");
  await presenter.selectOption("#info-type", "stat");
  await presenter.fill("#info-title", title);
  await presenter.fill("#info-lines", number + "\nمن حديث المحاضر");
  await presenter.click("#info-show");
  await presenter.locator("#info-hide").evaluate((el) => el.blur());
  await presenter.locator("#info-title").evaluate((el) => el.blur());
}

try {
  await presenter.goto(`${base}/?dev=1#presenter`);
  await presenter.waitForSelector("#meta");
  await audience.goto(`${base}/#audience`);
  await audience.waitForSelector("#slide-img");
  await presenter.bringToFront();

  // --- Build steps: slide 3 has three click builds. ---
  await presenter.keyboard.press("ArrowRight");
  await presenter.keyboard.press("ArrowRight");
  await settle(presenter);
  check("slide 3 starts at rest (build 0)", (await src(presenter)).endsWith("steps/003-00.png") &&
    (await meta(presenter)).includes("حركة 0 من 3"), await src(presenter));
  await presenter.keyboard.press("ArrowRight");
  await settle(presenter);
  check("next click advances the build, not the slide",
    (await meta(presenter)).includes("3 من") && (await meta(presenter)).includes("حركة 1 من 3") &&
    (await src(presenter)).endsWith("steps/003-01.png"), await meta(presenter));
  await audience.waitForFunction(() => document.querySelector("#slide-img")?.getAttribute("src")?.endsWith("003-01.png"), null, { timeout: 4000 });
  check("audience mirrors the build state", true);
  await presenter.keyboard.press("ArrowRight");
  await settle(presenter);
  check("second click reaches build 2", (await src(presenter)).endsWith("003-02.png"));

  // --- A scene must not restart the animated slide, and E returns to the exact click. ---
  const before = await src(presenter);
  await showScene("نسبة من المحاضر", "68%");
  await presenter.waitForTimeout(500);
  check("scene overlays without changing the build image",
    (await src(presenter)) === before && (await presenter.locator(".info-layer").count()) === 1);
  await audience.waitForSelector(".info-layer");
  await presenter.keyboard.press("e");
  await settle(presenter);
  check("return restores the same slide and build click",
    (await meta(presenter)).includes("3 من") && (await meta(presenter)).includes("حركة 2 من 3") &&
    (await src(presenter)) === before && (await presenter.locator(".info-layer").count()) === 0);
  check("audience returns to the same build with no scene",
    (await src(audience)).endsWith("003-02.png") && (await audience.locator(".info-layer").count()) === 0);

  // --- Nested digression: scene B over scene A. One level back shows A; return shows the original. ---
  await showScene("المشهد الأول", "40%");
  await showScene("المشهد الثاني", "55%");
  await presenter.waitForTimeout(300);
  const inLayer = () => presenter.locator(".info-layer").innerText();
  check("nested scene is on screen", (await inLayer()).includes("55"));
  await presenter.click("#info-hide");
  await presenter.waitForTimeout(300);
  check("one level back restores the first scene", (await inLayer()).includes("40"));
  await audience.waitForFunction(() => document.querySelector(".info-layer")?.textContent?.includes("40"), null, { timeout: 3000 });
  check("audience shows the first scene after one level back", true);
  await presenter.click("#info-hide");
  await presenter.waitForTimeout(300);
  check("second level back returns to the original lecture state",
    (await presenter.locator(".info-layer").count()) === 0 && (await src(presenter)) === before);

  // Voice: spoken "back one level" and "return" intents.
  await showScene("أ", "10%");
  await showScene("ب", "20%");
  await presenter.locator("details:has(#director-test-text)").evaluate((d) => { d.open = true; });
  await presenter.fill("#director-test-text", "نرجع للي قبل");
  await presenter.click("#director-test-run");
  await presenter.waitForTimeout(300);
  check("spoken 'back to the previous' restores the earlier scene", (await inLayer()).includes("10"));
  await presenter.fill("#director-test-text", "خلونا نرجع للعرض");
  await presenter.click("#director-test-run");
  await presenter.waitForTimeout(300);
  check("spoken return restores the original state",
    (await presenter.locator(".info-layer").count()) === 0 && (await meta(presenter)).includes("حركة 2 من 3"));

  // The most common phrasing must restore the EXACT PowerPoint build state,
  // without forcing the lecturer to memorize an unnatural command.
  await showScene("مشهد الرجوع", "32%");
  await presenter.fill("#director-test-text", "نرجع للشريحة الأصلية");
  await presenter.click("#director-test-run");
  await presenter.waitForTimeout(300);
  check("natural return to original slide restores click 2 and removes overlay",
    (await presenter.locator(".info-layer").count()) === 0 && (await meta(presenter)).includes("حركة 2 من 3"));
  // Explicit next slide skips any remaining click builds; audience must follow.
  await presenter.click("#next-slide");
  await settle(presenter);
  check("dedicated next-slide button bypasses last PowerPoint build click",
    (await meta(presenter)).includes("4 من"), await meta(presenter));
  await presenter.keyboard.press("ArrowLeft");
  await presenter.keyboard.press("ArrowLeft"); // back to build 2 on slide 3, for the existing checks
  await settle(presenter);

  // --- Navigation order around builds. ---
  await presenter.keyboard.press("ArrowRight");
  await presenter.keyboard.press("ArrowRight");
  await settle(presenter);
  check("after the last click the next press moves to slide 4", (await meta(presenter)).includes("4 من"));
  await presenter.keyboard.press("ArrowLeft");
  await settle(presenter);
  check("previous from slide 4 lands on slide 3 final build",
    (await meta(presenter)).includes("3 من") && (await src(presenter)).endsWith("003-03.png"));
  await presenter.keyboard.press("ArrowLeft");
  await settle(presenter);
  check("previous undoes one click", (await src(presenter)).endsWith("003-02.png"));

  // --- Video digression: position and play state survive. ---
  await presenter.keyboard.press("Home");
  for (let i = 0; i < 12 && !(await meta(presenter)).includes("7 من"); i++) {
    await presenter.keyboard.press("ArrowRight");
    await presenter.waitForTimeout(150);
  }
  await presenter.waitForSelector("video.clip");
  await presenter.waitForFunction(() => document.querySelector("video.clip")?.readyState >= 1, null, { timeout: 8000 });
  await presenter.locator("video.clip").evaluate((v) => { v.currentTime = 2; });
  await presenter.waitForTimeout(500);
  const pausedAt = await presenter.locator("video.clip").evaluate((v) => v.currentTime);
  await showScene("استطراد أثناء الفيديو", "25%");
  await presenter.waitForTimeout(300);
  await presenter.keyboard.press("Escape");
  await presenter.waitForTimeout(600);
  const restored = await presenter.locator("video.clip").evaluate((v) => ({ t: v.currentTime, paused: v.paused }));
  check("paused video keeps its position after a digression",
    restored.paused && Math.abs(restored.t - pausedAt) < 0.3, JSON.stringify({ pausedAt, restored }));
  check("slide 7 retained after the digression", (await meta(presenter)).includes("7 من"));

  await presenter.locator("video.clip").evaluate((v) => { v.muted = true; return v.play(); });
  await presenter.waitForTimeout(800);
  await showScene("استطراد والفيديو يعمل", "30%");
  await presenter.waitForTimeout(600);
  await presenter.keyboard.press("Escape");
  await presenter.waitForTimeout(900);
  const resumed = await presenter.locator("video.clip").evaluate((v) => ({ t: v.currentTime, paused: v.paused }));
  check("a video that was playing resumes after the digression", !resumed.paused && resumed.t > pausedAt, JSON.stringify(resumed));
  const audienceVideo = await audience.locator("video.clip").evaluate((v) => ({ t: v.currentTime, paused: v.paused }));
  check("audience video follows the restored state", !audienceVideo.paused && audienceVideo.t > 1, JSON.stringify(audienceVideo));
} catch (error) {
  console.error(error);
  failures.push("exception");
} finally {
  await browser.close();
  server.kill();
}
if (failures.length) { console.log(`\n${failures.length} check(s) failed`); process.exit(1); }
console.log("\nall build-step and return checks passed");
