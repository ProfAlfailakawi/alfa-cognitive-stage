// Rehearsal audience: questions real students asked in earlier sessions of THIS lecture (kept by the lecturer),
// matched to slides. It replays questions; it does not invent any.
import { embed, cosine } from "./semantic-index.js";

const RELATED = 0.45;

/**
 * bank: [{ id, slide, text }]. slides: [{ index, text }]. Returns { [slideIndex]: [{ id, text, from, origin }] }
 * where `origin` is "same-slide" (asked while that slide was on screen) or "related" (similar to the slide's content).
 */
export function expectedQuestions(bank, slides, { perSlide = 2 } = {}) {
  const items = (Array.isArray(bank) ? bank : []).filter((q) => q && typeof q.text === "string");
  const out = {};
  const slideVec = new Map((slides || []).map((s) => [s.index, embed(String(s.text || ""))]));
  for (const s of slides || []) {
    const direct = items.filter((q) => q.slide === s.index).map((q) => ({ id: q.id, text: q.text, from: q.slide, origin: "same-slide" }));
    const v = slideVec.get(s.index);
    const related = v && v.size >= 3 ? items.filter((q) => q.slide !== s.index).map((q) => ({ q, sim: cosine(embed(q.text).vec, v.vec) }))
      .filter((x) => x.sim >= RELATED).sort((a, b) => b.sim - a.sim).map(({ q }) => ({ id: q.id, text: q.text, from: q.slide, origin: "related" })) : [];
    const picked = [...direct, ...related].slice(0, perSlide);
    if (picked.length) out[s.index] = picked;
  }
  return out;
}
