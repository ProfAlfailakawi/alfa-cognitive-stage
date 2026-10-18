// Colour themes for the animated scenes. The scene code keeps its short role names:
// `solid` is an opaque stand-in for `paper` where lines must not show through (nodes, chips).
//   blue = the main accent, blue2 = its lighter partner, gold = the second emphasis, onAccent = text on those.
// "warm" is the default (cream, terracotta and ink); "deep" is a dark teal-and-green stage; "calm" is the quiet blue-grey original.
import { worldTheme, isWorldName, parseWorld } from "./world-theme.js";
export const THEMES = {
  warm: { label: "دافئ", dark: false,
    bg: "#f6eee2", bg2: "#efe1cf", glow1: "#f0b095", glow2: "#f7d9b4", dots: "#26241e", dotsOpacity: 0.07,
    ink: "#26241e", mute: "#6a5f55", blue: "#c24b2c", blue2: "#e68a68", gold: "#2b2822", gold2: "#4a453c",
    onAccent: "#ffffff", solid: "#fffaf2", paper: "#fffaf2", edge: "#e6d6c1", track: "#eadccb", wash: "#f4e8d8", shadow: "#6b3f22", shadowOpacity: 0.13 },
  deep: { label: "أخضر عميق", dark: true,
    bg: "#0f5c50", bg2: "#06352f", glow1: "#34b36e", glow2: "#d98a48", glow2Opacity: 0.28, dots: "#ffffff", dotsOpacity: 0.06,
    ink: "#f6faf4", mute: "#b9d6cb", blue: "#62d36e", blue2: "#a6e8a0", gold: "#f0a35e", gold2: "#f6c490",
    onAccent: "#05302a", solid: "#17695c", paper: "rgba(255,255,255,0.10)", edge: "rgba(255,255,255,0.22)", track: "rgba(255,255,255,0.14)", wash: "rgba(255,255,255,0.12)", shadow: "#000000", shadowOpacity: 0.28 },
  ember: { label: "جمر (داكن)", dark: true,
    bg: "#0b0706", bg2: "#1d0e08", glow1: "#8a3a1c", glow2: "#c2562c", glow2Opacity: 0.3, dots: "#ffffff", dotsOpacity: 0.04,
    ink: "#f4ece6", mute: "#b3a299", blue: "#e8774c", blue2: "#f2a07e", gold: "#f4ece6", gold2: "#b3a299",
    onAccent: "#1a0c07", solid: "#1b1210", paper: "#1b1210", edge: "#3a2820", track: "#2a1c16", wash: "#2a1a13", shadow: "#000000", shadowOpacity: 0.5 },
  calm: { label: "هادئ", dark: false,
    bg: "#fafbf9", bg2: "#eceeeb", glow1: "#3e5c78", glow2: "#8f5a28", dots: "#15161a", dotsOpacity: 0.04,
    ink: "#15161a", mute: "#5e6570", blue: "#3e5c78", blue2: "#6f8fab", gold: "#8f5a28", gold2: "#b98350",
    onAccent: "#ffffff", solid: "#ffffff", paper: "#ffffff", edge: "#d4d9da", track: "#e3e8ec", wash: "#e7eef1", shadow: "#15161a", shadowOpacity: 0.09 },
};
export const DEFAULT_THEME = "warm";
export const themeName = (value) => (Object.hasOwn(THEMES, value) ? value : DEFAULT_THEME);
// A scene may also name one of the 64 design worlds ("world:<id>"), chosen by the stylist (scene-stylist.js).
export const themeKnown = (value) => Object.hasOwn(THEMES, value) || isWorldName(value);
export const themeFor = (value) => (Object.hasOwn(THEMES, value) ? THEMES[value] : isWorldName(value) ? worldTheme(parseWorld(value).id, parseWorld(value).hue) : THEMES[DEFAULT_THEME]);

// ---- contrast (WCAG 2.1), used by tests/scene-themes.mjs so colours are measured, not guessed ----
export { contrast } from "./color-math.js";
