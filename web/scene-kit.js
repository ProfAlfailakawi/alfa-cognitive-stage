// Shared drawing kit for the vector scenes: theme palette, text wrapping, the animated frame and motion wrappers.
// Motion is CSS only (see style.css, ".info-layer svg .m-*"): text content is always the exact final text, so
// nothing is ever shown "counting up" to a number the lecturer did not say. Reduced-motion users get a still scene.
import { THEMES, themeName } from "./scene-theme.js";

/** The live palette. renderInfographic() calls useTheme() before it draws; drawing is synchronous so this is safe. */
export const C = { ...THEMES.warm };
export function useTheme(name) { Object.assign(C, THEMES[themeName(name)]); return C; }

export const FONT = { display: "Cairo, Tahoma, sans-serif", hero: "Lalezar, Cairo, sans-serif", hand: "'Aref Ruqaa', Cairo, serif" };

export const E = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Pure word wrap. Never drops or shortens any text. */
export function splitLines(value, limit = 24) {
  const words = String(value).split(/\s+/).filter(Boolean), rows = [];
  let current = "";
  for (const w of words) {
    if (current && (current + " " + w).length > limit) { rows.push(current); current = w; }
    else current = (current + " " + w).trim();
  }
  if (current) rows.push(current);
  return rows.length ? rows : [""];
}

/**
 * Fit ALL of the text into `rows` rows by shrinking the font (never by cutting words). A longer text means a smaller
 * font, down to 55%; below that it keeps every word and simply uses more rows.
 */
export function fitText(value, { size = 21, limit = 24, rows = 3, lh = 28 } = {}) {
  const longest = Math.max(1, ...String(value).split(/\s+/).map((w) => w.length));
  for (let scale = 1; scale >= 0.55; scale -= 0.05) {
    const l = Math.max(Math.floor(limit / scale), 1);
    if (l < longest) continue; // a single long word must fit the width too
    const lines = splitLines(value, l);
    if (lines.length <= rows) return { lines, size: Math.round(size * scale * 10) / 10, lh: Math.round(lh * scale * 10) / 10 };
  }
  const scale = Math.min(0.55, limit / longest);
  const lines = splitLines(value, Math.max(Math.floor(limit / Math.min(0.55, scale)), longest));
  return { lines, size: Math.round(size * Math.min(0.55, scale) * 10) / 10, lh: Math.round(lh * Math.min(0.55, scale) * 10) / 10 };
}

/** Centred, wrapped, RTL text. `accent` colours the last word (the title style). `ui` marks fixed scene captions (numbers, ordinals) that are not the lecturer's words. */
export function label(value, x, y, { size = 21, color = C.ink, limit = 24, rows = 3, weight = 400, lh = 28, family = "", accent = "", ui = false } = {}) {
  const f = fitText(value, { size, limit, rows, lh });
  const row = (t, last) => {
    if (!accent || !last) return E(t);
    const w = t.split(" ");
    return w.length > 1 ? `${E(w.slice(0, -1).join(" "))} <tspan fill="${accent}">${E(w.at(-1))}</tspan>` : `<tspan fill="${accent}">${E(t)}</tspan>`;
  };
  return `<text${ui ? ' class="ui"' : ""} x="${x}" y="${y}" fill="${color}" font-size="${f.size}" font-weight="${weight}"${family ? ` font-family="${family}"` : ""} text-anchor="middle" direction="rtl">` +
    f.lines.map((t, i) => `<tspan x="${x}" dy="${i ? f.lh : 0}">${row(t, i === f.lines.length - 1)}</tspan>`).join("") + "</text>";
}

/** Like label(), but `cy` is the vertical CENTRE of the text block, whatever the number of rows. */
export function labelMid(value, x, cy, opts = {}) {
  const f = fitText(value, { size: opts.size ?? 21, limit: opts.limit ?? 24, rows: opts.rows ?? 3, lh: opts.lh ?? 28 });
  return label(value, x, cy + f.size * 0.34 - ((f.lines.length - 1) * f.lh) / 2, opts);
}

