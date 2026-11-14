// iPhone Duo final audit (manual, WebKit): every screen × every pose, measured, plus the live
// resize sequence and the accessibility stress pass. Not part of `npm test` (CI has Chromium only).
//
//   python3 tools/make_test_fixture.py                      # once: the synthetic 7-slide lecture
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
//     node tests/duo-final-audit.mjs                         # starts its own server on PORT (5210)
//
// Env: PORT (default 5210) · BASE (use an already running server instead) · ADMIN_TOKEN (that server's token)
//      SHOTS=dir (screenshots of the six key poses) · BASELINE=1 (serve origin/main's style.css, for "before")
//      ONLY=screen-id,... · REPORT=path (default docs/iphone-duo-final/audit-report.json)
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { webkit } = require("playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 5210);
const ADMIN = process.env.ADMIN_TOKEN || "duo-audit-admin-0123456789abcdef";
let BASE = process.env.BASE || "";
const SHOTS = process.env.SHOTS || "";
const BASELINE = process.env.BASELINE === "1";
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
const REPORT = process.env.REPORT || join(root, "docs/iphone-duo-final/audit-report.json");
const baselineCss = BASELINE ? execFileSync("git", ["show", "origin/main:web/style.css"], { cwd: root, encoding: "utf8" }) : "";

const POSES = {
  A: [[382, 580], [385, 571], [320, 568]],
  B: [[594, 368]],
  C: [[669, 867]],
  D: [[951, 585]],
  E: [[951, 350], [600, 350]],
  F: [[669, 520], [600, 480]],
  G: [[768, 1024], [1024, 768], [1280, 800], [1440, 900]],
  H: [[360, 640], [390, 844], [844, 390]],
  S: [[320, 350], [320, 600], [320, 900], [470, 350], [470, 600], [470, 900], [620, 350], [620, 600], [620, 900]],
};
const SHOT_SIZES = new Set(["669x867", "951x585", "951x350", "600x350", "594x368", "382x580"]);
// Inner book sizes: the spine (centre ± 16px) must stay clear of text and controls.
const isSpread = (w, h) => (w >= 640 && w <= 720 && h >= 500) || (w >= 880 && w <= 1000 && h >= 500 && w / h >= 1.4);
const SPINE = 32;

// ---- stubs (no production endpoints: everything is the local test server or intercepted) ----
const CHOICE = { id: "p1", kind: "choice", question: "أي العوامل يؤثر أكثر في سرعة التعلم عند الطلبة في المرحلة الجامعية الأولى؟",
  options: ["التكرار المتباعد", "الشرح المباشر الطويل", "الاختبارات القصيرة المتكررة", "القراءة الصامتة فقط"], answered: false, allowChange: true };
const stubState = (active) => async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ active }) });
const REVIEW = { title: "مراجعة محاضرة: الذاكرة والتعلم", items: [
  { heading: "الذاكرة العاملة", slide: 2, lines: ["سعتها محدودة بأربعة عناصر تقريباً", "التقسيم إلى وحدات يخفف الحمل", "الانتباه يحدد ما يدخلها"] },
  { heading: "التكرار المتباعد", slide: 4, lines: ["المراجعة بعد يوم ثم ثلاثة أيام ثم أسبوع", "النسيان جزء من التثبيت"] },
  { heading: "الاسترجاع النشط", slide: 5, lines: ["اختبر نفسك بدل إعادة القراءة", "الأخطاء المبكرة مفيدة", "اشرح الفكرة بكلماتك"] },
  { heading: "خلاصة", slide: 7, lines: ["قليل متكرر أفضل من كثير متقطع"] }] };

const DESKTOP_STUB = () => {
  window.alfaDesktop = {
    startShow: async () => ({ reason: "several", proposed: 2, displays: [
      { id: 1, isConsole: true, label: "Built-in", resolution: "1440×900" },
      { id: 2, label: "Projector", resolution: "1920×1080" }, { id: 3, label: "TV", resolution: "3840×2160" }] }),
    endShow() {}, identifyDisplays() {}, listDisplays: async () => ({ displays: [] }), openNotes() {}, onEvent() {},
  };
};

