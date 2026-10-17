import { renderStructuredScene } from "./scene-layouts.js";
// Light, vector infographics built from a small spec. No images, no AI calls.
// Every number and word comes from the lecturer's input; nothing is invented here.

const esc = (value) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const PALETTE = { ink: "#15161a", soft: "#5e6570", accent: "#3e5c78", ember: "#8f5a28", wash: "#f4f5f3", hair: "#e3e5e2" };

// Simple line icons (24px grid) so a step or a card has a clear visual anchor.
const ICONS = {
  check: "M5 12l4 4 10-10",
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3 11c.6.5 1 1.3 1 2h4c0-.7.4-1.5 1-2a6 6 0 0 0-3-11z",
  users: "M16 11a4 4 0 1 0-8 0M4 21a8 8 0 0 1 16 0",
  book: "M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
};

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

function statSvg(spec) {
  const [number, label] = [spec.lines[0], spec.lines[1] || ""];
  return `<svg viewBox="0 0 960 540" role="img" aria-label="${esc(spec.title)}">
    <rect x="0" y="0" width="960" height="540" fill="${PALETTE.wash}"/>
    <text x="480" y="110" text-anchor="middle" font-size="34" font-weight="700" fill="${PALETTE.accent}">${esc(spec.title)}</text>
    <text x="480" y="330" text-anchor="middle" font-size="150" font-weight="800" fill="${PALETTE.ink}">${esc(number)}</text>
    <text x="480" y="410" text-anchor="middle" font-size="32" fill="${PALETTE.soft}">${esc(label)}</text>
    <circle cx="480" cy="470" r="6" fill="${PALETTE.ember}"/>
  </svg>`;
}

function compareSvg(spec) {
  const rows = spec.lines.map(([a, b], i) => {
    const y = 170 + i * 66;
    return `<text x="250" y="${y}" text-anchor="middle" font-size="26" fill="${PALETTE.ink}">${esc(a)}</text>
      <text x="710" y="${y}" text-anchor="middle" font-size="26" fill="${PALETTE.ink}">${esc(b)}</text>
      <line x1="120" x2="840" y1="${y + 22}" y2="${y + 22}" stroke="${PALETTE.hair}" stroke-width="2"/>`;
  }).join("");
  return `<svg viewBox="0 0 960 540" role="img" aria-label="${esc(spec.title)}">
    <rect width="960" height="540" fill="${PALETTE.wash}"/>
    <text x="480" y="80" text-anchor="middle" font-size="34" font-weight="700" fill="${PALETTE.accent}">${esc(spec.title)}</text>
    <rect x="120" y="115" width="260" height="48" rx="12" fill="${PALETTE.accent}"/>
    <rect x="580" y="115" width="260" height="48" rx="12" fill="${PALETTE.ember}"/>
    <text x="250" y="148" text-anchor="middle" font-size="24" fill="${PALETTE.wash}">الأول</text>
    <text x="710" y="148" text-anchor="middle" font-size="24" fill="${PALETTE.wash}">الثاني</text>
    ${rows}
  </svg>`;
}

function stepsSvg(spec) {
  const icons = Object.keys(ICONS);
  const n = spec.lines.length;
  const gap = 880 / n;
  const items = spec.lines.map((text, i) => {
    const cx = 40 + gap * i + gap / 2;
    const icon = ICONS[icons[i % icons.length]];
    return `<circle cx="${cx}" cy="250" r="54" fill="#ffffff" stroke="${PALETTE.hair}" stroke-width="2"/>
      <path d="${icon}" transform="translate(${cx - 12} 238) scale(1)" fill="none" stroke="${PALETTE.accent}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="${cx}" y="350" text-anchor="middle" font-size="24" font-weight="700" fill="${PALETTE.accent}">${i + 1}</text>
      <text x="${cx}" y="395" text-anchor="middle" font-size="22" fill="${PALETTE.ink}">${esc(text)}</text>`;
  }).join("");
  const track = `<line x1="${40 + gap / 2}" x2="${40 + gap * (n - 0.5)}" y1="450" y2="450" stroke="${PALETTE.hair}" stroke-width="4"/>`;
  return `<svg viewBox="0 0 960 540" role="img" aria-label="${esc(spec.title)}">
    <rect width="960" height="540" fill="${PALETTE.wash}"/>
    <text x="480" y="90" text-anchor="middle" font-size="34" font-weight="700" fill="${PALETTE.accent}">${esc(spec.title)}</text>
    ${track}${items}
  </svg>`;
}

export function renderInfographic(input) {
  const spec = validateSpec(input);
  const svg = spec.type === "stat" ? statSvg(spec) : spec.type === "compare" ? compareSvg(spec) : spec.type === "steps" ? stepsSvg(spec) : renderStructuredScene(spec.type, spec.title, spec.lines);
  return svg;
}
