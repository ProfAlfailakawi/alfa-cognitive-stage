// Alternative layouts for the same scene types, so consecutive scenes (and lectures) do not look alike.
// Same rules as scene-layouts.js: icons plus a FEW of the lecturer's words, the full text kept in <title>/data-full, nothing invented.
// Variant 0 of every type is the original layout in infographic.js / scene-layouts.js; the functions below are variants 1 and up.
import { C, FONT, E, label, labelMid, fitText, motion, item, drawLine, rtlX, frame, card, radius } from "./scene-kit.js";
import { pickIcon, iconSvg, shortLabel } from "./scene-icons.js";
import { bubble, numChip, ORD_F } from "./scene-layouts.js";

/** How many layouts exist for each scene type (including variant 0). */
export const VARIANTS = { steps: 5, concept: 3, stat: 2, compare: 2, quote: 2 };

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

// A fan of floating cards on a gentle arc, each slightly tilted. Same content as the original cards, never overlapping.
function fan(spec) {
  const n = spec.lines.length, w = Math.min(200, Math.floor(760 / n) - 14), small = n > 4, mid = (n - 1) / 2;
  const items = spec.lines.map((text, i) => {
    const cx = rtlX(i, n, 480 - ((n - 1) * (w + 14)) / 2, 480 + ((n - 1) * (w + 14)) / 2), x = cx - w / 2, d = i - mid, dy = Math.round(d * d * 9), tilt = (-d * 4.5).toFixed(1);
    return item("pop", i + 1, text, `<g class="fl" style="--i:${i}"><g transform="translate(0 ${dy}) rotate(${tilt} ${cx} 330)">` + card(x, 190, w, 270, { r: 24 }) +
      label("الخطوة " + ORD_F[i], cx, 246, { size: small ? 18 : 23, color: C.blue, limit: 14, rows: 1, weight: 700, family: FONT.hand, ui: true }) +
      bubble(cx, 312, 38, pickIcon(text), { fill: C.wash, shadow: false, square: true }) + numChip(cx + 32, 278, i + 1, 14) +
      labelMid(shortLabel(text, small ? 3 : 4), cx, 408, { size: small ? 20 : 25, limit: Math.max(8, Math.floor(w / 13)), rows: 3, lh: 29, weight: 800, family: FONT.display }) + "</g></g>");
  }).join("");
  return frame(spec.title, items);
}

// ---- kinetic: the phrases arrive one after another, big and heavy, a small grey lead line above ("lead | phrase") ----
export function kinetic(spec) {
  const parts = spec.lines.map((l) => { const [a, b] = l.split("|").map((x) => x.trim()); return b ? { lead: a, big: b, full: l } : { lead: "", big: a, full: l }; });
  const n = parts.length;
  const one = (p, i) => {
    const lead = p.lead ? label(p.lead, 480, 238, { size: 26, color: C.mute, limit: 40, rows: 1, weight: 700, family: FONT.display }) : "";
    const big = labelMid(p.big, 480, 330, { size: 78, color: C.ink, limit: 17, rows: 2, lh: 92, weight: 900, family: FONT.display, accent: C.blue, accentFirst: i % 2 === 0 });
    return `<g class="k-item${i === n - 1 ? " k-last" : ""}" style="--k:${i}" data-full="${E(p.full)}"><title>${E(p.full)}</title>${lead}${big}</g>`;
  };
  // Reduced motion shows every phrase at once instead, as a calm list (CSS swaps the two layers).
  const rowH = 330 / n;
  const list = parts.map((p, i) => `<g data-full="${E(p.full)}"><title>${E(p.full)}</title>` +
    (p.lead ? label(p.lead, 480, 168 + i * rowH, { size: 18, color: C.mute, limit: 50, rows: 1, weight: 700, family: FONT.display }) : "") +
    labelMid(p.big, 480, 168 + i * rowH + rowH * 0.38, { size: Math.min(44, rowH * 0.52), color: C.ink, limit: 30, rows: 1, weight: 900, family: FONT.display, accent: C.blue, accentFirst: i % 2 === 0 }) + "</g>").join("");
  return frame(spec.title, `<g class="k-seq">${parts.map(one).join("")}</g><g class="k-static">${list}</g>`, "", { bare: true });
}

