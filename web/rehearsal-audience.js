// "Twin" rehearsal: replay kept real questions slide by slide against a countdown and time the answers.
// Pure planning and summary; the lecturer's UI drives it. Optional spoken delivery is done by the UI.
export const DEFAULT_ANSWER_SEC = 45;

/** expected: output of expectedQuestions -> ordered steps (slide ascending, questions in order). */
export function planRehearsal(expected, { answerSec = DEFAULT_ANSWER_SEC } = {}) {
  const sec = Math.min(300, Math.max(10, Number(answerSec) || DEFAULT_ANSWER_SEC));
  const steps = [];
  for (const slide of Object.keys(expected || {}).map(Number).sort((a, b) => a - b)) {
    for (const q of expected[slide]) steps.push({ slide, id: q.id, text: q.text, origin: q.origin, limitSec: sec });
  }
  return steps;
}

/** results: [{ step, answeredSec | null (skipped or timed out) }] */
export function summarizeRehearsal(steps, results) {
  const done = results.filter((r) => Number.isFinite(r.answeredSec));
  const secs = done.map((r) => r.answeredSec).sort((a, b) => a - b);
  const over = results.filter((r) => r.timedOut || (Number.isFinite(r.answeredSec) && r.answeredSec > r.step.limitSec));
  return {
    questions: steps.length, answered: done.length, skipped: results.filter((r) => r.skipped).length, timedOut: results.filter((r) => r.timedOut).length,
    medianSec: secs.length ? secs[Math.floor((secs.length - 1) / 2)] : null,
    overLimit: over.map((r) => ({ slide: r.step.slide, text: r.step.text })),
  };
}
