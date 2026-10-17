// Local, no-API approved scene memory. Private to this browser profile and origin.
// Not yet a full semantic/vector database or a multi-device synchronization mechanism.
import { normalizeArabic } from "./director-core.js";
import { validateSpec } from "./infographic.js";

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
  const item = { id, slide, utterance: String(utterance).slice(0, 300),
    terms, spec, storedAt: Date.now() };
  const remaining = scenes.filter((x) => x.id !== id).slice(-49);
  try {
    storage.setItem(PREFIX + String(bundle), JSON.stringify([...remaining, item]));
    // A bounded, same-browser index: no network, embeddings, or extra raw transcript.
    // A failed index write never loses the lecture-specific saved scene.
    try {
      const global = readGlobal(storage).filter((entry) => entry.id !== bundle + ":" + id);
      const compact = { id: bundle + ":" + id, bundle, terms,
        numbers: numericTokens(String(utterance) + " " + spec.lines.join(" ")),
        spec, storedAt: item.storedAt };
      storage.setItem(GLOBAL_KEY, JSON.stringify([...global, compact].slice(-GLOBAL_LIMIT)));
    } catch {}
    return true;
  } catch { return false; }
}
export function recallScene({ bundle, slide, utterance }, customStorage) {
  const storage = storageOrNull(customStorage);
  if (!storage || !bundle) return null;
  const query = wordSet(utterance);
  if (query.length < 2) return null;
  let best = null, max = 0;
  const queryNumbers = JSON.stringify(numericTokens(utterance));
  for (const item of read(bundle, storage)) {
    if (!item || !Array.isArray(item.terms) || !item.spec ||
        !Array.isArray(item.spec.lines)) continue;
    // Numeric facts must match even within the same lecture and slide:
    // similarity alone could reuse 68% when the lecturer corrected it to 69%.
    const savedNumbers = JSON.stringify(numericTokens(
      String(item.utterance || "") + " " + item.spec.lines.join(" ")));
    if (savedNumbers !== queryNumbers) continue;
    const common = query.filter((word) => item.terms.includes(word)).length;
    const union = new Set([...query, ...item.terms]).size;
    const similarity = union ? common / union : 0;
    const threshold = item.slide === slide ? 0.55 : 0.85;
    if (common >= 2 && similarity >= threshold && similarity > max) {
      try { validateSpec(item.spec); best = item; max = similarity; } catch {}
    }
  }
  if (best) return { spec: best.spec, utterance: best.utterance, similarity: max };
  // Cross-lecture reuse is stricter than same-lecture matching and always goes
  // through the presenter's existing confirmation proposal, never auto-display.
  if (query.length < 3) return null;
  for (const item of readGlobal(storage)) {
    if (!item || item.bundle === bundle || !Array.isArray(item.terms) ||
        !Array.isArray(item.numbers) || !item.spec) continue;
    const common = query.filter((word) => item.terms.includes(word)).length;
    const similarity = common / new Set([...query, ...item.terms]).size;
    if (common < 3 || similarity < 0.85 || similarity <= max ||
        JSON.stringify(item.numbers) !== queryNumbers) continue;
    try { validateSpec(item.spec); best = item; max = similarity; } catch {}
  }
  return best ? { spec: best.spec, similarity: max, reusedAcrossLecture: true } : null;
}
export function countSavedScenes(bundle, customStorage) {
  const storage = storageOrNull(customStorage);
  return storage ? read(bundle, storage).length : 0;
}
