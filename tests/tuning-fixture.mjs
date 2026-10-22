// Shared by the tuning unit and browser tests: a scripted lecture recorded exactly as app.js records it.
import { createDirectorBrain } from "../web/director-brain.js";
import { createFieldRecorder } from "../web/field-recorder.js";

const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
// ---- a scripted lecture, recorded the way app.js records it ----
export const LECTURE = [
  "في دراسة طلعت إن ٦٨ بالمية من الطلبة يستخدمون الجوال وايد",      // auto, 0.97
  "ارتفعت النسبة من ثلاثين بالمية إلى سبعين بالمية",                  // auto, 0.96
  "الدافعية الداخلية تنبع من اهتمام الطالب نفسه بينما الدافعية الخارجية تعتمد على المكافآت", // propose 0.86
  "في 1990 ظهرت اول نسخة من البرنامج وفي 2005 صار الانتشار الواسع",   // propose 0.90
  "الخلاصة إن الطالب يتعلم أفضل لما يشارك بنفسه",                     // propose 0.84
  "الجامعة الأولى ٤٠ بالمية والجامعة الثانية ٣٥ بالمية والجامعة الثالثة ٢٥ بالمية", // propose 0.88
  "ناقشوا مع زميلكم خمس دقايق في الموضوع هذا",                         // propose 0.84
  "تتوقعون شنو راح يصير لو طبقنا هالطريقة",                           // none (question)
];
export const BLANK_SLIDES = Array.from({ length: 30 }, () => ({ text: "", notes: "" }));
export function recordLecture({ label, rounds = 2, lowIsBad = true, slides = BLANK_SLIDES }) {
  let t = 5_000_000; const rec = createFieldRecorder({ bundle: "b", storage: memory(), now: () => t });
  rec.setConsent(true); rec.start({ label });
  const brain = createDirectorBrain({ now: () => t });
  let slide = 0, last = 0;
  for (let r = 0; r < rounds; r++) for (const sentence of LECTURE) {
    slide++; t += 40000; if (slide !== last) { brain.resetSlide(); last = slide; }
    const ctx = { slide: { index: slide, text: slides[slide - 1]?.text || "", notes: slides[slide - 1]?.notes || "" }, mode: "balanced", overlay: null, mediaPlaying: false };
    const d = brain.observe(sentence, ctx);
    const uid = rec.utterance({ text: sentence, slide, context: { mode: "balanced", media: false, overlay: null } });
    const did = rec.decision({ slide, action: d.action, kind: d.kind, why: d.why, opportunity: d.opportunity, confidence: d.confidence, utteranceId: uid, spec: d.spec });
    if (d.action === "auto" || d.action === "propose") { brain.noteShown(slide); rec.shown({ slide, type: d.spec.type, source: "approved" }); }
    // the lecturer's judgement: weak proposals were noise, everything else was right
    const weak = d.action === "propose" && d.confidence < 0.9;
    rec.label(did, d.action === "none" ? "ok" : weak && lowIsBad ? "bad" : "ok");
  }
  rec.stop();
  return rec.last();
}

