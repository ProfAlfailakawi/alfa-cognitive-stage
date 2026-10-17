// Local semantic index for approved scenes. No network, no model download, no stored text.
//
// An utterance becomes a sparse hashed vector of: concept groups (an Arabic teaching lexicon that
// unifies synonyms and dialect/morphology, e.g. متحمسين / يتحمسون / حماس), light stems, word
// pairs and character trigrams. Similarity is cosine. This is *not* a neural embedding: it
// generalises over wording inside the lexicon and morphology, not over arbitrary meaning.
//
// Topic similarity is never enough to reuse a scene: numbers, the population being described
// (students/teachers/...), polarity (negation) and direction (increase/decrease) must agree.
import { normalizeArabic } from "./director-core.js";

const BUCKETS = 4096;
const STOP = new Set(("في من الى على عن ان انه انها هو هي هذا هذه هذي ذلك اللي الي ما لا مو شنو وش ليش كيف يعني زين طيب الحين اليوم بس " +
  "كان كانت يكون عند عندنا لو اذا بعد قبل مع او ثم يا الا كل بعض كذا جذي لكن هم احنا انتم انا نحن قال قلت ذكر ذكرت طلعت ظهر اظهرت اظهر " +
  "بالمئه بالميه بالمايه بالمائه مئه ميه وايد كثير").split(/\s+/));

// Concept groups: a regex over normalized words -> canonical concept token.
const CONCEPTS = [
  ["motivation", /(?:حمس|دافع|حفز|حافز|رغب|شغف|حماس)/],
  ["games", /(?:لعب|العاب|لعبه|تلعيب|gamif|game)/],
  ["assessment", /(?:تقييم|تقويم|اختبار|امتحان|درجات|علامات)/],
  ["learning", /(?:تعلم|تعليم|تحصيل|استيعاب|فهم)/],
  ["research", /(?:دراس[هة]?$|بحث|استطلاع|مسح|تجرب)/],
  ["technology", /(?:تقني|تكنولوج|جوال|هاتف|تطبيق|انترنت|حاسوب|كمبيوتر)/],
  ["participation", /(?:مشارك|تفاعل|مساهم)/],
  ["attendance", /(?:حضور|غياب|انتظام)/],
  ["satisfaction", /(?:رضا|رضي|قناع|ارتياح)/],
  ["time", /(?:وقت|ساع[هة]|دقائق|اسبوع|شهر)/],
  ["stress", /(?:قلق|توتر|ضغط|اجهاد)/],
  ["sleep", /(?:نوم|سهر|ارق)/],
  ["reading", /(?:قراء|مطالع|كتاب|مقرر)/],
  ["feedback", /(?:تغذي[هة]? راجع|ملاحظات|تعليق)/],
  ["collaboration", /(?:تعاون|جماع|فريق|مجموع)/],
];
const POPULATIONS = [
  ["students", /^(?:طلب|طلاب|طالب|متعلم|دارس)/],
  ["teachers", /^(?:معلم|مدرس|استاذ|اساتذ|محاضر|اكاديم|هيئه)/],
  ["parents", /^(?:اولياء|اهال|والد|اسر)/],
  ["employees", /^(?:موظف|عامل|مهني|خريج)/],
];
const NEGATION = new Set(["لا", "ما", "مو", "ماهو", "ليس", "غير", "عدم", "بدون", "لم", "لن"]);
const UP = /^(?:ارتفع|زاد|ازداد|تحسن|صعد|زياد|ارتفاع|تحسين)/;
const DOWN = /^(?:انخفض|قل|تراجع|نقص|هبط|انخفاض|تدني)/;

function fnv(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h % BUCKETS;
}
function stem(word) {
  let w = word;
  w = w.replace(/^(?:وبال|وال|بال|فال|كال|لل|ال)/, (m) => (w.length - m.length >= 3 ? "" : m));
  w = w.replace(/(?:ات|ين|ون|ان|ها|هم|ه|ي)$/, (m) => (w.length - m.length >= 3 ? "" : m));
  return w;
}
export function numbersOf(text) {
  const n = normalizeArabic(text).toLowerCase()
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:بالمئه|بالمائه|بالميه|بالمايه|في الميه|في المئه)/g, "$1%");
  return [...new Set([...n.matchAll(/\d+(?:[.,]\d+)?\s*%?/g)].map(([v]) => v.replace(/\s+/g, "").replace(",", ".")))].sort();
}

