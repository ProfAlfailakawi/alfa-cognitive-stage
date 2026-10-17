import assert from "node:assert/strict";
import { interpretNav, parseNumber } from "../web/voice-nav.js";

const kinds = (s) => interpretNav(s)?.kind ?? null;
// ---- commands that must work ----
for (const s of ["الشريحة التالية", "التالية", "الشريحة الجاية", "طيب الشريحة التالية", "يلا التالية", "روح للشريحة التالية", "الشريحة اللي بعدها", "Next slide"])
  assert.equal(kinds(s), "next", s);
for (const s of ["الشريحة السابقة", "السابقة", "ارجع شريحة", "الشريحة اللي قبل", "روح للشريحة السابقة", "الشريحة اللي قبلها"])
  assert.equal(kinds(s), "prev", s);
assert.equal(kinds("أول شريحة"), "first");
assert.equal(kinds("الشريحة الأولى"), "first");
assert.equal(kinds("آخر شريحة"), "last");
assert.equal(kinds("الشريحة الأخيرة"), "last");
assert.deepEqual(interpretNav("روح للشريحة خمسة"), { kind: "goto", index: 5 });
assert.deepEqual(interpretNav("الشريحة رقم 12"), { kind: "goto", index: 12 });
assert.deepEqual(interpretNav("انتقل إلى الشريحة خمسة وعشرين"), { kind: "goto", index: 25 });
assert.deepEqual(interpretNav("الشريحة ثلاثة عشر"), { kind: "goto", index: 13 });
assert.deepEqual(interpretNav("الشريحة عشرين"), { kind: "goto", index: 20 });
assert.deepEqual(interpretNav("خذنا للشريحة ٧"), { kind: "goto", index: 7 }, "Arabic-Indic digits");
// ---- sentences that merely talk about slides must never move the stage ----
for (const s of [
  "في الشريحة التالية سنرى النتائج", "الشريحة التالية فيها مثال مهم", "لاحظوا الشريحة السابقة كانت عن الدافعية", "كنا في الشريحة الخامسة",
  "التالية تأتي بعد المقدمة وبعدها نكمل", "ما نبي الشريحة التالية الحين", "رجعوا للشريحة السابقة وشوفوا الرقم", "عشان نفهم الشريحة 5 لازم نتذكر",
  "خلونا نتكلم عن الدافعية", "نرجع للعرض", "نرجع للي قبل", "نكمل درسنا", "", "   ", "السابقة الجاية التالية", "الشريحة",
]) assert.equal(interpretNav(s), null, `must not navigate: «${s}»`);
assert.equal(interpretNav("الشريحة صفر"), null);
assert.equal(interpretNav("الشريحة 0"), null);
assert.equal(interpretNav("x".repeat(500)), null);
assert.equal(interpretNav(null), null);
// ---- numbers ----
assert.deepEqual(["واحد", "اثنين", "تسعة", "عشرة", "أحد عشر", "اثنا عشر", "ثلاثين", "خمسة وسبعين", "42", "سبعة وأربعين"].map(parseNumber), [1, 2, 9, 10, 11, 12, 30, 75, 42, 47]);
assert.equal(parseNumber("بطيخ"), null);
console.log("voice-nav: all checks passed");
