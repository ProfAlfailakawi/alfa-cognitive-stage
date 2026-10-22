// Black-box replay and sensitivity tuning: a recorded lecture is replayed under other settings, and the suggestion
// must agree with the lecturer's labels, hold up out of sample, and never be offered when the evidence is thin.
import assert from "node:assert/strict";
import { createDirectorBrain, DEFAULT_TUNING, sanitizeTuning } from "../web/director-brain.js";
import { createFieldRecorder } from "../web/field-recorder.js";
import { replayTrial } from "../web/trial-replay.js";
import { recordLecture, BLANK_SLIDES } from "./tuning-fixture.mjs";
import { tuneFromTrials, tuningSummary, labelledItems, MIN_LABELLED } from "../web/director-tuner.js";

const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

// ---- knobs: defaults change nothing, bad values are clamped ----
assert.deepEqual(sanitizeTuning(), { ...DEFAULT_TUNING });
assert.deepEqual(sanitizeTuning({ minConfidence: 5, gapMs: -1, maxPerSlide: 99 }), { minConfidence: 0.99, gapMs: 3000, maxPerSlide: 10 });
assert.deepEqual(sanitizeTuning({ minConfidence: "x", gapMs: null, maxPerSlide: NaN }), { ...DEFAULT_TUNING });
{
  let t = 1e12; const brain = createDirectorBrain({ now: () => t });
  const say = (s, i) => { t += 40000; return brain.observe(s, { slide: { index: i, text: "", notes: "" }, mode: "balanced" }); };
  assert.equal(say("الخلاصة إن الطالب يتعلم أفضل لما يشارك بنفسه", 1).action, "propose");
  brain.setTuning({ minConfidence: 0.9 });
  const quiet = say("الخلاصة إن الطالب يتعلم أفضل لما يشارك بنفسه", 2);
  assert.equal(quiet.action, "none");
  assert.match(quiet.why.at(-1), /حد الحساسية/);
  assert.equal(brain.tuning().minConfidence, 0.9);
}

const SLIDES = BLANK_SLIDES;
// ---- replay reproduces the live run under the default settings ----
const trial = recordLecture({ label: "t1" });
{
  const replay = replayTrial(trial, { slides: SLIDES });
  const decisions = trial.events.filter((e) => e.type === "decision");
  assert.equal(decisions.length, 16);
  for (const d of decisions) assert.equal(replay.get(d.utteranceId).action, d.action, "default replay == what happened live");
  const strict = replayTrial(trial, { slides: SLIDES, tuning: { minConfidence: 0.9 } });
  const shownStrict = decisions.filter((d) => strict.get(d.utteranceId).shown).length;
  const shownLive = decisions.filter((d) => ["auto", "propose"].includes(d.action)).length;
  assert.ok(shownStrict < shownLive, `stricter settings show fewer scenes (${shownStrict} < ${shownLive})`);
  assert.equal(replayTrial(trial, { slides: SLIDES, tuning: { minConfidence: 0.9 } }).size, 16);
}

// ---- tuning: suggests the stricter threshold the labels point to ----
{
  const r = tuneFromTrials([trial], SLIDES);
  assert.equal(r.labelled, 16);
  assert.equal(r.recommended, true, JSON.stringify(r));
  assert.equal(r.tuning.minConfidence, 0.9, "above the weak 0.88 proposals, not above the good 0.90 ones");
  assert.equal(r.flips.broken, 0);
  assert.ok(r.flips.fixed >= 6, "the noisy proposals the lecturer rejected are silenced");
  assert.ok(r.loss.leaveOneOut < r.loss.current, "improvement survives leave-one-out");
  assert.equal(r.fidelity, 1);
  assert.match(tuningSummary(r), /90٪.*خارج العينة/);
  // a second lecture by the same person gives the same direction
  const two = tuneFromTrials([trial, recordLecture({ label: "t2", rounds: 1 })], SLIDES);
  assert.equal(two.tuning.minConfidence, 0.9);
}

// ---- refusals: thin, one-sided, or unfaithful evidence yields no suggestion ----
{
  const few = createFieldRecorder({ bundle: "b", storage: memory(), now: () => 1 }); few.setConsent(true); few.start();
  for (let i = 0; i < MIN_LABELLED - 1; i++) { const u = few.utterance({ text: "جملة " + i, slide: 1 }); few.label(few.decision({ slide: 1, action: "propose", kind: "stat", utteranceId: u }), "bad"); }
  const thin = tuneFromTrials([few.last()], SLIDES);
  assert.equal(thin.recommended, false); assert.match(thin.reason, /يلزم 10/);
  const allGood = recordLecture({ label: "good", lowIsBad: false });
  const g = tuneFromTrials([allGood], SLIDES);
  assert.equal(g.recommended, false); assert.match(g.reason, /لا مؤشر/);
  // slides that changed since the lecture make the replay unfaithful: refuse rather than guess
  const hidden = SLIDES.map(() => ({ text: "الدافعية الداخلية تنبع من اهتمام الطالب نفسه بينما الدافعية الخارجية تعتمد على المكافآت في 1990 في 2005 ٦٨ ٣٠ ٧٠ ٤٠ ٣٥ ٢٥", notes: "" }));
  const odd = tuneFromTrials([trial], hidden);
  assert.equal(odd.recommended, false); assert.ok(odd.fidelity < 0.9, "fidelity " + odd.fidelity); assert.match(odd.reason, /لا تطابق/);
  // unlabelled and navigation decisions are not evidence
  assert.deepEqual(labelledItems({ events: [{ type: "decision", utteranceId: 1, action: "return", label: "ok" }, { type: "decision", utteranceId: 2, action: "propose", label: "missed" }, { type: "decision", utteranceId: 3, action: "none" }] }), []);
  assert.equal(tuneFromTrials([], SLIDES).recommended, false);
}
console.log("director-tuning: all checks passed");
