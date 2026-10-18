// Theme colours are measured against WCAG contrast, not eyeballed.
import assert from "node:assert/strict";
import { THEMES, contrast, themeName, DEFAULT_THEME } from "../web/scene-theme.js";
import { renderInfographic } from "../web/infographic.js";

for (const [name, t] of Object.entries(THEMES)) {
  for (const bg of [t.bg, t.bg2]) {
    assert.ok(contrast(t.ink, bg) >= 7, `${name}: body text on ${bg} (AAA, ${contrast(t.ink, bg).toFixed(1)})`);
    assert.ok(contrast(t.mute, bg) >= 4.5, `${name}: secondary text on ${bg} (AA, ${contrast(t.mute, bg).toFixed(1)})`);
    assert.ok(contrast(t.blue, bg) >= 3, `${name}: accent display text on ${bg} (AA large, ${contrast(t.blue, bg).toFixed(1)})`);
    assert.ok(contrast(t.gold, bg) >= 3, `${name}: second accent on ${bg} (${contrast(t.gold, bg).toFixed(1)})`);
  }
  assert.ok(contrast(t.onAccent, t.blue) >= 4.5, `${name}: text on the accent (${contrast(t.onAccent, t.blue).toFixed(1)})`);
  assert.ok(contrast(t.onAccent, t.gold) >= 4.5, `${name}: text on the second accent (${contrast(t.onAccent, t.gold).toFixed(1)})`);
  assert.ok(typeof t.label === "string" && t.label.length > 0);
}
assert.equal(themeName("deep"), "deep");
assert.equal(themeName("nope"), DEFAULT_THEME);
assert.equal(themeName(undefined), DEFAULT_THEME);
assert.equal(themeName("__proto__"), DEFAULT_THEME, "prototype keys are never themes");
// every theme draws every scene type; a scene carries its own theme (the audience window draws what the lecturer chose)
const specs = [{ type: "stat", title: "x", lines: ["68%", "y"] }, { type: "steps", title: "x", lines: ["أ", "ب"] }, { type: "bars", title: "x", lines: ["أ | 10%", "ب | 20%"] },
  { type: "compare", title: "x", lines: ["أ | ب"] }, { type: "concept", title: "x", lines: ["أ", "ب"] }, { type: "flow", title: "x", lines: ["أ", "ب"] },
  { type: "timeline", title: "x", lines: ["أ", "ب"] }, { type: "story", title: "x", lines: ["أ", "ب"] }, { type: "cycle", title: "x", lines: ["أ", "ب", "ج"] }, { type: "activity", title: "x", lines: ["أ"] }];
for (const name of Object.keys(THEMES)) for (const spec of specs) {
  const svg = renderInfographic({ ...spec, theme: name });
  assert.ok(svg.includes(THEMES[name].bg), `${spec.type} uses the ${name} background`);
  assert.ok(!svg.includes("undefined") && !svg.includes("NaN"), `${spec.type}/${name}: no undefined or NaN in the drawing`);
}
// No text may sit on a gradient: contrast is only guaranteed against the solid accent colours.
for (const name of Object.keys(THEMES)) for (const spec of specs.concat([{ type: "stat", title: "x", lines: ["7", "y"] }, { type: "activity", title: "x", lines: ["أ", "المدة: 3 دقائق"] }])) {
  const svg = renderInfographic({ ...spec, theme: name });
  const on = THEMES[name].onAccent;
  for (const m of svg.matchAll(new RegExp(`<text[^>]*fill="${on}"`, "g"))) {
    const before = svg.slice(0, m.index);
    const shape = [...before.matchAll(/<(?:circle|rect)\b[^>]*>/g)].at(-1)?.[0] || "";
    assert.ok(!/fill="url\(#sk-(?:blue|gold)\)"/.test(shape), `${spec.type}/${name}: text on a gradient-filled shape: ${shape.slice(0, 80)}`);
  }
}
// themes never leak into one another (the palette is reset on every render)
const warm = renderInfographic({ ...specs[0], theme: "warm" });
renderInfographic({ ...specs[0], theme: "deep" });
assert.equal(renderInfographic({ ...specs[0], theme: "warm" }), warm, "rendering one theme after another leaves no residue");
console.log("scene themes: contrast and rendering checks passed");
