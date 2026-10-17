import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLibrary, deleteBundle, LibraryError } from "../server/library.mjs";

const dir = mkdtempSync(join(tmpdir(), "alfa-library-"));
const bundles = join(dir, "bundles");
const make = (id, source, slides = 10, extra = {}) => {
  mkdirSync(join(bundles, id, "slides"), { recursive: true });
  writeFileSync(join(bundles, id, "manifest.json"), JSON.stringify({ id, source, slideCount: slides, slides: [], problems: [], ...extra }));
  writeFileSync(join(bundles, id, "slides", "001.png"), "x");
};
try {
  make("aaaaaaaaaaaa", "ألعاب تعليمية v1.pptx");
  make("bbbbbbbbbbbb", "ألعاب تعليمية v2.pptx", 12);
  make("cccccccccccc", "مقدمة.pdf", 5, { format: "pdf" });
  writeFileSync(join(bundles, "lectures.json"), "[]"); writeFileSync(join(bundles, "current.json"), JSON.stringify({ id: "aaaaaaaaaaaa" }));
  let clock = 1_000;
  const lib = createLibrary({ file: join(dir, "data", "library.json"), bundlesRoot: bundles, now: () => clock });
  assert.equal(lib.snapshot().lectures.length, 3);
  const course = lib.addCourse("  تعلم   الكبار ", "خريف 2026");
  assert.equal(course.name, "تعلم الكبار");
  assert.throws(() => lib.addCourse("x"), LibraryError);
  const sec = lib.addSection(course.id, "شعبة 2");
  lib.label("aaaaaaaaaaaa", { courseId: course.id, sectionId: sec.id, title: "الألعاب — الأسبوع 3" });
  // Versions of a lecture share a series while every original bundle is kept.
  lib.label("bbbbbbbbbbbb", { courseId: course.id, versionOf: "aaaaaaaaaaaa" });
  const snap = lib.snapshot();
  const a = snap.lectures.find((x) => x.bundle === "aaaaaaaaaaaa"), b = snap.lectures.find((x) => x.bundle === "bbbbbbbbbbbb");
  assert.equal(a.title, "الألعاب — الأسبوع 3");
  assert.equal(b.title, "ألعاب تعليمية v2.pptx", "the original file name is the default title");
  assert.ok(a.seriesId && a.seriesId === b.seriesId);
  assert.equal(snap.lectures.find((x) => x.bundle === "cccccccccccc").format, "pdf");
  assert.throws(() => lib.label("aaaaaaaaaaaa", { sectionId: "zzzzzzzz" }), LibraryError, "a section must belong to the lecture's course");
  assert.throws(() => lib.label("aaaaaaaaaaaa", { versionOf: "aaaaaaaaaaaa" }), LibraryError);
  assert.throws(() => lib.label("deadbeefdead", { title: "x" }), (e) => e.status === 404);
  assert.throws(() => lib.label("../../etc", { title: "x" }), LibraryError);
  // Quick access: most recently opened first.
  clock = Date.now() + 100_000; lib.opened("cccccccccccc");
  assert.equal(lib.snapshot().lectures[0].bundle, "cccccccccccc");
  // Labels are text only: markup is neutralised.
  lib.label("cccccccccccc", { title: "<img src=x onerror=alert(1)>مقدمة" });
  assert.ok(!lib.snapshot().lectures[0].title.includes("<"));
  // Removing a course keeps the lectures and their files.
  lib.removeCourse(course.id);
  const after = lib.snapshot();
  assert.equal(after.courses.length, 0);
  assert.equal(after.lectures.length, 3);
  assert.equal(after.lectures.find((x) => x.bundle === "aaaaaaaaaaaa").courseId, null);
  assert.ok(existsSync(join(bundles, "aaaaaaaaaaaa", "manifest.json")));
  // The library survives a restart and rejects a damaged file instead of overwriting it.
  assert.equal(createLibrary({ file: join(dir, "data", "library.json"), bundlesRoot: bundles }).snapshot().lectures.length, 3);
  writeFileSync(join(dir, "data", "library.json"), "{ broken");
  assert.throws(() => createLibrary({ file: join(dir, "data", "library.json"), bundlesRoot: bundles }), (e) => e.status === 500);
  assert.equal(readFileSync(join(dir, "data", "library.json"), "utf8"), "{ broken");

  // ---- deleting one lecture ----
  const result = deleteBundle(bundles, "aaaaaaaaaaaa");
  assert.equal(result.remaining, 2);
  assert.ok(!existsSync(join(bundles, "aaaaaaaaaaaa")));
  assert.deepEqual(JSON.parse(readFileSync(join(bundles, "lectures.json"), "utf8")).map((x) => x.id).sort(), ["bbbbbbbbbbbb", "cccccccccccc"]);
  assert.notEqual(JSON.parse(readFileSync(join(bundles, "current.json"), "utf8")).id, "aaaaaaaaaaaa", "current moves off a deleted lecture");
  assert.throws(() => deleteBundle(bundles, "aaaaaaaaaaaa"), (e) => e.status === 404);
  assert.throws(() => deleteBundle(bundles, "../x"), LibraryError);
  deleteBundle(bundles, "bbbbbbbbbbbb"); deleteBundle(bundles, "cccccccccccc");
  assert.ok(!existsSync(join(bundles, "current.json")), "no lectures left means no current lecture");
  console.log("course library: courses, sections, versions, quick access, safe labels, restart, deletion passed");
} finally { rmSync(dir, { recursive: true, force: true }); }
