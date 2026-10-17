import assert from "node:assert/strict";
import { moderate, wordKey } from "../web/moderation.js";

const reasons = (t) => moderate(t).reasons.join(",");
assert.equal(moderate("هل الألعاب التعليمية تناسب كل التخصصات؟").ok, true);
assert.equal(moderate("ليش تجربة الكلب عند بافلوف مهمة؟").ok, true, "teaching vocabulary such as Pavlov's dog is fine");
assert.equal(moderate("What is the difference between motivation and engagement?").ok, true);
// Privacy: numbers, emails, links, civil IDs (also Arabic-Indic digits, spaced).
assert.equal(reasons("كلموني على 99887766"), "pii-number");
assert.equal(reasons("رقمي ٩٩٨٨ ٧٧٦٦"), "pii-number");
assert.equal(reasons("الرقم المدني 289 0123 45678"), "pii-number");
assert.match(reasons("+965 5555 1234"), /pii-number/);
assert.equal(reasons("ابعثوا على ali.test@example.com"), "pii-email");
assert.equal(reasons("شوفوا https://evil.example/x"), "link");
assert.equal(reasons("زوروا www.example.org"), "link");
assert.equal(moderate("رقم الشريحة 12 وصفحة 45").ok, true, "short numbers are fine");
assert.equal(moderate("نسبة 68% من الطلبة").ok, true);
assert.equal(moderate("رقمي 99887766").privacy, true);
// Abuse and spam are flagged for review, with obfuscation resistance.
assert.match(reasons("يا ابن الكلب"), /abuse/);
assert.match(reasons("يلعنننن"), /abuse/);
assert.match(reasons("you are a FUCK"), /abuse/);
assert.match(reasons("ههههههههههههه"), /spam/);
assert.match(reasons("ابي ابي ابي ابي ابي ابي"), /spam/);
assert.match(reasons("!!! ??? 123"), /spam/);
assert.deepEqual(moderate("   ").reasons, ["empty"]);
assert.deepEqual(moderate(null).reasons, ["empty"]);
assert.equal(moderate("a".repeat(2000)).ok, false);
// HTML is never interpreted, only screened as text.
assert.equal(moderate("<script>alert(1)</script> سؤال").ok, true);
// Word cloud keys fold variants and refuse non-words.
assert.equal(wordKey("الدافعية"), "دافعيه");
assert.equal(wordKey("دافعيّة"), "دافعيه");
assert.equal(wordKey("اللعب"), "لعب");
assert.equal(wordKey("two words"), null);
assert.equal(wordKey("x"), null);
assert.equal(wordKey("a".repeat(30)), null);
assert.equal(wordKey("١٢٣"), "123");
console.log("moderation: privacy screening, abuse/spam flags without Pavlov false positives, word keys passed");
