// Pure, offline teaching-event detector. No network, no invented research.
import { extractSpokenSteps } from "./spoken-steps.js";
export function normalizeArabic(value) {
  return String(value || "").replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0))
    .replace(/٪/g, "%")
    .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[\u064b-\u065f]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * normalizeArabic() plus a map from each normalized character back to its position in the original, so that
 * whatever is matched on the normalized text can be SHOWN in the lecturer's own spelling (أ، ة، ى kept).
 */
export function normalizeWithMap(value) {
  const raw = String(value || "");
  let text = "", map = [], space = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (/[\u064b-\u065f]/.test(ch)) continue;
    if (/\s/.test(ch)) { space = text.length > 0; continue; }
    if (space) { text += " "; map.push(i - 1); space = false; }
    text += normalizeArabic(ch) || ch;
    map.push(i);
  }
  return { text, map, raw };
}
/** The original words behind normalized positions [start, end), digits and the percent sign made western. */
export function rawSlice({ raw, map }, start, end) {
  if (end <= start || start >= map.length) return "";
  return raw.slice(map[start], map[Math.min(end, map.length) - 1] + 1)
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/٪/g, "%").replace(/\s+/g, " ").trim();
}

export function interpretSpeech(utterance) {
  const raw = String(utterance || "").trim().slice(0, 950);
  if (!raw) return null;
  const norm = normalizeWithMap(raw);
  const text = norm.text;
  if (/(?:نرجع|نعود)\s+(?:الى\s+|الي\s+)?(?:للي|اللي|لي)\s+قبل|(?:نرجع|نعود)\s+(?:الى\s+|الي\s+)?(?:لل|ال)?موضوع\s+(?:ال)?سابق/.test(text)) {
    return { kind: "return-level", confidence: 0.9, utterance: raw };
  }
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
    const beforeAfter = /(?:^|\s)(?:قبل|كانت|كان)\s+(?:(?:ال)?نسبه(?:\s+[\p{L}]+){0,2}\s+)?$/u.test(prefix) &&
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
    // "25% يفضلون X مقارنة مع 60% يفضلون Y": two percentages with an explicit comparison word, each followed by
    // the lecturer's own words. Drawn as two bars labelled with those words; nothing is computed or inferred.
    const VERSUS = /(?:^|\s)(?:مقارنه|بالمقارنه|مقابل|بينما|في حين)(?:\s+(?:مع|ب|بـ))?(?:\s|$)/;
    if (!correction && VERSUS.test(connector)) {
      const cut = connector.search(VERSUS);
      const label1 = labelWords(norm, first.index + first[0].length, first.index + first[0].length + Math.max(0, cut));
      const label2 = labelWords(norm, second.index + second[0].length, clauseEnd(text, second.index + second[0].length));
      const values = [first, second].map((m) => m[1].replace(",", "."));
      if (values.every((v) => Number(v) >= 0 && Number(v) <= 100)) {
        const names = [label1 || "النسبة الأولى", label2 && label2 !== label1 ? label2 : "النسبة الثانية"];
        return { kind: "bars", confidence: 0.96, utterance: raw,
          spec: { type: "bars", title: "مقارنة النسب كما ذكرها المحاضر", lines: [`${names[0]} | ${values[0]}%`, `${names[1]} | ${values[1]}%`] } };
      }
    }
  }
  // Never show an arbitrary first value if two different percentages were discussed.
  const mention = percentages.length === 1 || (percentages.length > 1 && correction)
    ? percentages[percentages.length - 1] : null;
  if (mention && context.test(text)) {
    const number = mention[1].replace(",", ".") + "%";
    const value = Number(mention[1].replace(",", "."));
    if (Number.isFinite(value) && value >= 0 && value <= 100) {
      // The caption is the lecturer's own words right after the number ("25% من الطلاب يذاكرون بالليل").
      // Without any, a plain note of where the number came from (never an invented description).
      const after = labelWords(norm, mention.index + mention[0].length, clauseEnd(text, mention.index + mention[0].length), 9, 60);
      const caption = after && after.split(" ").length >= 2 ? after
        : /دراس/.test(text) ? "حسب دراسة ذكرها المحاضر" : /احصائ/.test(text) ? "حسب إحصائية ذكرها المحاضر" : "من حديث المحاضر — المصدر غير معروض";
      return {
        kind: "stat", confidence: 0.97, utterance: raw, dangling: /(?:مقارنه|بالمقارنه|مقابل)(?:\s+(?:مع|ب))?\s*[.،]?\s*$/.test(text),
        spec: { type: "stat", title: "إحصائية ذكرها المحاضر", lines: [number, caption] },
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

// End of the clause that follows a number: a comparison word, punctuation or the next number.
export function clauseEnd(text, from) {
  const rest = text.slice(from);
  const stop = rest.search(/[.،,؛!؟?]|\s(?:مقارنه|بالمقارنه|مقابل|بينما|في حين|لكن|بس|اما|و?\d)/);
  return from + (stop < 0 ? rest.length : stop);
}
// Up to `words` of the lecturer's own words between two normalized positions, shown in the original spelling.
export function labelWords(norm, start, end, words = 5, maxLen = 40) {
  let out = rawSlice(norm, start, end).replace(/^[\s،,:؛.\-]+|[\s،,:؛.\-]+$/gu, "");
  const list = out.split(/\s+/).filter(Boolean).slice(0, words);
  while (list.length && list.join(" ").length > maxLen) list.pop();
  return list.join(" ");
}

/** The single percentage in an utterance and the lecturer's words right after it, or null (none, or more than one). */
export function percentMention(utterance) {
  const norm = normalizeWithMap(String(utterance || "").slice(0, 950)), text = norm.text;
  const all = [...text.matchAll(/([0-9]+(?:[.,][0-9]+)?)\s*(%|بالمئه|بالمائه|بالميه|في الميه)/g)];
  if (all.length !== 1) return null;
  const value = Number(all[0][1].replace(",", "."));
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  const end = all[0].index + all[0][0].length;
  return { value: all[0][1].replace(",", ".") + "%", words: labelWords(norm, end, clauseEnd(text, end)) };
}

export function eligibleForCloud(event, utterance) {
  return Boolean(event && event.kind !== "return" && event.kind !== "stat" &&
    String(utterance || "").trim().length >= 16);
}
