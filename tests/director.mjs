import assert from "node:assert/strict";
import { interpretSpeech, eligibleForCloud, normalizeArabic } from "../web/director-core.js";
import { createDirectorBrain } from "../web/director-brain.js";

assert.equal(normalizeArabic("٦٨٪"), "68%");
const stat = interpretSpeech("في دراسة ذكرت أن ٦٨٪ من الطلبة استفادوا");
assert.equal(stat.kind, "stat");
assert.equal(stat.spec.lines[0], "68%");
assert.equal(stat.spec.lines[1], "من الطلبة استفادوا", "the caption is the lecturer's own words after the number, in their spelling");
// no words after the number: the number stands alone; no source note and no "from the lecturer" filler is ever added
assert.deepEqual(interpretSpeech("وبناء على الدراسة او الاحصائية فهناك ٢٥٪ مقارنة مع").spec.lines, ["25%"]);
assert.equal(interpretSpeech("وبناء على الدراسة او الاحصائية فهناك ٢٥٪ مقارنة مع").dangling, true);
assert.deepEqual(interpretSpeech("نسبة الناجحين 40%").spec.lines, ["40%"]);
for (const said of ["نسبة الناجحين 40%", "في دراسة ذكرت أن ٦٨٪ من الطلبة استفادوا", "وبناء على الدراسة فهناك ٢٥٪ من الطلاب يفضلون التعلم النشط مقارنة مع ٦٠٪ يفضلون المحاضرة", "الخطوة الأولى نجمع البيانات والخطوة الثانية نحللها والخطوة الثالثة نكتب النتيجة", "الفرق بين الألعاب التعليمية والترفيهية"]) {
  const spec = interpretSpeech(said)?.spec;
  assert.ok(spec && !/(?<![\p{L}])المحاضر(?![\p{L}])|المصدر غير معروض/u.test(spec.title + " " + spec.lines.join(" ")), "no filler wording on the student screen: " + said);
}
// "الفرق بين X و Y" becomes a two-sided scene made only of the lecturer's own words
assert.deepEqual(interpretSpeech("الفرق بين الألعاب التعليمية والترفيهية").spec.lines, ["الألعاب التعليمية | الترفيهية"]);
assert.equal(interpretSpeech("يختلف عن غيره")?.spec, undefined);
// two percentages joined by an explicit comparison word -> two bars labelled with the lecturer's words
const versus = interpretSpeech("وبناء على الدراسة فهناك ٢٥٪ من الطلاب يفضلون التعلم النشط مقارنة مع ٦٠٪ يفضلون المحاضرة");
assert.equal(versus.kind, "bars");
assert.deepEqual(versus.spec.lines, ["من الطلاب يفضلون التعلم النشط | 25%", "يفضلون المحاضرة | 60%"]);
assert.equal(interpretSpeech("في الدراسة 30% و 50% من الطلاب")?.kind ?? null, null, "two numbers without a stated relation are never paired");
assert.equal(interpretSpeech("نسبة 140% من الطلبة")?.kind, undefined);
assert.equal(interpretSpeech("زين نرجع لموضوعنا").kind, "return");
assert.equal(interpretSpeech("بقولكم قصة عن شخص كان يلعب كل يوم").kind, "story");
assert.equal(interpretSpeech("الفرق بين الألعاب التعليمية والترفيهية").kind, "compare");
assert.equal(interpretSpeech("تتوقعون شنو راح يصير؟").kind, "question");
assert.equal(interpretSpeech("نشرح المقدمة اليوم"), null);
assert.equal(eligibleForCloud(stat, "في دراسة ذكرت أن ٦٨٪"), false);
assert.equal(eligibleForCloud(interpretSpeech("بقولكم قصة مؤثرة عن شخص"), "بقولكم قصة مؤثرة عن شخص"), true);
assert.equal(eligibleForCloud(interpretSpeech("زين نرجع لموضوعنا"), "زين نرجع لموضوعنا"), false);
assert.equal(interpretSpeech("ذكرت الدراسة نسبة 68% عفواً أقصد 86%")?.spec?.lines[0],"86%");
assert.equal(interpretSpeech("ارتفعت النسبة من 30% إلى 70%")?.kind,"compare");
assert.equal(interpretSpeech("وصلت نسبة المشاركة إلى ٧٤ بالمية")?.spec?.lines[0],"74%");
const fromTo = interpretSpeech("ارتفعت النسبة من ٣٠٪ إلى ٧٠٪");
assert.equal(fromTo?.kind, "compare");
assert.deepEqual(fromTo?.spec?.lines, ["من 30% | إلى 70%"]);
assert.equal(fromTo?.confidence, 0.96);
const beforeAfter = interpretSpeech("كانت نسبة 30 بالمية وصارت 70 بالمية");
assert.equal(beforeAfter?.kind, "compare");
assert.deepEqual(beforeAfter?.spec?.lines, ["كانت 30% | صارت 70%"]);
assert.equal(interpretSpeech("الدراسة فيها 30% وعندنا 70%")?.kind, undefined,
  "Two separate facts are not necessarily a sequence");
assert.equal(interpretSpeech("ارتفعت النسبة من 70% إلى 30%")?.kind, undefined,
  "Contradictory direction cannot be auto-visualized");
assert.equal(interpretSpeech("انخفضت النسبة من 30% إلى 70%")?.kind, undefined);
assert.equal(interpretSpeech("ارتفعت النسبة من 30% إلى 180%")?.kind, undefined,
  "Out-of-range percentages are rejected");
assert.equal(interpretSpeech("النسبة من 30% إلى 70% إلى 90%")?.kind, undefined,
  "Three values must not be reduced to an arbitrary pair");
assert.equal(interpretSpeech("النسبة من 30% إلى 70% عفواً أقصد 80%")?.kind, "stat",
  "Existing explicit correction path is preserved");
console.log("director-core: all checks passed");

// a comparison left hanging is completed by the next sentence that carries one number
{
  let t = 1e6; const brain = createDirectorBrain({ now: () => t });
  const a = brain.observe("وبناء على الدراسة او الاحصائية فهناك ٢٥٪ مقارنة مع", { slide: { index: 1 } });
  assert.equal(a.kind, "stat"); t += 4000;
  const b = brain.observe("ستين بالمية في المحاضرة التقليدية", { slide: { index: 1 } });
  assert.equal(b.kind, "bars"); assert.equal(b.action, "auto");
  assert.deepEqual(b.spec.lines, ["النسبة الأولى | 25%", "في المحاضرة التقليدية | 60%"]);
  t += 40000; brain.observe("وبناء على الدراسة فهناك ٢٥٪ مقارنة مع", { slide: { index: 2 } }); t += 30000;
  assert.notEqual(brain.observe("ستين بالمية في المحاضرة", { slide: { index: 2 } }).kind, "bars", "too late: no pairing after 25 s");
}
console.log("director: stat captions, comparisons and hanging comparisons passed");
