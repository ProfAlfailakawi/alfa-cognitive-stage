// Colour themes for the animated scenes. The scene code keeps its short role names:
// `solid` is an opaque stand-in for `paper` where lines must not show through (nodes, chips).
//   blue = the main accent, blue2 = its lighter partner, gold = the second emphasis, onAccent = text on those.
// "warm" is the default (cream, terracotta and ink); "deep" is a dark teal-and-green stage; "calm" is the quiet blue-grey original.
export const THEMES = {
  warm: { label: "دافئ", dark: false,
    bg: "#f6eee2", bg2: "#efe1cf", glow1: "#f0b095", glow2: "#f7d9b4", dots: "#26241e", dotsOpacity: 0.07,
    ink: "#26241e", mute: "#6a5f55", blue: "#c24b2c", blue2: "#e68a68", gold: "#2b2822", gold2: "#4a453c",
    onAccent: "#ffffff", solid: "#fffaf2", paper: "#fffaf2", edge: "#e6d6c1", track: "#eadccb", wash: "#f4e8d8", shadow: "#6b3f22", shadowOpacity: 0.13 },
  deep: { label: "أخضر عميق", dark: true,
    bg: "#0f5c50", bg2: "#06352f", glow1: "#34b36e", glow2: "#d98a48", glow2Opacity: 0.28, dots: "#ffffff", dotsOpacity: 0.06,
    ink: "#f6faf4", mute: "#b9d6cb", blue: "#62d36e", blue2: "#a6e8a0", gold: "#f0a35e", gold2: "#f6c490",
    onAccent: "#05302a", solid: "#17695c", paper: "rgba(255,255,255,0.10)", edge: "rgba(255,255,255,0.22)", track: "rgba(255,255,255,0.14)", wash: "rgba(255,255,255,0.12)", shadow: "#000000", shadowOpacity: 0.28 },
  calm: { label: "هادئ", dark: false,
    bg: "#fafbf9", bg2: "#eceeeb", glow1: "#3e5c78", glow2: "#8f5a28", dots: "#15161a", dotsOpacity: 0.04,
    ink: "#15161a", mute: "#5e6570", blue: "#3e5c78", blue2: "#6f8fab", gold: "#8f5a28", gold2: "#b98350",
    onAccent: "#ffffff", solid: "#ffffff", paper: "#ffffff", edge: "#d4d9da", track: "#e3e8ec", wash: "#e7eef1", shadow: "#15161a", shadowOpacity: 0.09 },
};
export const DEFAULT_THEME = "warm";
export const themeName = (value) => (Object.hasOwn(THEMES, value) ? value : DEFAULT_THEME);

// ---- contrast (WCAG 2.1), used by tests/scene-themes.mjs so colours are measured, not guessed ----
function rgbOf(color) {
  const m = String(color).match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const r = String(color).match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  return r ? [Number(r[1]), Number(r[2]), Number(r[3])] : null;
}
const lum = ([r, g, b]) => [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
export function contrast(fg, bg) {
  const a = rgbOf(fg), b = rgbOf(bg);
  if (!a || !b) return null;
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
