// The scene stylist: reads what the lecturer said, picks a design world and a layout for it, and avoids repeating itself.
// Deterministic (same text + same history = same choice), local, no AI call. It chooses a LOOK only; it never writes words.
// The semantic verbs and the Arabic patterns come from the lecturer's design-worlds library (world-semantics.ts).
import { WORLDS } from "./design-worlds.js";
import { worldName } from "./world-theme.js";
import { brightness, hueOf, hslOf } from "./color-math.js";
import { VARIANTS } from "./scene-variants.js";

const RULES = [
  ["balance", /(عدل|عدالة|توازن|ضمير|أخلاق|اخلاق|إنصاف|انصاف)/],
  ["root", /(جذر|جذور|أصل|اصول|هوية|غرس|طفل|تربية|ينمو|نمو)/],
  ["split", /(بلا |لكن|بينما|مقابل|انقسام|فجوة|ليس |ليست |تناقض|ضد|مو |بس )/],
  ["question", /(؟|لماذا|كيف|ماذا|هل |سؤال|ليش|شلون)/],
  ["rise", /(نهض|نهوض|يصعد|صعود|ارتفع|تقدّم|تقدم|مستقبل|طموح|يزيد|زيادة)/],
  ["echo", /(ذاكرة|ذكرى|أثر|اثر|استمرار|يبقى|تاريخ|تذكر)/],
  ["breathe", /(صمت|هدوء|سكينة|مسافة|تأمل|تامل|راحة)/],
  ["connect", /(شبك|اتصال|تواصل|علاقة|مجتمع|فريق|ربط|بيانات|ذكاء|تعاون)/],
  ["weave", /(نسيج|سدو|خيط|حكاية|سرد|ثقافة|قصة)/],
  ["orbit", /(مدار|كون|كوكب|دورة|منظومة|نظام|حول)/],
  ["pulse", /(نبض|قلب|حياة|شعور|إنسان|انسان|عاطف|حماس|دافع)/],
  ["path", /(طريق|مسار|رحلة|اتجاه|قرار|خطوة|مرحلة)/],
  ["fracture", /(كسر|صدع|أزمة|ازمة|فشل|خطأ|خطا|مشكلة)/],
  ["protect", /(أمان|امان|حماية|آمن|امن|خصوصية|ثقة)/],
  ["liberate", /(حرية|تحرر|قيد|يفرض)/],
  ["confront", /(خطر|تحذير|ضجيج|صراع|مواجهة|تحدي)/],
  ["transform", /(تحول|يتحول|يصبح|تصبح|تغيير|يتغير|تطوير)/],
  ["gather", /(يجمع|تجتمع|دليل|أدلة|ادلة|برهان|استنتاج|معلومات|أصوات|اصوات|ملخص)/],
  ["dissolve", /(يختفي|تلاشي|ينحسر|ذوبان|نسيان)/],
  ["reveal", /(يكشف|يظهر|حقيقة|معنى|نفهم|نرى|اكتشاف|تعريف)/],
];
const TONES = [
  [/صمت|هدوء|تأمل|راحة/, ["تأملي", "هادئ", "صامت", "شاعري"]],
  [/خطر|أزمة|صراع|فشل|مشكلة|تحذير/, ["حاد", "درامي", "إنذاري", "ترقبي"]],
  [/طفل|إنسان|عاطف|قلب|حنين|حب|فقد|طالب/, ["إنساني", "دافئ", "حميمي", "عاطفي"]],
  [/دليل|بحث|تقييم|دراسة|نتائج|إحصائ|نسبة/, ["معرفي", "أكاديمي", "دقيق", "تحليلي"]],
  [/مستقبل|نهض|فرصة|ابتكار|تقنية|ذكاء/, ["متفائل", "مستقبلي", "تقني", "حداثي"]],
  [/مرح|لعبة|نشاط|سؤال|ليش|شلون/, ["حواري", "فضولي", "حي", "تعليمي"]],
];

// What the sentence is about picks the accent hue (not the world's own colour): trouble is warm red, growth green, connection blue...
const VERB_HUE = { fracture: 8, confront: 14, split: 22, rise: 140, root: 120, path: 160, connect: 215, question: 265, gather: 200, reveal: 38, echo: 30,
  balance: 175, protect: 190, pulse: 345, transform: 280, weave: 320, orbit: 235, breathe: 150, liberate: 95, dissolve: 205 };
const hueNear = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d) < 25; };

/** What the text is about, as a design verb and a few moods. Pure. */
export function analyzeText(text) {
  const t = String(text || "");
  let verb = "reveal", best = 0;
  for (const [v, re] of RULES) { const n = (t.match(new RegExp(re.source, "g")) || []).length; if (n > best) { best = n; verb = v; } }
  const moods = TONES.filter(([re]) => re.test(t)).flatMap(([, m]) => m);
  return { verb, moods, matched: best > 0 };
}

