// Icon library and "few words" labels for the vector scenes.
// Icons are simple 24-grid line drawings chosen by keywords in the lecturer's own text. Labels are EXTRACTIVE:
// a few of the lecturer's own words, in order, never new words. The full text always stays in the scene
// (as the item's <title> and data-full), so nothing the lecturer said is lost.
import { normalizeArabic } from "./director-core.js";

export const ICON_PATHS = {
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.3 1 2.1h5c0-.8.4-1.6 1-2.1A6 6 0 0 0 12 3z",
  target: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0zM13 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0z",
  book: "M4 5h7a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H4zM20 5h-7a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h8z",
  users: "M12.5 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.4M18.5 14.2A6.5 6.5 0 0 1 21.5 20",
  chat: "M4 5h16v11H9.5L5 20v-4H4z",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM12 7v5l3 2",
  chart: "M4 20V11M10 20V4M16 20v-6M22 20H2",
  check: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM8 12l3 3 5-6",
  gear: "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1",
  heart: "M12 20s-8-5.3-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 9c0 5.7-8 11-8 11z",
  trophy: "M8 4h8v5a4 4 0 0 1-8 0zM8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 13v4M8 21h8M9 17h6",
  game: "M6 8h12a3 3 0 0 1 3 3v3a3 3 0 0 1-5 2l-1-1H9l-1 1a3 3 0 0 1-5-2v-3a3 3 0 0 1 3-3zM8 10.5v3M6.5 12h3M16 11.5h.01M18 13.5h.01",
  phone: "M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2",
  laptop: "M5 6h14v9H5zM3 19h18",
  question: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01",
  warning: "M12 4l9 16H3zM12 10v4M12 17h.01",
  search: "M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0zM16 16l5 5",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",
  rocket: "M12 3c3 2 5 5 5 9l-2 3H9l-2-3c0-4 2-7 5-9zM9 15l-3 4 4-1M15 15l3 4-4-1M12 9h.01",
  brain: "M9 5a3 3 0 0 0-3 3 3 3 0 0 0-1 5 3 3 0 0 0 4 4zM15 5a3 3 0 0 1 3 3 3 3 0 0 1 1 5 3 3 0 0 1-4 4zM12 5v12",
  pencil: "M4 20l1-4L16 5l3 3L8 19zM14 7l3 3",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  globe: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  money: "M12 3v18M16 7.5A4 3 0 0 0 12 6c-2.5 0-4 1-4 2.5S9.5 11 12 11.5s4 1 4 2.5-1.5 2.5-4 2.5a4 3 0 0 1-4-1.5",
  school: "M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5M22 9v6",
  moon: "M20 14A8 8 0 1 1 10 4a6.5 6.5 0 0 0 10 10z",
  trend: "M3 17l6-6 4 4 8-8M15 7h6v6",
  scale: "M12 4v16M5 8h14M5 8l-3 7a3 3 0 0 0 6 0zM19 8l-3 7a3 3 0 0 0 6 0z",
  doc: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M12 8l1.5 2.5L16 12l-2.5 1.5L12 16l-1.5-2.5L8 12l2.5-1.5z",
};

