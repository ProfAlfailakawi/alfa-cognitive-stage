// Conservative, local learning of which scene TYPES this lecturer approves or declines.
// Only explicit accept/decline decisions (and a quick manual hide of an auto-shown scene) count.
// Nothing here changes content, only how forward a suggestion is: auto -> ask -> quiet.
// A single rejection never changes behaviour; evidence decays with a 30-day half-life.
const PREFIX = "alfa-director-taste-v1:";
const GLOBAL = "alfa-director-taste-v1:*";
const HALF_LIFE_MS = 30 * 24 * 3600 * 1000;
const MAX_EVENTS = 60;
const TYPES = new Set(["stat", "compare", "steps", "concept", "flow", "timeline", "story"]);

function storageOrNull(custom) {
  if (custom) return custom;
  try { return globalThis.localStorage || null; } catch { return null; }
}
function load(key, storage) {
  try {
    const value = JSON.parse(storage.getItem(key) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
function cleanEvents(list, now) {
  return (Array.isArray(list) ? list : []).filter((e) => e && typeof e.approved === "boolean" &&
    Number.isFinite(e.at) && e.at <= now && Number.isFinite(e.w) && e.w > 0 && e.w <= 1 &&
    typeof e.fp === "string" && /^[a-f0-9]{0,16}$/.test(e.fp)).slice(-MAX_EVENTS);
}
function weigh(events, now) {
  let approvals = 0, rejections = 0;
  const approvedContent = new Set(events.filter((e) => e.approved && e.fp).map((e) => e.fp));
  for (const e of events) {
    const decay = Math.pow(0.5, (now - e.at) / HALF_LIFE_MS);
    if (e.approved) approvals += e.w * decay;
    // A decline of content the lecturer approved elsewhere points to timing, not taste.
    else rejections += e.w * decay * (e.fp && approvedContent.has(e.fp) ? 0.3 : 1);
  }
  return { approvals, rejections };
}
export function recordDecision({ bundle, type, approved, fingerprint = "", weight = 1 }, customStorage, now = Date.now()) {
  const storage = storageOrNull(customStorage);
  if (!storage || !TYPES.has(type) || typeof bundle !== "string" || !bundle || typeof approved !== "boolean") return false;
  const fp = /^[a-f0-9]{16}$/.test(fingerprint) ? fingerprint : "";
  const entry = { approved, at: now, w: Math.max(0.1, Math.min(1, weight)), fp };
  try {
    for (const key of [PREFIX + bundle, GLOBAL]) {
      const all = load(key, storage);
      all[type] = [...cleanEvents(all[type], now), entry].slice(-MAX_EVENTS);
      storage.setItem(key, JSON.stringify(all));
    }
    return true;
  } catch { return false; }
}
/** Learned stance for a scene type in this lecture (global history counts half). */
export function tasteFor({ bundle, type }, customStorage, now = Date.now()) {
  const storage = storageOrNull(customStorage);
  const neutral = { approvals: 0, rejections: 0, score: 0.5, quieter: false, suppressed: false };
  if (!storage || !TYPES.has(type)) return neutral;
  const local = weigh(cleanEvents(load(PREFIX + bundle, storage)[type], now), now);
  const global = weigh(cleanEvents(load(GLOBAL, storage)[type], now), now);
  const approvals = local.approvals + 0.5 * global.approvals;
  const rejections = local.rejections + 0.5 * global.rejections;
  const score = (approvals + 1) / (approvals + rejections + 2);
  return {
    approvals, rejections, score,
    quieter: rejections >= 2 && score < 0.4,      // stop auto-showing; ask first
    suppressed: rejections >= 3.5 && score < 0.25, // stop proposing this type
  };
}
export function summarizeTaste(bundle, customStorage, now = Date.now()) {
  const out = [];
  for (const type of TYPES) {
    const t = tasteFor({ bundle, type }, customStorage, now);
    if (t.approvals + t.rejections >= 1) out.push({ type, ...t });
  }
  return out;
}
export function clearTaste(bundle, customStorage) {
  const storage = storageOrNull(customStorage);
  if (!storage) return false;
  try {
    if (bundle) storage.removeItem(PREFIX + bundle); else {
      for (let i = (storage.length || 0) - 1; i >= 0; i--) {
        const key = storage.key?.(i);
        if (key && key.startsWith(PREFIX)) storage.removeItem(key);
      }
    }
    storage.removeItem(GLOBAL);
    return true;
  } catch { return false; }
}
