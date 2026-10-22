import assert from "node:assert/strict";
import { classifyQuestion, triageQuestions } from "../web/question-triage.js";

const now = 1_700_000_000_000;
const q = (id, text, slide, ago = 60000, extra = {}) => ({ id, text, slide, createdAt: now - ago, flagged: false, ...extra });
const questions = [
  q(1, "ما الفرق بين الدافعية الداخلية والدافعية الخارجية؟", 4), q(2, "ممكن تعيد شرح الدافعية الداخلية والخارجية؟", 4), q(3, "شنو الفرق بين الدافع الداخلي والخارجي؟", 4),
  q(4, "متى موعد الاختبار النهائي؟", 9), q(5, "هل الاختبار النهائي يشمل المحاضرة الأولى؟", 9), q(6, "كم نسبة الحضور المطلوبة؟", 9),
  q(7, "ممكن مثال عملي على التعلم المقلوب؟", 6), q(8, "ما فهمت الحمل المعرفي أبداً", 5, 500000),
  q(9, "يا ابن الكلب ما فهمنا شي", 4, 10000, { flagged: true }),
];

// ---- kinds ----
assert.equal(classifyQuestion("متى موعد الاختبار النهائي؟"), "logistics");
assert.equal(classifyQuestion("ما فهمت الفكرة"), "clarify");
assert.equal(classifyQuestion("ممكن مثال على هذا؟"), "example");
assert.equal(classifyQuestion("بس ليش ما نطبق الطريقة الثانية؟"), "challenge");
assert.equal(classifyQuestion("ما معنى الحمل المعرفي؟"), "content");
assert.equal(classifyQuestion(""), "content");

// ---- triage ----
const r = triageQuestions(questions, { currentSlide: 6, now });
assert.equal(r.total, 8, "flagged questions never enter triage");
assert.equal(r.top.length, 3);
assert.deepEqual(r.top[0].ids.sort(), [1, 2, 3], "the largest group of paraphrased questions comes first");
assert.equal(r.top[1].ids[0], 7, "a question about the slide on screen outranks an older single question");
assert.ok(r.top[1].onCurrentSlide && r.top[1].why.includes("عن الشريحة المعروضة الآن"));
assert.equal(r.top[2].kind, "clarify");
assert.deepEqual(r.logistics.map((c) => c.ids.sort()).sort(), [[4, 5], [6]], "administrative questions are separated, grouped by topic");
assert.ok(r.top.every((c) => c.kind !== "logistics"), "administrative questions never take a top slot");
assert.ok(questions.some((x) => x.text === r.top[0].representative), "the representative is a verbatim student question");
// the same data with another slide on screen changes the order
const other = triageQuestions(questions, { currentSlide: 5, now });
assert.equal(other.top[1].ids[0], 8, "the slide on screen decides ties");
// no slide context, no boost
assert.ok(triageQuestions(questions, { now }).top.every((c) => !c.onCurrentSlide));
// more groups than slots: the rest are counted, not hidden
const many = triageQuestions(Array.from({ length: 6 }, (_, i) => q(i + 1, ["الذاكرة العاملة", "الحمل المعرفي", "التقييم البنائي", "الصف المقلوب", "التلعيب", "الجوال"][i] + " ما معناها", i + 1)), { now });
assert.equal(many.top.length, 3); assert.equal(many.waiting, 3);
// degenerate input
assert.deepEqual(triageQuestions(null), { top: [], waiting: 0, logistics: [], total: 0 });
assert.equal(triageQuestions([{ id: 1, text: 5 }]).total, 0);
// a semantic backend can replace the comparison
const merged = triageQuestions([q(1, "الذاكره", 1), q(2, "الحافظه", 1)], { now, similarity: () => 1 });
assert.equal(merged.top[0].size, 2, "an injected similarity decides which questions are the same");
console.log("question-triage: all checks passed");
