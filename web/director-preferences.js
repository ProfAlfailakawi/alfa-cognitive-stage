// Private, bounded preference memory for explicitly dismissed director proposals.
// Exact normalized utterance + slide + lecture only. No network or paid API.
import { normalizeArabic } from "./director-core.js";

const PREFIX = "alfa-director-rejections-v1:";
const MAX_ENTRIES = 80;
const TTL_MS = 14 * 24 * 60 * 60 * 1000;

function storageOrNull(custom) {
  if (custom) return custom;
  try { return globalThis.localStorage || null; } catch { return null; }
}
function fingerprint(utterance) {
  // An index fingerprint, NOT a cryptographic hash or anonymization guarantee.
  // Preserve digits and percent signs: revised statistics must not be suppressed.
  const phrase = normalizeArabic(String(utterance || "").slice(0, 950)).toLowerCase()
    .replace(/[^\p{L}\p{N}%]+/gu, " ").trim();
  if (phrase.length < 5) return null;
  let hash = 0xcbf29ce484222325n;
  for (const char of phrase) {
    hash ^= BigInt(char.codePointAt(0));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}
function valid(input) {
  if (!input || typeof input.bundle !== "string" || !input.bundle ||
      !Number.isInteger(input.slide) || input.slide < 1) return null;
  return fingerprint(input.utterance);
}
function read(bundle, storage, now) {
  try {
    const value = JSON.parse(storage.getItem(PREFIX + bundle) || "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(item => item && Number.isInteger(item.slide) && item.slide > 0 &&
      typeof item.fingerprint === "string" && /^[a-f0-9]{16}$/.test(item.fingerprint) &&
      Number.isFinite(item.at) && item.at <= now && now - item.at < TTL_MS).slice(-MAX_ENTRIES);
  } catch { return []; }
}
export function rememberRejectedProposal(input, customStorage, now = Date.now()) {
  const storage = storageOrNull(customStorage);
  const key = valid(input);
  if (!storage || !key || !Number.isFinite(now)) return false;
  const { bundle, slide } = input;
  const entries = read(bundle, storage, now)
    .filter(item => !(item.slide === slide && item.fingerprint === key));
  try {
    storage.setItem(PREFIX + bundle, JSON.stringify([...entries, { slide, fingerprint: key, at: now }].slice(-MAX_ENTRIES)));
    return true;
  } catch { return false; }
}
export function wasProposalRejected(input, customStorage, now = Date.now()) {
  const storage = storageOrNull(customStorage);
  const key = valid(input);
  if (!storage || !key || !Number.isFinite(now)) return false;
  return read(input.bundle, storage, now)
    .some(item => item.slide === input.slide && item.fingerprint === key);
}
export function countRejectedProposals(bundle, customStorage, now = Date.now()) {
  const storage = storageOrNull(customStorage);
  return storage && bundle && Number.isFinite(now) ? read(String(bundle), storage, now).length : 0;
}
export function clearRejectedProposals(bundle, customStorage) {
  const storage = storageOrNull(customStorage);
  if (!storage || !bundle) return false;
  try { storage.removeItem(PREFIX + String(bundle)); return true; }
  catch { return false; }
}
