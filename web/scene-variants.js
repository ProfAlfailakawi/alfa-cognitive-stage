// Alternative layouts for the same scene types, so consecutive scenes (and lectures) do not look alike.
// Same rules as scene-layouts.js: icons plus a FEW of the lecturer's words, the full text kept in <title>/data-full, nothing invented.
// Variant 0 of every type is the original layout in infographic.js / scene-layouts.js; the functions below are variants 1 and up.
import { C, FONT, E, label, labelMid, fitText, motion, item, drawLine, rtlX, frame, card, radius } from "./scene-kit.js";
import { pickIcon, iconSvg, shortLabel } from "./scene-icons.js";
import { bubble, numChip, ORD_F } from "./scene-layouts.js";

/** How many layouts exist for each scene type (including variant 0). */
export const VARIANTS = { steps: 3, concept: 3, stat: 2, compare: 2, quote: 2 };

const AR_DIGITS = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9" };

// ---- steps ----
function stairs(spec) {
  const n = spec.lines.length, gap = 14, w = (840 - (n - 1) * gap) / n, base = 492, small = n > 4;
  const items = spec.lines.map((text, i) => {
    const x = 900 - (i + 1) * w - i * gap, cx = x + w / 2, h = 150 + (n === 1 ? 0 : (i * 170) / (n - 1)), top = base - h, pad = Math.round((h - 130) * 0.4) + 8;
    return item("rise", i + 1, text,
      label("الخطوة " + ORD_F[i], cx, top - 14, { size: small ? 18 : 22, color: C.blue, limit: 14, rows: 1, weight: 700, family: FONT.hand, ui: true }) +
      card(x, top, w, h, { r: 18 }) + bubble(cx, top + pad + 30, 28, pickIcon(text), { fill: C.wash, shadow: false, square: true }) + numChip(cx + 30, top + pad + 6, i + 1, 13) +
      labelMid(shortLabel(text, small ? 3 : 4), cx, top + pad + 96, { size: small ? 19 : 23, limit: Math.max(8, Math.floor(w / 12)), rows: 2, lh: 26, weight: 800, family: FONT.display }));
  }).join("");
  return frame(spec.title, items);
}

function path(spec) {
  const n = spec.lines.length, xs = spec.lines.map((_, i) => rtlX(i, n, 130, 830)), ys = spec.lines.map((_, i) => (i % 2 ? 372 : 236));
  let d = `M ${xs[0] + 60} ${ys[0]}`;
  xs.forEach((x, i) => { if (i) { const px = xs[i - 1], mx = (px + x) / 2; d += ` C ${mx} ${ys[i - 1]}, ${mx} ${ys[i]}, ${x} ${ys[i]}`; } });
  d += ` L ${xs[n - 1] - 60} ${ys[n - 1]}`;
  const curve = `<path class="m-draw" style="--i:0" pathLength="1" d="${d}" fill="none" stroke="${C.blue2}" stroke-width="6" stroke-linecap="round"/>`;
  const nodes = spec.lines.map((text, i) => item("pop", i + 1, text, bubble(xs[i], ys[i], 38, pickIcon(text)) + numChip(xs[i] + 30, ys[i] - 30, i + 1, 14) +
    labelMid(shortLabel(text, 4), xs[i], ys[i] + 82, { size: n > 4 ? 21 : 24, limit: Math.max(9, Math.floor(700 / Math.max(1, n - 1) / 13)), rows: 2, lh: 27, weight: 800, family: FONT.display }))).join("");
  return frame(spec.title, curve + nodes);
}

