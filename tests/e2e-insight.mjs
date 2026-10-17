// Understanding pulse with six phone contexts, number witness, coach, student review and kept questions, in real Chromium.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 4199, base = `http://localhost:${port}`, ADMIN = "insight-test-token-0123456789abc", ID = "abcdef012345";
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures.push(name);
};
const scratch = mkdtempSync(join(tmpdir(), "alfa-insight-e2e-"));
const bundles = join(scratch, "bundles");
cpSync(join(root, "bundles/testfixture1"), join(bundles, ID), { recursive: true });
const manifest = JSON.parse(readFileSync(join(bundles, ID, "manifest.json"), "utf8"));
manifest.id = ID; manifest.source = "محاضرة اختبار.pptx";
manifest.slides[1].text = "نسبة الرضا عن المقرر 68%";
writeFileSync(join(bundles, ID, "manifest.json"), JSON.stringify(manifest));
writeFileSync(join(bundles, "current.json"), JSON.stringify({ id: ID }));
writeFileSync(join(bundles, "lectures.json"), JSON.stringify([{ id: ID, title: manifest.source, slideCount: 7 }]));
const server = spawn(process.execPath, [join(root, "server/server.mjs")], {
  env: { ...process.env, PORT: String(port), ADMIN_TOKEN: ADMIN, ALFA_BUNDLES_DIR: bundles, LIBRARY_FILE: join(scratch, "library.json"),
    VOTES_FILE: join(scratch, "votes.json"), SCENES_FILE: join(scratch, "scenes.json"), QUESTION_BANK_FILE: join(scratch, "bank.json"),
    DIRECTOR_USAGE_FILE: join(scratch, "usage.json") }, stdio: ["ignore", "pipe", "pipe"] });
