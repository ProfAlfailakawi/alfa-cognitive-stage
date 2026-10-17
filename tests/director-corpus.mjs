// Labeled Kuwaiti-dialect corpus for the director brain: detection accuracy AND unwanted interventions.
// The corpus is hand-written; it demonstrates behaviour on these cases, not general accuracy.
import assert from "node:assert/strict";
import { createDirectorBrain, numeralizePercents, keywords } from "../web/director-brain.js";

let clock = 1_000_000;
function run(c) {
  const brain = createDirectorBrain({ now: () => clock });
  let decision = null;
  for (const say of c.say) {
    clock += c.gapMs ?? 7000;
    decision = brain.observe(say, { slide: { index: c.slideIndex ?? 3, text: c.slide?.text || "", notes: c.slide?.notes || "" },
      overlay: c.overlay || null, mode: c.mode || "balanced", mediaPlaying: Boolean(c.media) });
    if (c.shown && say === c.say.at(-2)) brain.noteShown(c.slideIndex ?? 3);
  }
  clock += 60000;
  return decision;
}

const stat = (lines0) => ({ type: "stat", title: "x", lines: [lines0, "من حديث المحاضر"] });
const positives = [
  { id: "stat digits", say: ["في دراسة طلعت إن ٦٨ بالمية من الطلبة يستخدمون الجوال وايد"], expect: { action: "auto", kind: "stat", line: "68%" } },
  { id: "stat spoken number", say: ["نسبة الطلاب اللي نجحوا خمسة وسبعين بالمية"], expect: { action: "auto", kind: "stat", line: "75%" } },
  { id: "stat tens", say: ["الدراسة أظهرت إن نسبة الرضا ستين بالمية"], expect: { action: "auto", kind: "stat", line: "60%" } },
  { id: "stat safe mode asks", mode: "safe", say: ["في دراسة طلعت إن ٦٨ بالمية من الطلبة استفادوا"], expect: { action: "propose", kind: "stat" } },
  { id: "stat shadow observes only", mode: "shadow", say: ["في دراسة طلعت إن ٦٨ بالمية من الطلبة استفادوا"], expect: { action: "observe", kind: "stat" } },
  { id: "from-to spoken", say: ["ارتفعت النسبة من ثلاثين بالمية إلى سبعين بالمية"], expect: { action: "auto", kind: "compare", line: "من 30% | إلى 70%" } },
  { id: "was-became", say: ["كانت نسبة المشاركة 30 بالمية وصارت 70 بالمية"], expect: { action: "auto", kind: "compare", line: "كانت 30% | صارت 70%" } },
  { id: "ordered steps", say: ["أول شي نحدد الهدف ثاني شي نجمع البيانات ثالث شي نحلل النتائج"], expect: { action: "auto", kind: "steps" } },
  { id: "question opportunity", say: ["تتوقعون شنو راح يصير لو طبقنا هالطريقة"], expect: { action: "none", kind: "question" } },
  { id: "contrast clauses", say: ["الدافعية الداخلية تنبع من اهتمام الطالب نفسه بينما الدافعية الخارجية تعتمد على المكافآت"],
    expect: { action: "propose", kind: "compare" } },
  { id: "timeline years", say: ["في 1990 ظهرت اول نسخة من البرنامج وفي 2005 صار الانتشار الواسع"], expect: { action: "propose", kind: "timeline" } },
  { id: "story opens", say: ["مرة واحد من الطلاب كان يلعب طول الليل"], expect: { action: "none", kind: "story" } },
  { id: "story grows (creative auto)", mode: "creative", say: ["مرة واحد من الطلاب كان يلعب طول الليل", "وتاليها نام وهو يدرس في المكتبة", "وفي الصبح ما قدر يدخل الاختبار"],
    expect: { action: "auto", kind: "story" } },
  { id: "story grows (balanced proposes)", say: ["مرة واحد من الطلاب كان يلعب طول الليل", "وتاليها نام وهو يدرس في المكتبة"], expect: { action: "propose", kind: "story" } },
  { id: "return", say: ["زين خلونا نرجع للعرض"], expect: { action: "return" } },
  { id: "return one level", say: ["نرجع للي قبل"], expect: { action: "return-level" } },
  { id: "correction needs approval", overlay: stat("68%"), say: ["عفواً أقصد إن نسبة الطلبة في الدراسة ٨٦ بالمية"],
    expect: { action: "propose", kind: "correction", line: "86%" } },
  { id: "retraction hides on request", overlay: stat("68%"), say: ["انسوا اللي قلت هذا الرقم غلط"], expect: { action: "propose", kind: "retract" } },
  { id: "concept opportunity", say: ["المقصود بالتعلم النشط إن الطالب يشارك بنفسه"], expect: { kind: "concept", action: "none" } },
  { id: "example opportunity", say: ["خلوني أعطيكم مثال من الجامعة"], expect: { kind: "example", action: "none" } },
];
const silent = (id, say, extra = {}) => ({ id, say, expect: { silent: true }, ...extra });
const negatives = [
  silent("greeting", ["يلا شباب نبدأ محاضرة اليوم"]),
  silent("page reference", ["نفتح الكتاب صفحة 45"]),
  silent("slide reference", ["الشريحة 12 فيها تعريف"]),
  silent("break", ["بعد 5 دقايق ناخذ استراحة"]),
  silent("idiom hundred percent", ["ابي مية بالمية تركيز منكم"]),
  silent("plain claim without number", ["الطلبة اللي يغيبون كثير ما يفهمون"]),
  silent("rhetorical", ["شفتوا شلون؟"]),
  silent("check understanding", ["زين فاهمين؟"]),
  silent("moving on", ["الحين نروح للنقطة الثانية"]),
  silent("mentions study without number", ["الدراسة اللي قلت لكم عنها"]),
  silent("stat already on slide", ["في دراسة 68 بالمية من الطلبة استخدموا الجوال"], { slide: { text: "دراسة: 68% من الطلبة" } }),
  silent("slide reads aloud", ["الشريحة تقول 40 بالمية من الطلاب"], { slide: { notes: "40% من الطلاب" } }),
  silent("video playing", ["في دراسة طلعت إن ٦٨ بالمية من الطلبة"], { media: true }),
  silent("contradictory direction", ["ارتفعت النسبة من 70% إلى 30%"]),
  silent("three values", ["النسبة من 30% إلى 70% إلى 90%"]),
  silent("out of range", ["نسبة الطلاب 140 بالمية"]),
  silent("two unrelated percentages", ["الدراسة فيها 30% وعندنا 70%"]),
  silent("scattered ordinals", ["أول شي سلموا الواجب وبعدين ثاني شي الاختبار"]),
  silent("years not ordered", ["في 2010 صار شي وفي 1995 صار شي ثاني"]),
  silent("single year", ["في 2010 ظهر البرنامج"]),
  silent("filler", ["يعني زين هاه"]),
  silent("short contrast", ["هذا بينما ذاك"]),
  silent("past tense discussion is not an activity", ["ناقشنا الموضوع أمس مع الطلبة الجداد"]),
  silent("activity word as noun", ["هذا النشاط موجود في الكتاب صفحة عشرين"]),
  silent("shadow stays silent", ["في دراسة 68 بالمية من الطلبة استخدموا الجوال"], { mode: "shadow", expectObserve: true }),
];

