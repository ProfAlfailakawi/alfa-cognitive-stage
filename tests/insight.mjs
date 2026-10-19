// Understanding pulse, number witness, coach, review, question bank and rehearsal audience.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVoteStore } from "../server/votes.mjs";
import { createQuestionBank } from "../server/question-bank.mjs";
import { studentSurfaceAllows } from "../server/security.mjs";
import { checkSpoken, createNumberWitness, numberFacts, unmatchedNumber } from "../web/number-witness.js";
import { coachSuggestion, COACH_RULES, dwellBySlide } from "../web/lecture-coach.js";
import { buildReview, reviewToMarkdown } from "../web/review-builder.js";
import { expectedQuestions } from "../web/audience-sim.js";

const dir = mkdtempSync(join(tmpdir(), "alfa-insight-"));
const LEC = "0123456789ab";
const tok = (c) => c.repeat(32);
try {
  // ---- pulse ----
  const file = join(dir, "votes.json");
  const realNow = Date.now; let t = 1_900_000_000_000; Date.now = () => t;
  const store = createVoteStore({ file });
  const code = store.createSession();
  assert.throws(() => store.sendPulse(code, tok("a"), "lost"), (e) => e.status === 409, "no pulse before the lecturer starts");
  assert.throws(() => store.setContext(code, { lecture: "bad", slide: 1 }));
  store.setContext(code, { lecture: LEC, slide: 3 });
  assert.throws(() => store.sendPulse(code, "short", "lost"));
  assert.throws(() => store.sendPulse(code, tok("a"), "maybe"));
  store.sendPulse(code, tok("a"), "lost");
  assert.throws(() => store.sendPulse(code, tok("a"), "got"), (e) => e.status === 429, "cooldown");
  t += 3500; store.sendPulse(code, tok("a"), "got");
  assert.deepEqual(store.pulseReport(code), [{ lecture: LEC, slide: 3, got: 1, lost: 0, questions: 0 }], "changing your mind moves the signal, never doubles it");
  t += 3500; store.sendPulse(code, tok("a"), "got");
  assert.equal(store.pulseReport(code)[0].got, 1, "repeating the same state is a no-op");
  assert.equal(store.pulseLive(code).hidden, true, "one device is never shown as a share");
  for (const c of "bcdef") store.sendPulse(code, tok(c), c <= "d" ? "lost" : "got");
  let live = store.pulseLive(code);
  assert.deepEqual([live.hidden, live.devices, live.lost, live.got, live.level], [false, 6, 3, 3, "watch"], JSON.stringify(live));
  t += 130_000;
  assert.equal(store.pulseLive(code).devices, 0, "signals age out of the live window");
  assert.equal(store.pulseReport(code)[0].lost, 3, "…but stay in the per-slide totals");
  store.setContext(code, { lecture: LEC, slide: 4 });
  t += 3500; store.sendPulse(code, tok("a"), "lost");
  assert.equal(store.pulseReport(code).find((r) => r.slide === 4).lost, 1, "a new slide starts its own count");
  // privacy: tokens never reach disk
  const disk = readFileSync(file, "utf8");
  for (const c of "abcdef") assert.ok(!disk.includes(tok(c)), "no device token on disk");
  const reloaded = createVoteStore({ file });
  assert.deepEqual(reloaded.pulseReport(code), store.pulseReport(code), "aggregates survive a restart");

  // question attribution + keep
  t += 31000;
  store.submitQuestion(code, tok("a"), "ما الفرق بين العينة والمجتمع؟");
  const [q] = store.listQuestions(code);
  assert.equal(q.slide, `${LEC}#4`);
  assert.equal(store.pulseReport(code).find((r) => r.slide === 4).questions, 1);
  assert.deepEqual(store.keepQuestion(code, q.id), { text: "ما الفرق بين العينة والمجتمع؟", slide: `${LEC}#4` });
  const history = store.lectureHistory(LEC);
  assert.equal(history.length, 1);
  assert.deepEqual(history[0].slides.map((s) => s.slide), [3, 4]);
  assert.throws(() => store.lectureHistory("../etc"));

  // review
  assert.throws(() => store.studentReview(code), (e) => e.status === 404);
  assert.throws(() => store.publishReview(code, { title: "x", items: [] }));
  store.publishReview(code, { title: "مراجعة", items: [{ slide: 2, heading: "<b>عنوان</b>", lines: ["سطر 1", "سطر 2"] }] });
  assert.equal(createVoteStore({ file }).studentReview(code).items[0].lines.length, 2, "a published review survives a restart");
  store.unpublishReview(code);
  assert.throws(() => store.studentReview(code), (e) => e.status === 404);
  Date.now = realNow;

  // ---- security surface ----
  assert.equal(studentSurfaceAllows("POST", "/api/sessions/ABCDEF/pulse"), true);
  assert.equal(studentSurfaceAllows("POST", "/api/sessions/ABCDEF/pulse/context"), false, "context is lecturer-only");
  assert.equal(studentSurfaceAllows("GET", "/api/sessions/ABCDEF/review"), true);
  assert.equal(studentSurfaceAllows("POST", "/api/sessions/ABCDEF/review"), false, "publishing is lecturer-only");
  assert.equal(studentSurfaceAllows("GET", "/review.html"), true);
  assert.equal(studentSurfaceAllows("GET", "/api/coach/" + LEC), false);
  assert.equal(studentSurfaceAllows("GET", "/api/bank/" + LEC), false);

  // ---- number witness ----
  const slide = "نسبة الرضا عن المقرر 68% وعدد الطلاب 120 في عام 2024";
  assert.ok(checkSpoken("نسبة الرضا حوالي تسعين بالميه", slide), "disagreeing percentage about the same subject");
  assert.equal(checkSpoken("نسبة الرضا ثمانية وستين بالميه", slide), null, "quoting the printed number is fine");
  assert.equal(checkSpoken("نسبة الرضا 68 بالمئة", slide), null);
  assert.equal(checkSpoken("نسبة الحضور تسعين بالميه", slide), null, "different subject: no alert");
  assert.equal(checkSpoken("في عام 2019 بدأنا", slide), null, "years are ignored");
  assert.equal(checkSpoken("عندنا 3 أمثلة", slide), null, "small counts are ignored");
  assert.equal(checkSpoken("خمسة وعشرين بالميه فقط", slide), null, "no subject words: no alert");
  assert.deepEqual(checkSpoken("الرضا ٩٠٪", "الرضا ٦٨٪"), { said: 90, printed: 68, unit: "%", about: ["رضا"] }, "Arabic-Indic digits");
  assert.equal(checkSpoken("نسبة الرضا 90 بالمئة", ""), null);
  assert.ok(checkSpoken("نسبة الرضا 90 بالمئة", "نسبة الحضور 90% ونسبة الرضا 68%"), "unrelated equal figure cannot hide a discrepancy");
  assert.equal(checkSpoken("نسبة الرضا 90 بالمئة", "نسبة الحضور 68% ونسبة الرضا 90%"), null, "same-subject equality remains safe");
  assert.equal(numberFacts("الرضا ٣٧٫٥٪")[0].value, 37.5, "Arabic decimal separator");
  assert.ok(unmatchedNumber("90%", slide), "a published number the slide never prints is queried");
  assert.equal(unmatchedNumber("68%", slide), null);
  assert.equal(unmatchedNumber("90%", "شريحة بلا أرقام"), null, "nothing to compare against: no alert");
  assert.equal(unmatchedNumber("12 من 40", slide), null, "plain counts are not percentages");
  const witness = createNumberWitness();
  assert.ok(witness.check(5, "نسبة الرضا 90 بالمئة", slide)?.message.includes("تنبيه لك وحدك"));
  assert.equal(witness.check(5, "نسبة الرضا 90 بالمئة", slide), null, "one slip is reported once per slide");
  assert.ok(witness.check(6, "نسبة الرضا 90 بالمئة", slide), "…but again on another slide");
  assert.equal(numberFacts("").length, 0);

  // Small hand-written corpus: no alert on quoting, rounding talk or unrelated numbers; alert on a real slip.
  const corpus = [
    ["الرضا وايد حلو يوصل لخمسه وسبعين بالميه", "نسبة الرضا 75%", false],
    ["الرضا يوصل لخمسه وسبعين بالميه", "نسبة الرضا 57%", true],
    ["نسبة الحضور تقريباً تسعين بالميه", "نسبة الحضور 91%", true],
    ["عندنا ثلاث نقاط مهمة", "نسبة الحضور 91%", false],
    ["في سنة 2020 كانت النسبة مختلفة", "نسبة الحضور 91%", false],
    ["الطلاب اللي حضروا ثلاثين بالميه بس", "نسبة الحضور 70%", false],
    ["خلونا نشوف الحضور 70 بالمئة", "نسبة الحضور 70%", false],
    ["الاختبار ثلثين بالميه من الدرجة", "الاختبار 40% من الدرجة", false],
    ["الاختبار أربعين بالميه من الدرجة", "الاختبار 30% من الدرجة", true],
    ["", "نسبة الحضور 70%", false],
  ];
  for (const [spoken, printed, expect] of corpus) assert.equal(Boolean(checkSpoken(spoken, printed)), expect, `${spoken} | ${printed}`);

  // ---- coach ----
  const S = (label, rows) => ({ label, createdAt: 1, slides: rows.map(([slide, got, lost, questions = 0]) => ({ slide, got, lost, questions })) });
  assert.equal(coachSuggestion([]), null);
  assert.equal(coachSuggestion([S("أ", [[2, 8, 1]])]), null, "calm data produces no suggestion");
  assert.equal(coachSuggestion([S("أ", [[2, 1, 3]])]), null, "below the device minimum nothing is claimed");
  const repeated = coachSuggestion([S("الأحد", [[4, 4, 4], [5, 9, 0]]), S("الثلاثاء", [[4, 3, 5]])]);
  assert.equal(repeated.rule, "repeated-lost"); assert.equal(repeated.slide, 4); assert.equal(repeated.evidence.length, 2);
  const single = coachSuggestion([S("الأحد", [[4, 4, 4]])]);
  assert.equal(single.rule, "single-lost"); assert.match(single.text, /لا يكفي/, "a single session is not called a pattern");
  const questions = coachSuggestion([S("الأحد", [[2, 0, 0, 1], [6, 0, 0, 5], [7, 0, 0, 1]])]);
  assert.equal(questions.rule, "question-cluster"); assert.equal(questions.slide, 6);
  assert.ok(coachSuggestion([S("أ", [[4, 4, 4], [2, 0, 0, 5]]), S("ب", [[4, 3, 6]])]).rule === "repeated-lost", "repeated confusion outranks one question cluster");
  const dwell = { 1: [30000, 40000, 35000], 2: [200000, 220000, 40000], 3: [20000, 30000, 25000] };
  const slow = coachSuggestion([S("أ", [[1, 9, 0]])], dwell);
  assert.equal(slow.rule, "slow-slide"); assert.equal(slow.slide, 2); assert.match(slow.text, /لا يعني أن فيها مشكلة/);
  assert.deepEqual(dwellBySlide([{ slides: [{ index: 1, ms: 5 }] }, { slides: [{ index: 1, ms: 7 }] }]), { 1: [5, 7] });
  assert.ok(COACH_RULES.minDevices >= 5);

  // ---- review builder ----
  const report = { lecture: "x", scenes: { list: [
    { slide: 3, type: "stat", title: "رضا الطلبة", lines: ["68% راضون"] },
    { slide: 3, type: "stat", title: "رضا الطلبة", lines: ["68% راضون"] },
    { slide: 1, type: "steps", title: "", lines: ["أولاً", "ثانياً"] },
    { slide: 2, type: "concept", title: "", lines: [] }] } };
  const review = buildReview(report, { title: "مقدمة", slides: [{ index: 1, title: "البداية" }] });
  assert.deepEqual(review.items.map((i) => i.slide), [1, 3], "duplicates and empty scenes are dropped, slides in order");
  assert.equal(review.items[0].heading, "البداية", "an untitled scene borrows the lecture's own slide title");
  assert.ok(reviewToMarkdown(review).includes("68% راضون"));
  assert.ok(!JSON.stringify(review).includes("<"));

  // ---- question bank + rehearsal audience ----
  const bankFile = join(dir, "bank.json");
  const bank = createQuestionBank({ file: bankFile });
  const a = bank.keep({ lecture: LEC, slide: 3, text: "ما الفرق بين العينة والمجتمع الإحصائي؟" });
  assert.equal(bank.keep({ lecture: LEC, slide: 3, text: "ما الفرق بين العينة والمجتمع الإحصائي؟" }).duplicate, true);
  bank.keep({ lecture: LEC, slide: 5, text: "كيف نحسب نسبة الحضور في الشعبة؟" });
  assert.throws(() => bank.keep({ lecture: "zz", slide: 1, text: "سؤال طويل كفاية" }));
  assert.throws(() => bank.keep({ lecture: LEC, slide: 1, text: "اتصل على 99887766 الان" }), (e) => e.status === 422, "personal data is never kept");
  const disk2 = readFileSync(bankFile, "utf8");
  assert.ok(!/token|session|code|createdAt/i.test(disk2), "a kept question carries no identity or time");
  assert.equal(createQuestionBank({ file: bankFile }).list(LEC).length, 2);
  const slides = [{ index: 3, text: "العينة والمجتمع" }, { index: 4, text: "نسبة الحضور في الشعبة والمقرر" }, { index: 9, text: "خاتمة" }];
  const expected = expectedQuestions(bank.list(LEC), slides);
  assert.equal(expected[3][0].origin, "same-slide");
  assert.equal(expected[4][0].origin, "related", "a question about attendance rates also fits the slide on attendance");
  assert.equal(expected[9], undefined, "nothing is invented for an unrelated slide");
  assert.equal(bank.remove(a.item.id).ok, true);
  assert.equal(bank.clearAll().removed, 1);
  console.log("insight: all checks passed");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
