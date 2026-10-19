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
  if (/(?:في المقابل|بالمقابل|لكن في المقابل|الفرق بين|شنو الفرق|فيه فرق|مو نفس|مب نفس|غير عن|على العكس)/.test(t))
    return { kind: "contrast", designCue: "مقابل" };
  if (/(?:على سبيل الافتراض|على سبيل المثال|على سبيل المثال|مثلا|اتذكر مره|تخيل|لو نفرض|خلوني اعطيكم مثال)/.test(t))
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