// ---- cover: a cover-flow row. The middle card is largest; the sides lean away (a flat stand-in for 3D) and float gently ----
function cover(spec) {
  const n = spec.lines.length, mid = (n - 1) / 2, w = Math.min(196, Math.floor(790 / n) - 10), small = n > 4;
  const order = spec.lines.map((_, i) => i).sort((a, b) => Math.abs(b - mid) - Math.abs(a - mid)); // outer cards first, the middle one on top
  const cards = order.map((i) => {
    const text = spec.lines[i], d = i - mid, cx = rtlX(i, n, 480 - ((n - 1) * (w + 6)) / 2, 480 + ((n - 1) * (w + 6)) / 2), x = cx - w / 2, sc = 1 - 0.07 * Math.abs(d), sk = (-d * 5).toFixed(1), cy = 330;
    return item("pop", i + 1, text, `<g class="fl" style="--i:${i}"><g transform="translate(${cx} ${cy + Math.abs(d) * 6}) skewY(${sk}) scale(${sc.toFixed(3)}) translate(${-cx} ${-cy})">` + card(x, 195, w, 270, { r: 24 }) +
      label("الخطوة " + ORD_F[i], cx, 250, { size: small ? 18 : 22, color: C.blue, limit: 14, rows: 1, weight: 700, family: FONT.hand, ui: true }) +
      bubble(cx, 318, 38, pickIcon(text), { fill: C.wash, shadow: false, square: true }) + numChip(cx + 32, 284, i + 1, 14) +
      labelMid(shortLabel(text, small ? 3 : 4), cx, 410, { size: small ? 20 : 24, limit: Math.max(8, Math.floor(w / 13)), rows: 3, lh: 28, weight: 800, family: FONT.display }) + "</g></g>");
  }).join("");
  return frame(spec.title, cards);
}

// ---- dialogue: chat bubbles, one per spoken turn ("القائل | الكلام"); the first speaker is on the right ----
export function dialogue(spec) {
  const turns = spec.lines.map((l) => { const [a, b] = l.split("|").map((x) => x.trim()); return b ? { who: a, text: b, full: l } : { who: "", text: a, full: l }; });
  const n = turns.length, rowH = 336 / n, size = n > 4 ? 20 : n > 3 ? 23 : 27;
  const firstWho = turns[0].who;
  const body = turns.map((t, i) => {
    const mine = t.who ? t.who === firstWho : i % 2 === 0, y = 150 + i * rowH;
    const f = fitText(t.text, { size, limit: 34, rows: 2, lh: size + 7 });
    const w = Math.min(560, Math.max(190, Math.max(...f.lines.map((l) => l.length)) * size * 0.58 + 56)), h = f.lines.length * f.lh + 22;
    const x = mine ? 900 - w : 60, by = y + (rowH - h - (t.who ? 16 : 0)) / 2 + (t.who ? 16 : 0);
    const fill = mine ? C.blue : C.paper, ink = mine ? C.onAccent : C.ink;
    const tail = mine ? `<path d="M ${x + w - 26} ${by + h - 1} l 10 14 l 10 -14 z" fill="${fill}"/>` : `<path d="M ${x + 26} ${by + h - 1} l -10 14 l 10 -14 z" fill="${fill}" transform="translate(20 0)"/>`;
    return item(mine ? "right" : "left", i + 1, t.full,
      (t.who ? label(t.who, mine ? x + w - 8 : x + 8, by - 8, { size: 16, color: C.mute, limit: 14, rows: 1, weight: 700, family: FONT.display }).replace('text-anchor="middle"', `text-anchor="${mine ? "start" : "end"}"`) : "") +
      `<rect x="${x}" y="${by}" width="${w}" height="${h}" rx="${radius(22)}" fill="${fill}" stroke="${mine ? "none" : C.edge}"${C.st.flat ? "" : ' filter="url(#sk-shadow)"'}/>` + tail +
      label(t.text, x + w / 2, by + 16 + size * 0.7, { size, color: ink, limit: 34, rows: 2, lh: size + 7, weight: 700, family: FONT.display }));
  }).join("");
  return frame(spec.title, body);
}

