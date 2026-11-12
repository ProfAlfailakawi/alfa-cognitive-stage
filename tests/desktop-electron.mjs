// The ALFA Mac app (Electron) end to end: its own server, the console, a projector window placed on a
// second display, focus, privacy, hot-unplug/replug, notes window, end of show and clean quit.
// Displays are simulated (a CI machine has one screen): this proves the app's logic and windows, not a real
// projector. Run: node tests/desktop-electron.mjs   (needs electron and playwright; on Linux CI use xvfb-run)
import { _electron as electron } from "playwright";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const port = 4231;
const bundleId = JSON.parse(readFileSync(join(root, "bundles/current.json"), "utf8")).id;
const manifest = JSON.parse(readFileSync(join(root, "bundles", bundleId, "manifest.json"), "utf8"));
const NOTE = manifest.slides.find((s) => s.notes)?.notes;
const noteSlide = manifest.slides.findIndex((s) => s.notes) + 1;
const failures = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) failures.push(name); };
const portFree = (p) => new Promise((r) => { const s = net.createServer().once("error", () => r(false)).once("listening", () => s.close(() => r(true))); s.listen(p, "127.0.0.1"); });

const app = await electron.launch({
  executablePath: require("electron"),
  args: [join(root, "desktop/main.cjs"), ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
  env: { ...process.env, ALFA_DESKTOP_TEST: "1", ALFA_PORT: String(port), ALFA_ROOT: root, ALFA_DESKTOP_LOG: "0" },
});
const windowWith = async (hash, timeout = 15000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (const w of app.windows()) if (w.url().includes(hash)) return w;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("no window " + hash);
};
try {
  const consoleWin = await windowWith("#presenter", 90000); // a cold start runs the server first
  await consoleWin.waitForSelector("#filmstrip .film-item", { timeout: 20000 });
  check("the app starts its own server and opens the console", (await consoleWin.textContent("#meta")).includes("من"));
  check("the console reaches only the narrow desktop bridge", await consoleWin.evaluate(() =>
    typeof window.alfaDesktop?.startShow === "function" && typeof require === "undefined" && typeof process === "undefined"));
  const prefs = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.webContents.getLastWebPreferences()));
  check("every window is isolated and sandboxed", prefs.every((p) => p.contextIsolation === true && p.nodeIntegration === false && p.sandbox === true), JSON.stringify(prefs.map((p) => [p.contextIsolation, p.nodeIntegration, p.sandbox])));

  // One screen only: ALFA explains instead of covering the lecturer's own screen.
  await app.evaluate(() => { globalThis.__alfaFakeDisplays = [{ id: 1, internal: true, scaleFactor: 2, bounds: { x: 0, y: 0, width: 1280, height: 800 }, workArea: { x: 0, y: 25, width: 1280, height: 775 } }]; });
  await consoleWin.click("#open-audience");
  await consoleWin.waitForFunction(() => document.getElementById("director-status").textContent.includes("لا توجد شاشة ثانية"), null, { timeout: 5000 });
  check("with one screen, Start show explains and opens nothing", !app.windows().some((w) => w.url().includes("#audience")));

  // Two screens (projector to the left, negative coordinates): Start show places the projector window there.
  await app.evaluate(() => { globalThis.__alfaFakeDisplays = [globalThis.__alfaFakeDisplays[0], { id: 2, internal: false, scaleFactor: 1, bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, workArea: { x: -1920, y: 0, width: 1920, height: 1080 } }]; });
  await consoleWin.click("#open-audience");
  const audience = await windowWith("#audience");
  await audience.waitForSelector("#slide-img", { timeout: 15000 });
  const placed = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes("#audience"));
    return { bounds: w.getBounds(), frame: w.isClosable(), focused: BrowserWindow.getFocusedWindow()?.webContents.getURL() || "" };
  });
  check("the projector window takes the projector's whole display", placed.bounds.x === -1920 && placed.bounds.width === 1920 && placed.bounds.height === 1080, JSON.stringify(placed.bounds));
  check("the projector window does not take the keyboard from the console", !placed.focused.includes("#audience"), placed.focused);
  check("the projector has no bridge, no notes, no controls", await audience.evaluate(() => typeof window.alfaDesktop === "undefined" && document.querySelectorAll("button").length === 0));
  await consoleWin.waitForFunction(() => !document.getElementById("end-show").hidden && !document.getElementById("blackout-btn").hidden, null, { timeout: 5000 });
  check("the console shows End show and Blackout once the show runs", true);

  // The projector follows the console through the engine.
  await consoleWin.locator(`#filmstrip .film-item[data-index="${noteSlide}"]`).click();
  await audience.waitForFunction((n) => (document.getElementById("slide-img")?.getAttribute("src") || "").includes(String(n).padStart(3, "0")), noteSlide, { timeout: 8000 });
  check("the projector follows a jump on the console", true);
  check("the projector never shows the notes of the slide on screen", !(await audience.evaluate(() => document.body.innerText)).includes(NOTE));
  // Blackout button.
  await consoleWin.click("#blackout-btn");
  await audience.waitForFunction(() => document.body.classList.contains("alfa-blackout"), null, { timeout: 6000 });
  await consoleWin.click("#blackout-btn");
  await audience.waitForFunction(() => !document.body.classList.contains("alfa-blackout"), null, { timeout: 6000 });
  check("Blackout darkens and restores the projector", true);

  // Unplug the projector: the window hides (never moves onto the lecturer's screen), the console is told.
  await app.evaluate(() => { globalThis.__alfaFakeDisplays = [globalThis.__alfaFakeDisplays[0]]; globalThis.__alfaDesktop.onDisplaysChanged("removed"); });
  const hidden = await app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes("#audience")).isVisible());
  check("an unplugged projector's window hides instead of landing on the Mac", hidden);
  await consoleWin.waitForFunction(() => document.getElementById("director-status").textContent.includes("انفصل البروجكتر"), null, { timeout: 5000 });
  check("the console says the projector was lost and the lecture continues", true);
  // Meanwhile the lecture moves on; replug brings the projector back on the current slide.
  await consoleWin.keyboard.press("ArrowRight");
  await consoleWin.waitForTimeout(400);
  const now = Number((await consoleWin.textContent("#meta")).match(/الشريحة (\d+)/)[1]);
  await app.evaluate(() => { globalThis.__alfaFakeDisplays = [globalThis.__alfaFakeDisplays[0], { id: 2, internal: false, scaleFactor: 1, bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, workArea: { x: -1920, y: 0, width: 1920, height: 1080 } }]; globalThis.__alfaDesktop.onDisplaysChanged("added"); });
  const back = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes("#audience")).isVisible());
  await audience.waitForFunction((n) => (document.getElementById("slide-img")?.getAttribute("src") || "").includes(String(n).padStart(3, "0")), now, { timeout: 8000 });
  check("a replugged projector comes back on the current slide", back);

  // Projector window reload (e.g. after a renderer crash) resumes the current state.
  await audience.reload();
  await audience.waitForFunction((n) => (document.getElementById("slide-img")?.getAttribute("src") || "").includes(String(n).padStart(3, "0")), now, { timeout: 10000 });
  check("a reloaded projector window resumes the current slide", true);

  // Notes window from the console's notes button.
  await consoleWin.click("#open-notes");
  const notesWin = await windowWith("#notes");
  await notesWin.waitForSelector("#nv-text");
  await consoleWin.locator(`#filmstrip .film-item[data-index="${noteSlide}"]`).click();
  await notesWin.waitForFunction((t) => document.getElementById("nv-text").textContent.includes(t), NOTE, { timeout: 8000 });
  check("the notes window opens on the Mac and follows the console", true);

  // End show closes the projector window; the console stays.
  await consoleWin.click("#end-show");
  await consoleWin.waitForTimeout(800);
  check("End show closes the projector window and keeps the console", !app.windows().some((w) => w.url().includes("#audience")) && app.windows().some((w) => w.url().includes("#presenter")));
  // A page cannot navigate the app elsewhere (last: Playwright keeps waiting for the navigation it blocked).
  consoleWin.evaluate(() => { location.href = "https://example.com/"; }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));
  const urls = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.webContents.getURL()));
  check("navigation away from ALFA is blocked", urls.every((u) => u.startsWith("http://127.0.0.1:") || u.startsWith("data:")), urls.join(" "));
} catch (err) {
  failures.push("exception: " + err.message); console.error(err);
} finally {
  await app.close().catch(() => {});
}
await new Promise((r) => setTimeout(r, 800));
check("quitting stops the server the app started", await portFree(port));
console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nall Mac app checks passed");
process.exit(failures.length ? 1 : 0);
