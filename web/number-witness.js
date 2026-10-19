// "Number witness": a private nudge for the lecturer when a number they say aloud disagrees with a number
// written on the same slide about the same thing. It never edits the slide or the speech, and shows nothing
// unless the two numbers share a subject word and the same unit.
import { numeralizePercents } from "./director-brain.js";
import { contentWords } from "./semantic-index.js";
import { normalizeArabic } from "./director-core.js";

const ARABIC_INDIC = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9", "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9" };
const PERCENT_AFTER = /^(?:%|٪|بالمئه|بالمائه|بالميه|بالمايه)$/;
const CONTEXT_REACH = 3; // words on each side that name what the number is about

/** Numbers with their unit and the subject words around them. Years and standalone small counts are ignored. */
export function numberFacts(text) {
  const raw = numeralizePercents(String(text || "").replace(/[٠-٩۰-۹]/g, (d) => ARABIC_INDIC[d]).replace(/٫/g, "."));
  const tokens = raw.split(/[^\p{L}\p{N}%.٪]+/u).filter(Boolean).map((t) => ({ raw: t, norm: normalizeArabic(t) }));
  const facts = [];
  tokens.forEach((tok, i) => {
    const m = tok.raw.match(/^(\d+(?:\.\d+)?)(%|٪)?$/);
    if (!m) return;
    const value = Number(m[1]);
    const percent = Boolean(m[2]) || (tokens[i + 1] && PERCENT_AFTER.test(tokens[i + 1].norm));
    if (!percent && (value >= 1900 && value <= 2100 || value < 10)) return;
    const near = [...tokens.slice(Math.max(0, i - CONTEXT_REACH), i), ...tokens.slice(i + 1, i + 1 + CONTEXT_REACH)]
      .filter((t) => !/^\d/.test(t.raw) && !PERCENT_AFTER.test(t.norm)).map((t) => t.raw).join(" ");
    const subject = new Set(contentWords(near).map((w) => w.stem));
    facts.push({ value, unit: percent ? "%" : "", subject });
  });
  return facts;
}

/**
 * Compare what was just said with what the slide prints. Returns the first likely disagreement or null.
 * `slideText` should include the slide's visible text; notes are the lecturer's own and may be passed too.
 */
export function checkSpoken(spoken, slideText) {
  const said = numberFacts(spoken);
  if (!said.length) return null;
  const printed = numberFacts(slideText);
  if (!printed.length) return null;
  for (const s of said) {
    // If the slide also prints this exact number (with the same unit) the lecturer is simply quoting it.
    if (printed.some((p) => p.unit === s.unit && p.value === s.value && [...s.subject].some((w) => p.subject.has(w)))) continue;
    for (const p of printed) {
      if (p.unit !== s.unit || p.value === s.value) continue;
      const shared = [...s.subject].filter((w) => p.subject.has(w));
      if (!shared.length) continue;
      return { said: s.value, printed: p.value, unit: s.unit, about: shared.slice(0, 2) };
    }
  }
  return null;
}

/**
 * For published material: a number (with its unit) that the slide never prints although the slide prints other
 * numbers of that unit. Looser than checkSpoken (no shared subject needed), so it only prompts a human check.
 */
export function unmatchedNumber(shown, slideText) {
  const printed = numberFacts(slideText);
  for (const f of numberFacts(shown).filter((x) => x.unit === "%")) { // percentages only: plain counts legitimately vary
    const same = printed.filter((p) => p.unit === f.unit);
    if (same.length && !same.some((p) => p.value === f.value)) return { said: f.value, printed: same[0].value, unit: f.unit, about: [] };
  }
  return null;
}

export function witnessMessage(hit) {
  const unit = hit.unit;
  return `ذكرتَ ${hit.said}${unit} والشريحة تقول ${hit.printed}${unit}` + (hit.about.length ? ` (بخصوص: ${hit.about.join("، ")})` : "") + ". تنبيه لك وحدك.";
}

/** Remembers what was already flagged on a slide so one slip is reported once. */
export function createNumberWitness() {
  const seen = new Set();
  return {
    check(slideIndex, spoken, slideText) {
      const hit = checkSpoken(spoken, slideText);
      if (!hit) return null;
      const key = [slideIndex, hit.said, hit.printed, hit.unit, ...hit.about].join("|");
      if (seen.has(key)) return null;
      seen.add(key);
      return { ...hit, message: witnessMessage(hit) };
    },
    reset() { seen.clear(); },
  };
}