let hit = 0;
for (const c of positives) {
  const d = run(c);
  const e = c.expect;
  const kind = e.kind === undefined || d.kind === e.kind || d.opportunity === e.kind;
  const action = e.action === undefined || d.action === e.action;
  const line = e.line === undefined || d.spec?.lines?.[0] === e.line;
  assert.ok(kind && action && line, `${c.id}: expected ${JSON.stringify(e)} got ${JSON.stringify({ action: d.action, kind: d.kind, opp: d.opportunity, line: d.spec?.lines?.[0], why: d.why })}`);
  hit++;
}
let unwanted = 0;
for (const c of negatives) {
  const d = run(c);
  const quiet = d.action === "none" || (c.expectObserve && d.action === "observe");
  if (!quiet || (d.action === "none" && d.spec)) { unwanted++; console.log("UNWANTED", c.id, JSON.stringify({ action: d.action, kind: d.kind })); }
}
assert.equal(unwanted, 0, `${unwanted} unwanted intervention(s)`);

// ---- continuity: topic shifts, returning to a topic, duplicate suppression, pacing ----
{
  let t = 5_000_000;
  const brain = createDirectorBrain({ now: () => t });
  const say = (text, extra = {}) => { t += 6000; return brain.observe(text, { slide: { index: 4 }, mode: "creative", ...extra }); };
  say("مرة واحد من الطلاب كان يلعب طول الليل");
  say("نام وهو يدرس في المكتبة قدام الكل");
  const offA = say("الحين نتكلم عن أنظمة التقييم الجامعية وطرق احتساب المعدل");
  const offB = say("نظام النقاط في التقييم الجامعي يختلف حسب الكلية والتخصص");
  assert.equal(offA.topic.shifted, true, "an announced new subject closes the open story at once");
  assert.equal(offB.topic.shifted, false);
  const afterShift = say("وتاليها استيقظ متأخر عن الاختبار");
  assert.equal(afterShift.spec, null, "the story was closed by the topic shift, not silently resumed");
  // Without an announcement, three unrelated sentences are needed to end an open story.
  const quiet = createDirectorBrain({ now: () => t });
  const go = (x) => { t += 6000; return quiet.observe(x, { slide: { index: 4 }, mode: "creative" }); };
  go("مرة واحد من الطلاب كان يلعب طول الليل");
  go("نام وهو يدرس في المكتبة قدام الكل");
  const flags = [
    go("نظام النقاط في التقييم الجامعي يختلف حسب الكلية والتخصص").topic.shifted,
    go("الدرجات النهائية تحسب من الاختبارات والمشاريع والمشاركة الصفية").topic.shifted,
    go("اختبار منتصف الفصل يشكل نسبة محددة من المعدل النهائي").topic.shifted,
  ];
  assert.deepEqual(flags, [false, true, false], "the open story ends only after repeated unrelated sentences");
  const dup1 = say("في دراسة طلعت إن 68 بالمية من الطلبة استفادوا");
  assert.equal(dup1.action, "auto");
  brain.noteShown(4);
  const dup2 = say("في دراسة طلعت إن 68 بالمية من الطلبة استفادوا");
  assert.equal(dup2.action, "none", "same statistic repeated is suppressed");
  const quick = say("ونسبة الرضا كانت خمسين بالمية في الدراسة نفسها");
  assert.equal(quick.action, "none", "quiet period after a scene");
  assert.ok(quick.why.some((w) => w.includes("هدوء")));
  t += 20000;
  const later = say("وفي الدراسة نفسها نسبة الرضا كانت خمسين بالمية");
  assert.equal(later.action, "auto", "after the quiet period the next clear statistic is shown");
}
{
  // Per-slide cap: no more than four scene proposals on one slide.
  let t = 9_000_000;
  const brain = createDirectorBrain({ now: () => t });
  const results = [];
  for (let i = 0; i < 6; i++) {
    t += 30000;
    const d = brain.observe(`في دراسة ${10 + i * 7} بالمية من الطلبة حققوا نتيجة`, { slide: { index: 9 }, mode: "balanced" });
    if (d.action === "auto") brain.noteShown(9);
    results.push(d.action);
  }
  assert.deepEqual(results, ["auto", "auto", "auto", "auto", "none", "none"]);
}
{
  // Cloud is eligible only for opportunities without local data, rarely, and with enough spoken context.
  let t = 20_000_000;
  const brain = createDirectorBrain({ now: () => t });
  const say = (x) => { t += 8000; return brain.observe(x, { slide: { index: 2 }, mode: "balanced" }); };
  const first = say("مرة واحد من الطلاب كان يلعب طول الليل ويسهر");
  assert.ok(first.cloudText && first.cloudText.length >= 40, "story opportunity may ask the cloud when enabled");
  brain.noteCloudRequest();
  const second = say("وبعدين حصل له موقف غريب في الجامعة");
  assert.equal(second.cloudText, null, "cooldown prevents repeated billed requests");
  assert.equal(say("في دراسة طلعت إن 68 بالمية من الطلبة استفادوا").cloudText, null, "a local statistic never uses the cloud");
}

