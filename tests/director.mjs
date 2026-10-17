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
console.log("director-core: all checks passed");
