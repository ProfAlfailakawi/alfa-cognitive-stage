// Pure helpers for PowerPoint click builds. A slide with a `build` has one image per
// click state: step 0 is the slide at rest, step N the state after N clicks.
export function buildSteps(slide) {
  const steps = slide?.build?.steps;
  return Array.isArray(steps) && steps.length >= 2 &&
    steps.every((s) => s && typeof s.image === "string" && /^steps\/[0-9]{3}-[0-9]{2}\.png$/.test(s.image))
    ? steps : null;
}
export function lastStep(slide) {
  const steps = buildSteps(slide);
  return steps ? steps.length - 1 : 0;
}
export function clampStep(slide, step) {
  return Number.isInteger(step) ? Math.max(0, Math.min(lastStep(slide), step)) : 0;
}
export function imageFor(slide, step) {
  const steps = buildSteps(slide);
  return steps ? steps[clampStep(slide, step)].image : slide.image;
}
// Where "next" goes: another click state of this slide, or the next slide at rest.
export function nextPosition(slides, index, step) {
  const slide = slides[index - 1];
  if (!slide) return null;
  if (step < lastStep(slide)) return { index, step: step + 1 };
  return index < slides.length ? { index: index + 1, step: 0 } : null;
}
// "Previous" undoes one click, and from the start of a slide lands on the previous slide's final state.
export function prevPosition(slides, index, step) {
  const slide = slides[index - 1];
  if (!slide) return null;
  if (step > 0) return { index, step: step - 1 };
  return index > 1 ? { index: index - 1, step: lastStep(slides[index - 2]) } : null;
}
// Delay before a build starts by itself ("after previous" / "with previous" as first effect), else null.
export function autoDelay(slide, step) {
  const steps = buildSteps(slide);
  const upcoming = steps?.[step + 1];
  return upcoming?.auto ? Math.max(0, Math.min(30000, upcoming.delayMs || 0)) : null;
}
export function fadeMs(slide, step) {
  const steps = buildSteps(slide);
  const ms = steps?.[step]?.durationMs || 0;
  return Math.max(180, Math.min(700, ms || 260));
}
