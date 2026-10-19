import assert from "node:assert/strict";
import { interpretNaturalNav, interpretStageReturn } from "../web/voice-intent.js";

for (const speech of [
  "خلونا نروح للشريحة اللي بعدها", "يلا ورني الشريحة الياية", "أبي ننتقل للصفحة الجاية",
  "زين نروح للي عقبها", "طيب خلنا ننتقل للشريحة التالية", "يلا روح للسلايد الجايه",
  "خلصنا من هذي خلونا نكمل بالشريحة اللي بعدها"
]) {
  assert.equal(interpretNaturalNav(speech)?.kind, "next", speech);
}
assert.deepEqual(interpretNaturalNav("خلونا نروح للشريحة اللي بعدها"), { kind: "next", skipBuilds: true });
assert.deepEqual(interpretNaturalNav("التالية"), { kind: "next" }, "next still moves a single build click");
for (const speech of ["خلونا نروح للشريحة السابقة", "ورني الصفحة اللي قبلها"]) assert.equal(interpretNaturalNav(speech)?.kind, "prev", speech);
for (const speech of ["نرجع للشريحة الأصلية", "ردني للعرض", "خلونا نرجع للشرح", "نكمل شرحنا",
  "خلصنا من المثال نرجع للعرض", "خلاص نرجع للبوربوينت", "ارجع لنفس الشريحة",
  "خلونا نكمل"]) assert.equal(interpretStageReturn(speech), "return", speech);
assert.equal(interpretStageReturn("نرجع للي قبل"), "return-level");
for (const speech of [
  "في الشريحة التالية راح نشوف النتائج", "أقول لكم الشريحة الجاية فيها معلومة", "ما نبي الشريحة التالية الحين",
  "ننتقل إلى فكرة ثانية وليس الشريحة التالية", "لاحظوا الشريحة اللي بعدها", "لو نرجع للعصر الحجري",
  "اليوم بنرجع لمفهوم تكنولوجيا التعليم", "الدرس الجاي بنتكلم عن الألعاب",
  "في المقابل نرجع شوي ونشوف", "تخيل نرجع للشريحة الأولى",
  "لا نرجع للعرض الحين", "نكمل مثالنا عن المهارات في الجامعة"
]) {
  assert.equal(interpretNaturalNav(speech), null, "no accidental slide navigation: " + speech);
  assert.equal(interpretStageReturn(speech), null, "no accidental visual return: " + speech);
}
console.log("natural Kuwaiti voice intents passed");
