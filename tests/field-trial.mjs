// Field recorder, resume state, course map, timed rehearsal planning and the guest server.
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFieldRecorder, analyzeTrial, trialToMarkdown } from "../web/field-recorder.js";
import { createResume } from "../web/resume-state.js";
import { buildCourseMap } from "../web/course-map.js";
import { planRehearsal, summarizeRehearsal } from "../web/rehearsal-audience.js";

const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), get size() { return m.size; }, dump: () => [...m.values()].join("\n") }; };
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---- recorder: consent gate ----
{
  let t = 1000; const storage = memory();
  const rec = createFieldRecorder({ bundle: "b", storage, now: () => t });
  assert.equal(rec.start(), false, "no recording without consent");
  assert.equal(rec.utterance({ text: "سر", slide: 1 }), null);
  assert.equal(storage.size, 0, "nothing written without consent");
  rec.setConsent(true);
  assert.equal(rec.start({ label: "اختبار" }), true);
  const u1 = rec.utterance({ text: "في دراسة ٦٨ بالمية", slide: 2, engine: "cloud" });
  t += 100; const d1 = rec.decision({ slide: 2, action: "propose", kind: "stat", why: ["أ", "ب"], confidence: 0.9, utteranceId: u1, spec: { title: "إحصائية" } });
  const u2 = rec.utterance({ text: "تخيلوا لو أن", slide: 2 });
  t += 100; const d2 = rec.decision({ slide: 2, action: "none", kind: "story", opportunity: "story", utteranceId: u2 });
  for (let i = 0; i < 4; i++) { const u = rec.utterance({ text: "جملة " + i, slide: 3 }); rec.decision({ slide: 3, action: "propose", kind: "steps", utteranceId: u }); }
  t += 20000; rec.shown({ slide: 2, type: "stat", source: "approved" }); rec.declined({ slide: 3, type: "steps" });
  rec.latency({ kind: "stat", totalMs: 420 }); rec.latency({ kind: "stat", totalMs: 380 }); rec.latency({ kind: "steps", totalMs: 900 }); rec.latency({ kind: "x", totalMs: NaN });
  rec.note("witness");
  t += 5000; rec.stop();
  let report = analyzeTrial(rec.last());
  assert.deepEqual([report.utterances, report.decisions, report.scenes.shown, report.scenes.declined], [6, 6, 1, 1]);
  assert.deepEqual(report.latencyMs, { samples: 3, median: 420, p95: 900 });
  assert.equal(report.precision, null, "no accuracy claimed before the lecturer labels anything");
  assert.match(report.precisionNote, /لم تُصنَّف/);
  assert.ok(report.unusedFeatures.includes("poll") && !report.unusedFeatures.includes("witness"));
  assert.equal(report.opportunitiesWithoutScene, 1, "a detected opportunity that produced no scene is counted");
  // labelling
  const ids = rec.last().events.filter((e) => e.type === "decision").map((e) => e.id);
  rec.label(ids[0], "ok"); rec.label(ids[1], "missed"); rec.label(ids[2], "bad");
  report = analyzeTrial(rec.last());
  assert.equal(report.precision, null, "fewer than 5 labels: still no percentage");
  for (const id of ids.slice(3)) rec.label(id, "ok");
  report = analyzeTrial(rec.last());
  assert.equal(report.labelled, 6); assert.equal(report.precision, 0.67); assert.equal(report.missedMarked, 1);
  assert.match(trialToMarkdown(report), /67٪ — 6 قراراً صنّفتَه أنت/);
  assert.equal(rec.label(ids[0], "great"), false, "labels are a closed set");
  assert.ok(JSON.parse(rec.exportJson()).trial.events.length > 10);
  // withdrawing consent stops and keeps nothing running
  rec.start(); rec.setConsent(false);
  assert.equal(rec.recording(), false);
  rec.clear();
  assert.equal(storage.dump().includes("جملة"), false, "clear removes the recorded text");
  assert.equal(rec.trials().length, 0);
}

// ---- resume ----
{
  let t = 10_000; const storage = memory();
  const r = createResume({ bundle: "b", storage, now: () => t });
  assert.equal(r.pending(), null);
  r.save({ index: 1, step: 0, videos: [{ time: 0 }], overlay: null }); assert.equal(r.pending(), null, "slide 1 at rest is not worth resuming");
  r.save({ index: 4, step: 2, videos: [{ time: 12.5, playing: true }], overlay: { type: "stat", title: "x", lines: ["68%"] }, poll: true });
  t += 3 * 60000;
  const p = r.pending();
  assert.deepEqual([p.index, p.step, Math.round(p.ageMs / 60000)], [4, 2, 3]);
  const stage = r.toStage(p);
  assert.equal(stage.videos[0].playing, false, "a video never restarts by itself after a crash");
  assert.equal(stage.poll, false);
  assert.equal(stage.videos[0].time, 12.5);
  assert.equal(createResume({ bundle: "other", storage, now: () => t }).pending(), null, "another lecture's state is ignored");
  t += 7 * 3600 * 1000; assert.equal(r.pending(), null, "stale state expires");
  r.save({ index: 0 }); r.save(null); r.save({ index: 2.5 });
  r.clear(); assert.equal(storage.size, 0);
}

