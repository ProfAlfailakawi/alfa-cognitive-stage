import assert from "node:assert/strict";
import { extractSpokenSteps } from "../web/spoken-steps.js";
import { interpretSpeech } from "../web/director-core.js";
import { validateSpec } from "../web/infographic.js";

const first = "عندنا 3 خطوات: أول شي نحدد الهدف، ثاني شي نصمم النشاط، ثالث شي نقيس الأثر";
const parsed = extractSpokenSteps(first);
assert.ok(parsed, "Explicit Kuwaiti ordered speech is recognized");
assert.equal(parsed.type, "steps");
assert.deepEqual(parsed.lines, ["نحدد الهدف", "نصمم النشاط", "نقيس الاثر"]);
assert.deepEqual(validateSpec(parsed).lines, parsed.lines);
assert.equal(interpretSpeech(first)?.kind, "steps");
assert.equal(interpretSpeech(first)?.confidence, 0.96);
assert.equal(interpretSpeech(first)?.spec?.lines.length, 3);
assert.equal(extractSpokenSteps("أولاً نجهز المحتوى، ثانياً نسجل الشرح، ثالثاً نختبر الفيديو")?.lines.length, 3);
assert.equal(extractSpokenSteps("الخطوة الأولى تحديد الأهداف، الخطوة الثانية تصميم الأنشطة، الخطوة الثالثة جمع الأدلة")?.lines.length, 3);
assert.equal(extractSpokenSteps("أول شي نحدد الهدف، ثاني شي نصمم النشاط"), null,
  "Two isolated conversational phrases are insufficient for automatic sequencing");
assert.equal(extractSpokenSteps("أول شي نحدد الهدف، ثالث شي نعرض النتائج، ثانيا نعدل النموذج"), null,
  "Out-of-order stages are refused");
assert.equal(extractSpokenSteps("أول شي نحدد الهدف، ثالث شي نعرض النتائج، رابع شي ننتهي"), null,
  "Missing stages are refused");
assert.equal(extractSpokenSteps("الألعاب مفيدة للمحاضرات، النشاط يزيد المشاركة"), null);
assert.equal(extractSpokenSteps("أول شي نحدد الهدف، ثاني شي نحدد الهدف، ثالث شي نحدد الهدف"), null,
  "Duplicate filler does not create a fake three-step lesson");
assert.equal(extractSpokenSteps("أول شي كلام، ثاني شي حرف، ثالث شي نص"), null,
  "Very short fragments are refused");
assert.equal(extractSpokenSteps("أول شي نحدد الهدف، ثاني شي نصمم النشاط، ثالث شي " + "كلمة".repeat(40)), null,
  "Overlong/truncated spoken steps must not be displayed misleadingly");
assert.equal(extractSpokenSteps("أول شي نحدد الهدف، ثاني شي نصمم النشاط، ثالث شي نذكر نسبة ٦٨٪")?.lines[2].includes("68"), true,
  "Numbers must remain derived exclusively from speech and normalize to western digits");
assert.equal(interpretSpeech("نسبة 68% من المشاركين")?.kind, "stat",
  "Existing one-percentage scene remains supported");
assert.equal(interpretSpeech("نرجع للعرض الحين")?.kind, "return",
  "Return intent still takes precedence");
console.log("local spoken steps: ordered Kuwaiti phrases, fidelity, guardrails and existing director behavior passed");
