import { renderStructuredScene, bubble, numChip, ORD_F, parsePercentValue } from "./scene-layouts.js";
import { C, E, FONT, label, labelMid, motion, item, drawLine, rtlX, frame, card, useTheme } from "./scene-kit.js";
import { themeKnown } from "./scene-theme.js";
import { renderVariant, VARIANTS } from "./scene-variants.js";
import { pickIcon, iconSvg, shortLabel } from "./scene-icons.js";
// Light, vector infographics built from a small spec. No images, no AI calls.
// Every number and word comes from the lecturer's input; nothing is invented here.

function validateBase(spec) {
  const theme = themeKnown(spec?.theme) ? spec.theme : undefined; // a lecturer-chosen colour theme travels with the scene
  const type = ["stat", "compare", "steps", "concept", "flow", "timeline", "story", "bars", "cycle", "activity", "quote", "kinetic", "tour", "dialogue"].includes(spec?.type) ? spec.type : null;
  if (!type) throw new Error("نوع الإنفوجرافيك غير معروف");
  const title = String(spec.title ?? "").trim().slice(0, 120); // Renderers escape at the HTML boundary.
  const lines = (Array.isArray(spec.lines) ? spec.lines : [])
    .map((l) => String(l ?? "").trim().slice(0, type === "quote" ? 260 : 120)).filter(Boolean);
  if (type === "kinetic") {
    if (lines.length < 2 || lines.length > 6) throw new Error("الكلمات المتتابعة: من 2 إلى 6 عبارات (اختيارياً: تمهيد | العبارة)");
    return { type, title, theme, lines };
  }
  if (type === "dialogue") {
    if (lines.length < 2 || lines.length > 6) throw new Error("الحوار: من 2 إلى 6 أدوار (اختيارياً: القائل | الكلام)");
    return { type, title, theme, lines };
  }
  if (type === "tour") {
    if (lines.length < 2 || lines.length > 7) throw new Error("جولة الخطوات: من 2 إلى 7 خطوات");
    return { type, title, theme, lines };
  }
  if (type === "quote") {
    if (lines.length < 1 || lines.length > 2) throw new Error("الاقتباس: جملة المحاضر ثم (اسم القائل) اختيارياً");
    return { type, title, theme, lines };
  }
  if (type === "stat") {
    if (lines.length < 1 || lines.length > 2) throw new Error("البطاقة الإحصائية تحتاج رقماً ووصفاً فقط");
    if (!/^[\d.,٫%٪+\-٠-٩۰-۹ ]+$/.test(lines[0]) && lines[0].length > 12) throw new Error("الرقم يجب أن يكون قصيراً");
    return { type, title, theme, lines };
  }
  if (type === "compare") {
    const pairs = lines.map((l) => l.split("|").map((x) => x.trim()));
    if (pairs.length < 1 || pairs.length > 5 || pairs.some((p) => p.length !== 2 || !p[0] || !p[1])) {
      throw new Error("المقارنة: كل سطر بصيغة (الأول | الثاني)، من 1 إلى 5 أسطر");
    }
    return { type, title, theme, lines: pairs };
  }
  if (type === "bars") {
    const rows = lines.map((l) => l.split("|").map((x) => x.trim()));
    const valid = rows.every((r) => r.length === 2 && r[0] && r[0].length <= 40 && parsePercentValue(r[1]) !== null);
    if (rows.length < 2 || rows.length > 6 || !valid) throw new Error("الأعمدة: من 2 إلى 6 سطور بصيغة (التسمية | 40%) والنسبة بين 0 و100");
    return { type, title, theme, lines: rows.map((r) => r[0] + " | " + r[1]) };
  }
  if (type === "cycle" && (lines.length < 3 || lines.length > 6)) throw new Error("الدورة: من 3 إلى 6 مراحل");
  if (type === "activity") {
    if (lines.length < 1 || lines.length > 2 || (lines[1] && !/^المدة:/.test(lines[1]))) throw new Error("النشاط: تعليمات المحاضر ثم (المدة: …) اختيارياً");
    return { type, title, theme, lines };
  }
  if (type === "steps" && (lines.length < 2 || lines.length > 6))
    throw new Error("الخطوات: من 2 إلى 6 خطوات");
  if (type !== "steps" && type !== "cycle" && (lines.length < 2 || lines.length > (type === "story" ? 4 : 6)))
    throw new Error("المشهد يحتاج من 2 إلى 6 عناصر (القصة حتى 4)");
  return { type, title, theme, lines };
}

/** A scene also carries which of its layouts to use (0 = the original). Unknown or out-of-range values mean the original. */
export function validateSpec(spec) {
  const out = validateBase(spec);
  const v = spec?.variant;
  return Number.isInteger(v) && v > 0 && v < (VARIANTS[out.type] || 1) ? { ...out, variant: v } : out;
}

const AR_DIGITS = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9" };

