// Course library, rehearsal, session summary, clock and data controls in real Chromium.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 4195, base = `http://localhost:${port}`, ADMIN = "library-test-token-0123456789abc";
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures.push(name);
};
// A private bundles directory holding the fixture under a real-looking id.
const scratch = mkdtempSync(join(tmpdir(), "alfa-lib-e2e-"));
const bundles = join(scratch, "bundles"), ID = "abcdef012345";
cpSync(join(root, "bundles/testfixture1"), join(bundles, ID), { recursive: true });
const manifest = JSON.parse(readFileSync(join(bundles, ID, "manifest.json"), "utf8"));
manifest.id = ID; manifest.source = "محاضرة تجريبية.pptx";
writeFileSync(join(bundles, ID, "manifest.json"), JSON.stringify(manifest));
writeFileSync(join(bundles, "current.json"), JSON.stringify({ id: ID }));
writeFileSync(join(bundles, "lectures.json"), JSON.stringify([{ id: ID, title: manifest.source, slideCount: 7 }]));
const server = spawn(process.execPath, [join(root, "server/server.mjs")], {
  env: { ...process.env, PORT: String(port), ADMIN_TOKEN: ADMIN, ALFA_BUNDLES_DIR: bundles, LIBRARY_FILE: join(scratch, "library.json"),
    VOTES_FILE: join(scratch, "votes.json"), SCENES_FILE: join(scratch, "scenes.json") }, stdio: ["ignore", "pipe", "pipe"] });
await new Promise((r) => server.stdout.once("data", r));
const api = (path, init = {}) => fetch(base + path, { ...init, headers: { "X-Admin-Token": ADMIN, "Content-Type": "application/json", ...(init.headers || {}) } });
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const presenter = await context.newPage(), audience = await context.newPage();
for (const [name, page] of [["presenter", presenter], ["audience", audience]]) page.on("pageerror", (e) => { console.log(name + " pageerror: " + e); failures.push(name + " pageerror"); });
try {
  // ---- API authorisation ----
  check("library is lecturer-only", (await fetch(base + "/api/library")).status === 401 && (await fetch(base + "/api/data/summary")).status === 401);
  const created = await (await api("/api/library/courses", { method: "POST", body: JSON.stringify({ name: "تعلم الكبار", term: "خريف" }) })).json();
  check("course can be created", /^[a-f0-9]{8}$/.test(created.course.id));
  await audience.goto(`${base}/#audience`);
  await audience.waitForSelector("#slide-img");

  await presenter.goto(`${base}/#presenter`);
  await presenter.waitForSelector("#library-drawer");
  await presenter.fill("#director-admin-token", ADMIN);
  await presenter.locator("#director-admin-token").press("Tab");
  // ---- clock ----
  await presenter.selectOption("#planned-minutes", "30");
  await presenter.waitForTimeout(1200);
  check("quiet clock shows a progress line without alarms", await presenter.locator("#clock-fill").evaluate((e) => e.dataset.phase === "normal") &&
    (await presenter.textContent("#clock")).match(/^\d\d:\d\d$/));
  // ---- rehearsal ----
  await presenter.locator("#readiness-drawer summary").click();
  await presenter.click("#rehearsal-run");
  await presenter.waitForFunction(() => [...document.querySelectorAll("#rehearsal-results li")].some((li) => li.textContent.includes("فيديو تالف")), null, { timeout: 30000 });
  const rows = await presenter.locator("#rehearsal-results li").allTextContents();
  check("rehearsal checks the lecture files", rows.some((r) => r.includes("✓") && r.includes("تُحمَّل")), rows.join(" | "));
  check("rehearsal finds the open audience window", rows.some((r) => r.includes("نافذة الطلبة مفتوحة")));
  check("rehearsal drills the failures without touching the lecture",
    ["رفض صلاحية الميكروفون", "انقطاع خدمة التعرف", "تشغيل فيديو يوقف", "فحص المخرج الذاتي", "فيديو تالف"].every((t) => rows.some((r) => r.includes(t) && r.includes("✓"))));
  check("rehearsal does not fail on a healthy lecture", !rows.some((r) => r.startsWith("✗")), rows.filter((r) => r.startsWith("✗")).join("|"));
  check("lecture position untouched by the rehearsal", (await presenter.textContent("#meta")).includes("1 من 7"));

  // ---- library drawer ----
  await presenter.locator("#library-drawer summary").click();
  await presenter.waitForSelector("#library-open");
  check("quick-access list shows the lecture", (await presenter.locator("#library-open option").allTextContents()).some((t) => t.includes("محاضرة تجريبية")));
  const selects = presenter.locator("#library-body select, .library-body select");
  await selects.nth(1).selectOption(created.course.id);
  await presenter.locator('.library-body input[aria-label="عنوان المحاضرة"]').fill("الأسبوع الثالث — الألعاب");
  await presenter.locator(".library-body button", { hasText: "حفظ التنظيم" }).click();
  await presenter.waitForFunction(() => document.querySelector("#library-status")?.textContent?.includes("حُفظ"));
  const snap = await (await api("/api/library")).json();
  const mine = snap.lectures.find((l) => l.bundle === ID);
  check("lecture is filed under the course with its title; original untouched",
    mine.courseId === created.course.id && mine.title === "الأسبوع الثالث — الألعاب" && mine.source === "محاضرة تجريبية.pptx" &&
    existsSync(join(bundles, ID, "manifest.json")));

  // ---- session summary (what really happened) ----
  await presenter.keyboard.press("ArrowRight");
  await presenter.waitForTimeout(250);
  await presenter.keyboard.press("ArrowRight");
  await presenter.waitForTimeout(250);
  await presenter.click("#toggle-info");
  await presenter.fill("#info-title", "نسبة");
  await presenter.fill("#info-lines", "68%\nمن حديث المحاضر");
  await presenter.click("#info-show");
  await presenter.waitForTimeout(300);
  await presenter.click("#session-summary-run");
  await presenter.waitForFunction(() => document.querySelector("#session-summary")?.textContent?.includes("ملخص الجلسة"));
  const summary = await presenter.textContent("#session-summary");
  check("summary reports visited slides, the scene and the disclaimer",
    summary.includes("الشرائح التي عُرضت") && summary.includes("stat") && summary.includes("ليس تقييماً"), summary.slice(0, 220));
  check("summary invents nothing about learning", !/ممتاز|ضعيف|جيد/.test(summary));

  // ---- data controls ----
  await presenter.waitForFunction(() => document.querySelector("#data-summary")?.textContent?.includes("مخزن محلياً"));
  await presenter.click("#wipe-session-logs");
  check("session logs can be wiped", (await presenter.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("alfa-sessions-v1:")).length)) === 0);
  presenter.once("dialog", (d) => d.accept());
  await presenter.click("#wipe-lecture");
  await presenter.waitForFunction(() => !location.search.includes("bundle="), null, { timeout: 8000 }).catch(() => {});
  await presenter.waitForTimeout(800);
  check("deleting a lecture removes its files and listing", !existsSync(join(bundles, ID)) &&
    JSON.parse(readFileSync(join(bundles, "lectures.json"), "utf8")).length === 0);
} catch (error) {
  console.error(error); failures.push("exception");
} finally {
  await browser.close(); server.kill(); rmSync(scratch, { recursive: true, force: true });
}
if (failures.length) { console.log(`\n${failures.length} check(s) failed`); process.exit(1); }
console.log("\nall library, rehearsal, summary and data-control checks passed");
