// Shared drawing kit for the vector scenes: palette, text wrapping, the animated frame and motion wrappers.
// Motion is CSS only (see style.css, ".info-layer svg .m-*"): text content is always the exact final text, so
// nothing is ever shown "counting up" to a number the lecturer did not say. Reduced-motion users get a still scene.
export const C = { bg: "#f4f5f3", paper: "#ffffff", blue: "#3e5c78", blue2: "#6f8fab", ink: "#15161a", mute: "#5e6570", edge: "#d4d9da",
  track: "#e3e8ec", gold: "#8f5a28", gold2: "#b98350", wash: "#e7eef1" };

export const E = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function splitLines(value, limit = 24, maxRows = 3) {
  const words = String(value).split(/\s+/), rows = [];
  let current = "";
  for (const w of words) {
    if (current && (current + " " + w).length > limit) { rows.push(current); current = w; }
    else current = (current + " " + w).trim();
  }
  if (current) rows.push(current);
  if (rows.length > maxRows) {
    const cut = rows.slice(0, maxRows);
    cut[maxRows - 1] = cut[maxRows - 1].slice(0, Math.max(1, limit - 2)) + "…";
    return cut;
  }
  // a single very long word must still fit its box
  return rows.map((r) => (r.length > limit + 4 ? r.slice(0, limit + 1) + "…" : r));
}

/** Centred, wrapped, RTL text. */
export function label(value, x, y, { size = 21, color = C.ink, limit = 24, rows = 3, weight = 400, lh = 28 } = {}) {
  return `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" text-anchor="middle" direction="rtl">` +
    splitLines(value, limit, rows).map((t, i) => `<tspan x="${x}" dy="${i ? lh : 0}">${E(t)}</tspan>`).join("") + "</text>";
}

/** Like label(), but `cy` is the vertical CENTRE of the text block, whatever the number of rows. */
export function labelMid(value, x, cy, opts = {}) {
  const { size = 21, limit = 24, rows = 3, lh = 28 } = opts;
  const used = splitLines(value, limit, rows).length;
  return label(value, x, cy + size * 0.34 - ((used - 1) * lh) / 2, opts);
}

/** Wrap content in an animated group. kind: rise | pop | fade | left | right | draw | grow | grow-r. i = stagger index. */
export const motion = (kind, i, inner) => `<g class="m-${kind}" style="--i:${i}">${inner}</g>`;
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
  const rows = splitLines(title, 42, 2).length;
  const underlineY = 76 + (rows - 1) * 40 + 26;
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
