import assert from "node:assert/strict";
import { lecturerTeachingMove, lecturerTakeaway, lecturerComparison } from "../web/lecturer-profile.js";
import { createDirectorBrain } from "../web/director-brain.js";

assert.equal(lecturerTeachingMove("كنا نعتقد كذا لكن في المقابل عندنا خيار ثاني").kind, "contrast");
assert.equal(lecturerTeachingMove("على سبيل الافتراض واحد معدله عالي بس مهاراته قليلة").kind, "example");
assert.equal(lecturerTeachingMove("نصيحتي لكم لا تكتفون بالمعدل وزيدوا مهاراتكم").kind, "takeaway");
assert.equal(lecturerTeachingMove("ليش نحتاج ندمج التكنولوجيا في التعليم؟").kind, "question");
const quote = lecturerTakeaway("نصيحتي لكم لا تركزون فقط على المعدل وحاولوا تزيدون مهاراتكم في المقابل");
assert.equal(quote?.type, "quote");
assert.equal(quote?.lines[0], "نصيحتي لكم لا تركزون فقط على المعدل وحاولوا تزيدون مهاراتكم في المقابل");
assert.equal(lecturerTakeaway("واحد معدله ممتاز لكن مهاراته قليلة"), null, "no false takeaways");

const one = lecturerComparison("هناك فرق كبير جدا بين استخدام التكنولوجيا في التعليم وبين دمج التكنولوجيا في التعليم");
assert.deepEqual(one?.lines, ["استخدام التكنولوجيا في التعليم | دمج التكنولوجيا في التعليم"],
  "archive wording is preserved without an invented explanation");
assert.equal(lecturerComparison("شنو الفرق بين استخدام التكنولوجيا في التعليم وبين دمج التكنولوجيا في التعليم؟"), null);
assert.equal(lecturerComparison("في المقابل ما راح نغير شي", "تكنولوجيا التعليم مفهوم متجدد"), null);
assert.deepEqual(lecturerComparison("لكن في المقابل دمج التكنولوجيا في التعليم يحتاج تخطيط مسبق",
  "استخدام التكنولوجيا في التعليم يحتاج معرفة الأدوات")?.lines,
  ["استخدام التكنولوجيا في التعليم يحتاج معرفة الأدوات | دمج التكنولوجيا في التعليم يحتاج تخطيط مسبق"]);
{
  let t = 100000;
  const b = createDirectorBrain({ now: () => t });
  const ctx = { slide: { index: 5, text: "تكنولوجيا التعليم", notes: "" }, mode: "balanced" };
  assert.equal(b.observe("استخدام التكنولوجيا في التعليم يحتاج معرفة الأدوات", ctx).action, "none");
  t += 8000;
  const result = b.observe("لكن في المقابل دمج التكنولوجيا في التعليم يحتاج تخطيط مسبق", ctx);
  assert.equal(result.action, "propose", "personalized comparison is NEVER automatic");
  assert.equal(result.kind, "compare");
  assert.deepEqual(result.spec.lines, [
    "استخدام التكنولوجيا في التعليم يحتاج معرفة الأدوات | دمج التكنولوجيا في التعليم يحتاج تخطيط مسبق"
  ]);
}
{
  let t = 200000;
  const b = createDirectorBrain({ now: () => t });
  b.observe("استخدام التكنولوجيا في التعليم يحتاج معرفة الأدوات", { slide: { index: 5 } });
  t += 8000;
  assert.equal(b.observe("لكن في المقابل دمج التكنولوجيا في التعليم يحتاج تخطيط مسبق",
    { slide: { index: 6 } }).action, "none", "no cross-slide pairing");
}
{
  const b = createDirectorBrain();
  const decision = b.observe("شنو الفرق بين استخدام التكنولوجيا في التعليم وبين دمج التكنولوجيا في التعليم؟",
    { slide: { index: 3 } });
  assert.equal(decision.action, "none", "a spoken question cannot hallucinate its answer");
}

console.log("curated lecturer teaching moves and explicit comparisons passed");