// ---- concept ----
function tiles(spec) {
  const n = spec.lines.length, cols = n <= 4 ? 2 : 3, rows = Math.ceil(n / cols), gap = 16;
  const tw = (780 - (cols - 1) * gap) / cols, th = (340 - (rows - 1) * gap) / rows;
  return frame(spec.title, spec.lines.map((text, i) => {
    const r = Math.floor(i / cols), c = i % cols, inRow = r === rows - 1 ? n - r * cols : cols, x = 870 - (c + 1) * tw - c * gap - ((cols - inRow) * (tw + gap)) / 2, y = 150 + r * (th + gap), cx = x + tw / 2, fill = i % 2 ? C.gold : C.blue;
    return item("pop", i + 1, text, `<rect x="${x}" y="${y}" width="${tw}" height="${th}" rx="${radius(22)}" fill="${fill}"${C.st.flat ? "" : ' filter="url(#sk-shadow)"'}/>` +
      iconSvg(pickIcon(text), cx, y + th * 0.34, Math.min(64, th * 0.42), C.onAccent) +
      labelMid(shortLabel(text), cx, y + th * 0.72, { size: th > 120 ? 27 : 22, color: C.onAccent, limit: Math.max(8, Math.floor(tw / 15)), rows: 2, lh: 30, weight: 800, family: FONT.display }));
  }).join(""));
}

function orbit(spec) {
  const n = spec.lines.length, cx = 480, cy = 322, rx = 300, ry = 138;
  const pts = spec.lines.map((_, i) => { const a = -Math.PI / 2 - (i * 2 * Math.PI) / n; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; }); // first at the top, then leftwards
  const links = pts.map(([x, y], i) => drawLine(cx, cy, x.toFixed(1), y.toFixed(1), { color: C.edge, width: 3, i: i + 1 })).join("");
  const hub = motion("pop", 0, `<circle cx="${cx}" cy="${cy}" r="58" fill="${C.blue}"/>` + iconSvg(pickIcon(spec.title), cx, cy, 66, C.onAccent));
  const nodes = spec.lines.map((text, i) => { const [x, y] = pts[i];
    return item("pop", i + 2, text, card(x - 98, y - 40, 196, 80, { r: 18 }) + bubble((x + 62).toFixed(1), y.toFixed(1), 22, pickIcon(text), { fill: C.wash, shadow: false, square: true }) +
      labelMid(shortLabel(text, 3), x - 22, y, { size: 21, limit: 9, rows: 2, lh: 23, weight: 800, family: FONT.display }));
  }).join("");
  return frame(spec.title, links + hub + nodes);
}

// ---- stat ----
function statBand(spec) {
  const [number, text] = [spec.lines[0], spec.lines[1] || ""];
  const ascii = number.replace(/[٠-٩]/g, (d) => AR_DIGITS[d]).replace(/\s/g, "");
  const pct = ascii.match(/^(\d{1,3}(?:[.,]\d+)?)%$/), value = pct ? Number(pct[1].replace(",", ".")) : null;
  const size = Math.max(70, Math.min(200, 200 - Math.max(0, number.length - 4) * 18));
  const bigNumber = motion("pop", 1, `<text x="480" y="${290 + size * 0.1}" text-anchor="middle" font-size="${size}" font-family="${FONT.hero}" fill="${value !== null ? C.ink : C.blue}">${E(number)}</text>`);
  const bar = value !== null && value <= 100
    ? `<rect x="140" y="376" width="680" height="40" rx="20" fill="${C.track}"/><g class="m-grow-r" style="--i:2"><rect x="${820 - (680 * value) / 100}" y="376" width="${Math.max(6, (680 * value) / 100)}" height="40" rx="20" fill="${C.blue}"/></g>`
    : drawLine(404, 340, 556, 340, { color: C.blue, width: 6, i: 2 });
  const captionY = value !== null && value <= 100 ? 466 : 410;
  const cap = text ? (value !== null && value <= 100
    ? motion("rise", 3, label(text, 480, captionY, { size: 30, color: C.blue, limit: 38, rows: 2, lh: 36, weight: 900, family: FONT.display }))
    : motion("rise", 3, `<rect x="120" y="${captionY - 34}" width="720" height="82" rx="${radius(22)}" fill="${C.gold}"/>` + labelMid(text, 480, captionY + 7, { size: 30, color: C.onAccent, limit: 40, rows: 2, lh: 36, weight: 800, family: FONT.display }))) : "";
  return frame(spec.title, bigNumber + bar + cap);
}

