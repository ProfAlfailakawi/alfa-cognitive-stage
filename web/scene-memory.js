// Local, no-API approved scene memory. Private to this browser profile and origin.
// Matching is semantic within a local lexicon (semantic-index.js) AND must pass numeric, population,
// polarity and direction guards. Not a neural model and not a multi-device synchronization mechanism.
import { normalizeArabic } from "./director-core.js";
import { validateSpec } from "./infographic.js";
import { embed, toSparse, fromSparse, compatible, numbersOf } from "./semantic-index.js";

const PREFIX = "alfa-approved-scenes-v1:";
const GLOBAL_KEY = "alfa-approved-scenes-cross-v1";
const GLOBAL_LIMIT = 150;
const IGNORE = new Set(["في","من","عن","على","الى","ان","انها","هو","هي","هذا","هذه","اللي","كان","انه","وش","شنو","علشان","خلال","اخر","قلت","خلونا","عندنا","المحاضر","دراسه","ذكر","ذكرت","تشير","اليوم","الطلبه","الطلاب","مثلا","يمكن","يعني"]);
function wordSet(text) {
  const normalized = normalizeArabic(text).toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ");
  const canonical = normalized.split(" ").map((word) => {
    let w = word;
    if (w.startsWith("لل") && w.length > 4) w = w.slice(2);
    else if (w.startsWith("ال") && w.length > 4) w = w.slice(2);
    if (w === "تحفيز" || w === "دافعيه") w = "دافعيه";
    return w;
  });
  return [...new Set(canonical.filter((w) => (w.length > 2 || /^\d+$/.test(w)) && !IGNORE.has(w)))];
}
function storageOrNull(custom) {
  if (custom) return custom;
  try { return globalThis.localStorage || null; } catch { return null; }
}
function read(bundle, storage) {
  try {
    const value = JSON.parse(storage.getItem(PREFIX + String(bundle)) || "[]");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}
function numericTokens(text) {
  const normalized = normalizeArabic(text).toLowerCase()
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:بالمئه|بالمائه|بالميه|في الميه)/g, "$1%");
  return [...new Set([...normalized.matchAll(/\d+(?:[.,]\d+)?\s*%?/g)]
    .map(([value]) => value.replace(/\s+/g, "").replace(",", ".")))].sort();
}
function opaqueId(text) { // Not security: just keeps readable words out of the cross-lecture index.
  let h = 0xcbf29ce484222325n;
  for (const ch of String(text)) { h ^= BigInt(ch.codePointAt(0)); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; }
  return h.toString(16).padStart(16, "0");
}
function readGlobal(storage) {
  try {
    const items = JSON.parse(storage.getItem(GLOBAL_KEY) || "[]");
    return Array.isArray(items) ? items.slice(-GLOBAL_LIMIT) : [];
  } catch { return []; }
}
export function rememberScene({ bundle, slide, utterance, spec }, customStorage) {
  const storage = storageOrNull(customStorage);
  if (!storage || !bundle || !Number.isInteger(slide) || slide < 1 || !utterance) return false;
  validateSpec(spec);
  const terms = wordSet(utterance);
  if (terms.length < 2) return false;
  const scenes = read(bundle, storage);
  const id = slide + ":" + terms.join("|");
  const shown = embed(String(utterance));
  const stored = { vec: toSparse(shown.vec), slots: shown.slots,
    numbers: numbersOf(String(utterance) + " " + spec.lines.join(" ")) };
  const item = { id, slide, utterance: String(utterance).slice(0, 300),
    terms, ...stored, spec, storedAt: Date.now() };
  const remaining = scenes.filter((x) => x.id !== id).slice(-49);
  try {
    storage.setItem(PREFIX + String(bundle), JSON.stringify([...remaining, item]));
    // A bounded, same-browser index: no network, embeddings, or extra raw transcript.
    // A failed index write never loses the lecture-specific saved scene.
    try {
      const globalId = bundle + ":" + opaqueId(id);
      const global = readGlobal(storage).filter((entry) => entry.id !== globalId);
      const compact = { id: globalId, bundle, ...stored, spec, storedAt: item.storedAt };
      storage.setItem(GLOBAL_KEY, JSON.stringify([...global, compact].slice(-GLOBAL_LIMIT)));
    } catch {}
    return true;
  } catch { return false; }
}
const THRESHOLD = { sameSlide: 0.45, sameLecture: 0.6, crossLecture: 0.55 };
function storedForm(item) {
  const vec = fromSparse(item.vec);
  if (vec && item.slots && Array.isArray(item.numbers)) return { vec, slots: item.slots, numbers: item.numbers };
  // Scenes saved by older releases carry only text: rebuild locally when possible.
  if (typeof item.utterance === "string" && item.utterance && Array.isArray(item.spec?.lines)) {
    const shown = embed(item.utterance);
    return { vec: shown.vec, slots: shown.slots,
      numbers: numbersOf(item.utterance + " " + item.spec.lines.join(" ")) };
  }
  return null;
}
export function recallScene({ bundle, slide, utterance }, customStorage) {
  const storage = storageOrNull(customStorage);
  if (!storage || !bundle) return null;
  const query = embed(String(utterance));
  if (query.size < 2) return null;
  let best = null, max = 0;
  for (const item of read(bundle, storage)) {
    if (!item || !item.spec || !Array.isArray(item.spec.lines)) continue;
    const stored = storedForm(item);
    if (!stored) continue;
    const verdict = compatible(query, stored, {
      threshold: item.slide === slide ? THRESHOLD.sameSlide : THRESHOLD.sameLecture });
    if (verdict.ok && verdict.similarity > max) {
      try { validateSpec(item.spec); best = item; max = verdict.similarity; } catch {}
    }
  }
  if (best) return { spec: best.spec, utterance: best.utterance, similarity: max };
  // Cross-lecture reuse is stricter and always goes through the presenter's confirmation.
  if (query.size < 3) return null;
  for (const item of readGlobal(storage)) {
    if (!item || item.bundle === bundle || !item.spec) continue;
    const stored = storedForm(item);
    if (!stored) continue;
    const verdict = compatible(query, stored, { threshold: THRESHOLD.crossLecture });
    if (verdict.ok && verdict.similarity > max) {
      try { validateSpec(item.spec); best = item; max = verdict.similarity; } catch {}
    }
  }
  return best ? { spec: best.spec, similarity: max, reusedAcrossLecture: true } : null;
}
export function clearSceneMemory(bundle, customStorage) {
  const storage = storageOrNull(customStorage);
  if (!storage) return false;
  try {
    if (bundle) {
      storage.removeItem?.(PREFIX + String(bundle));
      const rest = readGlobal(storage).filter((x) => x.bundle !== bundle);
      storage.setItem(GLOBAL_KEY, JSON.stringify(rest));
    } else {
      for (let i = (storage.length || 0) - 1; i >= 0; i--) {
        const key = storage.key?.(i);
        if (key && key.startsWith(PREFIX)) storage.removeItem(key);
      }
      storage.removeItem?.(GLOBAL_KEY);
    }
    return true;
  } catch { return false; }
}
export function countSavedScenes(bundle, customStorage) {
  const storage = storageOrNull(customStorage);
  return storage ? read(bundle, storage).length : 0;
}
