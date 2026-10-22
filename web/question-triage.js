// Lecturer-only triage of anonymous student questions: what kind of question it is, which groups of paraphrased
// questions deserve the lecturer's next 30 seconds, and which can be settled with one administrative reply.
// Deterministic and extractive: it orders and labels what students wrote; it never judges whether a question is right.
import { normalizeArabic } from "./director-core.js";
import { clusterQuestions } from "./engagement-insights.js";

export const KIND_LABELS = Object.freeze({
  logistics: "إداري", clarify: "لم أفهم", example: "يطلب مثالاً", challenge: "اعتراض أو شك", content: "سؤال عن المحتوى",
});
// Order matters: the first matching kind wins. Patterns run over normalizeArabic() text.
const RULES = [
  ["logistics", /(?:موعد|متى (?:الاختبار|الامتحان|التسليم|الفاينل|الميد)|تسليم|الواجب|الدرجات|درجه|علامه|نسبه الحضور|الغياب|الحضور|يشمل|ينزل|بيجي|راح يجي|ياتي في الاختبار|الاختبار النهائي|الفاينل|الميدترم|المنهج|الساعات المكتبيه|الايميل|الرابط|المرفق|بلاك ?بورد|الاستراحه)/],
  ["clarify", /(?:ما فهمت|مو فاهم|لم افهم|ما استوعبت|مب فاهم|مو واضح|غير واضح|ما وضح|ضايع|ضعت|اعد|عيد|ممكن توضح|توضح|تعيد|تكرر|مره ثانيه|شرح)/],
  ["example", /(?:مثال|امثله|تطبيق عملي|كيف نطبق|شلون نطبق|في الواقع|عمليا|حاله عمليه)/],
  ["challenge", /(?:لكن|بس (?:ليش|شلون)|مو منطقي|غلط|ما اتفق|ليش ما|اعتراض|مختلف عن|يتعارض|متناقض|كيف يعني|مب صحيح|مو صحيح)/],
];
export function classifyQuestion(text) {
  const normalized = normalizeArabic(text).toLowerCase();
  for (const [kind, pattern] of RULES) if (pattern.test(normalized)) return kind;
  return "content";
}

const RECENT_MS = 3 * 60 * 1000;
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

/**
 * @param questions [{ id, text, flagged, createdAt?, slide? }] as the lecturer API returns them
 * @param opts.currentSlide  the slide on screen now, if known
 * @param opts.similarity    optional (a, b) => 0..1 override passed to the clustering (e.g. a semantic backend)
 * @returns { top: Cluster[] (<=3, content questions), logistics: Cluster[], waiting: number, total: number }
 */
export function triageQuestions(questions, { currentSlide = null, now = Date.now(), limit = 3, similarity } = {}) {
  const visible = (Array.isArray(questions) ? questions : []).filter((q) => q && !q.flagged && typeof q.text === "string");
  const byId = new Map(visible.map((q) => [q.id, q]));
  const enriched = clusterQuestions(visible, { similarity }).map((c) => {
    const members = c.ids.map((id) => byId.get(id)).filter(Boolean);
    const kinds = members.map((m) => classifyQuestion(m.text));
    const count = (k) => kinds.filter((x) => x === k).length;
    // the group's kind is the most common one; "logistics" needs a majority so one stray word does not demote real content
    const kind = count("logistics") * 2 > members.length ? "logistics"
      : ["clarify", "example", "challenge"].map((k) => [k, count(k)]).sort((a, b) => b[1] - a[1])[0][1] * 2 > members.length
        ? ["clarify", "example", "challenge"].map((k) => [k, count(k)]).sort((a, b) => b[1] - a[1])[0][0] : "content";
    const slide = median(members.map((m) => m.slide).filter(Number.isInteger));
    const newest = Math.max(...members.map((m) => (Number.isFinite(m.createdAt) ? m.createdAt : 0)));
    const onCurrentSlide = currentSlide !== null && slide === currentSlide;
    const recent = newest > 0 && now - newest <= RECENT_MS;
    const why = [];
    if (c.size > 1) why.push(`${c.size} طلاب سألوا بصيغ متقاربة`);
    if (onCurrentSlide) why.push("عن الشريحة المعروضة الآن");
    if (kind === "clarify") why.push("يعبّرون عن عدم الفهم");
    if (recent) why.push("وصل حديثاً");
    const score = c.size * 2 + (onCurrentSlide ? 3 : 0) + (kind === "clarify" ? 1.5 : 0) + (recent ? 0.5 : 0);
    return { ...c, kind, kindLabel: KIND_LABELS[kind], slide, onCurrentSlide, newest, score, why };
  });
  const order = (a, b) => b.score - a.score || b.newest - a.newest;
  const content = enriched.filter((c) => c.kind !== "logistics").sort(order);
  return { top: content.slice(0, limit), waiting: Math.max(0, content.length - limit),
    logistics: enriched.filter((c) => c.kind === "logistics").sort(order), total: visible.length };
}
