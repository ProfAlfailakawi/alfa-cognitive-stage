import assert from "node:assert/strict";
import { detectWhatIf, hasHypotheticalPercent } from "../web/what-if.js";
import { renderInfographic, validateSpec } from "../web/infographic.js";
import { createDirectorBrain } from "../web/director-brain.js";
import { interpretSpeech } from "../web/director-core.js";

const cases = [
  ["نسبة الحضور حاليا 30% ولو افترضنا صارت 50%", ["30%", "50%"]],
  ["النسبة الحين 30 بالمية ولو صارت النسبة 45 بالمية شنو يصير", ["30%", "45%"]],
  ["النسبة فعليا 30.5% ولو افترضنا صارت 40.5%", ["30.5%", "40.5%"]]
];
for (const [phrase, values] of cases) assert.deepEqual(detectWhatIf(phrase)?.lines, values, phrase);
const refused = [
  "لو افترضنا نسبة النجاح 70%",
  "تخيلوا نسبة النجاح 70%",
  "النسبة حاليا 30% ولو افترضنا صارت - 50%",
  "نسبة الحضور حاليا 30% ولو افترضنا نسبة النجاح 50%",
  "نسبة الحضور حاليا 30% ولو افترضنا صارت 120%",
  "نسبة الحضور حاليا 30% ولو افترضنا صارت 30%",
  "نسبة الحضور حاليا 30% ولو افترضنا صارت 50% وبعدين 70%",
  "نسبة الحضور حاليا 30% ولو افترضنا صارت 50% عفوا غلطت",
  "النسبة حاليا 30% ولو افترضنا صارت -50%",
  "نسبة الحضور حاليا 30% ولو افترضنا صارت 50% من 60 طالب"
];
for (const phrase of refused) assert.equal(detectWhatIf(phrase), null, phrase);
assert.equal(hasHypotheticalPercent("لو افترضنا نسبة الطلاب 70 بالمية"), true);
assert.equal(interpretSpeech("تخيلوا نسبة الطلاب 70 بالمية")?.kind, "example");
assert.equal(interpretSpeech("لو افترضنا نسبة الطلاب 70 بالمية")?.kind, "example",
  "hypothetical speech must not become an observed statistic");

const context = { slide: { index: 2, text: "", notes: "" }, mode: "creative" };
const brain = createDirectorBrain({ now: () => 1000000 });
const decision = brain.observe(cases[0][0], context);
assert.deepEqual([decision.action, decision.kind, decision.spec?.lines],
  ["propose", "whatif", ["30%", "50%"]], "even creative mode needs lecturer approval");
const spoken = createDirectorBrain({ now: () => 1000000 }).observe(
  "نسبة الحضور الحين ثلاثين بالمية ولو افترضنا صارت خمسين بالمية", context);
assert.deepEqual(spoken.spec?.lines, ["30%", "50%"], "spoken Arabic numbers are preserved");
for (const phrase of refused) {
  const d = createDirectorBrain({ now: () => 1000000 }).observe(phrase, context);
  assert.equal(d.action, "none", phrase);
  assert.equal(d.cloudText, null, "unsupported assumptions do not spend API money");
}
const single = createDirectorBrain({ now: () => 1000000 }).observe(
  "لو افترضنا نسبة الطلاب 70 بالمية", context);
assert.equal(single.action, "none", "no speculative stat");

const svg = renderInfographic(decision.spec);
assert.match(svg, /viewBox="0 0 960 540"/);
assert.ok(svg.includes("30%") && svg.includes("50%") && svg.includes("ليست نتيجة متوقعة"));
assert.ok(!svg.includes("20%") && !svg.includes("مصدر:"));
for (const lines of [["20%"], ["20%", "120%"], ["20%", "20%"], ["20", "50%"], ["20%", "مجهول"]])
  assert.throws(() => validateSpec({ type: "whatif", title: "x", lines }), /الافتراض/);
const escaped = renderInfographic({ type: "whatif", title: "<b>تنبيه</b>", lines: ["30%", "50%"] });
assert.ok(!escaped.includes("<b>") && escaped.includes("&lt;b&gt;"));
console.log("what-if: safe local detection, approval, no invented results, SVG and refusal checks");
