// Voting checks with several "phones" (separate browser contexts, so separate device tokens).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 4198;
const base = `http://localhost:${port}`;
const ADMIN = "test-admin-token-0123456789abcdef";
const dataDir = mkdtempSync(join(tmpdir(), "alfa-votes-"));
const votesFile = join(dataDir, "votes.json");
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures.push(name);
};

function startServer() {
  const proc = spawn(process.execPath, [join(root, "server/server.mjs")], {
    env: { ...process.env, PORT: String(port), ADMIN_TOKEN: ADMIN, VOTES_FILE: votesFile },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve) => proc.stdout.once("data", () => resolve(proc)));
}

const admin = (path, method = "GET", body) => fetch(`${base}/api${path}`, {
  method,
  headers: { "Content-Type": "application/json", "X-Admin-Token": ADMIN },
  body: body ? JSON.stringify(body) : undefined,
});
const device = (token) => ({ "Content-Type": "application/json", "X-Voter-Token": token });
const tokenFor = (n) => String(n).padStart(2, "0").repeat(16); // 32 hex chars, distinct per phone

let server = await startServer();
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium",
  args: ["--no-sandbox"],
});

try {
  check("wrong admin token is refused", (await fetch(`${base}/api/admin/check`, { headers: { "X-Admin-Token": "nope" } })).status === 401);
  check("right admin token is accepted", (await admin("/admin/check")).status === 200);
  check("creating a session needs the admin token", (await fetch(`${base}/api/sessions`, { method: "POST" })).status === 401);

  const { code } = await (await admin("/sessions", "POST")).json();
  check("session code is 6 characters", /^[A-Z2-9]{6}$/.test(code), code);
  const q1 = await (await admin(`/sessions/${code}/polls`, "POST", {
    question: "هل تتوقع أن الألعاب التعليمية أفضل من التدريس التقليدي دائماً؟",
    options: ["نعم", "لا", "يعتمد على الهدف"],
  })).json();
  check("poll is created as draft", q1.poll.status === "draft");
  check("empty options are rejected",
    (await admin(`/sessions/${code}/polls`, "POST", { question: "x", options: ["a"] })).status === 400);
  await admin(`/sessions/${code}/polls/${q1.poll.id}/open`, "POST");

  // Five phones open the student link.
  const phones = [];
  for (let i = 1; i <= 5; i++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(`${base}/vote.html?s=${code}`);
    await page.waitForFunction(() => localStorage.getItem("alfa-voter-token"));
    const token = await page.evaluate(() => localStorage.getItem("alfa-voter-token"));
    phones.push({ ctx, page, token });
  }
  for (const ph of phones) await ph.page.waitForSelector("button.opt", { timeout: 8000 });
  check("five phones see the open question", phones.length === 5);

  // Each phone chooses a different option (0, 1, 2, 0, 1).
  const picks = [0, 1, 2, 0, 1];
  for (let i = 0; i < 5; i++) {
    await phones[i].page.locator(`button.opt[data-i="${picks[i]}"]`).click();
    await phones[i].page.waitForSelector("#note:has-text('تم تسجيل')", { timeout: 6000 });
  }
  check("every phone gets the registration confirmation", true);

  const st = await (await admin(`/sessions/${code}/presenter`)).json();
  const p1 = st.polls.find((p) => p.id === q1.poll.id);
  check("five votes are counted", p1.total === 5, `total=${p1.total}`);
  check("counts match the picks", JSON.stringify(p1.counts) === JSON.stringify([2, 2, 1]), JSON.stringify(p1.counts));

  // A phone cannot vote twice when changes are not allowed.
  const dup = await fetch(`${base}/api/sessions/${code}/vote`, {
    method: "POST", headers: device(phones[0].token), body: JSON.stringify({ option: 2 }),
  });
  check("second vote from the same phone is refused", dup.status === 409, `status ${dup.status}`);

  // Repeat-round creation is strictly an admin action.
  const stolenRepeat = await fetch(`${base}/api/sessions/${code}/polls/${q1.poll.id}/repeat`, { method: "POST" });
  check("unauthorized device cannot start a new round", stolenRepeat.status === 401, `status ${stolenRepeat.status}`);

  // Reveal results to phones; the phone sees counts and its own answer.
  await admin(`/sessions/${code}/polls/${q1.poll.id}/reveal`, "POST");
  await phones[0].page.waitForSelector("text=%", { timeout: 6000 });
  check("phones see results after reveal", (await phones[0].page.textContent("#options")).includes("%"));

  // Close, then a second question that allows changing the answer.
  await admin(`/sessions/${code}/polls/${q1.poll.id}/close`, "POST");
  const q2 = await (await admin(`/sessions/${code}/polls`, "POST", {
    question: "أي عنصر تفضله في المحاضرة؟", options: ["الفيديو", "الإنفوجرافيك"], allowChange: true,
  })).json();
  await admin(`/sessions/${code}/polls/${q2.poll.id}/open`, "POST");
  // A phone that is already waiting should see the new question without reloading.
  await phones[0].page.waitForSelector("text=أي عنصر تفضله", { timeout: 6000 });
  check("waiting phone shows the next question without reload", true);

  await phones[0].page.locator('button.opt[data-i="0"]').click();
  await phones[0].page.waitForSelector("#note:has-text('يمكنك تغيير')", { timeout: 6000 });
  await phones[0].page.waitForTimeout(700); // the server allows one vote per device every 500 ms
  await phones[0].page.locator('button.opt[data-i="1"]').click();
  await phones[0].page.waitForTimeout(800);
  const st2 = await (await admin(`/sessions/${code}/presenter`)).json();
  const p2 = st2.polls.find((p) => p.id === q2.poll.id);
  check("changing an answer does not double count", p2.total === 1 && p2.counts[1] === 1 && p2.counts[0] === 0, JSON.stringify(p2.counts));

  // Oversized bodies are refused.
  const big = await fetch(`${base}/api/sessions/${code}/vote`, {
    method: "POST", headers: device(tokenFor(9)), body: JSON.stringify({ option: 0, pad: "x".repeat(6000) }),
  });
  check("oversized vote body is refused", big.status === 413);

  // Lecturer console: wrong token refused, right token shows the QR code.
  const adminCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  await adminPage.goto(`${base}/vote-admin.html`);
  await adminPage.fill("#token", "wrong-token-value-here-000000");
  await adminPage.click("#save-token");
  await adminPage.waitForSelector("#auth-msg:has-text('الرمز غير صحيح')", { timeout: 6000 });
  check("lecturer console refuses a wrong token", true);
  await adminPage.fill("#token", ADMIN);
  await adminPage.click("#save-token");
  await adminPage.waitForSelector("#qr svg", { timeout: 8000 });
  check("lecturer console draws the QR code", true);
  await adminCtx.close();

  // Persistence: restart the server and keep the results.
  server.kill();
  server = await startServer();
  const after = await (await admin(`/sessions/${code}/presenter`)).json();
  check("results survive a server restart", after.polls.length === 2 && after.polls[0].total === 5,
    `polls=${after.polls.length}`);
} catch (err) {
  failures.push("exception: " + err.message);
  console.error(err);
} finally {
  for (const ph of globalThis.phones || []) await ph.ctx.close();
  await browser.close();
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nall voting checks passed");
process.exit(failures.length ? 1 : 0);