const SCREENS = [
  { id: "presenter", url: "/#presenter", ready: "#meta" },
  { id: "presenter-tools", url: "/?tools=1#presenter", ready: "#meta" },
  { id: "presenter-voting-drawer", url: "/?tools=1#presenter", ready: "#meta", setup: async (p) => { await p.click("#open-vote"); } },
  { id: "presenter-readiness", url: "/?tools=1#presenter", ready: "#meta", setup: async (p) => { await p.evaluate(() => { document.getElementById("readiness-drawer").open = true; }); } },
  { id: "presenter-import-open", url: "/#presenter", ready: "#meta", setup: async (p) => { await p.evaluate(() => { const d = document.querySelector("#lecture-import-mount details"); if (d) d.open = true; }); } },
  { id: "presenter-all-drawers", url: "/?tools=1#presenter", ready: "#meta", setup: async (p) => { await p.evaluate(() => document.querySelectorAll(".presenter details").forEach((d) => { d.open = true; })); } },
  { id: "presenter-showing", url: "/#presenter", ready: "#meta", setup: async (p) => {
    const popup = p.waitForEvent("popup", { timeout: 4000 }).catch(() => null);
    await p.click("#open-audience"); const w = await popup; if (w) await w.close();
    await p.waitForSelector("#end-show:not([hidden])", { timeout: 4000 }).catch(() => {}); } },
  { id: "presenter-display-chooser", url: "/#presenter", ready: "#meta", init: DESKTOP_STUB, setup: async (p) => { await p.click("#open-audience"); await p.waitForSelector("dialog#display-chooser[open]"); } },
  { id: "presenter-video", url: "/?tools=1#presenter", ready: "#meta", setup: gotoSlide7 },
  { id: "presenter-scene", url: "/?dev=1#presenter", ready: "#meta", setup: async (p) => {
    await p.click("#toggle-info"); await p.selectOption("#info-type", "steps");
    await p.fill("#info-title", "خطوات التعلم النشط"); await p.fill("#info-lines", "اقرأ الفكرة\nلخّصها بكلماتك\nاختبر نفسك");
    await p.click("#info-show"); await p.waitForTimeout(600); } },
  { id: "presenter-first-run", url: "/#presenter", ready: ".import-panel", route: [["**/bundles/current.json", (r) => r.fulfill({ status: 404, body: "" })]] },
  { id: "presenter-error", url: "/?bundle=missing-lecture#presenter", ready: ".error" },
  { id: "presenter-loading", url: "/#presenter", ready: ".loading", route: [["**/bundles/current.json", () => {}]] },
  { id: "audience", url: "/#audience", ready: "#stage img", spineException: ".audience .stage" },
  { id: "audience-blackout", url: "/#audience", ready: "#stage img", spineException: ".audience .stage", setup: async (p) => { await p.evaluate(() => document.body.classList.add("alfa-blackout")); } },
  { id: "audience-error", url: "/?bundle=missing-lecture#audience", ready: ".error" },
  { id: "audience-empty", url: "/#audience", ready: "#app", route: [["**/bundles/current.json", (r) => r.fulfill({ status: 404, body: "" })]], wait: 600 },
  { id: "notes", url: "/#notes", ready: "#nv-text" },
  { id: "notes-empty", url: "/#notes", ready: "#app", route: [["**/bundles/current.json", (r) => r.fulfill({ status: 404, body: "" })]], wait: 600 },
  { id: "vote-incomplete", url: "/vote.html", ready: ".status" },
  { id: "vote-waiting", url: "/vote.html?s=ABC123", ready: ".status", route: [["**/api/sessions/ABC123/state", stubState(null)]] },
  { id: "vote-choice", url: "/vote.html?s=ABC123", ready: "#options", route: [["**/api/sessions/ABC123/state", stubState(CHOICE)]] },
  { id: "vote-results", url: "/vote.html?s=ABC123", ready: "#options", route: [["**/api/sessions/ABC123/state", stubState({ ...CHOICE, answered: true, mine: 0, counts: [14, 3, 9, 2] })]] },
  { id: "vote-words", url: "/vote.html?s=ABC123", ready: ".word-input", route: [["**/api/sessions/ABC123/state", stubState({ id: "w1", kind: "words", question: "اكتب كلمة تصف شعورك تجاه المحاضرة", options: [], remaining: 3, answered: false })]] },
  { id: "vote-ask-open", url: "/vote.html?s=ABC123", ready: "#options", route: [["**/api/sessions/ABC123/state", stubState(CHOICE)]], setup: async (p) => { await p.evaluate(() => { document.getElementById("ask-lecturer").open = true; }); } },
  { id: "vote-not-found", url: "/vote.html?s=ABC123", ready: ".status", route: [["**/api/sessions/ABC123/state", (r) => r.fulfill({ status: 404, contentType: "application/json", body: "{}" })]], wait: 600 },
  { id: "vote-offline", url: "/vote.html?s=ABC123", ready: ".status", route: [["**/api/sessions/ABC123/state", (r) => r.abort()]], wait: 600 },
  { id: "review-incomplete", url: "/review.html", ready: ".tag" },
  { id: "review-unpublished", url: "/review.html?s=ABC123", ready: ".tag", route: [["**/api/sessions/ABC123/review", (r) => r.fulfill({ status: 404, body: "{}" })]], wait: 400 },
  { id: "review-content", url: "/review.html?s=ABC123", ready: "#app h1", route: [["**/api/sessions/ABC123/review", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(REVIEW) })]] },
  { id: "review-offline", url: "/review.html?s=ABC123", ready: ".tag", route: [["**/api/sessions/ABC123/review", (r) => r.abort()]], wait: 400 },
  // On localhost the console opens without a token; the sign-in card is reached by refusing the check.
  { id: "admin-auth", url: "/vote-admin.html", ready: "#auth", route: [["**/api/admin/check", (r) => r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "غير مصرح" }) })]] },
  { id: "admin-panel", url: "/vote-admin.html", ready: "#panel:not([hidden])", setup: adminLogin },
  { id: "admin-panel-drawers", url: "/vote-admin.html", ready: "#panel:not([hidden])", setup: async (p) => { await adminLogin(p); await p.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; })); } },
];

