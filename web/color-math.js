// Small colour toolkit: WCAG contrast, mixing and "move this colour until it is readable".
// Used by scene-theme.js (contrast checks) and world-theme.js (turning a world's palette into a readable theme).
export function rgbOf(color) {
  const m = String(color).match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const r = String(color).match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  return r ? [Number(r[1]), Number(r[2]), Number(r[3])] : null;
}
export const hexOf = ([r, g, b]) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const lum = ([r, g, b]) => [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
export function contrast(fg, bg) {
  const a = rgbOf(fg), b = rgbOf(bg);
  if (!a || !b) return null;
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** t = 0 gives a, t = 1 gives b. */
export function mix(a, b, t) {
  const x = rgbOf(a), y = rgbOf(b);
  return hexOf(x.map((v, i) => v + (y[i] - v) * t));
}
/** Perceived brightness 0..1 (the same formula the world library uses to call a world dark). */
export function brightness(hex) { const [r, g, b] = rgbOf(hex); return (r * 299 + g * 587 + b * 114) / 255000; }
/** Hue in degrees, or -1 for greys. */
export function hueOf(hex) {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 0.08) return -1;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
/** Move `color` toward `toward` in 4% steps until `ok(color)` holds; falls back to `toward` itself. */
export function fit(color, toward, ok) {
  for (let t = 0; t <= 1.0001; t += 0.04) { const c = mix(color, toward, Math.min(t, 1)); if (ok(c)) return c; }
  return toward;
}
