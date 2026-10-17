import assert from "node:assert/strict";
import { rememberScene, recallScene, clearSceneMemory, countSavedScenes } from "../web/scene-memory.js";
import { embed, compatible, toSparse, fromSparse, cosine } from "../web/semantic-index.js";
import { recordDecision, tasteFor, summarizeTaste, clearTaste } from "../web/director-taste.js";

const map = new Map();
const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k),
  key: (i) => [...map.keys()][i], get length() { return map.size; } };
const scene = { type: "stat", title: "نسبة ذكرها المحاضر", lines: ["68%", "من حديث المحاضر"] };
rememberScene({ bundle: "course_a_lecture1", slide: 5, utterance: "في دراسة طلعت إن 68% من الطلبة يتحمسون للألعاب التعليمية", spec: scene }, storage);

const ask = (bundle, slide, utterance) => recallScene({ bundle, slide, utterance }, storage);
// ---- the same idea in different wording, in a DIFFERENT lecture and course ----
for (const wording of [
  "الدراسة أظهرت ان ٦٨ بالمية من الطلاب متحمسين للعب التعليمي",
  "نسبة الطلبة اللي حماسهم زاد مع الألعاب التعليمية 68 بالمية في الدراسة",
  "68% من طلاب الجامعة يحفزهم استخدام الألعاب في التعليم حسب البحث",
]) {
  const hit = ask("course_b_lecture9", 2, wording);
  assert.equal(hit?.reusedAcrossLecture, true, "paraphrase should find the approved scene: " + wording);
  assert.equal(hit.spec.lines[0], "68%");
}
// ---- close but NOT the same fact: must never reuse the scene ----
for (const [why, text] of [
  ["different number", "في دراسة طلعت إن 70% من الطلبة يتحمسون للألعاب التعليمية"],
  ["different population", "في دراسة طلعت إن 68% من المعلمين يتحمسون للألعاب التعليمية"],
  ["opposite polarity", "في دراسة طلعت إن 68% من الطلبة ما يتحمسون للألعاب التعليمية"],
  ["different period", "في دراسة سنة 2020 طلعت إن 68% من الطلبة يتحمسون للألعاب التعليمية"],
  ["same number, other topic", "في دراسة طلعت إن 68% من الطلبة يعانون من قلة النوم"],
  ["number missing", "في دراسة طلعت إن أغلب الطلبة يتحمسون للألعاب التعليمية"],
  ["unrelated", "مقدمة عامة عن المحاضرة وأهدافها لهذا اليوم"],
]) assert.equal(ask("course_b_lecture9", 2, text), null, why);
// Direction words: an increase is not a decrease.
rememberScene({ bundle: "course_a_lecture1", slide: 8, utterance: "ارتفعت نسبة الحضور إلى 80% بعد تطبيق التحفيز", spec: { type: "stat", title: "x", lines: ["80%", "من حديث المحاضر"] } }, storage);
assert.equal(ask("course_a_lecture1", 8, "انخفضت نسبة الحضور إلى 80% بعد تطبيق التحفيز"), null, "opposite direction");
assert.ok(ask("course_a_lecture1", 8, "زادت نسبة الحضور لتصل 80% بعد تطبيق التحفيز"), "same direction, different words");
// Same lecture, farther slide needs a closer match than the same slide.
assert.ok(ask("course_a_lecture1", 5, "دراسة وجدت 68% من الطلبة يتحمسون للألعاب التعليمية"));
// ---- storage holds hashes, not readable text, in the cross-lecture index ----
const cross = map.get("alfa-approved-scenes-cross-v1");
assert.ok(!cross.includes("يتحمسون") && !cross.includes("الطلبة"), "cross index must not store the spoken text");
assert.equal(fromSparse(toSparse(embed("الألعاب التعليمية").vec)).size > 0, true);
assert.equal(fromSparse([[999999, 5]]), null, "malformed vectors are rejected");
assert.equal(fromSparse("x"), null);
assert.ok(cosine(embed("الألعاب التعليمية").vec, embed("الألعاب التعليمية").vec) > 0.999);
// ---- old scenes saved without vectors still work ----
map.set("alfa-approved-scenes-v1:old_lecture", JSON.stringify([{ id: "x", slide: 1, utterance: "المقصود بالتعلم النشط مشاركة الطالب 75%",
  terms: ["تعلم"], spec: { type: "stat", title: "x", lines: ["75%", "من حديث المحاضر"] }, storedAt: 1 }]));