async function gotoSlide7(p) {
  for (let i = 0; i < 14 && !(await p.textContent("#meta")).includes("7 من"); i++) { await p.keyboard.press("ArrowRight"); await p.waitForTimeout(140); }
  await p.waitForSelector("#stage video", { timeout: 5000 });
}
async function adminLogin(p) {
  if (await p.isVisible("#auth")) { await p.fill("#token", ADMIN); await p.click("#save-token"); }
  await p.waitForSelector("#panel:not([hidden])", { timeout: 6000 });
  if (!(await p.textContent("#session-line")).trim()) { await p.click("#new-session"); await p.waitForTimeout(500); }
  if (!(await p.locator("#polls > *").count())) {
    await p.fill("#q-text", "أي العوامل يؤثر أكثر في سرعة التعلم؟"); await p.fill("#q-opts", "التكرار المتباعد\nالشرح المباشر\nالاختبارات القصيرة");
    await p.click("#add-poll"); await p.waitForTimeout(500);
  }
}

// ---- in-page measurement ----
function measure({ spread, spine, exception }) {
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const out = { overflowX: document.documentElement.scrollWidth - vw, spine: [], small: [], clipped: [], keysOffscreen: [] };
  const visible = (el) => {
    if (el.closest("details:not([open]) > :not(summary)") || el.closest("[hidden]") || el.closest(".sr-only")) return false;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false;
    for (let a = el; a; a = a.parentElement) {
      const cs = getComputedStyle(a); if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    }
    return true;
  };
  const label = (el) => (el.id ? "#" + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "")) +
    ` «${(el.innerText || el.value || el.getAttribute("aria-label") || "").trim().slice(0, 28)}»`;
  const interactive = [...document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex='-1'])")].filter(visible);
  const texty = [...document.querySelectorAll("body *")].filter((el) => !["SCRIPT", "STYLE", "SVG", "PATH"].includes(el.tagName) &&
    [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).filter(visible);
  const exceptionEl = exception ? document.querySelector(exception) : null;
  if (spread) {
    const lo = vw / 2 - spine / 2, hi = vw / 2 + spine / 2;
    for (const el of new Set([...interactive, ...texty])) {
      if (exceptionEl && exceptionEl.contains(el)) continue;
      if (el.tagName === "DIALOG" || el.closest("dialog")) {
        // a modal panel sits on one page; its rect is checked like any other element
      }
      let r = el.getBoundingClientRect();
      // text in a block: measure the text itself, not the empty end of a long line box
      if (!interactive.includes(el)) {
        const range = document.createRange(); range.selectNodeContents(el); const rr = range.getBoundingClientRect();
        if (rr.width > 0) r = rr;
      }
      if (r.right > lo && r.left < hi && r.bottom > 0) out.spine.push(label(el));
    }
  }
  for (const el of interactive) {
    const r = el.getBoundingClientRect();
    const inline = el.tagName === "A" && getComputedStyle(el).display === "inline";
    if (!inline && (r.width < 44 || r.height < 44) && !el.closest(".film-item") && el.type !== "checkbox") out.small.push(`${label(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    // inside an intended scroller (a strip of thumbnails, a scrolling pane) being out of view is fine
    let scroller = false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (/(auto|scroll)/.test(cs.overflowX)) { scroller = true; break; }
      if (/(hidden|clip)/.test(cs.overflowX) && !/(auto|scroll)/.test(cs.overflowY)) {
        const ar = a.getBoundingClientRect();
        if (r.left < ar.left - 2 || r.right > ar.right + 2) { out.clipped.push(label(el) + " cut-by " + label(a).split(" ")[0]); break; }
      }
    }
    if (!scroller && (r.left < -1 || r.right > vw + 1)) out.clipped.push(label(el) + " off-screen-x");
  }
  for (const id of document.querySelector("dialog[open]") ? [] : ["next", "prev"]) {
    const el = document.getElementById(id); if (!el || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (r.top < 0 || r.bottom > vh + 1 || !(hit && (hit === el || el.contains(hit)))) out.keysOffscreen.push(id);
  }
  out.spine = out.spine.slice(0, 8); out.small = [...new Set(out.small)]; out.clipped = [...new Set(out.clipped)].slice(0, 8);
  return out;
}

async function startServer() {
  if (BASE) return null;
  const server = spawn(process.execPath, [join(root, "server/server.mjs")], { env: { ...process.env, PORT: String(PORT), ADMIN_TOKEN: ADMIN }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve) => server.stdout.once("data", resolve));
  BASE = `http://localhost:${PORT}`;
  return server;
}

async function openScreen(browser, screen, size, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: opts.colorScheme || "light" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  if (screen.init) await page.addInitScript(screen.init);
  if (BASELINE || opts.css) await page.route("**/style.css", async (route) => {
    const res = BASELINE ? null : await route.fetch();
    let body = BASELINE ? baselineCss : await res.text();
    if (opts.css) body = opts.css(body);
    route.fulfill({ status: 200, contentType: "text/css", body });
  });
  for (const [pattern, handler] of screen.route || []) await page.route(pattern, handler);
  await page.goto(BASE + screen.url);
  await page.waitForSelector(screen.ready, { timeout: 8000 }).catch(() => errors.push("ready selector missing: " + screen.ready));
  await page.waitForTimeout(screen.wait || 500);
  if (screen.setup) await screen.setup(page).catch((e) => errors.push("setup: " + String(e).slice(0, 160)));
  if (opts.extra) await page.addStyleTag({ content: opts.extra });
  return { ctx, page, errors };
}

const report = { generated: new Date().toISOString(), baseline: BASELINE, engine: "Playwright WebKit", spine: SPINE, matrix: [], live: [], stress: [], modal: [], print: null };
const browser = await webkit.launch();
const server = await startServer();
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
try {
  for (const screen of SCREENS.filter((s) => !ONLY.length || ONLY.includes(s.id))) {
    const all = Object.entries(POSES).flatMap(([pose, sizes]) => sizes.map((size) => ({ pose, size })));
    const { ctx, page, errors } = await openScreen(browser, screen, all[0].size);
    for (const { pose, size } of all) {
      await page.setViewportSize({ width: size[0], height: size[1] });
      await page.waitForTimeout(160);
      await page.evaluate(() => window.scrollTo(0, 0));
      const key = `${size[0]}x${size[1]}`;
      const m = await page.evaluate(measure, { spread: isSpread(...size), spine: SPINE, exception: screen.spineException || "" });
      report.matrix.push({ screen: screen.id, pose, size: key, ...m });
      if (SHOTS && SHOT_SIZES.has(key)) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: join(SHOTS, `${screen.id}-${key}.jpg`), type: "jpeg", quality: 62 });
      }
    }
    report.matrix.filter((r) => r.screen === screen.id).forEach((r) => { r.errors = errors; });
    const bad = report.matrix.filter((r) => r.screen === screen.id && (r.overflowX > 0 || r.spine.length || r.clipped.length || r.keysOffscreen.length));
    console.log(`${bad.length ? "WARN" : "PASS"}  ${screen.id}${bad.length ? "  — " + bad.map((r) => `${r.size}${r.overflowX > 0 ? " overflow" : ""}${r.spine.length ? " spine:" + r.spine.length : ""}${r.clipped.length ? " clipped:" + r.clipped.length : ""}${r.keysOffscreen.length ? " keys:" + r.keysOffscreen : ""}`).join(", ") : ""}${errors.length ? "  errors: " + errors.join(" | ") : ""}`);
    await ctx.close();
  }

  // ---- I: live resize sequence on ONE page instance (no reload) ----
  if (!ONLY.length || ONLY.includes("live")) {
    const SEQ = [[951, 585], [669, 867], [470, 700], [382, 580], [594, 368], [951, 350], [951, 585]];
    for (const typing of [true, false]) { // lecturer console: the slide, the playing video, a chosen option, a typed field, a scrolled pane (and once with nothing focused, so the video stays in view)
      const { ctx, page, errors } = await openScreen(browser, { url: "/?dev=1#presenter", ready: "#meta" }, SEQ[0]);
      await gotoSlide7(page);
      await page.evaluate(() => { const v = document.querySelector("#stage video"); v.muted = true; v.loop = true; v.dataset.auditId = "same-element"; });
      await page.keyboard.press("v"); await page.waitForTimeout(700);
      await page.selectOption("#planned-minutes", { index: 2 }).catch(() => {});
      if (typing) await page.fill("#director-admin-token", "typed-before-fold");
      const side = await page.evaluate(() => { const s = document.querySelector(".presenter .side"); s.scrollTop = 120; return s.scrollTop; });
      const before = await page.evaluate(() => ({ meta: document.getElementById("meta").textContent, t: document.querySelector("#stage video")?.currentTime || 0 }));
      let last = before.t;
      for (const size of SEQ.slice(1)) {
        await page.setViewportSize({ width: size[0], height: size[1] }); await page.waitForTimeout(650);
        const s = await page.evaluate(() => {
          const v = document.querySelector("#stage video");
          const vr = v?.getBoundingClientRect();
          return { meta: document.getElementById("meta").textContent, same: v?.dataset.auditId === "same-element", paused: v?.paused, t: v?.currentTime || 0,
            videoInView: !!vr && vr.bottom > 0 && vr.top < innerHeight, scrollY: Math.round(scrollY),
            planned: document.getElementById("planned-minutes").selectedIndex, typed: document.getElementById("director-admin-token")?.value,
            sideScroll: document.querySelector(".presenter .side").scrollTop, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
        });
        await page.waitForTimeout(400);
        const t2 = await page.evaluate(() => document.querySelector("#stage video")?.currentTime || 0);
        // the clip loops, so "advancing" means the playhead moved during this step (forward, or wrapped round)
        report.live.push({ page: typing ? "presenter" : "presenter-media", size: size.join("x"), ...s, t2, advancing: t2 !== s.t && !s.paused,
          // WebKit freezes the frames of a muted clip that is scrolled out of view (it is still "playing" and resumes in view)
          ...(s.videoInView ? {} : { advancing: !s.paused, note: "video scrolled out of view; still playing" }), slideKept: s.meta === before.meta });
        last = t2;
      }
      report.live.push({ page: typing ? "presenter" : "presenter-media", note: "side pane scrollTop set to " + side + " before the sequence", errors });
      await ctx.close();
    }
    { // student page: typed question, open drawer, selected answer
      const { ctx, page, errors } = await openScreen(browser, { url: "/vote.html?s=ABC123", ready: "#options", route: [["**/api/sessions/ABC123/state", stubState({ ...CHOICE, answered: true, mine: 1 })]] }, SEQ[0]);
      await page.evaluate(() => { document.getElementById("ask-lecturer").open = true; });
      await page.fill("#question-text", "سؤال مكتوب قبل الطي");
      for (const size of SEQ.slice(1)) {
        await page.setViewportSize({ width: size[0], height: size[1] }); await page.waitForTimeout(300);
        report.live.push({ page: "vote", size: size.join("x"), ...(await page.evaluate(() => ({ typed: document.getElementById("question-text").value, open: document.getElementById("ask-lecturer").open,
          selected: !!document.querySelector(".opt.selected"), overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth }))) });
      }
      report.live.push({ page: "vote", errors });
      await ctx.close();
    }
    { // notes window: chosen text size and reading position
      const { ctx, page, errors } = await openScreen(browser, { url: "/#notes", ready: "#nv-text" }, SEQ[0]);
      await page.click("#nv-bigger");
      for (const size of SEQ.slice(1)) {
        await page.setViewportSize({ width: size[0], height: size[1] }); await page.waitForTimeout(300);
        report.live.push({ page: "notes", size: size.join("x"), ...(await page.evaluate(() => ({ font: document.getElementById("nv-text").style.fontSize, meta: document.getElementById("nv-meta").textContent,
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth }))) });
      }
      report.live.push({ page: "notes", errors });
      await ctx.close();
    }
    { // open modal survives the sequence and keeps blocking the page under it
      const { ctx, page, errors } = await openScreen(browser, { url: "/#presenter", ready: "#meta", init: DESKTOP_STUB }, SEQ[0]);
      await page.click("#open-audience"); await page.waitForSelector("dialog#display-chooser[open]");
      for (const size of SEQ.slice(1)) {
        await page.setViewportSize({ width: size[0], height: size[1] }); await page.waitForTimeout(300);
        report.live.push({ page: "display-chooser", size: size.join("x"), ...(await page.evaluate(() => ({ open: !!document.querySelector("dialog#display-chooser[open]"),
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth }))) });
      }
      report.live.push({ page: "display-chooser", errors });
      await ctx.close();
    }
    // the other main screens: same instance through the sequence, their own state kept
    const GENERIC = [
      ["audience", null, () => document.querySelector("#stage img")?.getAttribute("src") || ""],
      ["review-content", async (p) => { await p.evaluate(() => window.scrollTo(0, 400)); }, () => document.querySelectorAll("#app section").length],
      ["admin-panel", async (p) => { await p.fill("#q-text", "سؤال مكتوب قبل الطي"); }, () => document.getElementById("q-text").value],
      ["presenter-first-run", null, () => !!document.querySelector(".import-panel")],
      ["vote-waiting", null, () => document.querySelector("main.vote .status")?.textContent || ""],
    ];
    for (const [id, prepare, probe] of GENERIC) {
      const screen = SCREENS.find((x) => x.id === id);
      const { ctx, page, errors } = await openScreen(browser, screen, SEQ[0]);
      if (prepare) await prepare(page);
      const first = await page.evaluate(probe);
      for (const size of SEQ.slice(1)) {
        await page.setViewportSize({ width: size[0], height: size[1] }); await page.waitForTimeout(300);
        const now = await page.evaluate(probe);
        report.live.push({ page: id, size: size.join("x"), kept: JSON.stringify(now) === JSON.stringify(first) && !!now,
          overflowX: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) });
      }
      report.live.push({ page: id, errors });
      await ctx.close();
    }
    const liveBad = report.live.filter((r) => r.size && (r.overflowX > 0 || r.slideKept === false || r.same === false || r.advancing === false ||
      (r.page === "presenter" && !r.typed) || (r.page === "vote" && !r.typed) || r.open === false || r.kept === false || (r.page === "vote" && !r.selected) || (r.page === "notes" && !r.font)));
    console.log(`${liveBad.length ? "FAIL" : "PASS"}  I live sequence (${report.live.filter((r) => r.size).length} steps)${liveBad.length ? " — " + JSON.stringify(liveBad) : ""}`);
  }

  // ---- modal over a spread: the backdrop covers both pages and blocks taps on the other page ----
  if (!ONLY.length || ONLY.includes("modal")) {
    for (const size of [[669, 867], [951, 585], [382, 580], [951, 350]]) {
      const { ctx, page } = await openScreen(browser, { url: "/#presenter", ready: "#meta", init: DESKTOP_STUB }, size);
      await page.click("#open-audience"); await page.waitForSelector("dialog#display-chooser[open]");
      const metaBefore = await page.textContent("#meta");
      const box = await page.evaluate(() => { const r = document.querySelector("dialog#display-chooser").getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
      // tap the page OUTSIDE the panel (the other page in a spread, or a corner) where a key or a thumbnail would be
      const x = box.left > size[0] / 2 ? 12 : size[0] - 12, y = size[1] - 30;
      await page.mouse.click(x, y);
      await page.waitForTimeout(300);
      const after = await page.evaluate(() => ({ meta: document.getElementById("meta").textContent, open: !!document.querySelector("dialog#display-chooser[open]") }));
      const spread = isSpread(...size);
      const lo = size[0] / 2 - SPINE / 2, hi = size[0] / 2 + SPINE / 2;
      report.modal.push({ size: size.join("x"), panel: box, onOnePage: !spread || box.right <= lo || box.left >= hi, tapBlocked: after.meta === metaBefore });
      await ctx.close();
    }
    console.log(`${report.modal.every((m) => m.onOnePage && m.tapBlocked) ? "PASS" : "FAIL"}  modal over spread ${JSON.stringify(report.modal)}`);
  }

  // ---- J: accessibility stress on the main screens ----
  if (!ONLY.length || ONLY.includes("stress")) {
    const MAIN = SCREENS.filter((s) => ["presenter", "notes", "vote-choice", "vote-waiting", "review-content", "admin-panel", "audience", "presenter-first-run"].includes(s.id));
    const SIZES = [[669, 867], [951, 585], [951, 350], [594, 368], [382, 580]];
    const safe = (css) => css.replace(/env\(safe-area-inset-(top|right|bottom|left)(\s*,[^)]*)?\)/g, (_, side) => ({ top: "24px", right: "0px", bottom: "34px", left: "47px" })[side]);
    const VARIANTS = [
      { id: "text-200", extra: "html { font-size: 200% !important; }" },
      { id: "dark", colorScheme: "dark" },
      { id: "safe-areas-asymmetric", css: safe },
    ];
    for (const v of VARIANTS) for (const screen of MAIN) {
      const { ctx, page, errors } = await openScreen(browser, screen, SIZES[0], v);
      for (const size of SIZES) {
        await page.setViewportSize({ width: size[0], height: size[1] }); await page.waitForTimeout(160);
        const m = await page.evaluate(measure, { spread: isSpread(...size), spine: SPINE, exception: screen.spineException || "" });
        report.stress.push({ variant: v.id, screen: screen.id, size: size.join("x"), overflowX: m.overflowX, spine: m.spine.length, clipped: m.clipped.length, keysOffscreen: m.keysOffscreen, errors: errors.length });
        if (SHOTS && v.id !== "dark" && ["669x867", "382x580"].includes(size.join("x")) && ["presenter", "vote-choice"].includes(screen.id)) {
          await page.screenshot({ path: join(SHOTS, `J-${v.id}-${screen.id}-${size.join("x")}.jpg`), type: "jpeg", quality: 62 });
        }
      }
      await ctx.close();
    }
    { // keyboard open: a focused field while the height drops to ~350
      for (const [screen, field] of [[{ url: "/vote.html?s=ABC123", ready: "#options", route: [["**/api/sessions/ABC123/state", stubState(CHOICE)]] }, "#question-text"],
        [SCREENS.find((x) => x.id === "admin-auth"), "#token"], [{ url: "/#presenter", ready: ".import-panel", route: [["**/bundles/current.json", (r) => r.fulfill({ status: 404, body: "" })]] }, ".import-panel input[type=file]"]]) {
        for (const size of [[669, 867], [951, 585], [382, 580]]) {
          const { ctx, page } = await openScreen(browser, screen, size);
          await page.evaluate(() => { const d = document.getElementById("ask-lecturer"); if (d) d.open = true; });
          await page.focus(field); await page.setViewportSize({ width: size[0], height: 350 }); await page.waitForTimeout(250);
          await page.evaluate((f) => document.querySelector(f).scrollIntoView({ block: "nearest" }), field);
          const r = await page.evaluate((f) => { const e = document.querySelector(f), b = e.getBoundingClientRect();
            return { focused: document.activeElement === e, inView: b.top >= 0 && b.bottom <= innerHeight + 1, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth }; }, field);
          report.stress.push({ variant: "keyboard-350", screen: screen.url, size: `${size[0]}x350`, ...r });
          await ctx.close();
        }
      }
    }
    const sBad = report.stress.filter((r) => r.overflowX > 0 || r.spine > 0 || (r.keysOffscreen && r.keysOffscreen.length) || r.inView === false || r.focused === false);
    console.log(`${sBad.length ? "WARN" : "PASS"}  J stress (${report.stress.length} cases)${sBad.length ? " — " + sBad.map((r) => `${r.variant}/${r.screen}@${r.size}${r.overflowX > 0 ? " overflow" : ""}${r.spine ? " spine:" + r.spine : ""}${r.keysOffscreen?.length ? " keys" : ""}${r.inView === false ? " field-hidden" : ""}`).join(", ") : ""}`);
  }

  // ---- print at a book width must not become a spread ----
  if (!ONLY.length || ONLY.includes("print")) {
    const { ctx, page } = await openScreen(browser, { url: "/#presenter", ready: "#meta" }, [669, 867]);
    await page.emulateMedia({ media: "print" });
    report.print = await page.evaluate(() => ({ columns: getComputedStyle(document.querySelector(".presenter")).gridTemplateColumns, spine: getComputedStyle(document.querySelector(".presenter"), "::before").content }));
    console.log(`${/none|normal/.test(report.print.spine) ? "PASS" : "FAIL"}  print at 669px is not a spread ${JSON.stringify(report.print)}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server?.kill();
}
const totals = {
  cases: report.matrix.length,
  overflowX: report.matrix.filter((r) => r.overflowX > 0).length,
  spineCrossings: report.matrix.filter((r) => r.spine.length).length,
  clipped: report.matrix.filter((r) => r.clipped.length).length,
  keysOffscreen: report.matrix.filter((r) => r.keysOffscreen.length).length,
  smallTargetCases: report.matrix.filter((r) => r.small.length).length,
  jsErrors: report.matrix.filter((r) => r.errors?.length).length,
};
report.totals = totals;
mkdirSync(dirname(REPORT), { recursive: true });
writeFileSync(REPORT, JSON.stringify(report, null, 1));
console.log("totals " + JSON.stringify(totals) + "\nreport → " + REPORT);
