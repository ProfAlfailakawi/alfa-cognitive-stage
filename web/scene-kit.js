// Shared drawing kit for the vector scenes: palette, text wrapping, the animated frame and motion wrappers.
// Motion is CSS only (see style.css, ".info-layer svg .m-*"): text content is always the exact final text, so
// nothing is ever shown "counting up" to a number the lecturer did not say. Reduced-motion users get a still scene.
export const C = { bg: "#f4f5f3", paper: "#ffffff", blue: "#3e5c78", blue2: "#6f8fab", ink: "#15161a", mute: "#5e6570", edge: "#d4d9da",
  track: "#e3e8ec", gold: "#8f5a28", gold2: "#b98350", wash: "#e7eef1" };

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

/** Centred, wrapped, RTL text. */
export function label(value, x, y, { size = 21, color = C.ink, limit = 24, rows = 3, weight = 400, lh = 28 } = {}) {
  const f = fitText(value, { size, limit, rows, lh });
  return `<text x="${x}" y="${y}" fill="${color}" font-size="${f.size}" font-weight="${weight}" text-anchor="middle" direction="rtl">` +
    f.lines.map((t, i) => `<tspan x="${x}" dy="${i ? f.lh : 0}">${E(t)}</tspan>`).join("") + "</text>";
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

const DEFS = `<defs>
  <linearGradient id="sk-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fafbf9"/><stop offset="1" stop-color="#eceeeb"/></linearGradient>
  <linearGradient id="sk-blue" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3e5c78"/><stop offset="1" stop-color="#6f8fab"/></linearGradient>
  <linearGradient id="sk-gold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8f5a28"/><stop offset="1" stop-color="#b98350"/></linearGradient>
  <filter id="sk-shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#15161a" flood-opacity="0.09"/></filter>
</defs>`;

/** The scene frame: soft background, a centred title with a drawn underline, then the scene content. */
export function frame(title, inside, extraDefs = "") {
  const fit = fitText(title, { size: 34, limit: 42, rows: 2, lh: 40 });
  const underlineY = 76 + (fit.lines.length - 1) * fit.lh + 26;
  return `<svg viewBox="0 0 960 540" role="img" xmlns="http://www.w3.org/2000/svg" aria-label="${E(title)}">` +
    DEFS.replace("</defs>", extraDefs + "</defs>") +
    `<rect width="960" height="540" fill="url(#sk-bg)"/>` +
    `<circle cx="70" cy="60" r="150" fill="${C.blue}" opacity="0.045"/><circle cx="900" cy="500" r="190" fill="${C.gold}" opacity="0.04"/>` +
    motion("rise", 0, label(title, 480, 76, { size: 34, color: C.blue, limit: 42, rows: 2, weight: 700, lh: 40 })) +
    drawLine(430, underlineY, 530, underlineY, { color: C.gold, width: 4, i: 1 }) +
    inside + "</svg>";
}

/** A card with a soft shadow. */
export const card = (x, y, w, h, { fill = C.paper, r = 18, stroke = C.edge } = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" filter="url(#sk-shadow)"/>`;