{
  // A statistic is never re-fired by the next unrelated sentence, but a split statistic still completes.
  let t = 30_000_000;
  const brain = createDirectorBrain({ now: () => t });
  const say = (x) => { t += 9000; return brain.observe(x, { slide: { index: 6 }, mode: "balanced" }); };
  assert.equal(say("في دراسة طلعت إن 68 بالمية من الطلبة استفادوا").action, "auto");
  brain.noteShown(6);
  t += 20000;
  assert.equal(say("يلا نبدأ المحاضرة اليوم").action, "none", "no re-detection from the earlier sentence");
  assert.equal(say("وبعدين نشوف التفاصيل").action, "none");
  t += 60000;
  assert.equal(say("الدراسة اللي تكلمنا عنها قبل شوي").action, "none");
}

// ---- helpers ----
assert.equal(numeralizePercents("خمسة وسبعين بالمية"), "75 بالمية");
assert.equal(numeralizePercents("تسعين في المية من الطلبة"), "90 في المية من الطلبة");
assert.equal(numeralizePercents("مية بالمية"), "100 بالمية");
assert.equal(numeralizePercents("خمسه وسبعين طالب"), "خمسه وسبعين طالب", "numbers not followed by a percent word are untouched");
assert.equal(numeralizePercents("ثلاثين وعشرين بالمية"), "ثلاثين وعشرين بالمية", "ambiguous compounds stay as spoken");
assert.ok(keywords("الدافعية الداخلية عند الطلبة").has("دافعيه"));
console.log(`director corpus: ${hit}/${positives.length} expected detections, ${negatives.length} quiet cases, 0 unwanted interventions`);
