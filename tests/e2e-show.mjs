// Presentation Engine end to end, in a browser: a projector window and a notes window that follow the
// lecturer through the local server (the path the Mac app uses), late join, reload, blackout, scenes,
// video, lecture privacy. Run: node tests/e2e-show.mjs (needs playwright and the synthetic fixture).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 4207;
const base = `http://localhost:${port}`;
const bundleId = JSON.parse(readFileSync(join(root, "bundles/current.json"), "utf8")).id;
const manifest = JSON.parse(readFileSync(join(root, "bundles", bundleId, "manifest.json"), "utf8"));
const NOTE = manifest.slides.find((s) => s.notes)?.notes;
const failures = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) failures.push(name); };
const server = spawn(process.execPath, [join(root, "server/server.mjs")], { env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
await new Promise((resolve) => server.stdout.once("data", resolve));
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
// Separate contexts: no BroadcastChannel between them, so everything the projector shows came through the engine.
const lecturerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const projectorCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const presenter = await lecturerCtx.newPage();
presenter.on("pageerror", (e) => failures.push("presenter pageerror: " + e));
const meta = () => presenter.textContent("#meta");
const audienceSlide = (p) => p.evaluate(() => document.getElementById("slide-img")?.getAttribute("src") || "");
const waitSlide = (p, n) => p.waitForFunction((n) => (document.getElementById("slide-img")?.getAttribute("src") || "").includes(String(n).padStart(3, "0")), n, { timeout: 5000 });
const status = () => fetch(base + "/api/show/status").then((r) => r.json());

try {
  await presenter.goto(`${base}/?dev=1#presenter`);
  await presenter.waitForSelector("#filmstrip .film-item");
  await presenter.locator('#filmstrip .film-item[data-index="2"]').click();
  await presenter.waitForFunction(() => document.getElementById("meta").textContent.includes("2 من"));
  // Late join: a projector opened in the middle of the lecture lands on the current slide.
  const audience = await projectorCtx.newPage();
  const leaked = [];
  audience.on("response", async (r) => { try { if ((await r.text()).includes(NOTE)) leaked.push(r.url()); } catch {} });
  audience.on("pageerror", (e) => failures.push("audience pageerror: " + e));
  await audience.goto(`${base}/?relay=1#audience`);
  await waitSlide(audience, 2);
  check("a projector opened mid-lecture shows the current slide", (await audienceSlide(audience)).includes("002"));
  check("the projector has no controls", (await audience.locator("button").count()) === 0);
  // Navigation follows, forward and back, including a far jump.
  await presenter.locator('#filmstrip .film-item[data-index="5"]').click();
  await waitSlide(audience, 5);
  await presenter.keyboard.press("ArrowLeft"); await presenter.keyboard.press("ArrowLeft");
  await presenter.waitForFunction(() => document.getElementById("meta").textContent.includes("4 من") || document.getElementById("meta").textContent.includes("3 من"));
  const shown = (await meta()).match(/الشريحة (\d+)/)[1];
  await waitSlide(audience, Number(shown));
  check("Previous and far jumps reach the projector", (await audienceSlide(audience)).includes(shown.padStart(3, "0")));
  // A scene is on screen; a reloaded projector comes back with it.
  await presenter.click("#toggle-info");
  await presenter.fill("#info-title", "نسبة"); await presenter.fill("#info-lines", "68%\nمن حديث المحاضر");
  await presenter.click("#info-show");
  await audience.waitForSelector(".info-layer", { timeout: 5000 });
  await audience.reload();
  await audience.waitForSelector(".info-layer", { timeout: 5000 });
  check("a reloaded projector restores the scene on screen", (await audience.locator(".info-layer").count()) > 0);
  await presenter.keyboard.press("Escape");
  await audience.waitForFunction(() => !document.querySelector(".info-layer"), null, { timeout: 5000 });
  check("returning to the slide clears the scene on the projector", true);
  // Blackout from the console (B), kept across a projector reload.
  await presenter.locator("body").press("b");
  await audience.waitForFunction(() => document.body.classList.contains("alfa-blackout"), null, { timeout: 5000 });
  await audience.reload();
  await audience.waitForFunction(() => document.body.classList.contains("alfa-blackout"), null, { timeout: 5000 });
  check("blackout reaches the projector and survives its reload", true);
  await presenter.locator("body").press("b");
  await audience.waitForFunction(() => !document.body.classList.contains("alfa-blackout"), null, { timeout: 5000 });
  // The projector acknowledges what it shows.
  await presenter.waitForTimeout(2600);
  const st = await status();
  check("the engine sees the projector and its acknowledgement", st.viewers.audience >= 1 && st.ackedVersion === st.version, JSON.stringify(st));
  // Video on slide 7 plays on the projector too.
  for (let i = 0; i < 14 && !(await meta()).includes("7 من"); i++) { await presenter.keyboard.press("ArrowRight"); await presenter.waitForTimeout(100); }
  await waitSlide(audience, 7);
  await presenter.waitForSelector("video.clip");
  await presenter.locator("body").press("v");
  const played = await audience.waitForFunction(() => { const v = document.querySelector("video.clip"); return v && !v.paused; }, null, { timeout: 6000 }).then(() => true, () => false);
  check("a video started on the console plays on the projector", played);
  await presenter.locator("body").press("v");
  // Notes window: follows the console, shows the notes, sits apart from the projector.
  const notes = await lecturerCtx.newPage();
  await notes.goto(`${base}/?relay=1#notes`);
  await notes.waitForSelector("#nv-text");
  const noteSlide = manifest.slides.findIndex((s) => s.notes) + 1;
  await presenter.locator(`#filmstrip .film-item[data-index="${noteSlide}"]`).click();
  await notes.waitForFunction((t) => document.getElementById("nv-text").textContent.includes(t), NOTE, { timeout: 5000 });
  check("the notes window follows the console and shows the notes", true);
  await waitSlide(audience, noteSlide);
  // Privacy: the notes of the slide on screen are nowhere in the projector, on screen or on the wire.
  check("the projector never shows the lecturer's notes", !(await audience.evaluate(() => document.body.innerText)).includes(NOTE));
  check("the projector never receives the lecturer's notes", leaked.length === 0, leaked.join(", "));
  // A lecture end turns the projector dark instead of leaving the last slide up.
  await fetch(base + "/api/show/control", { method: "POST", headers: { "content-type": "application/json", "x-alfa-show": "1" }, body: JSON.stringify({ action: "end" }) });
  await audience.waitForFunction(() => document.body.classList.contains("alfa-blackout"), null, { timeout: 5000 });
  check("ending the lecture darkens the projector", true);
} catch (err) {
  failures.push("exception: " + err.message); console.error(err);
} finally {
  await browser.close(); server.kill();
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nall presentation engine browser checks passed");
process.exit(failures.length ? 1 : 0);
