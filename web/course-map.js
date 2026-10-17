// Course map: how "lost" signals and questions recur across the lectures of one course.
// Inputs are counts only. A concept is "recurring" when slides of different lectures that were each
// confusing say similar things (local semantic similarity), never because of any claim about why.
import { embed, cosine } from "./semantic-index.js";

export const MAP_RULES = Object.freeze({ minDevices: 5, lostShare: 0.4, similar: 0.5 });

/** lectures: [{ bundle, title, sessions, slides: [{slide, got, lost, questions}] }]; texts: { [bundle]: { [slide]: text } } */
export function buildCourseMap(lectures, texts = {}) {
  const R = MAP_RULES;
  const rows = (Array.isArray(lectures) ? lectures : []).map((l) => {
    const confusing = (l.slides || []).filter((s) => s.got + s.lost >= R.minDevices && s.lost / (s.got + s.lost) >= R.lostShare)
      .map((s) => ({ slide: s.slide, lost: s.lost, devices: s.got + s.lost, text: String(texts[l.bundle]?.[s.slide] || "") }));
    const asked = (l.slides || []).reduce((a, s) => a + (s.questions || 0), 0);
    return { bundle: l.bundle, title: l.title || l.bundle, sessions: l.sessions || 0, confusing, questions: asked };
  });
  const recurring = [];
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    for (const a of rows[i].confusing) for (const b of rows[j].confusing) {
      const va = embed(a.text), vb = embed(b.text);
      if (va.size < 3 || vb.size < 3) continue;
      const sim = cosine(va.vec, vb.vec);
      if (sim >= R.similar) recurring.push({ a: { lecture: rows[i].title, slide: a.slide }, b: { lecture: rows[j].title, slide: b.slide }, similarity: Number(sim.toFixed(2)) });
    }
  }
  recurring.sort((x, y) => y.similarity - x.similarity);
  return { lectures: rows, recurring: recurring.slice(0, 5),
    note: "تشابه نصي محلي بين شرائح ضيّعت الطلاب؛ لا يفسّر السبب." };
}
