import assert from "node:assert/strict";
import { assessVisualDensity, refineVisualStyle } from "../web/visual-quality.js";
import { styleScene } from "../web/scene-stylist.js";
import { renderInfographic, validateSpec } from "../web/infographic.js";
import { parsePercentValue } from "../web/scene-layouts.js";
const long = "هذه جملة طويلة من كلام المحاضر يجب ألا تختفي أو تتبدل كلماتها مهما كانت كثافة المشهد البصري";
const dense = { type: "steps", title: "تسلسل تربوي", lines: [long, long, long, long, long] };
assert.equal(assessVisualDensity(dense).dense, true);
const sixItems = { type: "steps", title: "تسلسل", lines: Array(6).fill("جملة تعليمية متوسطة الحجم توضح الفكرة للمشاهد") };
assert.equal(assessVisualDensity(sixItems).dense, true, "six medium items need a calm layout");
assert.ok(assessVisualDensity(sixItems).reasons.includes("crowded-items"));
assert.equal(assessVisualDensity({ ...sixItems, lines: Array(6).fill("فكرة قصيرة") }).dense, false, "six short items retain visual variety");
assert.ok(assessVisualDensity(dense).reasons.includes("long-item"));
assert.equal(assessVisualDensity({ type: "steps", title: "تعلم", lines: ["فهم", "تطبيق"] }).dense, false);
const styled = styleScene(dense, { storage: { getItem: () => null, setItem: () => {} } });
assert.equal(styled.theme, "warm", "dense automatic scenes use a restrained, readable theme");
assert.equal(styled.variant, undefined, "dense automatic scenes avoid experimental layouts");
const svg = renderInfographic(styled);
for (const phrase of dense.lines) assert.ok(svg.includes('data-full="' + phrase + '"'), "full lecturer wording retained");
const manual = refineVisualStyle(dense, { ...dense, theme: "ember", variant: 2 }, { explicitTheme: true, explicitVariant: true });
assert.equal(manual.theme, "ember");
assert.equal(manual.variant, 2);
const short = { type: "steps", title: "فهم", lines: ["تجربة", "تطبيق"] };
assert.deepEqual(refineVisualStyle(short, { ...short, theme: "world:ivory-thesis", variant: 1 }), { ...short, theme: "world:ivory-thesis", variant: 1 });
// Regression: lecturer-selected layout survives the automatic style selector.
const chosen = styleScene({ type: "steps", title: "مقدمة", lines: ["معلومة"], variant: 2 }, { storage: { getItem: () => null, setItem: () => {} } });
assert.equal(chosen.variant, 2, "explicit lecturer layout is preserved");
const saved = [];
const storage = { getItem: () => null, setItem: (_key, value) => saved.push(JSON.parse(value)) };
styleScene(dense, { storage });
assert.equal(saved.at(-1)[0].v, 0, "history reflects the actually displayed dense-scene layout");
assert.equal(saved.at(-1)[0].w, "warm", "history reflects the actually displayed restrained theme");
// Every displayed statistical value must match the lecturer's literal input.
for (const value of ["0%", "37.5%", "100%", "٣٧%", "٣٧٪", "٣٧٫٥٪", "٣٧ ٪", "12"]) {
  const rendered = renderInfographic({ type: "stat", title: "نتيجة", lines: [value, "من المشاركين"] });
  assert.ok(rendered.includes(">" + value + "</text>"), "statistic must preserve literal number: " + value);
  assert.ok(rendered.includes("من المشاركين"), "statistic must preserve its explanation");
}
for (const [value, expected] of [["0%", "0"], ["37.5%", "37.5"], ["100%", "100"], ["٣٧%", "37"], ["٣٧٪", "37"], ["٣٧٫٥٪", "37.5"], ["٣٧ ٪", "37"]]) {
  const rendered = renderInfographic({ type: "stat", title: "نتيجة", lines: [value, "من المشاركين"] });
  assert.ok(rendered.includes('style="--v:' + expected + '"'), "ring must use the precise spoken percentage");
}
const zeroBars = renderInfographic({ type: "bars", title: "المشاركة", lines: ["الفئة الأولى | 0%", "الفئة الثانية | 80%"] });
assert.ok(zeroBars.includes('width="0"'), "zero percent must produce a genuinely empty bar");
const selectedTheme = styleScene({ ...dense, theme: "ember" }, { storage: { getItem: () => null, setItem: () => {} } });
assert.equal(selectedTheme.theme, "ember", "explicit scene theme survives automatic mode and density gate");
// Multilingual bar data: exact arithmetic, untouched on-screen labels, strict bounds.
for (const [raw, expected] of [["٣٧٫٥٪", 37.5], ["۳۷٫۵٪", 37.5], ["٣٧ ٪", 37], ["0%", 0], ["100%", 100]]) {
  assert.equal(parsePercentValue(raw), expected, "numeric interpretation: " + raw);
}
for (const raw of ["101%", "-2%", "غير معروف", "40%%", ""]) assert.equal(parsePercentValue(raw), null, "reject invalid percent: " + raw);
const arabicBars = { type: "bars", title: "نتائج", lines: ["المجموعة الأولى | ٣٧٫٥٪", "المجموعة الثانية | ٧٥٪"] };
assert.deepEqual(validateSpec(arabicBars).lines, arabicBars.lines, "original Arabic bar labels survive validation");
const arabicBarsSvg = renderInfographic(arabicBars);
assert.ok(arabicBarsSvg.includes('width="185"'), "37.5 relative to 75 must render at half the new 370px bar width");
assert.ok(arabicBarsSvg.includes("٣٧٫٥٪") && arabicBarsSvg.includes("٧٥٪"), "Arabic bar values remain visible verbatim");
assert.throws(() => validateSpec({ ...arabicBars, lines: ["الفئة | ١٠١٪", "الفئة | ٥٠٪"] }), "percentages above 100 must be rejected");
const persianStat = renderInfographic({ type: "stat", title: "مشاركة", lines: ["۳۷٫۵٪", "من المشاركين"] });
assert.ok(persianStat.includes('style="--v:37.5"'), "Persian numerals preserve precise stat rings");
assert.ok(persianStat.includes(">۳۷٫۵٪</text>"), "Persian stat remains visible verbatim");
console.log("visual quality: dense layouts restrained, lecturer content intact");