assert.ok(ask("old_lecture", 1, "نقصد بالتعلم النشط مشاركة الطالب 75%"));
// ---- the lecturer can clear memory ----
assert.equal(countSavedScenes("course_a_lecture1", storage), 2);
assert.equal(clearSceneMemory("course_a_lecture1", storage), true);
assert.equal(countSavedScenes("course_a_lecture1", storage), 0);
assert.equal(ask("course_b_lecture9", 2, "الدراسة أظهرت ان ٦٨ بالمية من الطلاب متحمسين للعب التعليمي"), null, "cleared lecture leaves the cross index too");
assert.equal(clearSceneMemory(null, storage), true);
assert.equal(countSavedScenes("old_lecture", storage), 0);

// ---- preference learning: conservative, decaying, reversible ----
const taste = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), key: (i) => [...map.keys()][i], get length() { return map.size; } };
const DAY = 24 * 3600 * 1000;
let now = 1_900_000_000_000;
assert.equal(tasteFor({ bundle: "b1", type: "story" }, taste, now).quieter, false, "no history is neutral");
recordDecision({ bundle: "b1", type: "story", approved: false }, taste, now);
let t = tasteFor({ bundle: "b1", type: "story" }, taste, now);
assert.deepEqual([t.quieter, t.suppressed], [false, false], "a single rejection never changes behaviour");
recordDecision({ bundle: "b1", type: "story", approved: false }, taste, now);
t = tasteFor({ bundle: "b1", type: "story" }, taste, now);
assert.deepEqual([t.quieter, t.suppressed], [true, false], "two rejections: ask first, still propose");
recordDecision({ bundle: "b1", type: "story", approved: false }, taste, now);
recordDecision({ bundle: "b1", type: "story", approved: false }, taste, now);
t = tasteFor({ bundle: "b1", type: "story" }, taste, now);
assert.equal(t.suppressed, true, "repeated rejections quiet that type");
assert.equal(tasteFor({ bundle: "b1", type: "stat" }, taste, now).quieter, false, "no generalisation to other types");
const inherited = tasteFor({ bundle: "b2", type: "story" }, taste, now);
assert.deepEqual([inherited.quieter, inherited.suppressed], [true, false], "other lectures inherit only half the evidence: ask first, never silent");
recordDecision({ bundle: "b1", type: "story", approved: true }, taste, now);
recordDecision({ bundle: "b1", type: "story", approved: true }, taste, now);
recordDecision({ bundle: "b1", type: "story", approved: true }, taste, now);
assert.equal(tasteFor({ bundle: "b1", type: "story" }, taste, now).suppressed, false, "approvals bring the type back");
// Evidence fades with time.
assert.equal(tasteFor({ bundle: "b1", type: "story" }, taste, now + 120 * DAY).quieter, false);
// A decline of content the lecturer approved elsewhere is a timing signal, not taste.
clearTaste(null, taste);
const fp = "0123456789abcdef";
recordDecision({ bundle: "b1", type: "compare", approved: true, fingerprint: fp }, taste, now);
for (let i = 0; i < 3; i++) recordDecision({ bundle: "b1", type: "compare", approved: false, fingerprint: fp }, taste, now);
assert.equal(tasteFor({ bundle: "b1", type: "compare" }, taste, now).quieter, false, "timing-related declines are discounted");
assert.equal(recordDecision({ bundle: "b1", type: "bogus", approved: false }, taste, now), false);
assert.equal(recordDecision({ bundle: "", type: "stat", approved: false }, taste, now), false);
assert.ok(summarizeTaste("b1", taste, now).some((x) => x.type === "compare"));
assert.equal(clearTaste("b1", taste), true);
assert.equal(summarizeTaste("b1", taste, now).length, 0);
console.log("semantic memory: paraphrases reused, near-miss facts refused, hashes only, clearable; taste: conservative, decaying, reversible");