// ---- course map ----
{
  const lectures = [
    { bundle: "a", title: "الأسبوع 1", sessions: 2, slides: [{ slide: 3, got: 4, lost: 6, questions: 2 }, { slide: 4, got: 9, lost: 0, questions: 0 }] },
    { bundle: "b", title: "الأسبوع 2", sessions: 1, slides: [{ slide: 5, got: 3, lost: 4, questions: 5 }, { slide: 6, got: 2, lost: 1, questions: 0 }] },
  ];
  const texts = { a: { 3: "الدافعية الذاتية والدافعية الخارجية لدى الطلاب" }, b: { 5: "الدافعية الخارجية والدافعية الذاتية وأثرها على الطلاب", 6: "الاختبارات النهائية" } };
  const map = buildCourseMap(lectures, texts);
  assert.deepEqual(map.lectures.map((l) => l.confusing.map((c) => c.slide)), [[3], [5]]);
  assert.equal(map.lectures[1].questions, 5);
  assert.equal(map.recurring.length, 1, JSON.stringify(map.recurring));
  assert.match(map.note, /لا يفسّر السبب/);
  assert.equal(buildCourseMap(lectures, { a: { 3: "الدافعية الذاتية" }, b: { 5: "جداول التوزيع التكراري" } }).recurring.length, 0, "unrelated slides never count as a recurring concept");
  assert.deepEqual(buildCourseMap([], {}).lectures, []);
}

// ---- timed rehearsal ----
{
  const expected = { 5: [{ id: "x", text: "سؤال ٥", origin: "same-slide" }], 2: [{ id: "y", text: "سؤال ٢", origin: "related" }, { id: "z", text: "سؤال آخر", origin: "related" }] };
  const steps = planRehearsal(expected, { answerSec: 30 });
  assert.deepEqual(steps.map((s) => s.slide), [2, 2, 5], "slides in lecture order");
  assert.equal(steps[0].limitSec, 30);
  assert.equal(planRehearsal(expected, { answerSec: 1 })[0].limitSec, 10, "limits are clamped");
  assert.equal(planRehearsal({}).length, 0);
  const sum = summarizeRehearsal(steps, [{ step: steps[0], answeredSec: 12 }, { step: steps[1], answeredSec: 41 }, { step: steps[2], timedOut: true }]);
  assert.deepEqual([sum.questions, sum.answered, sum.timedOut, sum.medianSec, sum.overLimit.length], [3, 2, 1, 12, 2]);
}

// ---- guest server keeps nothing ----
{
  const before = new Set(readdirSync(tmpdir()).filter((f) => f.startsWith("alfa-guest-")));
  const child = spawn(process.execPath, [join(root, "tools/start-guest.mjs")], { env: { ...process.env, PORT: "4311", OPENAI_API_KEY: "sk-host-secret" }, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; child.stdout.on("data", (d) => (out += d));
  // the token line can arrive after the banner, so wait for both
  await new Promise((r) => { const iv = setInterval(() => { if (/ALFA Cognitive Stage/.test(out) && /رمز المحاضر[^:]*: \w+/.test(out)) { clearInterval(iv); r(); } }, 100); });
  const dirs = readdirSync(tmpdir()).filter((f) => f.startsWith("alfa-guest-") && !before.has(f));
  assert.equal(dirs.length, 1, "one temporary data directory");
  const token = out.match(/رمز المحاضر[^:]*: (\w+)/)?.[1];
  const api = (path, init = {}) => fetch("http://localhost:4311/api" + path, { ...init, headers: { "X-Admin-Token": token, "Content-Type": "application/json" } });
  const { code } = await (await api("/sessions", { method: "POST", body: "{}" })).json();
  assert.match(code, /^[A-Z2-9]{6}$/);
  child.kill("SIGTERM");
  await new Promise((r) => child.once("exit", r));
  assert.equal(existsSync(join(tmpdir(), dirs[0])), false, "the guest's data directory is deleted on exit");
}
console.log("field-trial: all checks passed");
