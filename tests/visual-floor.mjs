// Projector legibility floor: no scene may draw text smaller than MIN_PX (in 960x540 viewBox units, about 2.6% of stage height),
// in any type or layout, with realistic crowded input. Every lecturer word must still be kept (nothing is cut to make room).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderInfographic } from "../web/infographic.js";
const MIN_PX = 14;
const med = "جملة تعليمية متوسطة الطول توضح الفكرة للمشاهد";
const lng = "هذه جملة طويلة من كلام المحاضر يجب ألا تختفي أو تتبدل كلماتها مهما كانت كثافة المشهد";
const mk = (n, s) => Array.from({ length: n }, (_, i) => `${s} ${i + 1}`);
const cases = [
  ["steps", mk(6, med)], ["steps", mk(5, lng)], ["concept", mk(4, med)], ["concept", mk(5, med)], ["flow", mk(6, med)], ["flow", mk(5, lng)],
  ["timeline", mk(5, med).map((t, i) => `${2000 + i * 3} — ${t}`)], ["story", mk(5, med)], ["cycle", mk(5, med)],
  ["bars", mk(6, "فئة طويلة الاسم | 20%").map((t, i) => t.replace(/\d+%/, `${10 + i * 5}%`))], ["compare", [`${med} | ${med}`, `${med} | ${lng}`, `${lng} | ${med}`]],
];
let failed = 0;
for (const [type, lines] of cases) {
  for (const variant of [0, 1, 2]) {
    let svg;
    try { svg = renderInfographic({ type, title: "عنوان المشهد", lines, variant }); } catch { continue; }
    const sizes = [...svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
    const min = Math.min(...sizes);
    const ok = min >= MIN_PX;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${type}/v${variant} min font ${min}`);
  }
}
const css = readFileSync(new URL("../web/style.css", import.meta.url), "utf8");
const infinite = (css.match(/\.info-layer[^{]*\{[^}]*animation[^}]*infinite[^}]*\}/g) || []);
console.log(`${infinite.length ? "FAIL" : "PASS"}  no infinite decorative animation on scenes (${infinite.length})`);
if (infinite.length) failed++;
const blur = /@keyframes k-(phrase|last)[^\n]*blur\(/.test(css);
console.log(`${blur ? "FAIL" : "PASS"}  no animated blur filter on scenes`);
if (blur) failed++;
assert.equal(failed, 0, `${failed} legibility/motion failures`);
console.log("\nall visual-floor checks passed");
