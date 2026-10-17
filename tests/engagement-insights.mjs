import assert from "node:assert/strict";
import { clusterQuestions, recurringTerms, reexplainSuggestions, groupByObjective, compareSections } from "../web/engagement-insights.js";

const q = (id, text, flagged = false) => ({ id, text, flagged });
const questions = [
  q(1, "ما الفرق بين الدافعية الداخلية والدافعية الخارجية؟"),
  q(2, "ممكن تعيد شرح الدافعية الداخلية والخارجية؟"),
  q(3, "شنو الفرق بين الدافع الداخلي والخارجي؟"),
  q(4, "متى موعد الاختبار النهائي؟"),
  q(5, "هل الاختبار النهائي يشمل المحاضرة الأولى؟"),
  q(6, "كم نسبة الحضور المطلوبة؟"),
  q(7, "يا ابن الكلب ما فهمنا شي", true),
];
const clusters = clusterQuestions(questions);
assert.equal(clusters[0].size, 3, "three paraphrased questions about motivation form one group");
assert.deepEqual(clusters[0].ids.sort(), [1, 2, 3]);
assert.ok(clusters[0].keywords.some((k) => /دافع/.test(k)), "keywords are real words from the questions: " + clusters[0].keywords);
assert.ok(clusters[0].representative.length > 5 && questions.some((x) => x.text === clusters[0].representative), "the representative is quoted verbatim");
assert.equal(clusters.find((c) => c.ids.includes(4)).ids.includes(5), true, "exam questions group together");
assert.ok(!clusters.some((c) => c.ids.includes(7)), "flagged questions never enter summaries");
const terms = recurringTerms(questions);
assert.ok(terms.some((t) => /دافع|اختبار|فرق/.test(t.term) && t.count >= 2));
assert.ok(terms.every((t) => t.count >= 2), "one-off words are not 'recurring'");
const tips = reexplainSuggestions(clusters, 6);
assert.equal(tips.length, 1);
assert.match(tips[0], /3 أسئلة متقاربة/);
assert.deepEqual(reexplainSuggestions(clusterQuestions([q(1, "سؤال عن الاختبار النهائي"), q(2, "سؤال ثاني عن الحضور")]), 2), [], "no cue without repeated asking");
assert.deepEqual(clusterQuestions([]), []); assert.deepEqual(clusterQuestions(null), []);

// Objectives only group what the lecturer typed.
const polls = [
  { id: 1, question: "أ", objective: "يميز بين أنواع الدافعية", total: 20, kind: "choice" },
  { id: 2, question: "ب", objective: "يميز بين أنواع الدافعية", total: 18, kind: "words" },
  { id: 3, question: "ج", objective: "", total: 5 },
];
const grouped = groupByObjective(polls);
assert.equal(grouped.length, 1); assert.equal(grouped[0].items.length, 2); assert.equal(grouped[0].participants, 20);

// Cross-section comparison: side by side, with the limits spelled out.
const choice = (total, counts) => ({ id: 1, question: "هل تفضل الألعاب؟", options: ["نعم", "لا"], total, counts, kind: "choice" });
const compared = compareSections([
  { code: "AAAAAA", label: "شعبة 1", polls: [choice(20, [15, 5])] },
  { code: "BBBBBB", label: "شعبة 2", polls: [choice(10, [4, 6])] },
  { code: "CCCCCC", label: "", polls: [{ ...choice(9, [1, 8]), question: "سؤال مختلف" }] },
]);
assert.equal(compared.length, 1);
assert.deepEqual(compared[0].sections.map((s) => [s.label, s.total, s.percents[0]]), [["شعبة 1", 20, 75], ["شعبة 2", 10, 40]]);
assert.match(compared[0].caveat, /ليس دليلاً/);
assert.equal(compareSections([{ code: "A", polls: [choice(5, [3, 2])] }]).length, 0, "needs at least two sections");
assert.equal(compareSections([{ code: "A", polls: [choice(0, [0, 0])] }, { code: "B", polls: [choice(0, [0, 0])] }]).length, 0, "empty rounds are ignored");
console.log("engagement insights: paraphrase clustering, recurring terms, re-explain cues, objectives, section comparison passed");
