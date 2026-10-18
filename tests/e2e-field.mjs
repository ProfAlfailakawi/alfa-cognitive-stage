// Resume after a crash, recorded field trial with labelling, timed rehearsal audience, course map and guest mode.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 4301, base = `http://localhost:${port}`, ADMIN = "field-test-token-0123456789abcd", A = "abcdef012345", B = "fedcba543210";
const failures = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) failures.push(name); };
const scratch = mkdtempSync(join(tmpdir(), "alfa-field-e2e-"));
const bundles = join(scratch, "bundles");
const texts = { [A]: ["", "الدافعية الذاتية والدافعية الخارجية لدى الطلاب"], [B]: ["", "", "الدافعية الخارجية والدافعية الذاتية وأثرها على الطلاب"] };
for (const id of [A, B]) {
  cpSync(join(root, "bundles/testfixture1"), join(bundles, id), { recursive: true });
  const m = JSON.parse(readFileSync(join(bundles, id, "manifest.json"), "utf8"));
  m.id = id; m.source = id === A ? "الأسبوع 1.pptx" : "الأسبوع 2.pptx";
  texts[id].forEach((t, i) => { if (t) m.slides[i].text = t; });
  writeFileSync(join(bundles, id, "manifest.json"), JSON.stringify(m));
}
writeFileSync(join(bundles, "current.json"), JSON.stringify({ id: A }));
writeFileSync(join(bundles, "lectures.json"), JSON.stringify([{ id: A, title: "الأسبوع 1", slideCount: 7 }, { id: B, title: "الأسبوع 2", slideCount: 7 }]));
const server = spawn(process.execPath, [join(root, "server/server.mjs")], {
  env: { ...process.env, PORT: String(port), ADMIN_TOKEN: ADMIN, ALFA_BUNDLES_DIR: bundles, LIBRARY_FILE: join(scratch, "library.json"), VOTES_FILE: join(scratch, "votes.json"),
    SCENES_FILE: join(scratch, "scenes.json"), QUESTION_BANK_FILE: join(scratch, "bank.json"), DIRECTOR_USAGE_FILE: join(scratch, "usage.json") }, stdio: ["ignore", "pipe", "pipe"] });
