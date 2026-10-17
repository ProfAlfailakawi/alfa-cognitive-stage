import assert from "node:assert/strict";
import { lectureFileName } from "../server/lecture-import.mjs";
assert.equal(lectureFileName("Lecture%201.pptx"), "Lecture 1.pptx");
assert.equal(lectureFileName("محاضرة الألعاب.pptx"), "محاضرة الألعاب.pptx");
for (const input of ["../a.pptx", "..%2Fa.pptx", "folder%5Ca.pptx",
  "notes.txt", "slide.pptx.exe", "%00wrong.pptx", ""]) {
  assert.equal(lectureFileName(input), null, input);
}
console.log("upload filename verification passed");