// First match wins, so the more specific words come first. Words are matched on normalised Arabic.
const RULES = [
  ["game", /(لعب|العاب|لعبه|محاكاه)/], ["trophy", /(مكافا|جايزه|جائزه|فوز|تميز|منافس|نقاط|تحدي)/],
  ["phone", /(جوال|هاتف|موبايل)/], ["laptop", /(حاسوب|كمبيوتر|انترنت|تقني|تكنولوج|رقمي|منصه|برنامج)/],
  ["money", /(تكلفه|مال|سعر|ميزانيه|دولار|ريال|دينار)/], ["shield", /(امان|خصوصيه|حمايه|سريه)/],
  ["moon", /(نوم|سهر|ليل|ارق)/], ["warning", /(خطر|تحذير|خطا|مخاطر|صعوب|عقبه|مشكله)/],
  ["question", /(لماذا|كيف|ماذا|تساول|سوال|اسيله|اسئله)/], ["scale", /(مقارنه|فرق|مقابل|توازن)/],
  ["heart", /(دافع|حماس|شغف|رغبه|مشاعر|رضا|سعاد|اهتمام|حب|حفز|تحفيز|محفز)/], ["target", /(هدف|اهداف|غايه|تركيز)/],
  ["clock", /(وقت|ساع|دقايق|دقائق|مده|زمن)/], ["calendar", /(اسبوع|شهر|جدول|موعد|سنه|فصل|يوم)/],
  ["trend", /(ارتفاع|زياده|ازدياد|نمو|تحسن|تطور)/], ["chart", /(نسبه|احصاء|بيانات|نتايج|نتائج|ارقام|تحليل)/],
  ["search", /(بحث|استكشاف|اكتشاف|فحص|مراجعه)/], ["eye", /(مشاهده|ملاحظ|انتباه|رؤيه)/],
  ["brain", /(تفكير|ذهن|عقل|معرفه|ادراك|ذاكره|فهم|استيعاب)/], ["pencil", /(كتابه|تدوين|واجب|تمرين|اختبار|تقييم|تقويم)/],
  ["school", /(جامعه|مدرسه|كليه|قاعه|تعليم|تدريس)/], ["book", /(كتاب|قراءه|مقرر|دراس|تعلم|درس|محتوي|مرجع)/],
  ["chat", /(نقاش|حوار|تغذيه\s+(ال)?راجعه|تواصل|تعليق|ناقش)/], ["users", /(طلاب|طلبه|طالب|فريق|جماعي|مجموع|تعاون|مشارك|مجتمع|اجتماع|دعم|اسره|اصدقاء|زميل)/],
  ["bulb", /(فكره|افكار|ابتكار|ابداع|اختراع|فكر)/], ["globe", /(عالم|دول|ثقاف|لغه|محلي)/],
  ["rocket", /(تطوير|انطلاق|اطلاق)/], ["flag", /(بدايه|بدء|مقدمه)/], ["star", /(مميز|افضل|جوده|ممتاز)/],
  ["gear", /(عمليه|تنفيذ|تطبيق|اجراء|نظام|اداه|ادوات|خطوه)/], ["check", /(نجاح|انجاز|تحقق|اكتمل|صحيح|نتيجه)/],
  ["doc", /(ملف|وثيقه|تقرير|ورقه|مستند)/],
];

/** Icon key for a piece of lecturer text. With no keyword match the neutral "spark" is used, never an icon that could suggest a wrong meaning. */
export function pickIcon(text) {
  const t = normalizeArabic(text).toLowerCase();
  for (const [key, re] of RULES) if (re.test(t)) return key;
  return "spark";
}

/** The icon as SVG centred on (cx, cy); `size` is the drawn width in px. Callers wrap it in a <g class="m-…"> if animated. */
export function iconSvg(key, cx, cy, size = 40, color = "#3e5c78") {
  const d = ICON_PATHS[key] || ICON_PATHS.star;
  const scale = size / 24;
  return `<path d="${d}" transform="translate(${(cx - size / 2).toFixed(1)} ${(cy - size / 2).toFixed(1)}) scale(${scale.toFixed(3)})" fill="none" stroke="${color}" stroke-width="${(1.7 + (1 - Math.min(1, scale)) * 0.4).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

const FILLER = new Set(["في", "من", "على", "عن", "الى", "إلى", "الي", "ان", "أن", "إن", "انه", "أنه", "كان", "كانت", "يكون", "تكون", "ثم", "قد", "هو", "هي", "هذا", "هذه", "ذلك", "اللي", "التي", "الذي", "مع", "و"]);

/**
 * A few of the lecturer's own words (default 4), in their order. Connective words are dropped first; if it is still
 * longer, the first words are kept. Nothing is reworded and nothing is added.
 */
export function shortLabel(text, maxWords = 4) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  const kept = words.filter((w) => !FILLER.has(w));
  return (kept.length ? kept : words).slice(0, maxWords).join(" ");
}