await new Promise((r) => server.stdout.once("data", r));
const api = (path, method = "GET", body, headers = { "X-Admin-Token": ADMIN }) => fetch(`${base}/api${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
const FAKE = () => {
  window.__rec = null;
  window.SpeechRecognition = class { constructor() { window.__rec = this; } start() { this.running = true; } stop() { this.running = false; setTimeout(() => this.onend?.(), 0); } static available() { return Promise.resolve("unavailable"); } };
  window.__say = (final) => window.__rec.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: final } }] });
};
const newPresenter = async (context, url = `${base}/?dev=1#presenter`) => {
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("pageerror: " + e); failures.push("pageerror"); });
  await page.goto(url);
  await page.waitForSelector("#field-drawer");
  return page;
};
try {
  // ======== resume after a crash ========
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await newPresenter(ctx);
    for (let i = 0; i < 2; i++) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(300); }
    await page.keyboard.press("ArrowRight"); await page.waitForTimeout(500);
    const before = await page.textContent("#meta");
    check("setup: stage is on slide 3 with a build step", before.includes("3 من") && before.includes("حركة 1"), before);
    await page.waitForTimeout(3200); // the position is saved every few seconds
    await page.close(); // "power cut"
    const again = await newPresenter(ctx);
    await again.waitForSelector("#resume-banner:not([hidden])", { timeout: 6000 });
    check("after a restart the lecturer is offered the exact position", (await again.textContent("#resume-banner")).includes("الشريحة 3"), await again.textContent("#resume-banner"));
    check("the offer is not applied automatically", (await again.textContent("#meta")).includes("1 من"));
    await again.click("#resume-go");
    await again.waitForFunction(() => document.querySelector("#meta")?.textContent?.includes("حركة 1"), null, { timeout: 5000 });
    check("resuming restores slide and build step", (await again.textContent("#meta")).includes("3 من"), await again.textContent("#meta"));
    check("the banner goes away after resuming", await again.locator("#resume-banner").isHidden());
    await ctx.close();
  }
  // ======== recorded field trial ========
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1400 }, acceptDownloads: true });
    await ctx.addInitScript(FAKE);
    const page = await newPresenter(ctx);
    await page.locator("#field-drawer summary").click();
    check("recording is impossible before consent", await page.locator("#trial-toggle").isDisabled());
    await page.click("#director-start");
    await page.evaluate(() => window.__say("في دراسة طلعت إن ٦٨ بالمية من الطلبة استفادوا"));
    await page.waitForTimeout(400);
    await page.check("#trial-consent");
    await page.click("#trial-toggle");
    const keysBefore = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("alfa-trial-v1:")).length);
    check("starting after consent opens a trial; earlier speech was not captured", keysBefore === 1 && await page.locator("#trial-toggle").textContent() === "إيقاف التسجيل");
    for (const line of ["في دراسة طلعت إن ٧٠ بالمية من الطلبة سهروا", "اللي يسهر وايد يتعب", "نكمل الشريحة الجاية", "اول شي نشوف المقدمة وبعدين التطبيق وبعدين النتائج", "طيب خلونا نتكلم عن شي ثاني"]) {
      await page.evaluate((t) => window.__say(t), line);
      await page.waitForTimeout(350);
    }
    await page.click("#trial-toggle");
    await page.waitForSelector("#trial-report");
    const report = await page.textContent("#trial-report");
    check("the report counts what was heard and decided", /جمل سُمعت: 5/.test(report) && /قرارات المخرج: 5/.test(report), report.slice(0, 180));
    check("latency is shown only if it was measured", /التأخير/.test(report));
    check("accuracy is not claimed before labelling", report.includes("غير محسوبة") && report.includes("لم تُصنَّف"), report);
    const rows = page.locator("#trial-decisions li");
    check("each decision can be labelled by the lecturer", (await rows.count()) >= 1);
    const n = await rows.count();
    for (let i = 0; i < n; i++) await rows.nth(i).locator("button", { hasText: /^(صمته )?مناسب$/ }).click(); // the list re-renders each time
    const after = await page.textContent("#trial-report");
    check("labels turn into a precision figure only past 5 labelled decisions", n >= 5 && after.includes("100٪"), `labelled rows: ${n}`);
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#trial-export")]);
    const exported = JSON.parse(readFileSync(await download.path(), "utf8"));
    check("the export is the trial as JSON with the recorded text", exported.format === "alfa-field-trial-v1" && exported.trial.events.some((e) => e.type === "utterance" && e.text.includes("طلعت")));
    await page.click("#trial-clear");
    check("clearing removes every trial from the browser", await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("alfa-trial-v1:")).length) === 0);
    await ctx.close();
  }
  // ======== kept questions, timed rehearsal, course map ========
  {
    const course = (await (await api("/library/courses", "POST", { name: "تعلم الكبار", term: "خريف" })).json()).course;
    for (const id of [A, B]) await api(`/library/lectures/${id}`, "PUT", { courseId: course.id });
    const T = (c) => c.repeat(32);
    const sessions = {};
    for (const [id, slide] of [[A, 2], [B, 3]]) {
      const { code } = await (await api("/sessions", "POST", {})).json();
      sessions[id] = code;
      await api(`/sessions/${code}/pulse/context`, "POST", { lecture: id, slide });
      for (const c of "abcdef") await fetch(`${base}/api/sessions/${code}/pulse`, { method: "POST", headers: { "Content-Type": "application/json", "X-Voter-Token": T(c) }, body: JSON.stringify({ state: c < "d" ? "lost" : "lost" }) });
    }
    await fetch(`${base}/api/sessions/${sessions[A]}/questions`, { method: "POST", headers: { "Content-Type": "application/json", "X-Voter-Token": T("a") }, body: JSON.stringify({ text: "ما الفرق بين الدافعية الذاتية والخارجية؟" }) });
    const q = (await (await api(`/sessions/${sessions[A]}/questions`)).json()).questions[0];
    check("the kept question remembers its slide", (await api(`/sessions/${sessions[A]}/questions/${q.id}/keep`, "POST", {})).status === 201);

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1500 } });
    await ctx.addInitScript((t) => { try { sessionStorage.setItem("alfa-admin-token", t); } catch {} }, ADMIN);
    const page = await newPresenter(ctx);
    await page.fill("#director-admin-token", ADMIN);
    await page.locator("#director-admin-token").press("Tab");
    await page.locator("#field-drawer summary").click();
    await page.waitForSelector("#rehearse-start");
    await page.click("#rehearse-start");
    await page.waitForSelector("#rehearse-q");
    check("the rehearsal moves the stage to the question's slide", (await page.textContent("#meta")).includes("2 من"), await page.textContent("#meta"));
    check("the replayed question is the real one", (await page.textContent("#rehearse-q")).includes("الدافعية الذاتية"));
    await page.waitForTimeout(1200);
    await page.click("#rehearse-done");
    await page.waitForSelector("#rehearse-summary");
    const sum = await page.textContent("#rehearse-summary");
    check("the summary reports the time it took to answer", /أجبتَ عن 1 من 1/.test(sum) && /وسيط زمن الإجابة \d+ ث/.test(sum), sum);

    await page.selectOption("#map-course", course.id);
    await page.waitForSelector("#map-list li");
    const list = await page.textContent("#map-list");
    check("the course map lists each lecture's lost-signal slides", list.includes("الأسبوع 1") && list.includes("الأسبوع 2") && list.includes("6/6"), list);
    await page.waitForSelector("#map-recurring li", { timeout: 6000 });
    check("a concept confusing in two lectures is shown as recurring", (await page.textContent("#map-recurring")).includes("يتكرر المفهوم"));
    check("the map says it does not explain why", (await page.textContent("#map-out")).includes("لا يفسّر السبب"));
    await ctx.close();
  }
  // ======== guest mode ========
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await ctx.addInitScript(FAKE);
    const page = await newPresenter(ctx, `${base}/?guest=1&dev=1#presenter`);
    check("guest mode is announced", await page.locator("#guest-badge").isVisible());
    await page.keyboard.press("ArrowRight"); await page.waitForTimeout(300);
    await page.keyboard.press("ArrowRight"); await page.waitForTimeout(3200);
    await page.click("#director-start");
    await page.evaluate(() => window.__say("في دراسة طلعت إن ٦٨ بالمية من الطلبة استفادوا"));
    await page.waitForTimeout(600);
    const inMemory = await page.evaluate(() => localStorage.length);
    const real = (await ctx.storageState()).origins.flatMap((o) => o.localStorage.map((x) => x.name)).filter((n) => n.startsWith("alfa-"));
    check("the guest page works in memory", inMemory > 0, "memory keys: " + inMemory);
    check("nothing from the guest session reaches the browser's real storage", real.length === 0, real.join(","));
    await ctx.close();
  }
} catch (error) {
  console.log("FAIL  unexpected: " + (error.stack || error));
  failures.push("unexpected");
} finally {
  await browser.close();
  server.kill();
  rmSync(scratch, { recursive: true, force: true });
}
if (failures.length) { console.log("\nFAILED:", failures.join("; ")); process.exit(1); }
console.log("\nfield e2e: all checks passed");
