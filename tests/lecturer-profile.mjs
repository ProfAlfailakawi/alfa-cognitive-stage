import assert from "node:assert/strict";
import { lecturerTeachingMove, lecturerTakeaway } from "../web/lecturer-profile.js";

assert.equal(lecturerTeachingMove("كنا نعتقد كذا لكن في المقابل عندنا خيار ثاني").kind, "contrast");
assert.equal(lecturerTeachingMove("على سبيل الافتراض واحد معدله عالي بس مهاراته قليلة").kind, "example");
assert.equal(lecturerTeachingMove("نصيحتي لكم لا تكتفون بالمعدل وزيدوا مهاراتكم").kind, "takeaway");
assert.equal(lecturerTeachingMove("ليش نحتاج ندمج التكنولوجيا في التعليم؟").kind, "question");
const quote = lecturerTakeaway("نصيحتي لكم لا تركزون فقط على المعدل وحاولوا تزيدون مهاراتكم في المقابل");
assert.equal(quote?.type, "quote");
assert.equal(quote?.lines[0], "نصيحتي لكم لا تركزون فقط على المعدل وحاولوا تزيدون مهاراتكم في المقابل");
assert.equal(lecturerTakeaway("واحد معدله ممتاز لكن مهاراته قليلة"), null, "no false takeaways");
console.log("curated lecturer teaching moves passed");
