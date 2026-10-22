// Suggests director sensitivity from the lecturer's OWN labelled lectures, by replaying them (trial-replay.js) under a
// small grid of settings and keeping the one that agrees best with the labels. It is a fit to one person's labels,
// so it reports an out-of-sample estimate (leave-one-out) and refuses to recommend unless that also improves.
// It never applies anything: adopting a suggestion is the lecturer's click, and it can only change three knobs.
import { DEFAULT_TUNING, sanitizeTuning } from "./director-brain.js";
import { replayTrial, isShown } from "./trial-replay.js";

export const GRID = Object.freeze({
  minConfidence: [0, 0.7, 0.8, 0.85, 0.9],
  gapMs: [8000, 15000, 25000, 40000],
  maxPerSlide: [2, 3, 4, 6],
});
export const MIN_LABELLED = 10;
const MIN_IMPROVEMENT = 2;     // loss units (a wrongly shown scene counts 1.5, a missed one 1)
const MIN_FIDELITY = 0.9;      // replay under default settings must reproduce the recorded actions this often
const COST_FALSE_SHOW = 1.5, COST_MISS = 1;

const candidates = () => {
  const out = [];
  for (const minConfidence of GRID.minConfidence) for (const gapMs of GRID.gapMs) for (const maxPerSlide of GRID.maxPerSlide) out.push({ minConfidence, gapMs, maxPerSlide });
  return out;
};
const distance = (t) => (t.minConfidence !== DEFAULT_TUNING.minConfidence) + (t.gapMs !== DEFAULT_TUNING.gapMs) + (t.maxPerSlide !== DEFAULT_TUNING.maxPerSlide) +
  Math.abs(t.minConfidence - DEFAULT_TUNING.minConfidence) + Math.abs(t.gapMs - DEFAULT_TUNING.gapMs) / 100000 + Math.abs(t.maxPerSlide - DEFAULT_TUNING.maxPerSlide) / 100;
const lossOf = (shown, should) => (shown === should ? 0 : shown ? COST_FALSE_SHOW : COST_MISS);

/** Labelled decisions that say something about showing vs staying silent. */
export function labelledItems(trial) {
  const items = [];
  for (const d of Array.isArray(trial?.events) ? trial.events : []) {
    if (d.type !== "decision" || d.utteranceId == null || !["ok", "bad", "missed"].includes(d.label)) continue;
    if (d.action === "return" || d.action === "return-level") continue;
    const wasShown = isShown(d.action);
    if (wasShown && d.label === "missed") continue; // "it missed something else" says nothing about this scene
    const should = wasShown ? d.label === "ok" : d.label === "missed";
    items.push({ utteranceId: d.utteranceId, should, label: d.label, wasShown });
  }
  return items;
}

