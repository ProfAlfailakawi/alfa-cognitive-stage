// Local, no-API approved scene memory. Private to this browser profile and origin.
// Not yet a full semantic/vector database or a multi-device synchronization mechanism.
import { normalizeArabic } from "./director-core.js";
import { validateSpec } from "./infographic.js";

const PREFIX = "alfa-approved-scenes-v1:";
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
    return true;
  } catch { return false; }
}
export function recallScene({ bundle, slide, utterance }, customStorage) {
  const storage = storageOrNull(customStorage);
  if (!storage || !bundle) return null;
  const query = wordSet(utterance);
  if (query.length < 2) return null;
  let best = null, max = 0;
  for (const item of read(bundle, storage)) {
    if (!item || !Array.isArray(item.terms) || !item.spec) continue;
    const common = query.filter((word) => item.terms.includes(word)).length;
    const union = new Set([...query, ...item.terms]).size;
    const similarity = union ? common / union : 0;
    const threshold = item.slide === slide ? 0.55 : 0.85;
    if (common >= 2 && similarity >= threshold && similarity > max) {
      try { validateSpec(item.spec); best = item; max = similarity; } catch {}
    }
  }
  return best ? { spec: best.spec, utterance: best.utterance, similarity: max } : null;
}
export function countSavedScenes(bundle, customStorage) {
  const storage = storageOrNull(customStorage);
  return storage ? read(bundle, storage).length : 0;
}
