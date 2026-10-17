// Cross-session coach. From counted facts only (anonymous "lost" pulses, question counts per slide, time on slide)
// it proposes AT MOST ONE change for the next session, with the evidence behind it. Thresholds are stated design
// choices, not measured norms, and the wording never claims to know why students were lost.
export const COACH_RULES = Object.freeze({ minDevices: 5, lostShare: 0.4, minQuestions: 3, questionShare: 0.25, slowFactor: 2, minSlowMs: 90000 });

const share = (r) => (r.got + r.lost ? r.lost / (r.got + r.lost) : 0);

/**
 * sessions: [{ label, createdAt, slides: [{ slide, got, lost, questions }] }] for ONE lecture, any order.
 * dwell: { [slide]: [ms per session] } from the lecturer's own session log (optional).
 */
export function coachSuggestion(sessions, dwell = {}) {
  const list = (Array.isArray(sessions) ? sessions : []).filter((s) => s && Array.isArray(s.slides));
  if (!list.length) return null;
  const R = COACH_RULES;

  const confusing = new Map(); // slide -> [{ label, lost, devices }]
  for (const s of list) for (const r of s.slides) {
    if (r.got + r.lost >= R.minDevices && share(r) >= R.lostShare) {
      (confusing.get(r.slide) || confusing.set(r.slide, []).get(r.slide)).push({ label: s.label || "جلسة", lost: r.lost, devices: r.got + r.lost });
    }
  }
  const repeated = [...confusing].filter(([, v]) => v.length >= 2).sort((a, b) => b[1].length - a[1].length || a[0] - b[0])[0];
  if (repeated) {
    const [slide, ev] = repeated;
    return { rule: "repeated-lost", slide, strength: "repeated",
      text: `الشريحة ${slide} ضيّعت جزءاً كبيراً من الطلاب في ${ev.length} جلسات. جرّب قبل المحاضرة القادمة مثالاً واحداً أو مشهداً يوضح فكرتها، أو قسّمها.`,
      evidence: ev.map((e) => `${e.label}: ${e.lost} من ${e.devices} أشاروا «ضايع»`) };
  }

  for (const s of list) {
    const total = s.slides.reduce((a, r) => a + r.questions, 0);
    const top = s.slides.filter((r) => r.questions >= R.minQuestions && r.questions >= total * R.questionShare).sort((a, b) => b.questions - a.questions)[0];
    if (top) return { rule: "question-cluster", slide: top.slide, strength: "single",
      text: `تركّزت أسئلة الطلاب عند الشريحة ${top.slide}. فكّر في إعادة صياغة نقطتها الأساسية أو إضافة مثال قبل الانتقال.`,
      evidence: [`${s.label || "جلسة"}: ${top.questions} من ${total} أسئلة جاءت وأنت على هذه الشريحة`] };
  }

  const [slide, ev] = [...confusing].sort((a, b) => a[0] - b[0])[0] || [];
  if (slide) return { rule: "single-lost", slide, strength: "single",
    text: `في جلسة واحدة أشار عدد ملحوظ من الطلاب أنهم ضايعون عند الشريحة ${slide}. لا يكفي هذا لاستنتاج نمط؛ راقبها في الجلسة القادمة.`,
    evidence: ev.map((e) => `${e.label}: ${e.lost} من ${e.devices} أشاروا «ضايع»`) };

  const slow = [];
  const allMs = Object.values(dwell).flat().filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  const median = allMs.length ? allMs[Math.floor(allMs.length / 2)] : 0;
  for (const [slide, arr] of Object.entries(dwell)) {
    const long = (arr || []).filter((ms) => ms >= R.minSlowMs && ms >= median * R.slowFactor);
    if (long.length >= 2) slow.push({ slide: Number(slide), n: long.length, avg: Math.round(long.reduce((a, b) => a + b, 0) / long.length / 60000) });
  }
  slow.sort((a, b) => b.n - a.n || a.slide - b.slide);
  if (slow[0]) return { rule: "slow-slide", slide: slow[0].slide, strength: "repeated",
    text: `الشريحة ${slow[0].slide} أخذت وقتاً أطول بكثير من معظم الشرائح في ${slow[0].n} جلسات. هذا مجرد قياس للوقت، لا يعني أن فيها مشكلة؛ قرّر إن كان الوقت مقصوداً.`,
    evidence: [`متوسط حوالي ${slow[0].avg} د في الجلسات الطويلة منها`] };
  return null;
}

/** Time on each slide per recorded local session: { slide: [ms, ...] }. */
export function dwellBySlide(summaries) {
  const out = {};
  for (const s of Array.isArray(summaries) ? summaries : []) for (const r of s.slides || []) (out[r.index] ||= []).push(r.ms);
  return out;
}
