// Quiet lecture timer: elapsed time, optional planned length, soft phases (no alarms).
export const PLANNED_CHOICES = [0, 30, 45, 50, 60, 75, 90, 120];
export function clockState(elapsedMs, plannedMin) {
  const safe = Number.isFinite(elapsedMs) && elapsedMs >= 0 ? elapsedMs : 0;
  const mm = String(Math.floor(safe / 60000)).padStart(2, "0"), ss = String(Math.floor(safe / 1000) % 60).padStart(2, "0");
  const planned = PLANNED_CHOICES.includes(plannedMin) && plannedMin > 0 ? plannedMin * 60000 : 0;
  if (!planned) return { label: `${mm}:${ss}`, ratio: 0, phase: "none", hint: "" };
  const ratio = safe / planned, left = planned - safe;
  const phase = ratio >= 1 ? "over" : left <= 10 * 60000 ? "late" : "normal";
  const hint = phase === "over" ? "تجاوزت الوقت المخطط بـ " + Math.ceil(-left / 60000) + " د"
    : phase === "late" ? "متبقٍ نحو " + Math.ceil(left / 60000) + " د" : "";
  return { label: `${mm}:${ss}`, ratio: Math.min(1, ratio), phase, hint };
}
