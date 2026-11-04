// Invisible Intelligence v2: explicit example / cause-effect scenes (proposal only), per-slide repeat memory, slide-scoped context.
import assert from "node:assert/strict";
import { createDirectorBrain } from "../web/director-brain.js";
import { renderInfographic } from "../web/infographic.js";
let clock = 1_000_000;
const mk = (opts) => createDirectorBrain({ now: () => clock, ...opts });
const slide = (index, text = "") => ({ slide: { index, text, notes: "" }, mode: "balanced" });
const adv = (ms) => { clock += ms; };

// 1. Explicit example -> verbatim quote card, a proposal and never automatic, even in the automatic modes.
for (const mode of ["balanced", "creative"]) {
  const b = mk();
  const d = b.observe("مثال على ذلك طالب يسهر قبل الاختبار ويجي الصبح بدون تركيز", { ...slide(1), mode });
  assert.equal(d.kind, "example", mode);
  assert.equal(d.action, "propose", `${mode}: examples are never shown automatically`);
  assert.equal(d.spec.type, "quote");
  assert.deepEqual(d.spec.lines, ["مثال على ذلك طالب يسهر قبل الاختبار ويجي الصبح بدون تركيز"], "verbatim words only");
  assert.ok(renderInfographic(d.spec).includes("طالب يسهر"));
}
for (const t of ["لنفترض أن عندنا فصل فيه ثلاثين طالب ومعلم واحد", "كمثال تخيلوا طالب يذاكر قبل الاختبار بيوم واحد بس"]) {
  assert.equal(mk().observe(t, slide(1)).kind, "example", t);
}
// A bare "مثلا" inside a sentence stays a quiet opportunity: no scene.
const mid = mk().observe("مثلا في جامعة الكويت الطلبة يستخدمون المنصة كل يوم تقريبا", slide(1));
assert.equal(mid.action, "none"); assert.equal(mid.spec, null);

// 2. Explicit cause -> effect, both clauses verbatim, proposal only.
const c1 = mk().observe("السهر الطويل يؤدي الى ضعف التركيز في المحاضرة الصباحية", slide(1));
assert.equal(c1.kind, "cause"); assert.equal(c1.action, "propose"); assert.equal(c1.spec.type, "flow");
assert.deepEqual(c1.spec.lines, ["السهر الطويل", "ضعف التركيز في المحاضرة الصباحية"]);
const c2 = mk().observe("ضعف التركيز عند الطلبة بسبب قلة النوم", slide(1));
assert.deepEqual(c2.spec?.lines, ["قلة النوم", "ضعف التركيز عند الطلبة"], "cause first even when spoken last");
assert.ok(renderInfographic(c2.spec).includes("قلة النوم"));
for (const t of ["لماذا السهر يؤدي الى ضعف التركيز؟", "هذا بسبب", "ليش يتأخر الطلبة لان الباص بعيد جدا عن الحرم الجامعي وقت الصباح الباكر كل يوم من الاسبوع"]) {
  assert.equal(mk().observe(t, slide(1)).spec?.type === "flow", false, "no cause card for: " + t);
}

// 3. The same scene is not offered twice on a slide (even after the quiet gap), but is again on another slide.
{
  const b = mk();
  const say = "السهر الطويل يؤدي الى ضعف التركيز في المحاضرة الصباحية";
  assert.equal(b.observe(say, slide(2)).action, "propose"); b.noteShown(2);
  adv(60000);
  const again = b.observe(say, slide(2));
  assert.equal(again.action, "none"); assert.ok(again.why.join(" ").includes("سبق عرض"));
  adv(60000);
  assert.equal(b.observe(say, slide(3)).action, "propose", "a different slide may show it again");
}
// 3b. Two different statistics with the same first line within 15 s are no longer collapsed.
{
  const b = mk();
  const a = b.observe("في دراسة 68 بالمية من الطلبة يفضلون التعلم المدمج", slide(1));
  adv(1000);
  const x = b.observe("وفي دراسة ثانية 45 بالمية من المعلمين يفضلون التعلم المدمج", slide(1));
  assert.ok(a.spec && x.spec, "both decisions carry a scene");
  assert.notEqual(x.why.join(" ").includes("تكرار قريب"), true);
}

// 4. The per-slide cap restarts when the lecturer comes back to a slide.
{
  const b = mk({ tuning: { maxPerSlide: 1, gapMs: 3000 } });
  assert.equal(b.observe("السهر الطويل يؤدي الى ضعف التركيز في المحاضرة", slide(4)).action, "propose"); b.noteShown(4);
  adv(5000);
  assert.equal(b.observe("ضعف التركيز عند الطلبة بسبب قلة النوم", slide(4)).action, "none");
  b.resetSlide(4); adv(20000);
  assert.equal(b.observe("ضعف التركيز عند الطلبة بسبب قلة النوم", slide(4)).action, "propose", "fresh visit, fresh allowance");
}

// 5. A number said on a new slide is not stitched to a statistic sentence from the previous slide.
{
  const b = mk();
  b.observe("في دراسة أجريت على طلبة الجامعة", slide(5)); adv(3000);
  const d = b.observe("طيب ونسبتهم 68 بالمية", slide(6));
  assert.ok(!d.spec || !d.spec.lines.join(" ").includes("دراسة أجريت"), "no cross-slide stitching");
}

// 6. Speed: a stream of 400 utterances stays well inside the lecture budget (generous bound, not a benchmark target).
{
  const b = mk(); const sample = ["طيب الحين نبدأ بالموضوع الجديد", "السهر الطويل يؤدي الى ضعف التركيز في المحاضرة", "في دراسة 68 بالمية من الطلبة", "خلونا نشوف الشريحة اللي بعدها"];
  for (let i = 0; i < 100; i++) { adv(20000); b.observe(sample[i % 4], slide(i % 9, "نص الشريحة ".repeat(80))); } // warm-up (JIT) is not what the lecturer feels
  const t0 = performance.now();
  for (let i = 0; i < 400; i++) { adv(20000); b.observe(sample[i % 4], slide(i % 9, "نص الشريحة ".repeat(80))); }
  const per = (performance.now() - t0) / 400;
  console.log(`director observe: ${per.toFixed(2)} ms/utterance`);
  assert.ok(per < 5, "director decision must stay far below the latency budget");
}
console.log("all director v2 checks passed");
