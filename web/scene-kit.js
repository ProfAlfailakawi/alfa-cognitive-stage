// Shared drawing kit for the vector scenes: theme palette, text wrapping, the animated frame and motion wrappers.
// Motion is CSS only (see style.css, ".info-layer svg .m-*"): text content is always the exact final text, so
// nothing is ever shown "counting up" to a number the lecturer did not say. Reduced-motion users get a still scene.
import { themeFor } from "./scene-theme.js";

/** The live palette. renderInfographic() calls useTheme() before it draws; drawing is synchronous so this is safe. */
export const C = {};
// `st` = style tokens (background pattern, title style, corner radius, flatness, motion); only the design worlds set them.
const PLAIN = { bg: "dots", title: "center", rad: 1, flat: false, motion: "", post: "", finish: "soft", light: "soft" };
export function useTheme(name) {
  for (const k of Object.keys(C)) delete C[k];
  Object.assign(C, themeFor(name));
  C.st = { ...PLAIN, ...(C.st || {}) };
  return C;
}
useTheme("warm");

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
export function label(value, x, y, { size = 21, color = C.ink, limit = 24, rows = 3, weight = 400, lh = 28, family = "", accent = "", ui = false, accentFirst = false } = {}) {
  const f = fitText(value, { size, limit, rows, lh });
  const row = (t, last, first) => {
    if (accentFirst && accent && first) { const w = t.split(" "); return w.length > 1 ? `<tspan fill="${accent}">${E(w[0])}</tspan> ${E(w.slice(1).join(" "))}` : `<tspan fill="${accent}">${E(t)}</tspan>`; }
    if (!accent || !last || accentFirst) return E(t);
    const w = t.split(" ");
    return w.length > 1 ? `${E(w.slice(0, -1).join(" "))} <tspan fill="${accent}">${E(w.at(-1))}</tspan>` : `<tspan fill="${accent}">${E(t)}</tspan>`;
  };
  return `<text${ui ? ' class="ui"' : ""} x="${x}" y="${y}" fill="${color}" font-size="${f.size}" font-weight="${weight}"${family ? ` font-family="${family}"` : ""} text-anchor="middle" direction="rtl">` +
    f.lines.map((t, i) => `<tspan x="${x}" dy="${i ? f.lh : 0}">${row(t, i === f.lines.length - 1, i === 0)}</tspan>`).join("") + "</text>";
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
  <filter id="sk-glow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="0" stdDeviation="9" flood-color="${C.blue}" flood-opacity="0.34"/></filter>
  <filter id="sk-shadow" x="-12%" y="-12%" width="124%" height="140%"><feDropShadow dx="0" dy="7" stdDeviation="9" flood-color="${C.shadow}" flood-opacity="${C.shadowOpacity}"/></filter>
</defs>`;

// Motion character of a design world: how far, how fast and how springy things arrive. CSS reads these as custom properties.
const MOTION = {
  breathe: { dur: ".95s", ease: "cubic-bezier(.45,0,.25,1)", stag: "150ms", dy: "10px", dx: "20px", sc: ".92", rot: "0deg" },
  grow: { dur: ".7s", ease: "cubic-bezier(.2,.8,.2,1)", stag: "120ms", dy: "22px", dx: "30px", sc: ".55", rot: "0deg" },
  connect: { dur: ".55s", ease: "cubic-bezier(.3,.7,.2,1)", stag: "85ms", dy: "14px", dx: "36px", sc: ".8", rot: "0deg" },
  split: { dur: ".6s", ease: "cubic-bezier(.2,.7,.2,1)", stag: "100ms", dy: "8px", dx: "64px", sc: ".85", rot: "0deg" },
  rise: { dur: ".7s", ease: "cubic-bezier(.16,.8,.2,1)", stag: "110ms", dy: "38px", dx: "30px", sc: ".85", rot: "0deg" },
  orbit: { dur: ".8s", ease: "cubic-bezier(.25,.8,.25,1)", stag: "130ms", dy: "18px", dx: "34px", sc: ".72", rot: "-9deg" },
  weave: { dur: ".65s", ease: "cubic-bezier(.3,.6,.3,1)", stag: "95ms", dy: "20px", dx: "52px", sc: ".9", rot: "3deg" },
  reveal: { dur: "1s", ease: "cubic-bezier(.4,0,.2,1)", stag: "160ms", dy: "0px", dx: "0px", sc: ".96", rot: "0deg" },
  balance: { dur: ".7s", ease: "cubic-bezier(.35,.1,.25,1)", stag: "100ms", dy: "12px", dx: "44px", sc: ".9", rot: "0deg" },
  pulse: { dur: ".6s", ease: "cubic-bezier(.3,1.5,.4,1)", stag: "105ms", dy: "16px", dx: "30px", sc: ".5", rot: "0deg" },
};
const motionAttrs = () => {
  const m = MOTION[C.st.motion];
  return m ? ` data-motion="${C.st.motion}" style="${Object.entries(m).map(([k, v]) => `--${k}:${v}`).join(";")}"` : "";
};

/** A faint, static background pattern that belongs to the world's geometry. Never carries text. */
function decor() {
  const a = C.blue, o = C.dark ? 0.1 : 0.075;
  switch (C.st.bg) {
    case "rings": return [190, 320, 450].map((r) => `<circle cx="480" cy="300" r="${r}" fill="none" stroke="${a}" stroke-opacity="${o}" stroke-width="2"/>`).join("");
    case "rays": return Array.from({ length: 9 }, (_, i) => `<line x1="${60 + i * 105}" y1="0" x2="${60 + i * 105}" y2="540" stroke="${a}" stroke-opacity="${o * 0.8}" stroke-width="2"/>`).join("");
    case "grid": return Array.from({ length: 9 }, (_, i) => `<line x1="0" y1="${60 + i * 60}" x2="960" y2="${60 + i * 60}" stroke="${a}" stroke-opacity="${o * 0.7}"/>`).join("") +
      Array.from({ length: 15 }, (_, i) => `<line x1="${60 + i * 60}" y1="0" x2="${60 + i * 60}" y2="540" stroke="${a}" stroke-opacity="${o * 0.7}"/>`).join("");
    case "blobs": return `<ellipse cx="820" cy="150" rx="230" ry="150" fill="${a}" fill-opacity="${o}"/><ellipse cx="150" cy="470" rx="260" ry="120" fill="${a}" fill-opacity="${o}"/>`;
    case "blocks": return `<rect x="650" y="0" width="310" height="540" fill="${a}" fill-opacity="${o * 0.8}"/><rect x="0" y="420" width="420" height="120" fill="${a}" fill-opacity="${o * 0.8}"/>`;
    case "stars": { let x = 7; const rnd = () => (x = (x * 48271) % 2147483647) / 2147483647;
      return Array.from({ length: 46 }, () => `<circle cx="${(rnd() * 960).toFixed(0)}" cy="${(rnd() * 540).toFixed(0)}" r="${(0.8 + rnd() * 1.6).toFixed(1)}" fill="${C.ink}" fill-opacity="${(0.15 + rnd() * 0.3).toFixed(2)}"/>`).join(""); }
    default: return "";
  }
}

/** Where the two soft glows sit follows the world's lighting. */
function lights() {
  const [a, b] = {
    radial: [[480, 300, 380], [900, 60, 160]], backlit: [[480, 560, 430], [60, 60, 170]], side: [[0, 270, 380], [960, 520, 230]],
    eclipse: [[830, 60, 330], [90, 500, 220]], "premium-neon": [[480, -20, 360], [480, 560, 300]],
  }[C.st.light] || [[120, 40, 260], [880, 520, 300]];
  return `<circle cx="${a[0]}" cy="${a[1]}" r="${a[2]}" fill="url(#sk-g1)"/><circle cx="${b[0]}" cy="${b[1]}" r="${b[2]}" fill="url(#sk-g2)"/>`;
}

/** The scene frame: themed background, a heavy title (style follows the world), a drawn rule, then the content. */
export function frame(title, inside, extraDefs = "", { bare = false } = {}) {
  const mode = C.st.title;
  const fit = fitText(title, { size: 40, limit: 34, rows: 1, lh: 46 });
  const underlineY = 84 + (fit.lines.length - 1) * fit.lh + 24;
  const head = bare ? "" : mode === "band"
    ? motion("rise", 0, `<rect x="0" y="22" width="960" height="92" fill="${C.gold}"/>` + label(title, 480, 84, { size: 40, color: C.onAccent, limit: 34, rows: 1, weight: 900, lh: 46, family: FONT.display })) +
      drawLine(0, 118, 960, 118, { color: C.blue, width: 5, i: 1 })
    : motion("rise", 0, label(title, 480, 84, { size: 40, color: C.ink, limit: 34, rows: 1, weight: 900, lh: 46, family: FONT.display, accent: C.blue })) +
      (mode === "rule" ? drawLine(250, underlineY, 710, underlineY, { color: C.edge, width: 2, i: 1 }) : "") +
      drawLine(436, underlineY, 524, underlineY, { color: C.blue, width: 5, i: mode === "rule" ? 2 : 1 });
  return `<svg viewBox="0 0 960 540" role="img" xmlns="http://www.w3.org/2000/svg" aria-label="${E(title)}" data-theme="${C.dark ? "dark" : "light"}"${motionAttrs()}>` +
    defs().replace("</defs>", extraDefs + "</defs>") +
    `<rect width="960" height="540" fill="url(#sk-bg)"/><rect width="960" height="540" fill="url(#sk-pat)"/>` +
    lights() + decor() + head + inside + "</svg>";
}

/** A card with a soft shadow. */
export const card = (x, y, w, h, { fill = C.paper, r = 20, stroke = C.edge } = {}) => {
  const rr = radius(r), f = C.st.finish;
  const body = (extra) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rr}" fill="${fill}" stroke="${f === "ink" ? C.ink : stroke}"${extra}/>`;
  if (f === "ink") return `<rect x="${x + 6}" y="${y + 6}" width="${w}" height="${h}" rx="${rr}" fill="${C.ink}" opacity=".9"/>` + body(' stroke-width="2.5"');
  const base = body(C.st.flat ? ' stroke-width="2.5"' : f === "glow" ? ' filter="url(#sk-glow)"' : ' filter="url(#sk-shadow)"');
  if (f === "glass") return base + `<rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" rx="${Math.max(2, rr - 2)}" fill="none" stroke="${C.dark ? "#ffffff" : "#ffffff"}" stroke-opacity="${C.dark ? 0.14 : 0.7}" stroke-width="1.5"/>`;
  if (f === "metal") return base + `<line x1="${x + rr}" y1="${y + 2}" x2="${x + w - rr}" y2="${y + 2}" stroke="${C.blue}" stroke-width="3" stroke-linecap="round"/>`;
  if (f === "stone") return base + `<rect x="${x + 6}" y="${y + 6}" width="${w - 12}" height="${h - 12}" rx="${Math.max(2, rr - 5)}" fill="none" stroke="${stroke}" stroke-width="1.2"/>`;
  return base;
};
/** A corner radius scaled by the world's material (glass is round, stone and ink are crisp). */
export const radius = (r) => Math.max(2, Math.round(r * C.st.rad));
