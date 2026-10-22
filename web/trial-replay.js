// Counterfactual replay of a recorded field trial. The recorder keeps what the director heard, in order and with
// timestamps; this feeds those same sentences through a fresh director brain under a different sensitivity, with a
// virtual clock, so "what would it have done with these settings?" can be answered without another lecture.
// Faithfulness is partial and measured: see `fidelity` in director-tuner.js (replayed vs recorded actions).
import { createDirectorBrain } from "./director-brain.js";

const CLOCK_BASE = 1_700_000_000_000; // a realistic epoch so "quiet since the last scene" starts from silence, as live
const DECLINE_WINDOW_MS = 45000;
export const isShown = (action) => action === "auto" || action === "propose";

/**
 * @param trial   a recorder trial ({ events })
 * @param slides  [{ text, notes }] indexed from slide 1 (the manifest slides)
 * @param tuning  see DEFAULT_TUNING in director-brain.js
 * @returns Map<utteranceId, { action, kind, confidence, shown }>
 */
export function replayTrial(trial, { slides = [], tuning } = {}) {
  const events = Array.isArray(trial?.events) ? trial.events : [];
  let clock = CLOCK_BASE;
  const brain = createDirectorBrain({ now: () => clock, tuning });
  const declined = events.filter((e) => e.type === "declined");
  const out = new Map();
  let lastSlide = null;
  for (const e of events) {
    if (e.type !== "utterance") continue;
    clock = CLOCK_BASE + e.t;
    if (lastSlide !== null && e.slide !== lastSlide) brain.resetSlide();
    lastSlide = e.slide;
    const slide = slides[e.slide - 1] || {};
    const d = brain.observe(e.text, {
      slide: { index: e.slide, text: String(slide.text || ""), notes: String(slide.notes || "") },
      overlay: e.ctx?.overlay ? { lines: e.ctx.overlay } : null,
      mode: e.ctx?.mode || "balanced",
      mediaPlaying: Boolean(e.ctx?.media),
    });
    const shown = isShown(d.action);
    out.set(e.id, { action: d.action, kind: d.kind, confidence: d.confidence, shown });
    if (shown && !(d.action === "propose" && declined.some((x) => x.slide === e.slide && x.t >= e.t && x.t - e.t <= DECLINE_WINDOW_MS))) {
      brain.noteShown(e.slide); // an approved proposal or an automatic scene starts the quiet period, as it did live
    }
  }
  return out;
}
