// Lightweight, deterministic, animated vector scenes (concept, flow, timeline, story, bars, cycle, activity).
// Every word and number comes from the lecturer's own input. Items run right-to-left, the Arabic reading order.
import { C, label, labelMid, motion, drawLine, rtlX, frame, card } from "./scene-kit.js";

const icon = (d, cx, cy, color = C.blue, scale = 1.16) =>
  `<path d="${d}" transform="translate(${cx - 14} ${cy - 14}) scale(${scale})" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;

export function renderStructuredScene(type, title, lines) {
  if (type === "concept") {
    const n = lines.length, cols = Math.min(3, n);
    const pos = lines.map((_, i) => ({ x: cols === 2 ? 340 + (1 - (i % 2)) * 280 : 195 + (2 - (i % 3)) * 285, y: 238 + Math.floor(i / 3) * 170 })); // first on the right
    // connectors first, so no line is ever drawn across a card: the title feeds the first row, each row-2 card hangs off the card above
    const links = pos.map((p, i) => (i < 3 ? drawLine(480, 130, p.x, p.y - 64, { color: C.edge, width: 3, i: i + 1 }) : drawLine(pos[i - 3].x, pos[i - 3].y + 66, p.x, p.y - 64, { color: C.edge, width: 3, i: i + 1 }))).join("");
    const nodes = lines.map((v, i) => {
      const { x, y } = pos[i];
      return motion("pop", i + 2, card(x - 130, y - 58, 260, 124) + `<circle cx="${x}" cy="${y - 58}" r="7" fill="${C.gold}"/>` + labelMid(v, x, y + 4, { limit: 22, rows: 3 }));
    }).join("");
    return frame(title, links + nodes);
  }
  if (type === "flow") {
    const step = 340 / lines.length, h = Math.min(62, step - 8);
    const rows = lines.map((v, i) => {
      const y = 150 + i * step;
      return motion("rise", i + 1, card(190, y, 580, h, { r: 14, fill: i % 2 ? C.wash : C.paper }) +
        `<circle cx="737" cy="${y + h / 2}" r="16" fill="url(#sk-blue)"/>` +
        label(String(i + 1), 737, y + h / 2 + 6, { size: 17, color: C.paper, weight: 700 }) +
        labelMid(v, 460, y + h / 2, { limit: 40, size: 20, rows: 2, lh: 24 }));
    }).join("");
    const rail = drawLine(737, 150 + h / 2, 737, 150 + (lines.length - 1) * step + h / 2, { color: C.blue2, width: 3, i: 0 });
    return frame(title, rail + rows);
  }
  if (type === "timeline") {
    const n = lines.length, y0 = 300;
    const nodes = lines.map((v, i) => {
      const x = rtlX(i, n, 120, 840), above = i % 2 === 0;
      return motion("pop", i + 2, `<circle cx="${x}" cy="${y0}" r="14" fill="url(#sk-gold)" stroke="${C.paper}" stroke-width="4"/>`) +
        drawLine(x, above ? y0 - 14 : y0 + 14, x, above ? y0 - 70 : y0 + 70, { color: C.edge, width: 2, i: i + 2 }) +
        motion("rise", i + 3, label(v, x, above ? y0 - 100 : y0 + 100, { limit: Math.max(12, Math.floor(78 / n)), size: Math.max(15, 23 - n), rows: 3, lh: 24 }));
    }).join("");
    return frame(title, drawLine(840, y0, 120, y0, { color: C.blue, width: 5, i: 1 }) + nodes);
  }
  if (type === "story") {
    // The story never generates people, events or conclusions: only symbolic icons.
    const marks = [
      { re: /(العاب|الألعاب|لعب|game)/i, d: "M7 9h10l3 8-4-2-3-3h-2l-3 3-4 2z M9 11v4 M7 13h4 M16 12h.1 M18 14h.1" },
      { re: /(الوقت|الساعات|ساعة|سا ع|ليل|الساعة)/i, d: "M12 3a9 9 0 1 1-.01 0 M12 6v6l4 3" },
      { re: /(دراس|الجامعة|المدرس|تعلم|التحصيل)/i, d: "M4 5h7a3 3 0 0 1 3 3v12H5a1 1 0 0 0-1 1z M20 5h-7a3 3 0 0 0-3 3v12h9a1 1 0 0 1 1 1z" },
      { re: /(علاقات|الاسرة|العزلة|صديق|مجتمع)/i, d: "M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M2 21a7 7 0 0 1 14 0 M18 9a3 3 0 1 0 0-6 M18 15a6 6 0 0 1 4 6" },
      { re: /(تغير|تغيير|قرر|الفكرة|فهم|اكتشف)/i, d: "M9 18h6 M10 21h4 M12 2a7 7 0 0 0-4 12c1 1 2 2 2 3h4c0-1 1-2 2-3a7 7 0 0 0-4-12z" },
    ];
    const n = lines.length, step = 860 / n, w = step - 14;
    const nodes = lines.map((v, i) => {
      const x = 50 + (n - 1 - i) * step + 7, cx = x + w / 2; // first scene on the right
      const d = marks.find((m) => m.re.test(v))?.d || "M4 5h16v14H4z M7 9h10 M7 13h10";
      return motion("rise", i + 1, card(x, 170, w, 260, { r: 22 }) +
        `<circle cx="${cx}" cy="222" r="36" fill="${C.bg}" stroke="${C.edge}"/>` + icon(d, cx, 222) +
        label("المشهد " + (i + 1), cx, 288, { limit: 18, size: 17, color: C.gold, rows: 1, weight: 700 }) +
        label(v, cx, 332, { limit: n > 3 ? 15 : 24, size: 19, rows: 4 }));
    }).join("");
    return frame(title, nodes);
  }
  if (type === "bars") {
    // Bars are scaled to the largest spoken value; every number is exactly what the lecturer said. Right to left.
    const rows = lines.map((l) => l.split("|").map((x) => x.trim()));
    const values = rows.map(([, v]) => Number(v.slice(0, -1).replace(",", ".")));
    const top = Math.max(...values, 1);
    const rowH = Math.min(58, (370 - (rows.length - 1) * 12) / rows.length), small = rowH < 56;
    const nodes = rows.map(([name, value], i) => {
      const y = 150 + i * (rowH + 12), w = Math.max(4, (values[i] / top) * 430);
      return motion("rise", i, labelMid(name, 830, y + rowH / 2, { size: small ? 17 : 20, limit: small ? 18 : 14, rows: 2, lh: small ? 20 : 24 }) +
        `<rect x="250" y="${y}" width="430" height="${rowH}" rx="12" fill="${C.track}"/>`) +
        `<g class="m-grow-r" style="--i:${i + 1}"><rect class="bar-fill" x="${680 - w}" y="${y}" width="${w}" height="${rowH}" rx="12" fill="url(#${i % 2 ? "sk-gold" : "sk-blue"})"/></g>` +
        motion("pop", i + 2, labelMid(value, 175, y + rowH / 2, { size: small ? 24 : 28, weight: 800, limit: 8, rows: 1 }));
    }).join("");
    return frame(title, nodes);
  }
  if (type === "cycle") {
    const n = lines.length, cx = 480, cy = 320, r = 135;
    const pts = lines.map((_, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
    const arcs = pts.map(([x, y], i) => { const [nx, ny] = pts[(i + 1) % n];
      return `<line class="m-draw" style="--i:${i + 1}" pathLength="1" x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="${C.blue2}" stroke-width="3" marker-end="url(#a)"/>`; }).join("");
    const nodes = lines.map((v, i) => { const [x, y] = pts[i];
      return motion("pop", i + 1, `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="27" fill="url(#sk-blue)" filter="url(#sk-shadow)"/>` +
        label(String(i + 1), x, y + 8, { size: 22, color: C.paper, limit: 3, rows: 1, weight: 700 }) +
        label(v, x, y + (y < cy ? -46 : 56), { size: 18, limit: 18, rows: 2, lh: 22 })); }).join("");
    const defs = `<marker id="a" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${C.blue2}"/></marker>`;
    return frame(title, arcs + nodes, defs);
  }
  if (type === "activity") {
    const dur = lines[1] || "";
    return frame(title, motion("rise", 1, card(130, 150, 700, 300, { r: 26 }) +
      `<circle cx="480" cy="212" r="36" fill="${C.bg}" stroke="${C.edge}"/>` + icon("M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z", 480, 212, C.gold) +
      labelMid(lines[0], 480, 330, { size: 28, limit: 34, rows: 4, lh: 36 })) +
      (dur ? motion("pop", 3, `<rect x="360" y="392" width="240" height="44" rx="22" fill="url(#sk-gold)"/>` + label(dur, 480, 422, { size: 22, color: C.paper, limit: 24, rows: 1, weight: 700 })) : ""));
  }
  throw new Error("نوع المشهد غير مدعوم");
}
