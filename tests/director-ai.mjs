import assert from "node:assert/strict";
import { validateDirectorProposal } from "../server/director-ai.mjs";
const scene = validateDirectorProposal({
  type: "stat", title: "دراسة", lines: ["٦٨%", "نسبة ذكرها المحاضر"], reason: "إحصائية", confidence: 0.9
}, "قلت 68% من المشاركين");
assert.equal(scene.spec.lines[0], "٦٨%");
assert.equal(scene.confidence, 0.9);
assert.equal(validateDirectorProposal({ type: "none" }, "كلام"), null);
assert.throws(() => validateDirectorProposal({
  type: "stat", title: "x", lines: ["90%", "وصف"], confidence: 0.9
}, "قلت 68% فقط"), /invented number/);
assert.throws(() => validateDirectorProposal({
  type: "compare", title: "x", lines: ["ادعاء غير مطابق"], confidence: 0.8
}, "مقارنة"), /المقارنة/);
console.log("director-ai safety: all checks passed");
