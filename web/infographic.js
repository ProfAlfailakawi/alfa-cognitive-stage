import { renderStructuredScene } from "./scene-layouts.js";
import { C, E, label, labelMid, motion, item, drawLine, rtlX, frame, card } from "./scene-kit.js";
import { pickIcon, iconSvg, shortLabel } from "./scene-icons.js";
// Light, vector infographics built from a small spec. No images, no AI calls.
// Every number and word comes from the lecturer's input; nothing is invented here.

export function validateSpec(spec) {
  const type = ["stat", "compare", "steps", "concept", "flow", "timeline", "story", "bars", "cycle", "activity"].includes(spec?.type) ? spec.type : null;
  if (!type) throw new Error("نوع الإنفوجرافيك غير معروف");
  const title = String(spec.title ?? "").trim().slice(0, 120); // Renderers escape at the HTML boundary.
  const lines = (Array.isArray(spec.lines) ? spec.lines : [])
    .map((l) => String(l ?? "").trim().slice(0, 120)).filter(Boolean);
  if (type === "stat") {
    if (lines.length < 1 || lines.length > 2) throw new Error("البطاقة الإحصائية تحتاج رقماً ووصفاً فقط");
    if (!/^[\d.,%+\-٠-٩ ]+$/.test(lines[0]) && lines[0].length > 12) throw new Error("الرقم يجب أن يكون قصيراً");
    return { type, title, lines };
  }
  if (type === "compare") {
    const pairs = lines.map((l) => l.split("|").map((x) => x.trim()));
    if (pairs.length < 1 || pairs.length > 5 || pairs.some((p) => p.length !== 2 || !p[0] || !p[1])) {
      throw new Error("المقارنة: كل سطر بصيغة (الأول | الثاني)، من 1 إلى 5 أسطر");
    }
    return { type, title, lines: pairs };
  }
  if (type === "bars") {
    const rows = lines.map((l) => l.split("|").map((x) => x.trim()));
    const valid = rows.every((r) => r.length === 2 && r[0] && r[0].length <= 40 && /^\d{1,3}(?:[.,]\d+)?%$/.test(r[1]) && Number(r[1].slice(0, -1).replace(",", ".")) <= 100);
    if (rows.length < 2 || rows.length > 6 || !valid) throw new Error("الأعمدة: من 2 إلى 6 سطور بصيغة (التسمية | 40%) والنسبة بين 0 و100");
    return { type, title, lines: rows.map((r) => r[0] + " | " + r[1]) };
  }
  if (type === "cycle" && (lines.length < 3 || lines.length > 6)) throw new Error("الدورة: من 3 إلى 6 مراحل");
  if (type === "activity") {
    if (lines.length < 1 || lines.length > 2 || (lines[1] && !/^المدة:/.test(lines[1]))) throw new Error("النشاط: تعليمات المحاضر ثم (المدة: …) اختيارياً");
    return { type, title, lines };
  }
  if (type === "steps" && (lines.length < 2 || lines.length > 6))
    throw new Error("الخطوات: من 2 إلى 6 خطوات");
  if (type !== "steps" && type !== "cycle" && (lines.length < 2 || lines.length > (type === "story" ? 4 : 6)))
    throw new Error("المشهد يحتاج من 2 إلى 6 عناصر (القصة حتى 4)");
  return { type, title, lines };
}

const AR_DIGITS = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9" };

