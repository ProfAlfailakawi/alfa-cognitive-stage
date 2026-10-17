// Persist only scenes the lecturer explicitly saves to the lecture library.
// No AI calls, no student identities. Local JSON atomically updated on the lecturer's machine.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { validateSpec } from "../web/infographic.js";

function bad(message) {
  const error = new Error(message); error.status = 400; return error;
}
function validBundle(bundle) {
  if (!/^[a-f0-9]{12}$/.test(String(bundle))) throw bad("معرّف المحاضرة غير صحيح");
  return String(bundle);
}
function normalize(scene) {
  const bundle = validBundle(scene?.bundle);
  const slide = Number(scene?.slide);
  if (!Number.isInteger(slide) || slide < 1 || slide > 10000) throw bad("رقم الشريحة غير صحيح");
  const utterance = String(scene?.utterance || "").trim().slice(0, 300);
  if (utterance.length < 4) throw bad("لا يوجد سياق كافٍ لحفظ المشهد");
  const spec = { type: scene.spec?.type,
    title: String(scene.spec?.title || "").slice(0, 120),
    lines: Array.isArray(scene.spec?.lines) ? scene.spec.lines.slice(0, 6).map((v) => String(v).slice(0, 120)) : [] };
  validateSpec(spec);
  return { bundle, slide, utterance, spec };
}
export function createSceneLibrary({ file = null } = {}) {
  let scenes = [];
  if (file && existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      if (Array.isArray(parsed)) scenes = parsed.slice(-1500).filter((item) => {
        try { normalize(item); return typeof item.id === "string"; } catch { return false; }
      });
    } catch { scenes = []; }
  }
  function persist() {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    const tmp = file + ".tmp";
    writeFileSync(tmp, JSON.stringify(scenes, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  }
  function list(bundle) {
    const name = validBundle(bundle);
    return scenes.filter((item) => item.bundle === name).map((item) => ({ ...item }));
  }
  function save(input) {
    const clean = normalize(input);
    const matching = scenes.find((item) => item.bundle === clean.bundle && item.slide === clean.slide &&
      item.utterance === clean.utterance && JSON.stringify(item.spec) === JSON.stringify(clean.spec));
    if (matching) return matching;
    const entry = { ...clean, id: randomBytes(12).toString("hex"), createdAt: Date.now() };
    const perBundle = scenes.filter((item) => item.bundle === entry.bundle);
    if (perBundle.length >= 120) {
      const oldest = perBundle.sort((a, b) => a.createdAt - b.createdAt)[0];
      scenes = scenes.filter((item) => item.id !== oldest.id);
    }
    scenes.push(entry);
    persist();
    return entry;
  }
  function remove(bundle, id) {
    const name = validBundle(bundle);
    if (!/^[a-f0-9]{24}$/.test(String(id))) throw bad("معرّف المشهد غير صحيح");
    const before = scenes.length;
    scenes = scenes.filter((item) => !(item.bundle === name && item.id === id));
    if (before !== scenes.length) persist();
    return before !== scenes.length;
  }
  return { list, save, remove };
}