// ---- tour: a step-by-step walk with a progress stepper on top (segments, one chip per step, "3 / 7") ----
// The active chip moves along as the steps arrive one after another; every step is the lecturer's own phrase, in full.
export function tour(spec) {
  const n = spec.lines.length, cw = 62, gap = 12, aw = 124;
  const total = n * cw + (n - 1) * gap + (aw - cw);
  const stepper = (active) => {
    let x = 480 + total / 2, out = "";
    const segW = (total - (n - 1) * 8) / n;
    let sx = 480 + total / 2;
    for (let i = 0; i < n; i++) { out += `<rect x="${sx - segW}" y="104" width="${segW}" height="5" rx="2.5" fill="${i <= active ? C.blue : C.track}"/>`; sx -= segW + 8; }
    for (let i = 0; i < n; i++) {
      const w = i === active ? aw : cw, left = x - w, cx = left + w / 2, key = pickIcon(spec.lines[i]);
      if (i === active) out += `<rect x="${left}" y="124" width="${w}" height="64" rx="${radius(18)}" fill="${C.blue}"/>` + iconSvg(key, cx, 148, 28, C.onAccent) +
        label(shortLabel(spec.lines[i], 2), cx, 179, { size: 14, color: C.onAccent, limit: 12, rows: 1, weight: 800, family: FONT.display });
      else out += `<rect x="${left}" y="124" width="${w}" height="64" rx="${radius(18)}" fill="${i < active ? C.wash : C.paper}" stroke="${C.edge}"/>` +
        (i < active ? iconSvg(key, cx, 156, 28, C.blue) : label(String(i + 1), cx, 164, { size: 24, color: C.mute, limit: 3, rows: 1, weight: 800, family: FONT.display, ui: true }));
      x -= w + gap;
    }
    out += label("الخطوات", 480 + total / 2, 92, { size: 17, color: C.mute, limit: 12, rows: 1, weight: 800, family: FONT.display, ui: true });
    out = out.replace(/^/, "") + `<text class="ui" x="${480 - total / 2}" y="92" font-size="17" font-weight="800" fill="${C.mute}" font-family="${FONT.display}" direction="ltr">${active + 1} / ${n}</text>`;
    return out;
  };
  const one = (text, i) => `<g class="k-item${i === n - 1 ? " k-last" : ""}" style="--k:${i}" data-full="${E(text)}"><title>${E(text)}</title>${stepper(i)}` +
    label("الخطوة " + ORD_F[i], 480, 262, { size: 34, color: C.blue, limit: 20, rows: 1, weight: 700, family: FONT.hand, ui: true }) +
    labelMid(text, 480, 372, { size: 58, color: C.ink, limit: 20, rows: 3, lh: 70, weight: 900, family: FONT.display, accent: C.blue, accentFirst: i % 2 === 1 }) + "</g>";
  const rowH = 330 / n;
  const list = spec.lines.map((text, i) => `<g data-full="${E(text)}"><title>${E(text)}</title>` +
    `<circle cx="760" cy="${160 + i * rowH + rowH / 2 - 6}" r="${Math.min(16, rowH / 2 - 4)}" fill="${C.blue}"/>` +
    label(String(i + 1), 760, 160 + i * rowH + rowH / 2 - 6 + 6, { size: 16, color: C.onAccent, limit: 3, rows: 1, weight: 900, family: FONT.display, ui: true }) +
    labelMid(text, 450, 160 + i * rowH + rowH / 2 - 6, { size: Math.min(28, rowH * 0.5), color: C.ink, limit: 38, rows: 1, weight: 800, family: FONT.display }) + "</g>").join("");
  return frame(spec.title, `<g class="k-seq">${spec.lines.map(one).join("")}</g><g class="k-static">${list}</g>`, "", { bare: true });
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
  if (type === "kinetic") return kinetic(spec);
  if (type === "tour") return tour(spec);
  if (type === "dialogue") return dialogue(spec);
  if (type === "quote") return quote(spec, variant ? 1 : 0);
  const table = { steps: [null, stairs, path, fan, cover], concept: [null, tiles, orbit], stat: [null, statBand], compare: [null, versus] }[type];
  const fn = table?.[variant];
  return fn ? fn(spec) : null;
}
