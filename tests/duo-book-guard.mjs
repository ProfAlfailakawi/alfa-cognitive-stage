// Guard for the iPhone Duo round 2 rules (Chromium; starts its own server on a free port).
//  1. one BOOK definition (landscape only) and no portrait book left in style.css
//  2. spine/fold exists only inside BOOK; portrait inner screen is one page; regression sizes keep their layout
//  3. the widget keep-out is defined once, only for the inner screen (tab and installed app alike)
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "web/style.css"), "utf8");
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL  " + m); } else console.log("PASS  " + m); };

const BOOK = "screen and (min-width: 721px) and (max-width: 1000px) and (min-height: 520px) and (max-height: 960px) and (orientation: landscape)";
ok(css.includes("@media " + BOOK), "BOOK media condition present");
ok(!/min-aspect-ratio: 7\/5/.test(css), "no aspect-ratio book branch");
const portraitBook = [...css.matchAll(/@media[^{]*min-width: 640px\)[^{]*max-width: 720px\)[^{]*\{/g)].map((m) => m[0]).filter((m) => !/orientation: portrait/.test(m) && !/max-height: 480px/.test(m));
ok(portraitBook.length === 0, "no portrait 640-720 branch without orientation:portrait " + JSON.stringify(portraitBook));
ok((css.match(/--duo-cutout-w: 116px/g) || []).length === 1, "keep-out box defined once");
const CUT_MQ = [...css.matchAll(/@media([^{]*)\{\s*:root \{ --duo-cutout-w: 116px/g)].map((m) => m[1].trim());
ok(CUT_MQ.length === 1 && !/display-mode/.test(CUT_MQ[0]), "keep-out media query has no display-mode");
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
ok(!/@media[^{]*display-mode[^{]*\{[^{}]*--duo-cutout/.test(cssNoComments) && !/display-mode[^;{}]*\{[^}]*--duo-cutout/.test(cssNoComments), "no display-mode: standalone in keep-out rules");
const BOOK_Q = "screen and (min-width: 721px) and (max-width: 1000px) and (min-height: 520px) and (max-height: 960px) and (orientation: landscape)";
const PORT_Q = "screen and (min-width: 640px) and (max-width: 720px) and (min-height: 520px) and (max-height: 960px) and (orientation: portrait)";
ok(CUT_MQ[0] === BOOK_Q.replace("screen and ", "screen and ") + ",\n       " + PORT_Q, "keep-out = BOOK or PORTRAIT INNER exactly");

const port = 5300 + Math.floor(Math.random() * 600);
const server = spawn(process.execPath, [join(root, "server/server.mjs")], { env: { ...process.env, PORT: String(port), ADMIN_TOKEN: "guard-token-0123456789abcdef" }, stdio: ["ignore", "pipe", "pipe"] });
await new Promise((r) => server.stdout.once("data", r));
const base = `http://localhost:${port}`;
const browser = await chromium.launch();
let baseCss = "";
try { baseCss = execFileSync("git", ["show", "origin/main:web/style.css"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { console.log("NOTE  origin/main not available: baseline comparison skipped"); }
async function probe(size, { baseline = false, url = "/#presenter" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.route("**/style.css", async (route) => {
    let body = baseline ? baseCss : css;
    route.fulfill({ status: 200, contentType: "text/css", body });
  });
  await page.goto(base + url); await page.waitForSelector("#meta"); await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const rect = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round); };
    const p = document.querySelector(".presenter");
    return { fold: getComputedStyle(p, "::before").content, cols: getComputedStyle(p).gridTemplateColumns, cut: getComputedStyle(document.documentElement).getPropertyValue("--duo-cutout-w").trim(),
      rects: ["#next", "#prev", ".stage", ".bar", ".side"].map(rect), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  await page.unrouteAll({ behavior: "ignoreErrors" }); await ctx.close(); return r;
}
try {
  for (const s of [[951, 585], [951, 669], [880, 560], [800, 600]]) { const r = await probe(s); ok(/"/.test(r.fold) || r.fold !== "none", `${s} is a book (fold drawn)`); }
  for (const s of [[669, 867], [720, 900], [640, 760], [390, 844], [844, 390], [744, 1024], [1024, 768], [1280, 800], [367, 740]]) {
    const r = await probe(s); ok(r.fold === "none" || r.fold === "normal", `${s} has no spine`); ok(r.overflow <= 0, `${s} no horizontal overflow`);
  }
  // regression sizes must lay out exactly as before this round
  if (baseCss) for (const s of [[390, 844], [844, 390], [744, 1024], [1024, 768], [1280, 800], [367, 740]]) {
    const a = await probe(s), b = await probe(s, { baseline: true });
    ok(JSON.stringify(a.rects) === JSON.stringify(b.rects), `${s} unchanged vs origin/main`);
  }
  // keep-out: the real media queries, evaluated in a plain tab, no CSS rewriting
  for (const s of [[951, 585], [951, 669], [669, 867], [720, 900], [640, 760], [722, 520], [1000, 960], [640, 700], [720, 960]]) ok((await probe(s)).cut === "116px", `${s} keep-out on`);
  for (const s of [[390, 844], [844, 390], [932, 430], [744, 1024], [820, 1180], [1024, 768], [1180, 820], [1280, 800], [1440, 900], [367, 740], [951, 350], [721, 519], [721, 961], [639, 800], [721, 900]]) ok((await probe(s)).cut === "0px", `${s} keep-out off`);
} finally { await browser.close(); server.kill(); }
console.log(fails ? `${fails} FAILED` : "duo book guard passed");
process.exit(fails ? 1 : 0);
