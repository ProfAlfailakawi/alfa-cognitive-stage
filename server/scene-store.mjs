// Durable lecturer-approved scene library, stored locally next to vote data.
// This works without a model/API and persists across browser profiles and server restarts.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { validateSpec } from "../web/infographic.js";

const ID = /^[a-zA-Z0-9_-]{4,64}$/;
const MAX_PER_BUNDLE = 120;

export class SceneStoreError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function createSceneStore({ file = null } = {}) {
  const state = new Map();
  if (file && existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [key, records] of Object.entries(parsed)) {
          if (ID.test(key) && Array.isArray(records)) state.set(key, records.slice(-MAX_PER_BUNDLE));
        }
      }
    } catch (err) { throw new SceneStoreError("ملف ذاكرة المحاضرات تالف؛ لم يتم الكتابة عليه", 500); }
  }
  function verifyBundle(bundle) {
    if (typeof bundle !== "string" || !ID.test(bundle)) throw new SceneStoreError("معرّف محاضرة غير صالح");
  }
  function persist() {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    const target = Object.fromEntries(state);
    const tmp = file + ".tmp";
    writeFileSync(tmp, JSON.stringify(target));
    renameSync(tmp, file);
  }
  function list(bundle) {
    verifyBundle(bundle);
    return (state.get(bundle) || []).map((item) => structuredClone(item));
  }
  function save(bundle, { slide, utterance, spec }) {
    verifyBundle(bundle);
    if (!Number.isInteger(slide) || slide < 1 || slide > 10000)
      throw new SceneStoreError("رقم الشريحة غير صالح");
    const spoken = String(utterance || "").trim().slice(0, 350);
    if (spoken.length < 8) throw new SceneStoreError("نص الاستدعاء غير كاف");
    const original = { type: spec?.type, title: spec?.title, lines: spec?.lines };
    try { validateSpec(original); }
    catch { throw new SceneStoreError("المشهد غير صالح"); }
    const id = createHash("sha256").update(bundle + "|" + slide + "|" + spoken).digest("hex").slice(0, 20);
    const item = { id, bundle, slide, utterance: spoken,
      spec: original, updatedAt: new Date().toISOString() };
    const other = (state.get(bundle) || []).filter((r) => r.id !== id);
    state.set(bundle, [...other, item].slice(-MAX_PER_BUNDLE));
    persist();
    return structuredClone(item);
  }
  function remove(bundle, id) {
    verifyBundle(bundle);
    if (!/^[a-f0-9]{20}$/.test(id)) throw new SceneStoreError("معرّف المشهد غير صالح");
    const old = state.get(bundle) || [];
    state.set(bundle, old.filter((record) => record.id !== id));
    persist();
    return { removed: old.length !== state.get(bundle).length };
  }
  return { list, save, remove };
}