function hash(text) { let h = 2166136261; for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }
const hueBucket = (w) => { const h = hueOf(w.colors[4]); return h < 0 ? -1 : Math.round(h / 40) % 9; };
const isDark = (w) => brightness(w.colors[0]) < 0.47;
export const LIGHT_WORLDS = WORLDS.filter((w) => !isDark(w));

/**
 * Pick a world and a layout. `history` is newest-first: [{w: worldId, f: family, p: post, m: motion, h: hueBucket, t: type, v: variant}].
 * A world used in the last 12 scenes is nearly excluded; family, layout archetype, motion and hue of the last 4 are discouraged.
 */
export function pickStyle({ type, text, allowDark = false, history = [] }) {
  const { verb, moods } = analyzeText(text);
  const pool = allowDark ? WORLDS : LIGHT_WORLDS;
  let best = null;
  for (const w of pool) {
    let score = hash(text + "|" + w.id) * 1.5;
    const at = w.semantic.indexOf(verb);
    if (at >= 0) score += at === 0 ? 4 : 3;
    score += 1.5 * w.mood.filter((m) => moods.includes(m)).length;
    const bucket = hueBucket(w);
    history.slice(0, 80).forEach((h, i) => {
      if (h.w === w.id) score -= i < 12 ? 20 : 8;
      if (i < 4) {
        if (h.f === w.family) score -= 3;
        if (h.p === w.post) score -= 2.5;
        if (h.m === w.motion[0]) score -= 2.5;
        if (bucket >= 0 && h.h === bucket) score -= 2.5;
      }
    });
    if (!best || score > best.score) best = { w, score };
  }
  // The accent hue follows the meaning (only when the text matched one); it is rotated if the last two scenes already used that colour.
  let hue = null;
  if (analyzeText(text).matched) {
    hue = Math.round((VERB_HUE[verb] + (hash(text + "~") - 0.5) * 36 + 360) % 360);
    for (let k = 0; k < 8 && history.slice(0, 2).some((h) => h.hue !== undefined && hueNear(h.hue, hue)); k++) hue = (hue + 35) % 360;
  }
  return { world: best.w, hue, theme: worldName(best.w.id, hue ?? undefined), variant: pickVariant(type, text, history), verb };
}

/** The least recently overused layout of this type; never the same as the previous scene of that type. */
export function pickVariant(type, text, history = []) {
  const count = VARIANTS[type] || 1;
  if (count < 2) return 0;
  const recent = history.filter((h) => h.t === type).slice(0, 6);
  const order = Array.from({ length: count }, (_, v) => v).map((v) => ({ v, n: recent.filter((h) => h.v === v).length, last: recent[0]?.v === v, r: hash(text + "#" + v) }));
  order.sort((a, b) => a.last - b.last || a.n - b.n || a.r - b.r);
  return order[0].v;
}

// ---- memory of what was shown, across scenes and lectures (this browser only) ----
const KEY = "alfa-style-memory-v1", LIMIT = 80;
const store = (custom) => { if (custom) return custom; try { return globalThis.localStorage || null; } catch { return null; } };
export function loadHistory(storage) {
  try { const v = JSON.parse(store(storage)?.getItem(KEY) || "[]"); return Array.isArray(v) ? v.filter((x) => x && typeof x === "object").slice(0, LIMIT) : []; } catch { return []; }
}
export function entryOf(style, type) {
  const w = style.world;
  return w ? { w: w.id, f: w.family, p: w.post, m: w.motion[0], h: style.hue != null ? Math.round(style.hue / 40) % 9 : hueBucket(w), hue: style.hue ?? undefined, t: type, v: style.variant } : { w: style.theme || "fixed", t: type, v: style.variant };
}
export function saveHistory(entry, storage, history = loadHistory(storage)) {
  const next = [entry, ...history].slice(0, LIMIT);
  try { store(storage)?.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: variety then only lasts for this page */ }
  return next;
}

/**
 * Style one scene spec. `mode` is the lecturer's colour choice: "auto" (light worlds), "auto-all" (light and dark worlds)
 * or a fixed theme name. A fixed theme keeps its colours, but the layout still rotates so scenes do not repeat.
 */
export function styleScene(spec, { mode = "auto", storage, history, sourceSpeech = "" } = {}) {
  const past = history || loadHistory(storage);
  // Use the lecturer's actual explanation for visual tone/layout, not just an extracted
  // 3-word caption. Speech is NEVER added to the visible slide or stored as a prompt.
  const text = [sourceSpeech, spec.title, ...(spec.lines || [])].join(" ").slice(0, 1000);
  const auto = mode === "auto" || mode === "auto-all";
  const picked = auto ? pickStyle({ type: spec.type, text, allowDark: mode === "auto-all", history: past })
    : { theme: mode, world: null, variant: pickVariant(spec.type, text, past) };
  const out = { ...spec, theme: picked.theme };
  if (picked.variant) out.variant = picked.variant; else delete out.variant;
  saveHistory(entryOf(picked, spec.type), storage, past);
  return out;
}
