// Curated discourse cues observed in Dr Ahmad Alfailakawi's public interview
// transcripts (Dr.Ahmad/src/data/media-archive-transcripts.json).
// These classify teaching MOVES, never claims, diagnoses, or speaker identity.
// The archive contains hosts/guests and transcription noise; it is NOT a voiceprint,
// speech recognizer, transcript-truth database, or a trained language model.
import { normalizeArabic } from "./director-core.js";

export function lecturerTeachingMove(utterance) {
  const original = String(utterance || "").trim();
  const t = normalizeArabic(original).toLowerCase().replace(/[\u064b-\u065f]/g, "");
  if (!t) return { kind: "none", designCue: "" };
  // Explicit personal conclusions outrank a contrast mentioned INSIDE the conclusion.
  if (/^(?:نصيحتي|رسالتي|خلاصه الكلام|الخلاصه|الزبده|المهم عندي|باختصار)/.test(t))
    return { kind: "takeaway", designCue: "أثر" };
  if (/(?:في المقابل|بالمقابل|لكن في المقابل|الفرق بين|شنو الفرق|فيه فرق|مو نفس|مب نفس|غير عن|على العكس)/.test(t))
    return { kind: "contrast", designCue: "مقابل" };
  if (/(?:علي سبيل الافتراض|علي سبيل المثال|مثلا|اتذكر مره|تخيل|لو نفرض|خلوني اعطيكم مثال)/.test(t))
    return { kind: "example", designCue: "حكاية" };
  if (/(?:نصيحتي|رسالتي|خلاصه الكلام|الخلاصه|الزبده|المهم عندي|المهم ان|باختصار)/.test(t))
    return { kind: "takeaway", designCue: "أثر" };
  if (/(?:شنو الفرق|شنو رايكم|ليش|شرايكم|تتوقعون|منو يعتقد)/.test(t))
    return { kind: "question", designCue: "سؤال" };
  if (/(?:بمعني|المقصود|يعني باختصار|ما اقصده|معناته|بمعنى اخر)/.test(t))
    return { kind: "explain", designCue: "معنى" };
  return { kind: "none", designCue: "" };
}

export function lecturerTakeaway(utterance) {
  const raw = String(utterance || "").trim().replace(/\s+/g, " ");
  const move = lecturerTeachingMove(raw);
  // Explicitly framed personal takeaways become optional editorial quotes.
  // Never rephrase a lecturer's words or introduce a percentage or citation.
  if (move.kind !== "takeaway" || raw.length < 25 || raw.length > 240) return null;
  const lead = normalizeArabic(raw.slice(0, 30));
  if (!/^(?:نصيحتي|رسالتي|خلاصه الكلام|الخلاصه|الزبده|المهم عندي|باختصار)/.test(lead)) return null;
  return { type: "quote", title: "الخلاصة", lines: [raw] };
}


// Explicit educational distinctions seen in the lecturer's public interviews.
// No speaker identification, voice training, or inferred unstated comparisons.
import { normalizeWithMap, rawSlice } from "./director-core.js";
const OPEN_QUESTION = /(?:^|\s)(?:شنو|ايش|وش|ما)\s+(?:هو\s+)?الفرق|[؟?]/u;
const CONTRAST_START = /^(?:لكن\s+)?(?:في\s+المقابل|بالمقابل)(?:\s|$)/u;
const BORDER = /^[\s،,:؛.!؟?\-]+|[\s،,:؛.!؟?\-]+$/gu;
const NOISE = new Set(["اليوم", "احنا", "عندنا", "عندكم", "عنده", "عندها", "يعني", "لكن", "المقابل", "مثال", "شويه", "ممكن", "من", "هذا", "وهذا", "كانت", "كان", "في", "على", "غير", "موجود", "كثير", "جدا", "اللي"]);
function exactSide(value) {
  const s = String(value || "").replace(BORDER, "").replace(/\s+/g, " ").trim();
  const count = s.split(/\s+/).filter(Boolean).length;
  return count >= 3 && count <= 16 && s.length <= 105 ? s : "";
}
function significantWords(s) {
  return new Set(normalizeArabic(s).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/)
    .map((w) => w.replace(/^(?:وال|بال|لل|ال)/, "").replace(/^و(?=\S{3,})/u, ""))
    .filter((w) => w.length >= 4 && !NOISE.has(w)));
}
/**
 * Extract only fully spoken comparison sides: "فرق بين أ وبين ب",
 * or a prior statement followed shortly by "لكن في المقابل ب".
 * For two utterances, the caller is responsible for time + slide continuity.
 * Always a suggestion, never evidence the comparison's contents are true.
 */
export function lecturerComparison(current, previous = "") {
  const raw = String(current || "").trim();
  const norm = normalizeWithMap(raw);
  if (!raw || OPEN_QUESTION.test(norm.text)) return null;
  const one = norm.text.match(/(?:^|\s)(?:الفرق|فرق|اختلاف)\s+(?:(?:كبير|كبيره)\s+)?(?:جدا\s+)?بين\s+(.+?)\s+وبين\s+(.+?)(?:[،.؛!?؟]|$)/u);
  if (one) {
    const a = one.index + one[0].indexOf(one[1]);
    const b = one.index + one[0].lastIndexOf(one[2]);
    const left = exactSide(rawSlice(norm, a, a + one[1].length));
    const right = exactSide(rawSlice(norm, b, b + one[2].length));
    if (left && right && normalizeArabic(left) !== normalizeArabic(right))
      return { type: "compare", title: "مقارنة", lines: [left + " | " + right] };
  }
  const before = String(previous || "").trim();
  if (!before || OPEN_QUESTION.test(normalizeArabic(before)) || !CONTRAST_START.test(norm.text)) return null;
  const left = exactSide(before);
  const right = exactSide(raw.replace(/^(?:لكن\s+)?(?:في\s+المقابل|بالمقابل)[\s،,:؛-]*/u, ""));
  if (!left || !right || normalizeArabic(left) === normalizeArabic(right)) return null;
  const words = significantWords(left);
  if (![...significantWords(right)].some((w) => words.has(w))) return null;
  return { type: "compare", title: "مقارنة", lines: [left + " | " + right] };
}


/**
 * Explicit "X لكن هي بالأصل Y" educational distinction. Both complete
 * statements are the lecturer's exact words, not inferred facts.
 */
export function lecturerRealityContrast(utterance) {
  const raw = String(utterance || "").trim();
  if (raw.length > 235 || /[|؟?]/u.test(raw)) return null;
  const hit = raw.match(/^(.+?)\s+(?:لكن|بس)\s+((?:هي|هو|هذا|هذي)\s+(?:(?:في\s+)?(?:الأصل|الاصل|الحقيقة|الحقيقه)|بالأصل|بالاصل|بالواقع)\s+.+)$/u);
  if (!hit) return null;
  const left = hit[1].trim(), right = hit[2].trim();
  const eligible = (s) => s.length >= 24 && s.length <= 115 && s.split(/\s+/).length >= 5 &&
    s.split(/\s+/).length <= 22 && !/^(?:ليش|شنو|منو|هل|كيف)\s/u.test(normalizeArabic(s));
  if (!eligible(left) || !eligible(right)) return null;
  return { type: "compare", title: "مقارنة", lines: [left + " | " + right] };
}
