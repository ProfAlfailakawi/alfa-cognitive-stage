// Question bank for rehearsal: real student questions the lecturer chose to keep, text only.
// No device token, session code, time of day or IP is stored with a question. Kept per lecture, capped, deletable.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { moderate } from "../web/moderation.js";

const LECTURE = /^[a-f0-9]{12}$/;
const MAX_PER_LECTURE = 200;
const clean = (v, n) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

export class QuestionBankError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function createQuestionBank({ file }) {
  let data = { version: 1, items: [] };
  if (file && existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      if (parsed?.version !== 1 || !Array.isArray(parsed.items)) throw new Error("shape");
      data.items = parsed.items.filter((i) => i && LECTURE.test(i.lecture) && typeof i.text === "string" && Number.isInteger(i.slide) && i.slide > 0 && /^[a-f0-9]{8}$/.test(i.id));
    } catch {
      try { renameSync(file, file + ".damaged-" + Date.now()); } catch {}
    }
  }
  const save = () => {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    const tmp = file + ".tmp";
    writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    renameSync(tmp, file);
  };
  const norm = (t) => t.replace(/\s+/g, " ").toLowerCase();
  return {
    keep({ lecture, slide, text }) {
      if (!LECTURE.test(String(lecture))) throw new QuestionBankError("معرّف المحاضرة غير صالح");
      if (!Number.isInteger(slide) || slide < 1 || slide > 9999) throw new QuestionBankError("رقم الشريحة غير صالح");
      const t = clean(text, 280);
      if (t.length < 3) throw new QuestionBankError("نص السؤال قصير");
      if (!moderate(t).ok) throw new QuestionBankError("لا يُحفظ سؤال مُعلَّم", 422);
      const mine = data.items.filter((i) => i.lecture === lecture);
      const dup = mine.find((i) => norm(i.text) === norm(t));
      if (dup) return { item: dup, duplicate: true };
      if (mine.length >= MAX_PER_LECTURE) throw new QuestionBankError("بنك الأسئلة ممتلئ لهذه المحاضرة", 429);
      const item = { id: randomBytes(4).toString("hex"), lecture, slide, text: t };
      data.items.push(item);
      save();
      return { item, duplicate: false };
    },
    list(lecture) {
      if (!LECTURE.test(String(lecture))) throw new QuestionBankError("معرّف المحاضرة غير صالح");
      return data.items.filter((i) => i.lecture === lecture).map(({ id, slide, text }) => ({ id, slide, text }));
    },
    remove(id) {
      const before = data.items.length;
      data.items = data.items.filter((i) => i.id !== id);
      if (data.items.length === before) throw new QuestionBankError("السؤال غير موجود", 404);
      save();
      return { ok: true };
    },
    clearLecture(lecture) { const n = data.items.length; data.items = data.items.filter((i) => i.lecture !== lecture); save(); return { removed: n - data.items.length }; },
    clearAll() { const n = data.items.length; data.items = []; save(); return { removed: n }; },
    count: () => data.items.length,
  };
}