/** Wrap content in an animated group. kind: rise | pop | fade | left | right | draw | grow | grow-r. i = stagger index. */
export const motion = (kind, i, inner) => `<g class="m-${kind}" style="--i:${i}">${inner}</g>`;
/** An animated item that carries the lecturer's FULL text (data-full + <title>) even when only a few words are drawn. */
export const item = (kind, i, full, inner) => `<g class="m-${kind}" style="--i:${i}" data-full="${E(full)}"><title>${E(full)}</title>${inner}</g>`;
/** A line/path that draws itself (needs pathLength=1 on the element). */
export const drawLine = (x1, y1, x2, y2, { color = C.edge, width = 3, i = 0, extra = "" } = {}) =>
  `<line class="m-draw" style="--i:${i}" pathLength="1" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" ${extra}/>`;

/** x position of item i of n, first item on the RIGHT (Arabic reading order). */
export const rtlX = (i, n, left, right) => (n === 1 ? (left + right) / 2 : right - (i * (right - left)) / (n - 1));

const defs = () => `<defs>
  <linearGradient id="sk-bg" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${C.bg}"/><stop offset="1" stop-color="${C.bg2}"/></linearGradient>
  <radialGradient id="sk-g1"><stop offset="0" stop-color="${C.glow1}" stop-opacity="0.55"/><stop offset="1" stop-color="${C.glow1}" stop-opacity="0"/></radialGradient>
  <radialGradient id="sk-g2"><stop offset="0" stop-color="${C.glow2}" stop-opacity="${C.glow2Opacity ?? 0.5}"/><stop offset="1" stop-color="${C.glow2}" stop-opacity="0"/></radialGradient>
  <pattern id="sk-pat" width="40" height="40" patternUnits="userSpaceOnUse"><circle cx="20" cy="20" r="1.5" fill="${C.dots}" opacity="${C.dotsOpacity}"/></pattern>
  <linearGradient id="sk-blue" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.blue}"/><stop offset="1" stop-color="${C.blue2}"/></linearGradient>
  <linearGradient id="sk-gold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.gold2}"/></linearGradient>
  <filter id="sk-shadow" x="-12%" y="-12%" width="124%" height="140%"><feDropShadow dx="0" dy="7" stdDeviation="9" flood-color="${C.shadow}" flood-opacity="${C.shadowOpacity}"/></filter>
</defs>`;

/** The scene frame: themed background, a heavy title whose last word carries the accent, a drawn underline, then the content. */
export function frame(title, inside, extraDefs = "") {
  const fit = fitText(title, { size: 40, limit: 34, rows: 1, lh: 46 });
  const underlineY = 84 + (fit.lines.length - 1) * fit.lh + 24;
  return `<svg viewBox="0 0 960 540" role="img" xmlns="http://www.w3.org/2000/svg" aria-label="${E(title)}" data-theme="${C.dark ? "dark" : "light"}">` +
    defs().replace("</defs>", extraDefs + "</defs>") +
    `<rect width="960" height="540" fill="url(#sk-bg)"/><rect width="960" height="540" fill="url(#sk-pat)"/>` +
    `<circle cx="120" cy="40" r="260" fill="url(#sk-g1)"/><circle cx="880" cy="520" r="300" fill="url(#sk-g2)"/>` +
    motion("rise", 0, label(title, 480, 84, { size: 40, color: C.ink, limit: 34, rows: 1, weight: 900, lh: 46, family: FONT.display, accent: C.blue })) +
    drawLine(436, underlineY, 524, underlineY, { color: C.blue, width: 5, i: 1 }) +
    inside + "</svg>";
}

/** A card with a soft shadow. */
export const card = (x, y, w, h, { fill = C.paper, r = 20, stroke = C.edge } = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" filter="url(#sk-shadow)"/>`;
