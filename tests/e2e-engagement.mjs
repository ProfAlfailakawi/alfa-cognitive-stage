// Word cloud, moderated questions, topic summaries and section comparison with real phones (browser contexts).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 4194, base = `http://localhost:${port}`, ADMIN = "engagement-test-token-0123456789a";
const scratch = mkdtempSync(join(tmpdir(), "alfa-eng-"));
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures.push(name);
};
const server = spawn(process.execPath, [join(root, "server/server.mjs")], {
  env: { ...process.env, PORT: String(port), ADMIN_TOKEN: ADMIN, VOTES_FILE: join(scratch, "votes.json"), SCENES_FILE: join(scratch, "s.json") },
  stdio: ["ignore", "pipe", "pipe"] });
await new Promise((r) => server.stdout.once("data", r));
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ["--no-sandbox"] });
const api = (path, method = "GET", body, headers = { "X-Admin-Token": ADMIN }) => fetch(`${base}/api${path}`, { method,
  headers: { "Content-Type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
const lecturer = await (await browser.newContext({ viewport: { width: 1200, height: 1400 } })).newPage();
lecturer.on("pageerror", (e) => { console.log("lecturer pageerror: " + e); failures.push("lecturer pageerror"); });
let dialogs = 0;
lecturer.on("dialog", (d) => { dialogs++; d.dismiss(); });
const phones = [];
try {
  await lecturer.goto(`${base}/vote-admin.html`);
  await lecturer.fill("#token", ADMIN);
  await lecturer.click("#save-token");
  await lecturer.waitForSelector("#qr svg");
  const code = (await lecturer.textContent("#session-line")).split(":")[1].trim();
  await lecturer.fill("#session-label", "شعبة 1 — الأحد");
  await lecturer.click("#save-label");

  // ---- word cloud ----
  await lecturer.fill("#q-text", "كلمة تصف الدافعية؟");
  await lecturer.selectOption("#q-kind", "words");
  check("options box is hidden for a word cloud", await lecturer.locator("#q-opts").isHidden());
  await lecturer.fill("#q-objective", "يحدد مصادر الدافعية");
  await lecturer.click("#add-poll");
  await lecturer.waitForSelector("button[data-act=open]");
  await lecturer.click("button[data-act=open]");
  for (let i = 0; i < 3; i++) {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
    page.on("pageerror", (e) => { console.log("phone pageerror: " + e); failures.push("phone pageerror"); });
    await page.goto(`${base}/vote.html?s=${code}`);
    phones.push(page);
  }
  for (const p of phones) await p.waitForSelector("#word-form");
  await phones[0].locator(".word-input").nth(0).fill("شغف");
  await phones[0].locator(".word-input").nth(1).fill("هدف");
  await phones[0].locator(".word-input").nth(2).fill("99887766");
  await phones[0].click("#word-form button[type=submit]");
  await phones[0].waitForFunction(() => document.querySelector("#note")?.textContent?.includes("لم تُقبل"));
  check("phone is told why a number was refused", (await phones[0].textContent("#note")).includes("الأرقام"));
  await phones[1].locator(".word-input").nth(0).fill("الشغف");
  await phones[1].locator(".word-input").nth(1).fill("ضغط");
  await phones[1].click("#word-form button[type=submit]");
  await phones[2].locator(".word-input").nth(0).fill("يلعنننن");
  await phones[2].click("#word-form button[type=submit]");
  await phones[2].waitForFunction(() => document.querySelector("#note")?.textContent?.includes("لم تُقبل"));
  await lecturer.waitForFunction(() => document.querySelectorAll(".word-chip").length >= 3, null, { timeout: 8000 });
  const chips = await lecturer.locator(".word-chip").allTextContents();
  check("lecturer sees merged word counts, no abuse or number", chips.some((c) => c.includes("شغف") && c.includes("× 2")) && !chips.join(" ").match(/9988|يلعن/), chips.join(" | "));
  await lecturer.locator(".word-chip", { hasText: "ضغط" }).locator("button").click();
  await lecturer.waitForFunction(() => document.querySelector(".word-chip.hidden-word"));
  await lecturer.click("button[data-act=reveal]");
  await phones[0].waitForFunction(() => document.querySelector("#app")?.textContent?.includes("شغف") && document.querySelector("#app span"), null, { timeout: 8000 });
  const phoneText = await phones[0].textContent("#app");
  check("revealed cloud shows approved words and omits the hidden one", phoneText.includes("هدف") && !phoneText.includes("ضغط"), phoneText.slice(0, 120));
  check("students cannot hide words or read the inbox",
    (await api(`/sessions/${code}/polls/1/hide-word`, "POST", { key: "شغف" }, {})).status === 401 &&
    (await api(`/sessions/${code}/questions`, "GET", null, {})).status === 401);
  await lecturer.click("button[data-act=close]");

  // ---- questions: privacy refusal, flagging, clustering, XSS safety ----
  const ask = async (page, text) => {
    await page.evaluate(() => { document.querySelector("#ask-lecturer").open = true; });
    await page.fill("#question-text", text);
    await page.click("#question-submit");
    await page.waitForFunction(() => document.querySelector("#question-message")?.textContent?.length > 0);
    return page.textContent("#question-message");
  };
  await ask(phones[0], "ما الفرق بين الدافعية الداخلية والدافعية الخارجية؟");
  await ask(phones[1], "ممكن تعيد شرح الدافعية الداخلية والخارجية؟");
  await ask(phones[2], "شنو الفرق بين الدافع الداخلي والخارجي؟");
  const refused = await ask(await (async () => { const p = await (await browser.newContext()).newPage(); await p.goto(`${base}/vote.html?s=${code}`); phones.push(p); return p; })(),
    "كلموني على 99887766");
  check("a question with a phone number is refused with an explanation", refused.includes("أرقام هواتف"), refused);
  const flaggedPage = await (await browser.newContext()).newPage(); await flaggedPage.goto(`${base}/vote.html?s=${code}`); phones.push(flaggedPage);
  await ask(flaggedPage, "يا ابن الكلب شرح سيء <img src=x onerror=window.__pwned=1>");
  const xssPage = await (await browser.newContext()).newPage(); await xssPage.goto(`${base}/vote.html?s=${code}`); phones.push(xssPage);
  await ask(xssPage, "<script>window.__pwned=1</script> متى الاختبار النهائي؟");
  await lecturer.evaluate(() => { document.querySelector("#student-questions-drawer").open = true; });
  await lecturer.waitForFunction(() => document.querySelector("#question-insights")?.textContent?.includes("أسئلة متقاربة"), null, { timeout: 8000 });
  const insights = await lecturer.textContent("#question-insights");
  check("repeated topic is summarised with a re-explain cue", /3 أسئلة متقاربة/.test(insights) && insights.includes("اقتراح"), insights.slice(0, 200));
  check("flagged question is hidden behind a collapsed section",
    (await lecturer.locator("#student-questions > details").count()) === 1 &&
    !(await lecturer.locator("#student-questions > div.poll").allTextContents()).join(" ").includes("ابن الكلب"));
  check("student text is never executed as HTML", await lecturer.evaluate(() => window.__pwned === undefined) &&
    (await lecturer.locator("#student-questions").innerText()).includes("<script>") === true);

  // ---- section comparison ----
  const second = (await (await api("/sessions", "POST")).json()).code;
  await api(`/sessions/${second}`, "PUT", { label: "شعبة 2 — الثلاثاء" });
  const mk = async (c, votes) => {
    const poll = (await (await api(`/sessions/${c}/polls`, "POST", { question: "هل تفضل التعلم بالألعاب؟", options: ["نعم", "لا"] })).json()).poll;
    await api(`/sessions/${c}/polls/${poll.id}/open`, "POST");
    for (const [i, option] of votes.entries()) await fetch(`${base}/api/sessions/${c}/vote`, { method: "POST",
      headers: { "Content-Type": "application/json", "X-Voter-Token": String(i + 10).padStart(2, "0").repeat(16) }, body: JSON.stringify({ option }) });
  };
  await mk(code, [0, 0, 0, 1]); await new Promise((r) => setTimeout(r, 600));
  await mk(second, [0, 1, 1]);
  await lecturer.evaluate(() => { document.querySelector("#section-compare").open = true; });
  await lecturer.click("#load-section-compare");
  await lecturer.waitForFunction(() => document.querySelector("#section-compare-results")?.textContent?.includes("ليس دليلاً"), null, { timeout: 8000 });
  const compare = await lecturer.textContent("#section-compare-results");
  check("sections are shown side by side with sample sizes and the limits", compare.includes("شعبة 1") && compare.includes("شعبة 2") && compare.includes("ن=4") && compare.includes("75%") && compare.includes("ليس دليلاً"), compare.slice(0, 220));
  const csv = await lecturer.evaluate(async (c) => {
    const { exportAggregateCsv } = await import("/poll-analytics.js");
    const state = await (await fetch("/api/sessions/" + c + "/presenter", { headers: { "X-Admin-Token": sessionStorage.getItem("alfa-admin-token") } })).json();
    return exportAggregateCsv(state.polls);
  }, code);
  check("aggregate export carries objective and moderated words only", csv.includes("يحدد مصادر الدافعية") && csv.includes("شغف") && !csv.includes("ضغط") && !csv.match(/99887766|ابن الكلب/));

  // ---- projection of the approved cloud on the audience screen ----
  const shared = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const presenter = await shared.newPage(), audience = await shared.newPage();
  presenter.on("pageerror", (e) => { console.log("presenter pageerror: " + e); failures.push("presenter pageerror"); });
  await audience.goto(`${base}/#audience`);
  await presenter.goto(`${base}/#presenter`);
  await presenter.waitForSelector("#open-vote");
  await presenter.click("#open-vote");
  const frame = presenter.frameLocator("#vote-iframe");
  await frame.locator("#token").fill(ADMIN);
  await frame.locator("#save-token").click();
  await frame.locator("#qr svg").waitFor({ timeout: 10000 });
  const projCode = (await frame.locator("#session-line").textContent()).split(":")[1].trim();
  await frame.locator("#q-text").fill("كلمة عن التعلم؟");
  await frame.locator("#q-kind").selectOption("words");
  await frame.locator("#add-poll").click();
  await frame.locator("button[data-act=open]").click();
  for (const [i, w] of [["شغف"], ["شغف"], ["فضول"]].entries()) {
    await fetch(`${base}/api/sessions/${projCode}/words`, { method: "POST",
      headers: { "Content-Type": "application/json", "X-Voter-Token": String(i + 40).padStart(2, "0").repeat(16) }, body: JSON.stringify({ words: w }) });
  }
  await frame.locator("button[data-act=reveal]").click();
  await presenter.click("#project-poll");
  await audience.waitForSelector(".vote-projection .vote-wordcloud span", { timeout: 8000 });
  const cloudText = await audience.locator(".vote-wordcloud").textContent();
  check("approved word cloud is projected on the audience screen as text", cloudText.includes("شغف") && cloudText.includes("فضول"), cloudText);
} catch (error) {
  console.error(error); failures.push("exception");
} finally {
  await browser.close(); server.kill(); rmSync(scratch, { recursive: true, force: true });
}
if (failures.length) { console.log(`\n${failures.length} check(s) failed`); process.exit(1); }
console.log("\nall engagement checks passed");