function statSvg(spec) {
  const [number, text] = [spec.lines[0], spec.lines[1] || ""];
  const ascii = number.replace(/[٠-٩]/g, (d) => AR_DIGITS[d]).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/٪/g, "%").replace(/٫/g, ".").replace(/\s/g, "");
  const pct = ascii.match(/^(\d{1,3}(?:[.,]\d+)?)%$/);
  const count = /^\d{1,2}$/.test(ascii) && Number(ascii) >= 1 && Number(ascii) <= 12 ? Number(ascii) : null;
  const value = pct ? parsePercentValue(number) : null;
  // Place the full caption block inside a safe bottom zone, rather than its first baseline at the page edge.
  const caption = (cy) => (text ? motion("rise", 3, labelMid(text, 480, cy, { size: 29, color: C.blue, limit: 30, rows: 3, lh: 34, weight: 800, family: FONT.display })) : "");
  if (value !== null && value <= 100) {
    // A ring filled to exactly the spoken percentage (only for 0-100).
    const size = number.length <= 3 ? 112 : number.length === 4 ? 92 : 74;
    return frame(spec.title,
      `<circle cx="480" cy="283" r="112" fill="none" stroke="${C.track}" stroke-width="22"/>` +
      `<circle class="m-ring" style="--v:${value}" cx="480" cy="283" r="112" fill="none" stroke="url(#sk-blue)" stroke-width="22" stroke-linecap="round" pathLength="100"/>` +
      motion("pop", 2, `<text x="480" y="${283 + size * 0.3}" text-anchor="middle" font-size="${size}" font-family="${FONT.hero}" fill="${C.ink}">${E(number)}</text>`) +
      caption(467));
  }
  const size = Math.max(64, Math.min(180, 180 - Math.max(0, number.length - 4) * 16));
  // A small whole number also gets that many dots, one for each, so the picture is the number.
  const dots = count ? Array.from({ length: count }, (_, k) => motion("pop", 3 + k * 0.4, `<circle cx="${480 + (count - 1) * 20 - k * 40}" cy="478" r="13" fill="url(#sk-blue)"/>`)).join("") : "";
  return frame(spec.title,
    motion("pop", 1, `<text x="480" y="${300 + size * 0.12}" text-anchor="middle" font-size="${size}" font-family="${FONT.hero}" fill="${C.ink}">${E(number)}</text>`) +
    drawLine(404, 372, 556, 372, { color: C.blue, width: 6, i: 2 }) + caption(count ? 417 : 424) + dots);
}

function compareSvg(spec) {
  const n = spec.lines.length, rowH = n <= 3 ? 78 : 58, gap = 12;
  const head = motion("rise", 1, `<rect x="510" y="140" width="330" height="42" rx="21" fill="${C.blue}"/><rect x="120" y="140" width="330" height="42" rx="21" fill="${C.gold}"/>` +
    label("الأول", 675, 170, { size: 22, color: C.onAccent, limit: 10, rows: 1, weight: 900, family: FONT.display, ui: true }) + label("الثاني", 285, 170, { size: 22, color: C.onAccent, limit: 10, rows: 1, weight: 900, family: FONT.display, ui: true }));
  const cell = (text, x0, i, color, dir) => {
    const y = 200 + i * (rowH + gap), cx = x0 + 165, cy = y + rowH / 2;
    return item(dir, i + 2, text, card(x0, y, 330, rowH, { r: 16 }) + bubble(x0 + 292, cy, Math.min(21, rowH / 2 - 6), pickIcon(text), { fill: C.wash, color, shadow: false, square: true }) +
      labelMid(shortLabel(text, 5), cx - 24, cy, { size: 24, limit: 16, rows: 2, lh: 26, weight: 800, family: FONT.display }));
  };
  const rows = spec.lines.map(([a, b], i) => cell(a, 510, i, C.blue, "right") + cell(b, 120, i, C.gold, "left")).join("");
  return frame(spec.title, head + rows + motion("pop", 2, `<circle cx="480" cy="161" r="21" fill="${C.paper}" stroke="${C.edge}"/>` + label("×", 480, 169, { size: 22, color: C.mute, limit: 2, rows: 1, weight: 900, ui: true })));
}

function stepsSvg(spec) {
  const n = spec.lines.length, w = n <= 3 ? 250 : n === 4 ? 205 : n === 5 ? 168 : 140, gap = 16;
  const right = 480 + (n * w + (n - 1) * gap) / 2;
  const small = n > 4;
  const items = spec.lines.map((text, i) => {
    const x = right - (i + 1) * w - i * gap, cx = x + w / 2;
    return drawLine(x + w - 24, 210, x + 24, 210, { color: C.blue, width: 6, i: i + 1 }) +
      item("pop", i + 1, text, card(x, 186, w, 292, { r: 24 }) +
        label("الخطوة " + ORD_F[i], cx, 250, { size: small ? 20 : 25, color: C.blue, limit: 14, rows: 1, weight: 700, family: FONT.hand, ui: true }) +
        bubble(cx, 318, 42, pickIcon(text), { fill: C.wash, shadow: false, square: true }) +
        numChip(cx + 36, 280, i + 1) +
        labelMid(shortLabel(text, small ? 3 : 4), cx, 420, { size: small ? 21 : 26, limit: Math.floor(w / 13), rows: 3, lh: 30, weight: 800, family: FONT.display }));
  }).join("");
  return frame(spec.title, items);
}

export function renderInfographic(input) {
  const spec = validateSpec(input);
  useTheme(spec.theme);
  const varied = spec.type === "quote" || spec.type === "kinetic" || spec.type === "tour" || spec.type === "dialogue" || spec.variant ? renderVariant(spec.type, spec.variant || 0, spec) : null;
  if (varied) return varied;
  return spec.type === "stat" ? statSvg(spec) : spec.type === "compare" ? compareSvg(spec) : spec.type === "steps" ? stepsSvg(spec) : renderStructuredScene(spec.type, spec.title, spec.lines);
}
