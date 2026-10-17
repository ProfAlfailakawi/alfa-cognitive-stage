// Small, deterministic text screening for anonymous student input (questions, single words).
// It protects privacy (phone numbers, emails, civil IDs, links) and hides plainly abusive or
// spam text for lecturer review. It is NOT a complete profanity filter: lecturer review stays the real control.
const digits = (s) => String(s).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0));
const fold = (s) => digits(s).toLowerCase()
  .replace(/[ً-ٟـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
  .replace(/(.)\1{2,}/gu, "$1$1").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
// Clearly abusive phrases only (words with legitimate teaching uses, e.g. "كلب" in Pavlov's experiment, are NOT listed).
const ABUSE = ["ابن الكلب", "يلعن", "لعنه الله", "عاهر", "قحبه", "منيوك", "ابن الحرام", "كس امك", "كسمك", "زبي", "اخرس", "fuck", "shit", "bitch", "asshole"];

export function moderate(input) {
  const raw = String(input ?? "");
  const reasons = [];
  const normalized = fold(raw);
  const compact = digits(raw).replace(/[\s().\-_]/g, "");
  if (!normalized) return { ok: false, reasons: ["empty"], privacy: false };
  if (/\d{8,}/.test(compact) || /\+\d{6,}/.test(compact)) reasons.push("pii-number");
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(raw)) reasons.push("pii-email");
  if (/https?:\/\/|www\.|(?:^|\s)[\w-]+\.(?:com|net|org|kw|me|ly|io|app|info)\b/i.test(raw)) reasons.push("link");
  const squash = (t) => t.replace(/(.)\1+/gu, "$1"); // "يلعننن" -> "يلعن", "fuuuck" -> "fuck"-like
  const padded = " " + squash(normalized) + " ";
  if (ABUSE.some((w) => padded.includes(" " + squash(fold(w)) + " ") || (w.includes(" ") && padded.includes(squash(fold(w)))))) reasons.push("abuse");
  const words = normalized.split(" ");
  const counts = new Map();
  for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);
  if ([...counts.values()].some((n) => n >= 5 && words.length >= 5) || /(.)\1{7,}/u.test(raw) || !/\p{L}/u.test(normalized)) reasons.push("spam");
  const privacy = reasons.some((r) => r.startsWith("pii") || r === "link");
  return { ok: reasons.length === 0, reasons, privacy };
}

/** Normalised single-word key for word clouds: no diacritics, definite article folded, bounded length. */
export function wordKey(input) {
  if (String(input ?? "").trim().length > 24) return null;
  const w = fold(input).replace(/^(?:ال|لل)(?=.{3})/, "");
  return w.length >= 2 && w.length <= 24 && !w.includes(" ") ? w : null;
}
