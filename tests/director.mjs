import assert from "node:assert/strict";
import { interpretSpeech, eligibleForCloud, normalizeArabic } from "../web/director-core.js";

assert.equal(normalizeArabic("٦٨٪"), "68%");
const stat = interpretSpeech("في دراسة ذكرت أن ٦٨٪ من الطلبة استفادوا");
assert.equal(stat.kind, "stat");
assert.equal(stat.spec.lines[0], "68%");
assert.equal(stat.spec.lines[1], "من حديث المحاضر — المصدر غير معروض");
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
