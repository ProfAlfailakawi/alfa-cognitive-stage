import assert from "node:assert/strict";
import { renderInfographic, validateSpec } from "../web/infographic.js";
import { createDirectorBrain } from "../web/director-brain.js";

// ---- renderers ----
const bars = renderInfographic({ type: "bars", title: "توزيع", lines: ["الجوال | 40%", "الكمبيوتر | 35%", "التابلت | 25%"] });
assert.match(bars, /viewBox="0 0 960 540"/);
for (const t of ["الجوال", "40%", "35%", "25%"]) assert.ok(bars.includes(t), t);
const widths = [...bars.matchAll(/<rect x="250" y="[\d.]+" width="([\d.]+)" height="[\d.]+" rx="10" fill="#(?:3e5c78|8f5a28)"/g)].map((m) => Number(m[1]));
assert.deepEqual(widths.map((w) => Math.round(w)), [430, 376, 269], "bars scale to the largest SPOKEN value, no invented total");
for (const bad of [["أ | 120%", "ب | 5%"], ["أ | 40", "ب | 5%"], ["أ | 40%"], ["أ | 1%", "ب | 2%", "ج | 3%", "د | 4%", "هـ | 5%", "و | 6%", "ز | 7%"], ["بلا فاصل 40%", "ب | 5%"]])
  assert.throws(() => validateSpec({ type: "bars", title: "x", lines: bad }), /الأعمدة/);
const cycle = renderInfographic({ type: "cycle", title: "دورة التعلم", lines: ["نخطط", "ننفذ", "نقيم", "نعدل"] });
assert.ok(["نخطط", "ننفذ", "نقيم", "نعدل"].every((t) => cycle.includes(t)) && cycle.includes("marker-end"));
assert.throws(() => validateSpec({ type: "cycle", title: "x", lines: ["أ", "ب"] }), /الدورة/);
const activity = renderInfographic({ type: "activity", title: "نشاط", lines: ["ناقشوا مع زميلكم أهم فايدة", "المدة: 3 دقائق"] });
assert.ok(activity.includes("ناقشوا مع زميلكم") && activity.includes("المدة: 3 دقائق"));
assert.throws(() => validateSpec({ type: "activity", title: "x", lines: ["تعليمات", "ثلاث دقائق"] }), /النشاط/);
for (const type of ["bars", "cycle", "activity"]) {
  const html = renderInfographic({ type, title: "<img src=x onerror=alert(1)>", lines: type === "bars" ? ["<b>x</b> | 10%", "y | 20%"] : type === "cycle" ? ["<script>1</script>", "b", "c"] : ["<svg onload=alert(1)>"] });
  assert.ok(!/<(?:img|script|b|svg onload)/.test(html.replace(/<svg viewBox[^>]*>/, "")), type + " escapes markup");
}

// ---- detectors (explicit structure only; always a proposal) ----
let t = 1_000_000;
const ask = (text, mode = "balanced") => createDirectorBrain({ now: () => t }).observe(text, { slide: { index: 4, text: "", notes: "" }, mode });
let d = ask("الطلاب موزعين الفئة أ 40% والفئة ب 35% والفئة ج 25%");
assert.deepEqual([d.action, d.kind, d.spec.lines], ["propose", "bars", ["الفئة أ | 40%", "الفئة ب | 35%", "الفئة ج | 25%"]]);
d = ask("في الدراسة الجوال أربعين بالمية والكمبيوتر خمسة وثلاثين بالمية والتابلت خمسة وعشرين بالمية");
assert.deepEqual(d.spec.lines, ["الجوال | 40%", "الكمبيوتر | 35%", "التابلت | 25%"], "spoken numbers become exact digits");
assert.equal(ask("هذا 40% وهذا 60%").kind === "bars", false, "two values are a comparison, not bars");
assert.equal(ask("الفئة أ 40% والفئة أ 35% والفئة أ 25%").spec, null, "duplicate labels are refused");
assert.equal(ask("الفئة أ 140% والفئة ب 35% والفئة ج 25%").kind === "bars", false, "out-of-range values are refused");
assert.equal(ask("الفئة أ 40% والفئة ب 35% والفئة ج 25%", "shadow").action, "observe");
d = ask("ناقشوا مع زميلكم أهم فايدة للألعاب لمدة ثلاث دقايق");
assert.deepEqual([d.action, d.kind, d.spec.lines], ["propose", "activity", ["ناقشوا مع زميلكم أهم فايدة للألعاب لمدة ثلاث دقايق", "المدة: 3 دقائق"]]);
d = ask("ناقشوا مع زميلكم أهم فايدة للألعاب خمس دقائق");
assert.equal(d.spec.lines[1], "المدة: 5 دقائق");
d = ask("اكتبوا في ورقة ثلاث أفكار عن الدافعية");
assert.equal(d.spec.lines.length, 1, "no duration is invented when none was spoken");
assert.equal(ask("ناقشوا").kind === "activity", false);
assert.equal(ask("الورقة فيها نشاط").kind === "activity", false, "a bare mention is not an instruction");
d = ask("أول شي نحدد الهدف ثاني شي نجمع البيانات ثالث شي نحلل النتائج وهذي دورة تتكرر");
assert.deepEqual([d.kind, d.spec.type], ["cycle", "cycle"]);
assert.equal(ask("أول شي نحدد الهدف ثاني شي نجمع البيانات ثالث شي نحلل النتائج").kind, "steps");
console.log("new scenes: bars, cycle, activity render safely and are detected only from explicit speech");
