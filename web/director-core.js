// Pure, offline teaching-event detector. No network, no invented research.
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
  const percentages = [...text.matchAll(/([0-9]+(?:[.,][0-9]+)?)\s*(%|بالمئه|بالمائه|بالميه|في الميه)/g)];
  const correction = /(عفوا|اقصد|التصحيح|اصحح|مو قصدي|بل الصحيح)/.test(text);
  // Never show an arbitrary first value if two different percentages were discussed.
  const mention = percentages.length === 1 || (percentages.length > 1 && correction)
    ? percentages[percentages.length - 1] : null;
  const context = /(نسبه|دراس|احصائ|بحث|مشارك|طلب|طلاب|طالب|نتيج|اظهر|اشار|تشير|وصلت|بلغت|ارتفعت|انخفضت)/;
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
