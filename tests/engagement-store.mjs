import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVoteStore, VoteError } from "../server/votes.mjs";

const dir = mkdtempSync(join(tmpdir(), "alfa-engagement-"));
const file = join(dir, "votes.json");
const phone = (n) => String(n).padStart(2, "0").repeat(16);
try {
  const store = createVoteStore({ file });
  const code = store.createSession();
  assert.deepEqual(store.setLabel(code, "  شعبة 2 <b>"), { label: "شعبة 2 <b>" }, "labels are stored as plain text (rendered with textContent)");
  assert.equal(store.listSessions()[0].label, "شعبة 2 <b>");

  // ---- word cloud ----
  const poll = store.createPoll(code, { kind: "words", question: "كلمة تصف الدافعية؟", objective: "  يحدد الطالب مصادر الدافعية  " });
  assert.equal(poll.kind, "words");
  assert.equal(poll.objective, "يحدد الطالب مصادر الدافعية", "objective is only what the lecturer typed");
  assert.throws(() => store.createPoll(code, { kind: "bogus", question: "x" }), VoteError);
  assert.throws(() => store.submitWords(code, phone(1), ["شغف"]), (e) => e.status === 409, "closed poll takes no words");
  store.setStatus(code, poll.id, "open");
  assert.deepEqual(store.studentState(code, phone(1)).active, { pollId: poll.id, kind: "words", question: "كلمة تصف الدافعية؟", maxWords: 3, remaining: 3 });
  assert.deepEqual(store.submitWords(code, phone(1), ["شغف", "الشغف", "هدف"]), { accepted: 3, rejected: 0 });
  assert.throws(() => store.submitWords(code, phone(1), ["رابعة"]), (e) => e.status === 409, "three words per device");
  assert.equal(store.studentState(code, phone(1)).active.remaining, 0);
  store.submitWords(code, phone(2), ["شغف", "اتصل 99887766", "two words", "يلعنننن"]);
  const rejections = store.submitWords(code, phone(3), ["ههههههههههههه"]);
  assert.deepEqual(rejections, { accepted: 0, rejected: 1 });
  assert.throws(() => store.vote(code, phone(4), 0), (e) => e.status === 409, "a words poll is not a choice poll");
  assert.throws(() => store.submitWords(code, "short", ["x"]), VoteError);
  let lecturer = store.presenterState(code).polls[0];
  assert.deepEqual(lecturer.words.map((w) => [w.word, w.count]).slice(0, 2), [["شغف", 3], ["هدف", 1]], "folded variants merge (شغف / الشغف)");
  assert.ok(!lecturer.words.some((w) => /99887766|يلعن|هه/.test(w.word)), "PII, abuse and spam never enter the cloud");
  assert.equal(lecturer.submissions, 4, "only accepted words are counted");
  // The lecturer can hide a word; students only ever see revealed, non-hidden words.
  assert.equal("words" in store.studentState(code, phone(5)).active, false, "hidden until revealed");
  store.setReveal(code, poll.id, true);
  assert.deepEqual(store.studentState(code, phone(5)).active.words.map((w) => w.word), ["شغف", "هدف"]);
  store.hideWord(code, poll.id, "هدف", true);
  assert.deepEqual(store.studentState(code, phone(5)).active.words.map((w) => w.word), ["شغف"]);
  assert.equal(store.presenterState(code).polls[0].words.find((w) => w.key === "هدف").hidden, true);
  store.hideWord(code, poll.id, "هدف", false);
  assert.equal(store.studentState(code, phone(5)).active.words.length, 2);
  assert.throws(() => store.hideWord(code, poll.id, "غير-موجودة"), (e) => e.status === 404);
  // Persistence stores aggregate words only: no device tokens.
  const disk = readFileSync(file, "utf8");
  assert.ok(!disk.includes(phone(1)) && !disk.includes(phone(2)), "device tokens are not written for word polls");
  const reloaded = createVoteStore({ file });
  assert.equal(reloaded.presenterState(code).polls[0].words[0].count, 3);
  // A repeated word question starts empty but keeps the objective.
  const again = reloaded.repeatPoll(code, poll.id);
  assert.equal(again.kind, "words"); assert.equal(again.objective, "يحدد الطالب مصادر الدافعية");
  assert.deepEqual(reloaded.presenterState(code).polls.at(-1).words, []);

  // ---- questions: privacy refusal and moderation flag ----
  reloaded.setStatus(code, again.id, "closed");
  const bad = reloaded.submitQuestion(code, phone(7), "ليش الألعاب مفيدة؟");
  assert.ok(bad.id);
  assert.throws(() => reloaded.submitQuestion(code, phone(8), "كلموني على 99887766"), (e) => e.status === 422);
  assert.throws(() => reloaded.submitQuestion(code, phone(9), "شوفوا https://x.example"), (e) => e.status === 422);
  reloaded.submitQuestion(code, phone(10), "يا ابن الكلب شرح سيء");
  const inbox = reloaded.listQuestions(code);
  assert.equal(inbox.find((q) => q.text.includes("ابن الكلب")).flagged, true, "abuse is accepted but flagged for the lecturer");
  assert.equal(inbox.find((q) => q.text.includes("الألعاب")).flagged, false);
  assert.ok(!JSON.stringify(inbox).match(/token|phone/), "questions keep no device identity");
  console.log("engagement store: word cloud with moderation/limits/hiding, objectives, PII refusal, flagged questions, labels passed");
} finally { rmSync(dir, { recursive: true, force: true }); }