// ---- compare ----
function versus(spec) {
  const n = spec.lines.length, rowH = Math.min(70, (270 - (n - 1) * 8) / n);
  const panel = (x, color, name, pick) => {
    const rows = spec.lines.map((pair, i) => { const text = pair[pick], y = 238 + i * (rowH + 8), cy = y + rowH / 2;
      return item(pick ? "left" : "right", i + 2, text, bubble(x + 372, cy, Math.min(20, rowH / 2 - 5), pickIcon(text), { fill: C.wash, color, shadow: false, square: true }) +
        labelMid(shortLabel(text, 5), x + 178, cy, { size: 23, limit: 18, rows: 2, lh: 25, weight: 800, family: FONT.display }));
    }).join("");
    return card(x, 150, 410, 340, { r: 24 }) + `<rect x="${x}" y="150" width="410" height="64" rx="${radius(24)}" fill="${color}"/>` +
      label(name, x + 205, 192, { size: 28, color: C.onAccent, limit: 12, rows: 1, weight: 900, family: FONT.display, ui: true }) + rows;
  };
  return frame(spec.title, motion("rise", 1, panel(490, C.blue, "الأول", 0)) + motion("rise", 1.5, panel(60, C.gold, "الثاني", 1)) +
    motion("pop", 3, `<circle cx="480" cy="320" r="26" fill="${C.paper}" stroke="${C.edge}" stroke-width="2"/>` + label("×", 480, 330, { size: 26, color: C.mute, limit: 2, rows: 1, weight: 900, ui: true })));
}

// ---- quote: a typographic poster for one spoken sentence (the whole sentence, never cut) ----
function quote(spec, variant) {
  const [text, who] = [spec.lines[0], spec.lines[1] || ""];
  const dark = variant === 1, fg = dark ? C.onAccent : C.ink;
  const f = fitText(text, { size: 46, limit: 24, rows: 5, lh: 62 });
  const body = label(text, 480, (dark ? 342 : 296) - ((f.lines.length - 1) * f.lh) / 2 + f.size * 0.3, { size: 46, color: fg, limit: 24, rows: 5, weight: 800, lh: 62, family: FONT.display });
  const mark = (color) => `<text class="ui" x="480" y="${dark ? 258 : 232}" text-anchor="middle" font-size="150" font-family="${FONT.hero}" fill="${color}">”</text>`;
  const by = who ? motion("rise", 3, label(who, 480, 470, { size: 24, color: dark ? C.mute : C.mute, limit: 40, rows: 1, weight: 700, family: FONT.display })) : "";
  return dark
    ? frame(spec.title, motion("rise", 1, `<rect x="100" y="150" width="760" height="${who ? 290 : 320}" rx="${radius(28)}" fill="${C.gold}"/>` + mark(C.blue2) + body) + (who ? motion("rise", 3, label(who, 480, 472, { size: 24, color: C.mute, limit: 40, rows: 1, weight: 700, family: FONT.display })) : ""))
    : frame(spec.title, motion("pop", 1, mark(C.blue)) + motion("rise", 2, body) + drawLine(430, 440, 530, 440, { color: C.blue, width: 5, i: 3 }) + by);
}

export const quoteScene = (spec) => quote(spec, 0);

/** Returns the drawing for variant >= 1 of a type, or null when that type has only the original layout. */
export function renderVariant(type, variant, spec) {
  if (type === "quote") return quote(spec, variant ? 1 : 0);
  const table = { steps: [null, stairs, path], concept: [null, tiles, orbit], stat: [null, statBand], compare: [null, versus] }[type];
  const fn = table?.[variant];
  return fn ? fn(spec) : null;
}
