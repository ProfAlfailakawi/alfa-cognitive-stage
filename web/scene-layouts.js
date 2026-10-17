// Icon-led, animated vector scenes (concept, flow, timeline, story, bars, cycle, activity).
// Each item is a clear icon plus a FEW of the lecturer's own words; the full text stays in the item (<title>, data-full).
// Items run right-to-left, the Arabic reading order. Nothing is invented: icons come from keywords, words from the text.
import { C, label, labelMid, motion, item, drawLine, rtlX, frame, card } from "./scene-kit.js";
import { pickIcon, iconSvg, shortLabel } from "./scene-icons.js";

const bubble = (cx, cy, r, key, { fill = C.paper, color = C.blue, shadow = true } = {}) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${C.edge}" stroke-width="2"${shadow ? ' filter="url(#sk-shadow)"' : ""}/>` + iconSvg(key, cx, cy, r * 1.08, color);

export function renderStructuredScene(type, title, lines) {
  if (type === "concept") {
    const cols = Math.min(3, lines.length);
    const pos = lines.map((_, i) => ({ x: cols === 2 ? 340 + (1 - (i % 2)) * 280 : 195 + (2 - (i % 3)) * 285, y: 238 + Math.floor(i / 3) * 172 })); // first on the right
    // connectors first, so no line ever crosses a card
    const links = pos.map((p, i) => (i < 3 ? drawLine(480, 130, p.x, p.y - 76, { color: C.edge, width: 3, i: i + 1 })
      : drawLine(pos[i - 3].x, pos[i - 3].y + 76, p.x, p.y - 76, { color: C.edge, width: 3, i: i + 1 }))).join("");
    const nodes = lines.map((v, i) => {
      const { x, y } = pos[i];
      return item("pop", i + 2, v, card(x - 125, y - 76, 250, 152) + bubble(x, y - 30, 34, pickIcon(v), { fill: C.wash, shadow: false }) +
        labelMid(shortLabel(v), x, y + 44, { size: 26, limit: 15, rows: 2, lh: 30, weight: 700 }));
    }).join("");
    return frame(title, links + nodes);
  }
  if (type === "flow") {
    const step = 350 / lines.length, h = Math.min(66, step - 8);
    const rows = lines.map((v, i) => {
      const y = 150 + i * step, cy = y + h / 2;
      return item("rise", i + 1, v, card(190, y, 580, h, { r: 14, fill: i % 2 ? C.wash : C.paper }) +
        `<circle cx="737" cy="${cy}" r="${Math.min(17, h / 2 - 5)}" fill="url(#sk-blue)"/>` + label(String(i + 1), 737, cy + 6, { size: 17, color: C.paper, weight: 700, limit: 3, rows: 1 }) +
        iconSvg(pickIcon(v), 686, cy, Math.min(34, h - 14), C.gold) + labelMid(shortLabel(v), 440, cy, { limit: 34, size: 24, rows: 1, weight: 700 }));
    }).join("");
    const rail = drawLine(737, 150 + h / 2, 737, 150 + (lines.length - 1) * step + h / 2, { color: C.blue2, width: 3, i: 0 });
    return frame(title, rail + rows);
  }
  if (type === "timeline") {
    const n = lines.length, y0 = 300;
    const nodes = lines.map((v, i) => {
      const x = rtlX(i, n, 120, 840), above = i % 2 === 0;
      return drawLine(x, above ? y0 - 28 : y0 + 28, x, above ? y0 - 70 : y0 + 70, { color: C.edge, width: 2, i: i + 2 }) +
        item("pop", i + 2, v, bubble(x, y0, 27, pickIcon(v)) +
          label(shortLabel(v, 3), x, above ? y0 - 100 : y0 + 108, { limit: Math.max(10, Math.floor(80 / n)), size: Math.max(18, 25 - n), rows: 2, lh: 26, weight: 700 }));
    }).join("");
    return frame(title, drawLine(840, y0, 120, y0, { color: C.blue, width: 5, i: 1 }) + nodes);
  }
  if (type === "story") {
    // The story never generates people, events or conclusions: only symbolic icons.
    const n = lines.length, step = 860 / n, w = step - 14;
    const nodes = lines.map((v, i) => {
      const x = 50 + (n - 1 - i) * step + 7, cx = x + w / 2; // first scene on the right
      return item("rise", i + 1, v, card(x, 170, w, 270, { r: 22 }) + bubble(cx, 250, 44, pickIcon(v), { fill: C.bg, shadow: false }) +
        label("المشهد " + (i + 1), cx, 330, { limit: 18, size: 17, color: C.gold, rows: 1, weight: 700 }) +
        labelMid(shortLabel(v), cx, 385, { limit: n > 3 ? 11 : 16, size: 24, rows: 3, lh: 30, weight: 700 }));
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
    const n = lines.length, cx = 480, cy = 322, r = 122;
    const pts = lines.map((_, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
    const arcs = pts.map(([x, y], i) => { const [nx, ny] = pts[(i + 1) % n];
      return `<line class="m-draw" style="--i:${i + 1}" pathLength="1" x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="${C.blue2}" stroke-width="3" marker-end="url(#a)"/>`; }).join("");
    const nodes = lines.map((v, i) => { const [x, y] = pts[i];
      return item("pop", i + 1, v, bubble(x.toFixed(1), y.toFixed(1), 33, pickIcon(v)) +
        `<circle cx="${(x + 26).toFixed(1)}" cy="${(y - 26).toFixed(1)}" r="12" fill="url(#sk-gold)"/>` + label(String(i + 1), x + 26, y - 20, { size: 15, color: C.paper, limit: 3, rows: 1, weight: 700 }) +
        labelMid(shortLabel(v, 3), x, y + (y < cy ? -62 : 64), { size: 22, limit: 14, rows: 2, lh: 24, weight: 700 })); }).join("");
    const defs = `<marker id="a" viewBox="0 0 10 10" refX="26" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${C.blue2}"/></marker>`;
    return frame(title, arcs + nodes, defs);
  }
  if (type === "activity") {
    const dur = lines[1] || "";
    return frame(title, motion("rise", 1, card(130, 150, 700, 300, { r: 26 }) + bubble(480, 214, 38, pickIcon(lines[0]), { fill: C.bg, color: C.gold, shadow: false }) +
      labelMid(lines[0], 480, 335, { size: 28, limit: 34, rows: 4, lh: 36 })) +
      (dur ? motion("pop", 3, `<rect x="360" y="392" width="240" height="44" rx="22" fill="url(#sk-gold)"/>` + label(dur, 480, 422, { size: 22, color: C.paper, limit: 24, rows: 1, weight: 700 })) : ""));
  }
  throw new Error("نوع المشهد غير مدعوم");
}
