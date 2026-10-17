// Academic organisation of lectures: courses, sections (شعب) and "series" linking versions of the
// same lecture. Bundles (originals) are never modified or merged; this file only labels them.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

const BUNDLE = /^[a-f0-9]{12}$/;
const ID = /^[a-z0-9]{8}$/;
const clean = (value, max) => String(value ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export class LibraryError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function createLibrary({ file, bundlesRoot, now = () => Date.now() }) {
  let data = { version: 1, courses: [], sections: [], lectures: {} };
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      if (parsed?.version === 1 && Array.isArray(parsed.courses) && Array.isArray(parsed.sections) &&
          parsed.lectures && typeof parsed.lectures === "object") data = parsed;
      else throw new Error("shape");
    } catch { throw new LibraryError("ملف مكتبة المقررات تالف؛ لم يُكتب عليه", 500); }
  }
  const save = () => {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = file + ".tmp";
    writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    renameSync(tmp, file);
  };
  const newId = () => randomBytes(4).toString("hex").slice(0, 8).replace(/[^a-f0-9]/g, "0").padEnd(8, "0");
  const course = (id) => {
    const c = data.courses.find((x) => x.id === id);
    if (!c) throw new LibraryError("المقرر غير موجود", 404);
    return c;
  };
  function manifests() {
    const out = new Map();
    if (!existsSync(bundlesRoot)) return out;
    for (const name of readdirSync(bundlesRoot)) {
      if (!BUNDLE.test(name)) continue;
      try {
        const m = JSON.parse(readFileSync(join(bundlesRoot, name, "manifest.json"), "utf8"));
        out.set(name, { source: String(m.source || name), slideCount: Number(m.slideCount) || 0,
          format: m.format || "pptx", warnings: (m.problems || []).length,
          builtAt: statSync(join(bundlesRoot, name, "manifest.json")).mtimeMs });
      } catch { /* an unreadable bundle is simply not listed */ }
    }
    return out;
  }
  return {
    snapshot() {
      const found = manifests();
      const lectures = [...found].map(([bundle, info]) => {
        const label = data.lectures[bundle] || {};
        return { bundle, ...info, title: label.title || info.source, courseId: label.courseId || null,
          sectionId: label.sectionId || null, seriesId: label.seriesId || null, lastOpenedAt: label.lastOpenedAt || null };
      }).sort((a, b) => (b.lastOpenedAt || b.builtAt) - (a.lastOpenedAt || a.builtAt));
      return { courses: data.courses, sections: data.sections, lectures };
    },
    addCourse(name, term = "") {
      const n = clean(name, 80);
      if (n.length < 2) throw new LibraryError("اسم المقرر قصير");
      if (data.courses.length >= 100) throw new LibraryError("بلغت الحد الأعلى للمقررات", 429);
      const c = { id: newId(), name: n, term: clean(term, 40) };
      data.courses.push(c); save(); return c;
    },
    removeCourse(id) {
      course(id);
      data.courses = data.courses.filter((c) => c.id !== id);
      data.sections = data.sections.filter((s) => s.courseId !== id);
      for (const label of Object.values(data.lectures)) if (label.courseId === id) { label.courseId = null; label.sectionId = null; }
      save(); return { ok: true }; // Lectures and their files stay.
    },
    addSection(courseId, name) {
      course(courseId);
      const n = clean(name, 60);
      if (n.length < 1) throw new LibraryError("اسم الشعبة مطلوب");
      if (data.sections.filter((s) => s.courseId === courseId).length >= 40) throw new LibraryError("عدد الشعب كبير", 429);
      const s = { id: newId(), courseId, name: n };
      data.sections.push(s); save(); return s;
    },
    removeSection(id) {
      data.sections = data.sections.filter((s) => s.id !== id);
      for (const label of Object.values(data.lectures)) if (label.sectionId === id) label.sectionId = null;
      save(); return { ok: true };
    },
    label(bundle, { courseId = undefined, sectionId = undefined, title = undefined, versionOf = undefined } = {}) {
      if (!BUNDLE.test(bundle) || !manifests().has(bundle)) throw new LibraryError("المحاضرة غير موجودة", 404);
      const label = data.lectures[bundle] ||= {};
      if (courseId !== undefined) {
        if (courseId !== null) course(courseId);
        label.courseId = courseId; if (courseId === null) label.sectionId = null;
      }
      if (sectionId !== undefined) {
        if (sectionId !== null && !data.sections.some((s) => s.id === sectionId && s.courseId === label.courseId))
          throw new LibraryError("الشعبة لا تتبع مقرر المحاضرة");
        label.sectionId = sectionId;
      }
      if (title !== undefined) label.title = clean(title, 120) || undefined;
      if (versionOf !== undefined) {
        if (versionOf === null) delete label.seriesId;
        else {
          if (!BUNDLE.test(versionOf) || versionOf === bundle || !manifests().has(versionOf)) throw new LibraryError("المحاضرة المرتبطة غير موجودة");
          const target = data.lectures[versionOf] ||= {};
          target.seriesId ||= newId();
          label.seriesId = target.seriesId; // Same series id = versions of one lecture.
        }
      }
      save(); return { bundle, ...label };
    },
    opened(bundle) {
      if (!BUNDLE.test(bundle)) return;
      const label = data.lectures[bundle] ||= {};
      label.lastOpenedAt = now(); save();
    },
    // Forget a lecture's labels (its files are removed by the caller).
    forget(bundle) { delete data.lectures[bundle]; save(); },
    forgetAll() { data = { version: 1, courses: [], sections: [], lectures: {} }; save(); },
  };
}

/** Delete one lecture's files and rebuild the public selectors. Returns what was removed. */
export function deleteBundle(bundlesRoot, bundle) {
  if (!BUNDLE.test(bundle)) throw new LibraryError("معرّف محاضرة غير صالح");
  const dir = join(bundlesRoot, bundle);
  if (!existsSync(join(dir, "manifest.json"))) throw new LibraryError("المحاضرة غير موجودة", 404);
  rmSync(dir, { recursive: true, force: true });
  const available = [];
  for (const name of readdirSync(bundlesRoot)) {
    if (!BUNDLE.test(name)) continue;
    try {
      const m = JSON.parse(readFileSync(join(bundlesRoot, name, "manifest.json"), "utf8"));
      if (m.id === name) available.push({ id: name, title: String(m.source || name), slideCount: m.slideCount || 0, warnings: (m.problems || []).length });
    } catch {}
  }
  let current = null;
  try { current = JSON.parse(readFileSync(join(bundlesRoot, "current.json"), "utf8")).id; } catch {}
  const write = (name, payload) => { const t = join(bundlesRoot, name + ".tmp"); writeFileSync(t, JSON.stringify(payload, null, 2)); renameSync(t, join(bundlesRoot, name)); };
  write("lectures.json", available);
  if (current === bundle || !available.some((x) => x.id === current)) {
    if (available.length) write("current.json", { id: available[0].id });
    else rmSync(join(bundlesRoot, "current.json"), { force: true });
  }
  return { removed: bundle, remaining: available.length };
}
