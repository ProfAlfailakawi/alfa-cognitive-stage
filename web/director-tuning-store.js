// The sensitivity the lecturer adopted (director-tuner.js suggests, this remembers). Local, one small record.
import { DEFAULT_TUNING, sanitizeTuning } from "./director-brain.js";
const KEY = "alfa-director-tuning-v1";
const storageOrNull = (custom) => { if (custom) return custom; try { return globalThis.localStorage || null; } catch { return null; } };

export function loadTuning(customStorage) {
  try {
    const saved = JSON.parse(storageOrNull(customStorage)?.getItem(KEY) || "null");
    return saved && typeof saved === "object" ? sanitizeTuning(saved.tuning) : { ...DEFAULT_TUNING };
  } catch { return { ...DEFAULT_TUNING }; }
}
export function isCustomTuning(tuning) {
  return Object.keys(DEFAULT_TUNING).some((k) => tuning?.[k] !== DEFAULT_TUNING[k]);
}
export function saveTuning(tuning, basis = {}, customStorage, now = Date.now()) {
  const storage = storageOrNull(customStorage);
  if (!storage) return false;
  try { storage.setItem(KEY, JSON.stringify({ tuning: sanitizeTuning(tuning), at: now, labelled: Number(basis.labelled) || 0 })); return true; } catch { return false; }
}
export function clearTuning(customStorage) { try { storageOrNull(customStorage)?.removeItem(KEY); return true; } catch { return false; } }
