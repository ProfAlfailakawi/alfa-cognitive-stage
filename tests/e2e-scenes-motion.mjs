// Animated scenes in real Chromium: nothing clipped, motion present and calm, reduced-motion respected, text exact.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 4303, base = `http://localhost:${port}`;
const shots = process.env.SCENE_SHOTS || "";
if (shots) mkdirSync(shots, { recursive: true });
const failures = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) failures.push(name); };
const server = spawn(process.execPath, [join(root, "server/server.mjs")], { env: { ...process.env, PORT: String(port), ADMIN_TOKEN: "scenes-motion-test-token-0123456", VOTES_FILE: "/tmp/alfa-sm-v.json", SCENES_FILE: "/tmp/alfa-sm-s.json", QUESTION_BANK_FILE: "/tmp/alfa-sm-b.json", DIRECTOR_USAGE_FILE: "/tmp/alfa-sm-u.json" }, stdio: ["ignore", "pipe", "pipe"] });
await new Promise((r) => server.stdout.once("data", r));
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ["--no-sandbox"] });

const LONG = "عنوان طويل جداً يشرح الفكرة الرئيسية لهذا المشهد بكلمات كثيرة حتى يتجاوز سطراً واحداً بكثير";
const T120 = "هذا عنوان طويل جداً من مئة وعشرين حرفاً بالضبط تقريباً لاختبار أن النص يبقى كاملاً دون أي حذف لأي كلمة فيه أبداً";
if (T120.length > 120) throw new Error("fixture must respect the 120-character input limit");
const I110 = "هذه جملة طويلة من كلام المحاضر تتجاوز الحد المعتاد للبطاقة وتحتاج إلى تصغير الخط حتى تظهر كاملة بلا أي اختصار نهائياً";
const P55 = "جملة قصيرة نسبياً تملأ خانة المقارنة كاملة هنا";
const URL60 = "https://example.com/a/very/long/path/to/some/learning/resource";
const SPECS = [
  ["stat-percent", { type: "stat", title: "الألعاب التعليمية", lines: ["68%", "من المشاركين استفادوا من التجربة"] }],
  ["stat-100", { type: "stat", title: LONG, lines: ["100%", "كل الطلبة"] }],
  ["stat-decimal", { type: "stat", title: "نسبة", lines: ["68.5%", "وصف"] }],
  ["stat-plain", { type: "stat", title: "عدد", lines: ["12,500", "طالب وطالبة"] }],
  ["stat-wide", { type: "stat", title: "x", lines: ["٣٤٥٬٦٧٨ ريال", "x"] }],
  ["compare", { type: "compare", title: "الفرق بين النهجين", lines: ["هدف تعليمي | هدف ترفيهي", "تغذية راجعة فورية | تغذية متأخرة", "مشاركة نشطة | مشاهدة"] }],
  ["compare5", { type: "compare", title: LONG, lines: ["أ طويلة جداً جداً جداً جداً | ب", "ج | د", "ه | و", "ز | ح", "ط | ي"] }],
  ["steps3", { type: "steps", title: "خطوات", lines: ["اختر الهدف", "صمم النشاط", "قيّم الأثر"] }],
  ["steps6", { type: "steps", title: LONG, lines: ["حدد الهدف التعليمي بدقة", "صمم النشاط المناسب", "جرّب مع مجموعة صغيرة", "اجمع الملاحظات", "عدّل التصميم", "طبّق على الجميع الآن"] }],
  ["concept6", { type: "concept", title: "التعلم المباشر", lines: ["تحفيز المتعلم", "التغذية الراجعة", "المشاركة", "التطبيق العملي", "التقييم المستمر", "الدعم الاجتماعي"] }],
  ["concept2", { type: "concept", title: "x", lines: ["أولاً", "ثانياً"] }],
  ["flow6", { type: "flow", title: "تسلسل", lines: ["أول مرحلة", "ثاني مرحلة", "ثالث مرحلة", "رابع مرحلة", "خامس مرحلة", "سادس مرحلة طويلة نسبياً لاختبار الالتفاف"] }],
  ["timeline6", { type: "timeline", title: "خط زمني", lines: ["2018 بداية المشروع", "2019 التجربة", "2020 التعلم عن بعد", "2021 التوسع", "2022 التقييم", "2023 النشر"] }],
  ["timeline2", { type: "timeline", title: "x", lines: ["قبل", "بعد"] }],
  ["story4", { type: "story", title: "قصة المحاضر", lines: ["شخص كان يلعب ألعاب الفيديو", "ثم تأثرت دراسته", "فقرر أن يغير الفكرة", "وصار يتعلم من اللعب"] }],
  ["bars6", { type: "bars", title: "توزيع", lines: ["الجوال | 40%", "الكمبيوتر | 35%", "التابلت | 25%", "التلفاز | 10%", "الساعة الذكية | 5%", "أخرى بتسمية طويلة | 2%"] }],
  ["cycle6", { type: "cycle", title: "دورة التعلم", lines: ["نخطط", "ننفذ", "نقيم", "نعدل", "نكرر", "نوثق"] }],
  ["concept-long", { type: "concept", title: T120, lines: [I110, I110, "قصير", URL60] }],
  ["story-long", { type: "story", title: T120, lines: [I110, I110, I110] }],
  ["steps-long", { type: "steps", title: T120, lines: [I110, I110, I110, I110, I110, I110] }],
  ["flow-long", { type: "flow", title: T120, lines: [I110, I110, I110, I110] }],
  ["compare-long", { type: "compare", title: T120, lines: [P55 + " | " + P55, "أ | ب", P55 + " | " + P55] }],
  ["timeline-long", { type: "timeline", title: T120, lines: [I110, I110, I110] }],
  ["cycle-long", { type: "cycle", title: T120, lines: [I110, I110, I110] }],
  ["bars-long", { type: "bars", title: T120, lines: ["تسمية طويلة نسبياً هنا للاختبار | 40%", "ب | 60%"] }],
  ["activity-long", { type: "activity", title: T120, lines: [I110, "المدة: 3 دقائق"] }],
  ["stat-long", { type: "stat", title: T120, lines: ["68%", I110] }],
  ["activity", { type: "activity", title: "نشاط", lines: ["ناقشوا مع زميلكم أهم فايدة للألعاب في التعلم ثم اكتبوا فكرة واحدة", "المدة: 3 دقائق"] }],
];
async function open(reducedMotion) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: reducedMotion ? "reduce" : "no-preference" });
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("pageerror: " + e); failures.push("pageerror"); });
  await page.goto(`${base}/vote.html`);
  return page;
}
const mount = (page, spec, key) => page.evaluate(async ([spec]) => {
  const { renderInfographic } = await import("/infographic.js");
  document.documentElement.dir = "rtl";
  document.body.innerHTML = `<div id="stage" style="position:relative;width:1280px;height:720px"><div class="info-layer">${renderInfographic(spec)}</div></div>`;
}, [spec]);
try {
  const page = await open(false);
  for (const [key, spec] of SPECS) {
    await mount(page, spec, key);
    await page.waitForTimeout(40);
    const early = await page.evaluate(() => {
      const els = [...document.querySelectorAll('svg [class^="m-"]')];
      const joined = (node) => [...node.querySelectorAll("text:not(.ui)")].map((t) => [...t.querySelectorAll("tspan")].map((x) => x.textContent).join(" ") || t.textContent).join(" ");
      return { count: els.length, hidden: els.filter((e) => Number(getComputedStyle(e).opacity) < 0.99).length, animated: els.filter((e) => getComputedStyle(e).animationName !== "none").length,
        text: [...document.querySelectorAll("svg text")].map((t) => t.textContent).join("|"),
        items: [...document.querySelectorAll("svg [data-full]")].map((g) => ({ full: g.getAttribute("data-full"), titleEl: g.querySelector("title")?.textContent, visible: joined(g) })),
        icons: document.querySelectorAll("svg path[transform]").length };
    });
    const squash = (t) => t.replace(/[\s|]/g, "");
    const pieces = spec.lines.flatMap((l) => l.split("|").map((x) => x.trim()));
    const ITEM_TYPES = ["concept", "flow", "timeline", "story", "cycle", "steps", "compare"];
    let exact = squash(early.text).includes(squash(spec.title)) && !early.text.includes("…"); // the title is always shown whole
    let few = true, why = "";
    if (ITEM_TYPES.includes(spec.type)) {
      // the FULL text of every item is kept in the scene; what is drawn is a few of the lecturer's own words, in order
      exact = exact && pieces.every((p) => early.items.some((it) => it.full === p && it.titleEl === p));
      for (const it of early.items) {
        const fullWords = it.full.split(/\s+/), seen = it.visible.split(/\s+/).filter(Boolean).filter((w) => !/^\d+$/.test(w) || it.full.includes(w));
        let cursor = 0, ordered = true;
        for (const w of seen) { const at = fullWords.indexOf(w, cursor); if (at < 0) { ordered = false; break; } cursor = at + 1; }
        const tooMany = seen.filter((w) => !/^[0-9]+$/.test(w)).length > 5;
        if (!ordered || tooMany) { few = false; why = `${it.visible} ⊄ ${it.full}`; }
      }
    } else exact = exact && pieces.every((p) => squash(early.text).includes(squash(p)));
    check(`${key}: animates (not static) and starts hidden`, early.count > 0 && early.animated === early.count && early.hidden > 0, JSON.stringify({ n: early.count, hidden: early.hidden }));
    check(`${key}: the full text is kept (title whole; every item whole in the scene) and nothing is cut with an ellipsis`, exact, early.text.slice(0, 80));
    check(`${key}: what is drawn is at most a few of the lecturer's own words, in order, never new words`, few, why);
    if (ITEM_TYPES.includes(spec.type)) check(`${key}: every item has an icon`, early.icons >= Math.min(...[early.items.length].filter(Boolean), 99) , `icons=${early.icons} items=${early.items.length}`);
    await page.waitForTimeout(2600);
    const late = await page.evaluate(() => {
      const bad = [];
      for (const t of document.querySelectorAll("svg text")) {
        const b = t.getBBox();
        if (b.width > 0 && (b.x < 4 || b.y < 4 || b.x + b.width > 956 || b.y + b.height > 536)) bad.push(`${t.textContent.slice(0, 20)} [${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)}x${Math.round(b.height)}]`);
      }
      const shown = [...document.querySelectorAll('svg [class^="m-"]')].filter((e) => Number(getComputedStyle(e).opacity) < 0.99).length;
      return { bad, shown };
    });
    check(`${key}: no text clipped by the frame`, late.bad.length === 0, late.bad.join(" ; "));
    check(`${key}: everything is fully visible when the motion ends`, late.shown === 0, String(late.shown));
    if (shots) await page.screenshot({ path: join(shots, key + ".png"), clip: { x: 0, y: 0, width: 1280, height: 720 } });
  }
  // the other themes: same worst-case checks on a representative subset
  for (const theme of ["deep", "calm"]) {
    for (const key of ["stat-percent", "stat-long", "steps6", "steps-long", "concept6", "compare", "bars6", "story4", "cycle6", "timeline6"]) {
      const spec = { ...SPECS.find(([k]) => k === key)[1], theme };
      await mount(page, spec);
      await page.waitForTimeout(2300);
      const r = await page.evaluate(() => ({ dark: document.querySelector("svg").dataset.theme,
        bad: [...document.querySelectorAll("svg text")].filter((t) => { const b = t.getBBox(); return b.width > 0 && (b.x < 4 || b.y < 4 || b.x + b.width > 956 || b.y + b.height > 536); }).map((t) => t.textContent.slice(0, 16)),
        shown: [...document.querySelectorAll('svg [class^="m-"]')].filter((e) => Number(getComputedStyle(e).opacity) < 0.99).length }));
      check(`${key} [${theme}]: nothing clipped, fully visible after the motion`, r.bad.length === 0 && r.shown === 0 && r.dark === (theme === "deep" ? "dark" : "light"), JSON.stringify(r));
      if (shots) await page.screenshot({ path: join(shots, `${key}.${theme}.png`), clip: { x: 0, y: 0, width: 1280, height: 720 } });
    }
  }
  // ring: the arc is filled to exactly the stated percentage
  await mount(page, SPECS[0][1]);
  await page.waitForTimeout(1600);
  check("the ring ends at exactly the stated percentage", await page.evaluate(() => getComputedStyle(document.querySelector(".m-ring")).strokeDasharray.replace(/px/g, "").split(/[ ,]+/)[0] === "68"));
  // reduced motion
  const calm = await open(true);
  await mount(calm, SPECS[5][1]);
  await calm.waitForTimeout(40);
  const still = await calm.evaluate(() => ({ n: [...document.querySelectorAll('svg [class^="m-"]')].length, moving: [...document.querySelectorAll('svg [class^="m-"]')].filter((e) => getComputedStyle(e).animationName !== "none").length,
    hidden: [...document.querySelectorAll('svg [class^="m-"]')].filter((e) => Number(getComputedStyle(e).opacity) < 0.99).length }));
  check("with reduced-motion the scene is shown still and complete", still.n > 0 && still.moving === 0 && still.hidden === 0, JSON.stringify(still));
} catch (error) {
  console.log("FAIL  unexpected: " + (error.stack || error));
  failures.push("unexpected");
} finally {
  await browser.close();
  server.kill();
}
if (failures.length) { console.log("\nFAILED:", failures.length, "->", [...new Set(failures)].join("; ")); process.exit(1); }
console.log("\nscenes motion e2e: all checks passed");