await new Promise((r) => server.stdout.once("data", r));
const api = (path, init = {}) => fetch(base + "/api" + path, { ...init, headers: { "X-Admin-Token": ADMIN, "Content-Type": "application/json", ...(init.headers || {}) } });
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
const FAKE = () => {
  window.__rec = null;
  window.SpeechRecognition = class {
    constructor() { window.__rec = this; }
    start() { this.running = true; } stop() { this.running = false; setTimeout(() => this.onend?.(), 0); }
    static available() { return Promise.resolve("unavailable"); }
  };
  window.__say = (final) => window.__rec.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: final } }] });
};
try {
  const { code } = await (await api("/sessions", { method: "POST", body: "{}" })).json();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.addInitScript(FAKE);
  await context.addInitScript(([t, c]) => { try { sessionStorage.setItem("alfa-admin-token", t); sessionStorage.setItem("alfa-current-voting-session", c); } catch {} }, [ADMIN, code]);
  const presenter = await context.newPage();
  presenter.on("pageerror", (e) => { console.log("presenter pageerror: " + e); failures.push("presenter pageerror"); });
  await presenter.goto(`${base}/#presenter`);
  await presenter.waitForSelector("#insight-drawer");
  await presenter.fill("#director-admin-token", ADMIN);
  await presenter.locator("#director-admin-token").press("Tab");
  await presenter.locator("#voting-drawer summary").click(); // loads the voting console, which reports the session code
  const liveSlide = async () => (await (await api(`/sessions/${code}/pulse`)).json()).live.slide;
  for (let i = 0; i < 40 && (await liveSlide()) !== 1; i++) await presenter.waitForTimeout(500);
  check("the lecturer window tells the server which slide is on screen", (await liveSlide()) === 1);

  // ---- six phones ----
  const phones = [];
  for (let i = 0; i < 6; i++) {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
    page.on("pageerror", (e) => { console.log("phone pageerror: " + e); failures.push("phone pageerror"); });
    await page.goto(`${base}/vote.html?s=${code}`);
    phones.push(page);
  }
  check("phones show two quiet buttons", (await phones[0].locator("#pulse button").allTextContents()).join("|") === "فاهم|ضايع");
  for (let i = 0; i < 6; i++) await phones[i].click(i < 3 ? "#pulse-lost" : "#pulse-got");
  await presenter.waitForFunction(() => document.querySelector("#pulse-line")?.dataset.level === "watch", null, { timeout: 12000 });
  const line = await presenter.textContent("#pulse-line");
  check("lecturer sees a calm, anonymous aggregate", line.includes("3 من 6"), line);
  const audience = await context.newPage();
  await audience.goto(`${base}/#audience`);
  await audience.waitForSelector("#slide-img");
  check("the audience screen carries no pulse, witness or insight panel",
    (await audience.locator("#pulse-line, #witness-line, #insight-drawer").count()) === 0 && !(await audience.textContent("body")).includes("نبض الفهم"));
  const rawPulse = await (await api(`/sessions/${code}/pulse`)).text();
  check("the aggregate API exposes no tokens or identities", !/token|[a-f0-9]{24}/i.test(rawPulse), rawPulse.slice(0, 160));
  check("students cannot read the aggregate", (await fetch(`${base}/api/sessions/${code}/pulse`)).status === 401);
  const fresh = "9".repeat(32), tap = (state) => fetch(`${base}/api/sessions/${code}/pulse`, { method: "POST", headers: { "Content-Type": "application/json", "X-Voter-Token": fresh }, body: JSON.stringify({ state }) });
  const [first, second] = [await tap("got"), await tap("lost")];
  check("a second tap inside the cooldown is refused", first.status === 200 && second.status === 429, `${first.status}/${second.status}`);

  // ---- move on: the next slide starts a fresh count ----
  await presenter.keyboard.press("ArrowRight");
  await presenter.waitForFunction(() => document.querySelector("#pulse-line")?.hidden === true, null, { timeout: 12000 });
  check("a new slide starts a fresh pulse", true);

  // ---- number witness (slide 2 prints 68%) ----
  await presenter.click("#director-start");
  await presenter.evaluate(() => window.__say("نسبة الرضا عن المقرر وصلت تسعين بالميه"));
  await presenter.waitForSelector("#witness-line:not([hidden])", { timeout: 6000 });
  const witness = await presenter.textContent("#witness-line");
  check("a spoken number that disagrees with the slide is flagged privately", witness.includes("90%") && witness.includes("68%") && witness.includes("لك وحدك"), witness);
  await presenter.evaluate(() => window.__say("طيب نكمل"));
  await presenter.evaluate(() => window.__say("نسبة الرضا عن المقرر ثمانية وستين بالميه"));
  await presenter.waitForTimeout(500);

  // ---- a student question on slide 2, kept for rehearsal ----
  await phones[1].locator("#ask-lecturer summary").click();
  await phones[1].fill("#question-text", "ما الفرق بين الرضا والقناعة في المقرر؟");
  await phones[1].click("#question-submit");
  await phones[1].waitForFunction(() => document.querySelector("#question-message")?.textContent?.includes("وصل"));
  const inbox = await (await api(`/sessions/${code}/questions`)).json();
  check("the question is tied to the slide that was on screen", inbox.questions[0].slide === `${ID}#2`, JSON.stringify(inbox.questions[0]));
  const kept = await api(`/sessions/${code}/questions/${inbox.questions[0].id}/keep`, { method: "POST", body: "{}" });
  check("the lecturer can keep it for rehearsal (text only)", kept.status === 201);
  check("flagged or personal questions are never kept",
    (await api(`/sessions/${code}/questions/999/keep`, { method: "POST", body: "{}" })).status === 404);

  // ---- drawer: suggestion, review, rehearsal audience ----
  await presenter.keyboard.press("ArrowLeft");
  await presenter.locator("#insight-drawer summary").click();
  await presenter.waitForSelector("#coach-text", { timeout: 8000 });
  const coach = await presenter.textContent("#coach-text");
  check("the suggestion is honest about resting on one session", coach.includes("الشريحة 1") && coach.includes("لا يكفي"), coach);
  check("the suggestion shows its evidence", (await presenter.textContent("#coach-evidence")).includes("3 من 7"));
  await presenter.waitForSelector("#bank-list");
  check("the rehearsal audience replays the real question on its slide", (await presenter.textContent("#bank-list")).includes("شريحة 2") && (await presenter.textContent("#bank-list")).includes("الفرق بين الرضا"));
  check("the drawer says the questions are real, not generated", (await presenter.textContent("#insight-drawer")).includes("وليست مولّدة"));

  await presenter.click("#toggle-info");
  await presenter.fill("#info-title", "مصدر الرضا");
  await presenter.fill("#info-lines", "68%\nمن حديث المحاضر");
  await presenter.click("#info-show");
  await presenter.waitForTimeout(400);
  await presenter.locator("#insight-drawer summary").click();
  await presenter.locator("#insight-drawer summary").click();
  await presenter.waitForSelector("#review-publish:not([disabled])", { timeout: 6000 });
  // the re-opened drawer rebuilds asynchronously; wait until the newest scene is in the list
  await presenter.waitForFunction(() => document.querySelector("#review-preview")?.textContent.includes("مصدر الرضا"), null, { timeout: 6000 });
  const clash = await presenter.locator(".review-clash").allTextContents();
  check("a scene whose number contradicts its slide is flagged and starts unticked",
    clash.length === 1 && clash[0].includes("90") && clash[0].includes("68") &&
    (await presenter.locator("#review-preview li", { hasText: "90%" }).locator("input").isChecked()) === false, clash.join("|"));
  await presenter.click("#review-publish");
  await presenter.waitForFunction(() => document.querySelector("#insight-status")?.textContent?.includes("review.html"));
  const student = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  await student.goto(`${base}/review.html?s=${code}`);
  await student.waitForSelector("section");
  const reviewText = await student.textContent("#app");
  check("students read a review made only of what was shown", reviewText.includes("مصدر الرضا") && reviewText.includes("68%") && !reviewText.includes("90%") && reviewText.includes("مما عُرض أثناء المحاضرة فقط"), reviewText.slice(0, 160));
  check("the review page cannot publish or change anything",
    (await fetch(`${base}/api/sessions/${code}/review`, { method: "POST", body: "{}" })).status === 401);
  await presenter.click("#review-withdraw");
  await presenter.waitForFunction(() => document.querySelector("#insight-status")?.textContent?.includes("سُحبت"));
  check("withdrawing hides the review again", (await fetch(`${base}/api/sessions/${code}/review`)).status === 404);
} catch (error) {
  console.log("FAIL  unexpected: " + (error.stack || error));
  failures.push("unexpected");
} finally {
  await browser.close();
  server.kill();
  rmSync(scratch, { recursive: true, force: true });
}
if (failures.length) { console.log("\nFAILED:", failures.join("; ")); process.exit(1); }
console.log("\ninsight e2e: all checks passed");