export function tuneFromTrials(trials, slides = []) {
  const list = (Array.isArray(trials) ? trials : []).filter((t) => Array.isArray(t?.events));
  const items = []; // { trial, utteranceId, should }
  list.forEach((trial, trialIndex) => { for (const it of labelledItems(trial)) items.push({ ...it, trialIndex }); });
  const base = { labelled: items.length, recommended: false, tuning: { ...DEFAULT_TUNING } };
  if (items.length < MIN_LABELLED) return { ...base, reason: `يلزم ${MIN_LABELLED} قرارات مصنّفة على الأقل (لديك ${items.length}).` };
  if (!items.some((i) => i.label !== "ok")) return { ...base, reason: "كل ما صنّفته مناسب؛ لا مؤشر على ما يُغيَّر." };

  const grid = candidates();
  // loss per candidate per item, from one replay of every trial per candidate
  const shownBy = grid.map((tuning) => list.map((trial) => replayTrial(trial, { slides, tuning })));
  const lossMatrix = grid.map((_, g) => items.map((it) => lossOf(Boolean(shownBy[g][it.trialIndex].get(it.utteranceId)?.shown), it.should)));
  const totals = lossMatrix.map((row) => row.reduce((a, b) => a + b, 0));
  const defaultIndex = grid.findIndex((t) => distance(t) === 0);
  const better = (a, b) => totals[a] < totals[b] - 1e-9 || (Math.abs(totals[a] - totals[b]) < 1e-9 && distance(grid[a]) < distance(grid[b]));
  let best = defaultIndex;
  for (let g = 0; g < grid.length; g++) if (better(g, best)) best = g;

  // fidelity: does the default replay reproduce what actually happened in the lecture?
  let agree = 0, seen = 0;
  list.forEach((trial, ti) => {
    for (const d of trial.events) if (d.type === "decision" && d.utteranceId != null) {
      const r = shownBy[defaultIndex][ti].get(d.utteranceId);
      if (r) { seen++; if (r.action === d.action) agree++; }
    }
  });
  const fidelity = seen ? agree / seen : 0;

  // leave-one-out: pick the best setting without item i, score it on item i
  let loo = 0;
  for (let i = 0; i < items.length; i++) {
    let pick = defaultIndex, pickLoss = totals[defaultIndex] - lossMatrix[defaultIndex][i];
    for (let g = 0; g < grid.length; g++) {
      const l = totals[g] - lossMatrix[g][i];
      if (l < pickLoss - 1e-9 || (Math.abs(l - pickLoss) < 1e-9 && distance(grid[g]) < distance(grid[pick]))) { pick = g; pickLoss = l; }
    }
    loo += lossMatrix[pick][i];
  }

  const flips = { fixed: 0, broken: 0 };
  items.forEach((_, i) => {
    const was = lossMatrix[defaultIndex][i], now = lossMatrix[best][i];
    if (was > 0 && now === 0) flips.fixed++; else if (was === 0 && now > 0) flips.broken++;
  });
  const improvement = totals[defaultIndex] - totals[best];
  const recommended = best !== defaultIndex && improvement >= MIN_IMPROVEMENT && loo < totals[defaultIndex] - 1e-9 && fidelity >= MIN_FIDELITY;
  let reason;
  if (best === defaultIndex) reason = "الإعدادات الحالية هي الأقرب لتصنيفاتك.";
  else if (fidelity < MIN_FIDELITY) reason = `الإعادة لا تطابق ما جرى فعلاً (${Math.round(fidelity * 100)}٪)؛ ربما تغيّرت الشرائح، فلا أقترح شيئاً.`;
  else if (improvement < MIN_IMPROVEMENT) reason = "التحسن الممكن صغير ولا يستحق التغيير.";
  else if (!(loo < totals[defaultIndex] - 1e-9)) reason = "التحسن يظهر على تصنيفاتك الحالية فقط ولا يصمد في الاختبار الخارجي؛ صنّف مزيداً من القرارات.";
  return { labelled: items.length, recommended, tuning: sanitizeTuning(grid[best]), current: { ...DEFAULT_TUNING },
    loss: { current: totals[defaultIndex], suggested: totals[best], leaveOneOut: loo },
    flips, fidelity: Number(fidelity.toFixed(2)), ...(reason ? { reason } : {}), grid: grid.length };
}

export function tuningSummary(result) {
  if (!result) return "";
  if (!result.recommended) return `${result.reason || "لا اقتراح."} (قرارات مصنّفة: ${result.labelled})`;
  const t = result.tuning;
  return `اقتراح: لا تُعرض مشاهد أقل ثقة من ${Math.round(t.minConfidence * 100)}٪، وفاصل هدوء ${Math.round(t.gapMs / 1000)} ث، وحدّ ${t.maxPerSlide} مشاهد للشريحة. ` +
    `على تصنيفاتك (${result.labelled}) يصحّح ${result.flips.fixed} قرارات ويفسد ${result.flips.broken}؛ والتقدير خارج العينة ${result.loss.leaveOneOut} مقابل ${result.loss.current} حالياً (أقل أفضل). هذا ملاءمة لمحاضراتك أنت.`;
}
