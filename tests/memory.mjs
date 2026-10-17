import assert from "node:assert/strict";
import { rememberScene, recallScene, countSavedScenes } from "../web/scene-memory.js";
const map = new Map();
const storage = { getItem: (k) => map.get(k), setItem: (k, v) => map.set(k, v) };
const spec = { type: "stat", title: "إحصائية", lines: ["68%", "من حديث المحاضر"] };
assert.equal(rememberScene({bundle:"lecture1",slide:12,utterance:"في دراسة عن تحفيز الألعاب نسبة 68%",spec},storage),true);
assert.equal(countSavedScenes("lecture1",storage),1);
assert.equal(recallScene({bundle:"lecture1",slide:12,utterance:"في دراسة عن الدافعية للألعاب نسبة 68%"},storage)?.spec.lines[0],"68%");
const across = recallScene({bundle:"lecture2",slide:2,utterance:"في دراسة عن تحفيز الألعاب نسبة 68%"},storage);
assert.equal(across?.spec.lines[0],"68%");
assert.equal(across?.reusedAcrossLecture,true);
assert.equal(recallScene({bundle:"lecture2",slide:2,utterance:"في دراسة عن تحفيز الألعاب نسبة 69%"},storage),null);
assert.equal(recallScene({bundle:"lecture2",slide:2,utterance:"في دراسة عن تحفيز الألعاب"},storage),null);
assert.equal(recallScene({bundle:"lecture2",slide:2,utterance:"في دراسة عن تحفيز الألعاب نسبة 68%"},{
  getItem: () => null, setItem: () => {}
}),null); // Separate browser profile does not inherit lecturer memory.
assert.equal(map.get("alfa-approved-scenes-cross-v1").includes("في دراسة عن تحفيز الألعاب نسبة 68%"),false);
assert.equal(recallScene({bundle:"lecture1",slide:12,utterance:"في دراسة عن الدافعية للألعاب نسبة 68%"},storage)?.reusedAcrossLecture,undefined);
assert.equal(recallScene({bundle:"lecture1",slide:12,utterance:"مقدمة أخرى ليس لها علاقة"},storage),null);
assert.equal(rememberScene({bundle:"lecture1",slide:12,utterance:"في دراسة عن تحفيز الألعاب نسبة 68%",spec},storage),true);
assert.equal(countSavedScenes("lecture1",storage),1);
for (let i = 0; i < 155; i++) {
  assert.equal(rememberScene({bundle:"section_"+i,slide:1,
    utterance:"تجربة تعليمية لطلاب المجموعة "+i+" بنسبة 68%",
    spec},storage),true);
}
assert.equal(JSON.parse(map.get("alfa-approved-scenes-cross-v1")).length,150);
console.log("approved scene memory: same-lecture priority, strict cross-lecture reuse, numeric guard, browser isolation, bounded index passed");