/** Embed text -> { vec: Map<bucket, weight> (L2-normalised), slots, numbers, size } */
export function embed(text) {
  const normalized = normalizeArabic(text).toLowerCase().replace(/[^\p{L}\p{N}%]+/gu, " ").trim();
  const words = normalized.split(" ").filter(Boolean);
  const slots = { population: null, negated: false, direction: null };
  const stems = [];
  const raw = new Map();
  const add = (feature, weight) => {
    const id = fnv(feature);
    raw.set(id, (raw.get(id) || 0) + weight);
  };
  for (const word of words) {
    if (NEGATION.has(word)) { slots.negated = true; continue; }
    const s = stem(word);
    if (/^\d+%?$/.test(word) || STOP.has(word) || STOP.has(s) || s.length < 3) continue;
    for (const [name, re] of POPULATIONS) if (!slots.population && re.test(s)) slots.population = name;
    if (UP.test(s)) slots.direction = "up"; else if (DOWN.test(s)) slots.direction = "down";
    stems.push(s);
    add("w:" + s, 1);
    for (const [name, re] of CONCEPTS) if (re.test(s) || re.test(word)) add("c:" + name, 1.4);
    if (s.length >= 4) for (let i = 0; i + 3 <= s.length; i++) add("t:" + s.slice(i, i + 3), 0.18);
  }
  for (let i = 0; i + 1 < stems.length; i++) add("b:" + stems[i] + "_" + stems[i + 1], 0.5);
  let norm = 0;
  for (const w of raw.values()) norm += w * w;
  norm = Math.sqrt(norm) || 1;
  const vec = new Map([...raw].map(([k, w]) => [k, w / norm]));
  return { vec, slots, numbers: numbersOf(text), size: stems.length };
}
export function cosine(a, b) {
  let dot = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const [k, w] of small) { const o = large.get(k); if (o) dot += w * o; }
  return dot;
}
/** Compact, text-free form for storage: top weighted buckets as [id, weight*1000]. */
export function toSparse(vec, limit = 90) {
  return [...vec].sort((x, y) => y[1] - x[1]).slice(0, limit).map(([k, w]) => [k, Math.round(w * 1000)]);
}
export function fromSparse(list) {
  if (!Array.isArray(list)) return null;
  const map = new Map();
  let norm = 0;
  for (const item of list) {
    if (!Array.isArray(item) || !Number.isInteger(item[0]) || item[0] < 0 || item[0] >= BUCKETS ||
        !Number.isFinite(item[1]) || item[1] <= 0) return null;
    map.set(item[0], item[1] / 1000); norm += (item[1] / 1000) ** 2;
  }
  if (!map.size) return null;
  norm = Math.sqrt(norm);
  return new Map([...map].map(([k, w]) => [k, w / norm]));
}

/**
 * Can a stored scene stand for this utterance? Similarity is necessary, never sufficient.
 * Returns { ok, similarity, reason }.
 */
export function compatible(query, stored, { threshold }) {
  if (JSON.stringify(query.numbers) !== JSON.stringify(stored.numbers)) return { ok: false, reason: "numbers" };
  const q = query.slots, s = stored.slots;
  if (q.negated !== s.negated) return { ok: false, reason: "polarity" };
  if (q.direction && s.direction && q.direction !== s.direction) return { ok: false, reason: "direction" };
  if (q.population && s.population && q.population !== s.population) return { ok: false, reason: "population" };
  const similarity = cosine(query.vec, stored.vec);
  // One-sided population/direction mentions are ambiguous: demand a clearly closer match.
  const ambiguous = (q.population === null) !== (s.population === null) || (q.direction === null) !== (s.direction === null);
  const needed = ambiguous ? Math.max(threshold, 0.8) : threshold;
  return similarity >= needed ? { ok: true, similarity } : { ok: false, similarity, reason: "similarity" };
}
