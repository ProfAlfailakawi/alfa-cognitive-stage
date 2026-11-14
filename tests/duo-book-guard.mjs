// Guard for the iPhone Duo round 2 rules (Chromium; starts its own server on a free port).
//  1. one BOOK definition (landscape only) and no portrait book left in style.css
//  2. spine/fold exists only inside BOOK; portrait inner screen is one page; regression sizes keep their layout
//  3. the widget keep-out is defined once, only for the inner screen in standalone
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
ok(/display-mode: standalone/.test(css) && !/:root \{ --duo-cutout-w: 116px[^}]*\}[\s\S]*display-mode: standalone\) and \(max-height: 480/.test(css), "keep-out is standalone-only");

const port = 5300 + Math.floor(Math.random() * 600);
const server = spawn(process.execPath, [join(root, "server/server.mjs")], { env: { ...process.env, PORT: String(port), ADMIN_TOKEN: "guard-token-0123456789abcdef" }, stdio: ["ignore", "pipe", "pipe"] });
await new Promise((r) => server.stdout.once("data", r));
const base = `http://localhost:${port}`;
const browser = await chromium.launch();
let baseCss = "";
try { baseCss = execFileSync("git", ["show", "origin/main:web/style.css"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { console.log("NOTE  origin/main not available: baseline comparison skipped"); }
async function probe(size, { standalone = false, baseline = false, url = "/#presenter" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.route("**/style.css", async (route) => {
    let body = baseline ? baseCss : css;
    if (standalone) body = body.replaceAll("(display-mode: standalone)", "(min-width: 0px)");
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
  // keep-out: only on the inner screen and only standalone
  ok((await probe([951, 585])).cut === "0px", "tab (not standalone) has no keep-out");
  for (const s of [[951, 585], [669, 867], [720, 900]]) ok((await probe(s, { standalone: true })).cut === "116px", `${s} standalone keep-out on`);
  for (const s of [[390, 844], [844, 390], [744, 1024], [1024, 768], [367, 740]]) ok((await probe(s, { standalone: true })).cut === "0px", `${s} standalone keep-out off`);
} finally { await browser.close(); server.kill(); }
console.log(fails ? `${fails} FAILED` : "duo book guard passed");
process.exit(fails ? 1 : 0);
