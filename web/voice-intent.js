// Natural Kuwaiti/Gulf slide language. Commands are deliberately anchored:
// a lecturer DISCUSSING a future/previous slide must never move the deck.
// No network/API; speech-to-text remains the browser's responsibility.
import { normalizeArabic } from "./director-core.js";
import { interpretNav } from "./voice-nav.js";

const clean = (value) => normalizeArabic(value).toLowerCase()
  .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
  .replace(/[،؛.!?؟:"«»]/g, " ")
  .replace(/\s+/g, " ").trim();

const begin = /^(?:(?:زين|طيب|تمام|اوكي|يلا|الحين|خلاص|بس|لو سمحت|ممكن|عقب هالكلام)\s+){0,3}/;
const directive = /^(?:(?:خلنا|خلونا|ودنا|ابي|ابغي|نبي|ياريت|ممكن)\s+)?(?:(?:نروح|روح|خل نروح|نتحول|حول|ننتقل|انتقل|ودنا نروح|خذنا|وديني|ودنا ننتقل|ورني|اعرض|طلع|نفتح|افتح|نقلب|قلب)\s+)?(?:لل|ل|علي|الى|في|ب)?\s*/;
const slide = /(?:(?:ال)?(?:شريحه|صفحه|سلايد)\s+)?/;
const ahead = /(?:(?:للي|اللي|الي)\s+)?(?:بعدها|عقبها|وراها|الجايه|التاليه|اليايه|القادمه)/;
const behind = /(?:(?:اللي|الي)\s+)?(?:قبلها|قبل|ورا|السابقه|اللي طافت)/;
function anchoredDirection(t, direction) {
  const tail = direction === "next" ? ahead.source : behind.source;
  return new RegExp("^" + directive.source.slice(1) + slide.source + tail + "$").test(t);
}

/** The existing strict commands remain valid; richer sentences must still be unambiguous. */
export function interpretNaturalNav(utterance) {
  const strict = interpretNav(utterance);
  if (strict) {
    // A named slide is an explicit slide transition, never an animation/build click.
    // The standalone "التالية"/"السابقة" keeps the established single-build behavior.
    const spoken = clean(utterance);
    if (strict.kind === "next" || strict.kind === "prev")
      return { ...strict, skipBuilds: /(?:شريحه|صفحه|سلايد)/.test(spoken) };
    return strict;
  }
  let t = clean(utterance);
  if (!t || t.length > 145 || t.split(" ").length > 17) return null;
  if (/^(?:لا|مو|لاتروح|ما نبي|ما ابي|بدون|لازم ما)\b/.test(t)) return null;
  t = t.replace(begin, "").trim();
  if (!t) return null;
  // Explicit slide changes bypass remaining animation build clicks; "التالي" still advances one click.
  if (anchoredDirection(t, "next")) return { kind: "next", skipBuilds: /(?:شريحه|صفحه|سلايد)/.test(t) };
  if (anchoredDirection(t, "prev")) return { kind: "prev", skipBuilds: /(?:شريحه|صفحه|سلايد)/.test(t) };
  // Common direct classroom transitions, not narrative mentions of another slide.
  if (/^(?:خلصنا\s+(?:من\s+)?(?:هذي|هذه|هالشريحه)\s+)?(?:خلنا|خلونا|نبي|ودنا|ابي)\s+(?:نكمل|نروح|ننتقل)\s+(?:ب|ل|الى|على)?\s*(?:ال)?شريحه\s+(?:اللي\s+)?(?:بعدها|عقبها|الجايه|التاليه|اليايه)$/.test(t)) {
    return { kind: "next", skipBuilds: true };
  }
  return null;
}

/** A distinct intent: finish a visual digression and restore the exact original slide/click/video state. */
export function interpretStageReturn(utterance) {
  let t = clean(utterance);
  if (!t || t.length > 145 || t.split(" ").length > 18) return null;
  if (/^(?:لو|اذا|عشان|مثلا|على سبيل|كنا|يوم)\s/.test(t)) return null;
  t = t.replace(begin, "").trim();
  if (!t) return null;
  if (/^(?:(?:نرجع|ارجع|خلنا نرجع|خلونا نرجع|ردنا|ردني|نعود)\s+(?:ل|الي|الى)?\s*(?:اللي|الي|للي)\s+قبل|(?:ارجع|نرجع)\s+(?:خطوه|مرحله)\s+(?:وحده|واحده)?)$/.test(t)) return "return-level";
  const exact = [
    /^(?:نرجع|نرد|نعود|ارجع|ردني|ردنا|خلنا نرجع|خلونا نرجع|ودي ارجع|ابي ارجع)\s+(?:لل|ل|الى|الي|على)?\s*(?:(?:ال)?(?:عرض|بوربوينت|درس|شرح|موضوع)(?:نا|ي| الاصلي)?|(?:ال)?شريحه\s+(?:ال)?(?:اصليه|اساسيه|اللي كنا فيها|الحاليه|نفسها))$/,
    /^(?:نرجع|ارجع|ردني|ورني|طلع|اعرض)\s+(?:لل|ل|الى|الي|على)?\s*(?:ال)?شريحه\s+(?:ال)?(?:اصليه|اساسيه|نفسها)$/,
    /^(?:خلاص\s+)?(?:نكمل|خلنا نكمل|خلونا نكمل|نواصل|خلنا نواصل|نرد|نرجع)\s+(?:(?:ال)?(?:درس|شرح|موضوع|عرض)(?:نا|ي)?|من\s+وين\s+وقفنا|مثل\s+ما\s+كنا)$/
  ];
  if (/^(?:ارجع|نرجع|ردني|رجعني) لنفس (?:ال)?شريحه$/.test(t)) return "return";
  if (exact.some((re) => re.test(t))) return "return";
  if (/^(?:خلاص\s+)?(?:خلنا|خلونا|يلا|الحين)\s+(?:نكمل|نواصل|نرجع)$/.test(t)) return "return";
  // Longer, but still clearly addressed to the projector: avoids "لو نرجع للعصر الحجري" false triggers.
  if (/^(?:خلصنا\s+(?:من\s+)?(?:المثال|القصه|النشاط|الاستطراد)(?:\s+هذا)?\s+)?(?:يلا\s+)?(?:نرجع|نرد|نكمل)\s+(?:لل|ل)?(?:(?:ال)?(?:عرض|شرح|درس|شريحه)(?:نا)?)(?:\s+(?:الاصلي|الحين|الاصليه))?$/.test(t)) return "return";
  return null;
}
