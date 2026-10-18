// Turns one of the 64 design worlds into a scene theme with the same role names as scene-theme.js.
// The world's own colours are kept; they are only nudged (never replaced) until the same contrast rules hold:
// ink >= 7, muted >= 4.5, accent >= 3 on every surface, and onAccent >= 4.5 on both emphasis colours.
import { WORLDS } from "./design-worlds.js";
import { contrast, mix, brightness, fit } from "./color-math.js";

const BG_KIND = { circular: "rings", axial: "rays", grid: "grid", organic: "blobs", architectural: "blocks", free: "dots" };
const TITLE_MODE = { "Poster Monument": "band", "Cinematic Frame": "band", "Central Emblem": "band",
  "Editorial Stack": "rule", "Quote Architecture": "rule", "Modular Brief": "rule", "Typographic Field": "rule", "Minimal Thesis": "rule" };
const RADIUS = { glass: 1.35, clay: 1.35, water: 1.3, stone: 0.45, metal: 0.5, ink: 0.55 };

export const WORLD_BY_ID = new Map(WORLDS.map((w) => [w.id, w]));
export const worldName = (id) => `world:${id}`;
export const isWorldName = (name) => typeof name === "string" && name.startsWith("world:") && WORLD_BY_ID.has(name.slice(6));

const cache = new Map();
export function worldTheme(id) {
  if (cache.has(id)) return cache.get(id);
  const w = WORLD_BY_ID.get(id);
  if (!w) return null;
  const [bg0, surface0, ink0, mute0, accent0, soft, rule] = w.colors;
  const dark = brightness(bg0) < 0.47;
  // A mid-tone background cannot carry AAA text even in pure black or white, so it is pushed lighter (or darker) just enough.
  const extreme = dark ? "#ffffff" : "#000000", away = dark ? "#000000" : "#ffffff", roomy = (c) => contrast(extreme, c) >= 8.5;
  const bg = fit(bg0, away, roomy), surface = fit(surface0, away, roomy);
  const bg2 = fit(dark ? mix(bg, "#000000", 0.35) : mix(bg, rule, 0.55), away, roomy);
  const surfaces = [bg, bg2, surface];
  const ink = fit(ink0, dark ? "#ffffff" : "#000000", (c) => surfaces.every((s) => contrast(c, s) >= 7));
  const mute = fit(mute0, ink, (c) => surfaces.every((s) => contrast(c, s) >= 4.5));
  const onAccent = dark ? mix(bg, "#000000", 0.5) : "#ffffff";
  const wash = soft;
  const accent = fit(accent0, dark ? "#ffffff" : "#000000", (c) => contrast(c, onAccent) >= 4.5 && [...surfaces, wash].every((s) => contrast(c, s) >= 3));
  const material = w.material[0], depth = w.depth[0];
  const theme = {
    label: w.ar, dark, world: w.id, family: w.family,
    bg, bg2, glow1: mix(accent, bg, dark ? 0.55 : 0.6), glow2: dark ? accent : soft, glow2Opacity: dark ? 0.25 : 0.5,
    dots: ink, dotsOpacity: 0.05, ink, mute, blue: accent, blue2: mix(accent, dark ? "#ffffff" : bg, dark ? 0.3 : 0.45),
    gold: ink, gold2: mute, onAccent, solid: surface, paper: surface, edge: rule, track: mix(rule, bg, 0.45), wash,
    shadow: dark ? "#000000" : mix(ink, "#000000", 0.3), shadowOpacity: dark ? 0.35 : 0.12,
    st: {
      bg: w.family === "cosmic" ? "stars" : BG_KIND[w.geometry[0]] || "dots", title: TITLE_MODE[w.post] || "center", rad: RADIUS[material] ?? 1,
      flat: depth === "flat", motion: w.motion[0], post: w.post,
    },
  };
  cache.set(id, theme);
  return theme;
}
