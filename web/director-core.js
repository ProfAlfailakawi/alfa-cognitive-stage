// Pure, offline teaching-event detector. No network, no invented research.
import { extractSpokenSteps } from "./spoken-steps.js";
export function normalizeArabic(value) {
  return String(value || "").replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0))
    .replace(/٪/g, "%")
    .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[\u064b-\u065f]/g, "").replace(/\s+/g, " ").trim();
}

export function interpretSpeech(utterance) {
  const raw = String(utterance || "").trim().slice(0, 950);
  if (!raw) return null;
  const text = normalizeArabic(raw);
  if (/(نرجع|نعود|نرد|خلونا نرجع|نكمل درسنا|نرجع لموضوع|نرجع للعرض)/.test(text)) {
    return { kind: "return", confidence: 0.96, utterance: raw };
  }
  const spokenSteps = extractSpokenSteps(raw);
  if (spokenSteps) return { kind: "steps", confidence: 0.96, utterance: raw, spec: spokenSteps };
  const percentages = [...text.matchAll(/([0-9]+(?:[.,][0-9]+)?)\s*(%|بالمئه|بالمائه|بالميه|في الميه)/g)];
  const correction = /(عفوا|اقصد|التصحيح|اصحح|مو قصدي|بل الصحيح)/.test(text);
  const context = /(نسبه|دراس|احصائ|بحث|مشارك|طلب|طلاب|طالب|نتيج|اظهر|اشار|تشير|وصلت|بلغت|ارتفعت|انخفضت)/;
  // Two distinct percentages form one safe comparison ONLY when their relationship
  // was stated in order. Never silently choose the first number or invent a delta.
  if (percentages.length === 2 && !correction && context.test(text)) {
    const [first, second] = percentages;
    const prefix = text.slice(Math.max(0, first.index - 32), first.index);
    const connector = text.slice(first.index + first[0].length, second.index);
    const fromTo = /(?:^|\s)من\s*$/.test(prefix) && /^\s*(?:الى|الي)\s*$/.test(connector);
    const beforeAfter = /(?:^|\s)(?:قبل|كانت|كان)\s+(?:النسبه\s*|نسبه\s*)?$/.test(prefix) &&
      /^\s*(?:وصارت|صارت|وبعد|بعد|ثم صارت|وبعدين صارت)\s*$/.test(connector);
    const left = Number(first[1].replace(",", "."));
    const right = Number(second[1].replace(",", "."));
    if ((fromTo || beforeAfter) && [left, right].every((n) => Number.isFinite(n) && n >= 0 && n <= 100) &&
        left !== right &&
        !(/ارتفعت|زادت/.test(text) && right < left) &&
        !(/انخفضت|قلت/.test(text) && right > left)) {
      const a = first[1].replace(",", ".") + "%";
      const b = second[1].replace(",", ".") + "%";
      return { kind: "compare", confidence: 0.96, utterance: raw,
        spec: { type: "compare", title: "مقارنة النسب كما ذكرها المحاضر",
          lines: [fromTo ? `من ${a} | إلى ${b}` : `كانت ${a} | صارت ${b}`] } };
    }
  }
  // Never show an arbitrary first value if two different percentages were discussed.
  const mention = percentages.length === 1 || (percentages.length > 1 && correction)
    ? percentages[percentages.length - 1] : null;
  if (mention && context.test(text)) {
    const number = mention[1].replace(",", ".") + "%";
    const value = Number(mention[1].replace(",", "."));
    if (Number.isFinite(value) && value >= 0 && value <= 100) {
      return {
        kind: "stat", confidence: 0.97, utterance: raw,
        spec: { type: "stat", title: "إحصائية ذكرها المحاضر",
          lines: [number, "من حديث المحاضر — المصدر غير معروض"] },
      };
    }
  }
  if (/(بقولكم قصه|احكيلكم قصه|بعطيكم قصه|خلوني احكي|كان في شخص|كان هناك شخص)/.test(text)) {
    return { kind: "story", confidence: 0.89, utterance: raw };
  }
  if (/(الفرق بين|نقارن بين|مقارنه بين|يختلف عن|الاختلاف بين)/.test(text)) {
    return { kind: "compare", confidence: 0.82, utterance: raw };
  }
  if (/(تتوقعون|شنو رايكم|ما رايكم|منو يعتقد|هل تعتقدون)/.test(text)) {
    return { kind: "question", confidence: 0.81, utterance: raw };
  }
  return null;
}

export function eligibleForCloud(event, utterance) {
  return Boolean(event && event.kind !== "return" && event.kind !== "stat" &&
    String(utterance || "").trim().length >= 16);
}
