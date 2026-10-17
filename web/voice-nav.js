// Spoken slide navigation. Deliberately strict: an utterance is a navigation command only when the WHOLE
// utterance is a short imperative ("الشريحة التالية", "السابقة", "روح للشريحة خمسة"). A sentence that merely
// mentions a slide ("في الشريحة التالية سنرى…") never matches. Pure and offline.
import { normalizeArabic } from "./director-core.js";

const FILLERS = new Set(["طيب", "يلا", "تمام", "الحين", "يعني", "بس", "خلونا", "خلنا", "لو", "سمحت", "ممكن", "اوكي", "اوك", "زين", "هاه"]);
const UNITS = { واحد: 1, واحده: 1, اثنين: 2, اثنان: 2, ثنتين: 2, ثلاثه: 3, ثلاث: 3, اربعه: 4, اربع: 4, خمسه: 5, خمس: 5, سته: 6, ست: 6,
  سبعه: 7, سبع: 7, ثمانيه: 8, ثماني: 8, ثمان: 8, تسعه: 9, تسع: 9, عشره: 10, عشر: 10 };
const TENS = { عشرين: 20, ثلاثين: 30, اربعين: 40, خمسين: 50, ستين: 60, سبعين: 70, ثمانين: 80, تسعين: 90 };

/** Spoken or digit number, 1–99, or null. */
export function parseNumber(text) {
  const t = normalizeArabic(text).replace(/\s+/g, " ").trim();
  if (/^\d{1,3}$/.test(t)) return Number(t);
  const words = t.split(" ");
  if (words.length === 1) return UNITS[words[0]] ?? TENS[words[0]] ?? null;
  // eleven…nineteen: "احد عشر"، "اثنا عشر"، "ثلاثه عشر"…
  if (words.length === 2 && /^عشر$/.test(words[1])) {
    const u = { احد: 1, احدى: 1, اثنا: 2, اثني: 2, اثنين: 2, ثلاثه: 3, اربعه: 4, خمسه: 5, سته: 6, سبعه: 7, ثمانيه: 8, تسعه: 9 }[words[0]];
    return u ? 10 + u : null;
  }
  const m = words.join(" ").match(/^(\S+) و(\S+)$/); // خمسه وعشرين
  if (m && UNITS[m[1]] && UNITS[m[1]] < 10 && TENS[m[2]]) return TENS[m[2]] + UNITS[m[1]];
  return null;
}

const VERB = "(?:(?:روح|انتقل|اذهب|خذنا|وديني|نروح|ننتقل|نبي|ابي|ابغي)\\s+)?";
const SLIDE = "(?:ال)?شريحه";
const NEXT = [
  new RegExp(`^${VERB}${SLIDE}\\s+(?:ال)?(?:تاليه|جايه|الجايه|بعدها)$`),
  /^(?:ال)?(?:تاليه|جايه)$/, new RegExp(`^${VERB}${SLIDE}\\s+اللي\\s+بعدها$`), /^next(?: slide)?$/,
];
const PREV = [
  new RegExp(`^${VERB}${SLIDE}\\s+(?:ال)?(?:سابقه|ورا|وراء)$`),
  /^(?:ال)?سابقه$/, new RegExp(`^${VERB}${SLIDE}\\s+(?:اللي|الي)\\s+قبل(?:ها)?$`), /^ارجع\s+شريحه(?:\s+وحده)?$/, /^previous(?: slide)?$/,
];
const FIRST = new RegExp(`^${VERB}(?:اول\\s+${SLIDE}|${SLIDE}\\s+(?:ال)?(?:اولي|اولى))$`);
const LAST = new RegExp(`^${VERB}(?:اخر\\s+${SLIDE}|${SLIDE}\\s+(?:ال)?(?:اخيره|اخيرة))$`);
const GOTO = new RegExp(`^${VERB}${SLIDE}\\s+(?:رقم\\s+)?(.+)$`);

/** -> { kind: "next"|"prev"|"first"|"last"|"goto", index? } or null. Never throws. */
export function interpretNav(utterance, { maxWords = 6 } = {}) {
  let t = normalizeArabic(String(utterance || "")).toLowerCase().replace(/[.,!?؟،"«»]/g, " ").replace(/\s+/g, " ").trim();
  if (!t || t.length > 60) return null;
  t = t.replace(/(^|\s)لل(?=شريحه)/g, "$1ال").replace(/\s(?:الى|الي)\s/g, " ").replace(/^(?:الى|الي)\s/, "");
  let words = t.split(" ");
  while (words.length && FILLERS.has(words[0])) words.shift();
  while (words.length && FILLERS.has(words.at(-1))) words.pop();
  if (!words.length || words.length > maxWords) return null;
  t = words.join(" ");
  if (NEXT.some((re) => re.test(t))) return { kind: "next" };
  if (PREV.some((re) => re.test(t))) return { kind: "prev" };
  if (FIRST.test(t)) return { kind: "first" };
  if (LAST.test(t)) return { kind: "last" };
  const g = t.match(GOTO);
  if (g) { const n = parseNumber(g[1]); if (n !== null && n >= 1) return { kind: "goto", index: n }; }
  return null;
}
