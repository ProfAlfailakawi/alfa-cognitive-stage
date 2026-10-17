// Lecturer-only, deterministic summaries of anonymous student input. Extractive: it groups and counts
// what students wrote; it never decides what is correct or what students understood.
import { embed, cosine, contentWords } from "./semantic-index.js";

const SAME_TOPIC = 0.42;

export function clusterQuestions(questions) {
  const visible = (Array.isArray(questions) ? questions : []).filter((q) => q && !q.flagged && typeof q.text === "string");
  const vectors = visible.map((q) => embed(q.text));
  const parent = visible.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < visible.length; i++) {
    for (let j = i + 1; j < visible.length; j++) {
      if (vectors[i].size >= 2 && vectors[j].size >= 2 && cosine(vectors[i].vec, vectors[j].vec) >= SAME_TOPIC) parent[find(j)] = find(i);
    }
  }
  const groups = new Map();
  visible.forEach((q, i) => (groups.get(find(i)) || groups.set(find(i), []).get(find(i))).push(q));
  return [...groups.values()].map((members) => {
    const tally = new Map();
    for (const q of members) for (const w of new Set(contentWords(q.text).map((x) => x.stem))) tally.set(w, (tally.get(w) || 0) + 1);
    const surface = new Map();
    for (const q of members) for (const { stem, word } of contentWords(q.text)) if (!surface.has(stem)) surface.set(stem, word);
    const keywords = [...tally].filter(([, n]) => n >= Math.min(2, members.length)).sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([stem]) => surface.get(stem));
    // The shortest member is the clearest representative, quoted verbatim.
    const representative = members.slice().sort((a, b) => a.text.length - b.text.length)[0];
    return { size: members.length, ids: members.map((m) => m.id), representative: representative.text, keywords };
  }).sort((a, b) => b.size - a.size);
}

export function recurringTerms(questions, limit = 6) {
  const tally = new Map(), surface = new Map();
  for (const q of (Array.isArray(questions) ? questions : []).filter((x) => x && !x.flagged)) {
    for (const { stem, word } of contentWords(q.text || "")) if (!surface.has(stem)) surface.set(stem, word);
    for (const stem of new Set(contentWords(q.text || "").map((x) => x.stem))) tally.set(stem, (tally.get(stem) || 0) + 1);
  }
  return [...tally].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([stem, count]) => ({ term: surface.get(stem), count }));
}

/** Gentle cues for the lecturer, only when several students independently asked about the same thing. */
export function reexplainSuggestions(clusters, totalVisible) {
  const out = [];
  for (const c of clusters) {
    if (c.size >= 3 && c.size >= Math.ceil(totalVisible * 0.25)) {
      out.push(`${c.size} أسئلة متقاربة${c.keywords.length ? " حول «" + c.keywords.join("، ") + "»" : ""} — فكّر في إعادة شرح النقطة أو إعطاء مثال. مثال من الأسئلة: «${c.representative}»`);
    }
  }
  return out.slice(0, 3);
}

/** Polls grouped by the objective the lecturer typed. Only participation and distribution shape, no scoring. */
export function groupByObjective(polls) {
  const groups = new Map();
  for (const p of (Array.isArray(polls) ? polls : []).filter((x) => x && x.objective)) {
    (groups.get(p.objective) || groups.set(p.objective, []).get(p.objective)).push({ id: p.id, question: p.question, kind: p.kind || "choice", total: p.total || 0 });
  }
  return [...groups].map(([objective, items]) => ({ objective, items, participants: items.reduce((a, b) => Math.max(a, b.total), 0) }));
}

/**
 * Same question (same wording and options) asked in different sections. `sections` = [{ code, label, polls }].
 * Shows percentages side by side with sample sizes; never claims one section learned more.
 */
export function compareSections(sections) {
  const byKey = new Map();
  for (const s of Array.isArray(sections) ? sections : []) {
    for (const p of (s.polls || []).filter((x) => (x.kind || "choice") === "choice" && x.total > 0)) {
      const key = JSON.stringify([p.question, p.options]);
      (byKey.get(key) || byKey.set(key, []).get(key)).push({ code: s.code, label: s.label || s.code, poll: p });
    }
  }
  const out = [];
  for (const entries of byKey.values()) {
    const distinct = new Map();
    for (const e of entries) distinct.set(e.code, e); // latest round per section
    if (distinct.size < 2) continue;
    const list = [...distinct.values()];
    out.push({ question: list[0].poll.question, options: list[0].poll.options,
      sections: list.map((e) => ({ label: e.label, total: e.poll.total,
        percents: e.poll.counts.map((c) => Number((100 * c / e.poll.total).toFixed(1))) })),
      caveat: "الشعب تختلف في الحجم والتوقيت والجمهور وسياق الشرح؛ هذا عرض متجاور للتوزيعات وليس دليلاً على سبب الفرق أو على تعلّم أفضل." });
  }
  return out;
}