function statSvg(spec) {
  const [number, text] = [spec.lines[0], spec.lines[1] || ""];
  // A ring is drawn only for a plain percentage between 0 and 100, filled to exactly that value.
  const m = number.replace(/[٠-٩]/g, (d) => AR_DIGITS[d]).replace(/\s/g, "").match(/^(\d{1,3}(?:[.,]\d+)?)%$/);
  const value = m ? Number(m[1].replace(",", ".")) : null;
  if (value !== null && value <= 100) {
    const size = number.length <= 3 ? 100 : number.length === 4 ? 84 : 68;
    return frame(spec.title,
      `<circle cx="480" cy="318" r="118" fill="none" stroke="${C.track}" stroke-width="22"/>` +
      `<circle class="m-ring" style="--v:${value}" cx="480" cy="318" r="118" fill="none" stroke="url(#sk-blue)" stroke-width="22" stroke-linecap="round" pathLength="100"/>` +
      motion("pop", 2, `<text x="480" y="${318 + size * 0.34}" text-anchor="middle" font-size="${size}" font-weight="800" fill="${C.ink}">${E(number)}</text>`) +
      (text ? motion("rise", 3, label(text, 480, 478, { size: 28, color: C.mute, limit: 40, rows: 2, lh: 32 })) : ""));
  }
  const size = Math.max(56, Math.min(150, 150 - Math.max(0, number.length - 4) * 14));
  return frame(spec.title,
    motion("pop", 1, `<text x="480" y="${300 + size * 0.1}" text-anchor="middle" font-size="${size}" font-weight="800" fill="${C.ink}">${E(number)}</text>`) +
    drawLine(400, 352, 560, 352, { color: C.gold, width: 5, i: 2 }) +
    (text ? motion("rise", 3, label(text, 480, 412, { size: 30, color: C.mute, limit: 40, rows: 2, lh: 34 })) : ""));
}

function compareSvg(spec) {
  const n = spec.lines.length, rowH = n <= 3 ? 76 : 58, gap = 12;
  const head = motion("rise", 1, `<rect x="120" y="140" width="330" height="40" rx="20" fill="url(#sk-blue)"/><rect x="510" y="140" width="330" height="40" rx="20" fill="url(#sk-gold)"/>` +
    label("الأول", 285, 168, { size: 22, color: C.paper, limit: 10, rows: 1, weight: 700 }) + label("الثاني", 675, 168, { size: 22, color: C.paper, limit: 10, rows: 1, weight: 700 }));
  const cell = (text, x0, i, color, dir) => {
    const y = 198 + i * (rowH + gap), cx = x0 + 165, cy = y + rowH / 2;
    return item(dir, i + 2, text, card(x0, y, 330, rowH, { r: 14 }) + iconSvg(pickIcon(text), x0 + 292, cy, 34, color) +
      labelMid(shortLabel(text, 5), cx - 22, cy, { size: 24, limit: 17, rows: 2, lh: 26, weight: 700 }));
  };
  const rows = spec.lines.map(([a, b], i) => cell(a, 120, i, C.blue, "right") + cell(b, 510, i, C.gold, "left")).join("");
  return frame(spec.title, head + rows + motion("pop", 2, `<circle cx="480" cy="160" r="20" fill="${C.paper}" stroke="${C.edge}"/>` + label("×", 480, 168, { size: 22, color: C.mute, limit: 2, rows: 1 })));
}

function stepsSvg(spec) {
  const n = spec.lines.length;
  const gap = 880 / n, xs = Array.from({ length: n }, (_, i) => rtlX(i, n, 40 + gap / 2, 920 - gap / 2));
  const limit = Math.max(8, Math.floor(gap / 15));
  const items = spec.lines.map((text, i) => {
    const cx = xs[i];
    return item("pop", i + 1, text, `<circle cx="${cx}" cy="270" r="60" fill="${C.paper}" stroke="${C.edge}" stroke-width="2" filter="url(#sk-shadow)"/>` +
      iconSvg(pickIcon(text), cx, 270, 62, C.blue) +
      `<circle cx="${cx + 44}" cy="224" r="17" fill="url(#sk-gold)"/>` + label(String(i + 1), cx + 44, 231, { size: 19, color: C.paper, limit: 3, rows: 1, weight: 700 }) +
      label(shortLabel(text, n > 4 ? 3 : 4), cx, 372, { size: n > 4 ? 22 : 26, limit, rows: 3, lh: 30, weight: 700 }));
  }).join("");
  const rail = n > 1 ? drawLine(xs[0], 270, xs[n - 1], 270, { color: C.blue2, width: 4, i: 0 }) : "";
  return frame(spec.title, rail + items);
}

export function renderInfographic(input) {
  const spec = validateSpec(input);
  return spec.type === "stat" ? statSvg(spec) : spec.type === "compare" ? compareSvg(spec) : spec.type === "steps" ? stepsSvg(spec) : renderStructuredScene(spec.type, spec.title, spec.lines);
}
