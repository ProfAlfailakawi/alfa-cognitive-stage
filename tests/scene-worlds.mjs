// The 64 design worlds, the stylist and the extra layouts. Colours are measured, variety is measured, text is never lost.
import assert from "node:assert/strict";
import { WORLDS } from "../web/design-worlds.js";
import { worldTheme, worldName, WORLD_BY_ID, parseWorld } from "../web/world-theme.js";
import { contrast } from "../web/color-math.js";
import { renderInfographic, validateSpec } from "../web/infographic.js";
import { VARIANTS } from "../web/scene-variants.js";
import { styleScene, pickStyle, pickVariant, analyzeText, LIGHT_WORLDS } from "../web/scene-stylist.js";

assert.equal(WORLDS.length, 64);
assert.equal(new Set(WORLDS.map((w) => w.id)).size, 64, "world ids are unique");
assert.ok(LIGHT_WORLDS.length >= 20, "plenty of light worlds, because dark is never the default");

// 1. every world is readable, so none can ever be offered unreadable
for (const w of WORLDS) {
  const t = worldTheme(w.id);
  for (const bg of [t.bg, t.bg2, t.solid]) {
    assert.ok(contrast(t.ink, bg) >= 7, `${w.id}: ink on ${bg}`);
    assert.ok(contrast(t.mute, bg) >= 4.5, `${w.id}: muted text on ${bg}`);
    assert.ok(contrast(t.blue, bg) >= 3, `${w.id}: accent on ${bg}`);
    assert.ok(contrast(t.gold, bg) >= 3, `${w.id}: second emphasis on ${bg}`);
  }
  assert.ok(contrast(t.blue, t.wash) >= 3, `${w.id}: icon colour on its badge`);
  assert.ok(contrast(t.onAccent, t.blue) >= 4.5, `${w.id}: text on the accent`);
  assert.ok(contrast(t.onAccent, t.gold) >= 4.5, `${w.id}: text on the second emphasis`);
}

// 2. every scene type and layout draws in every world family, keeps every spoken word, and puts no text on a gradient
const long = "جملة طويلة نسبياً يقولها المحاضر وتبقى كاملة في المشهد مهما صغر الخط";
const samples = {
  stat: [["68%", long], ["7", "أيام"], ["١٢٠٠٠", "طالب"]],
  steps: [["الاستماع", "الفهم", "التطبيق"], ["أ", "ب", "ج", "د", "هـ", "و"], ["أ", "ب"]],
  concept: [["الدافعية", "الانتباه"], ["أ", "ب", "ج", "د", "هـ", "و"], ["الدافعية", "الانتباه", "الذاكرة", "الفهم"]],
  compare: [["محاضرة | تفاعل", "حفظ | فهم"], ["أ | ب", "ج | د", "هـ | و", "ز | ح", "ط | ي"]],
  quote: [[long, "د. أحمد"], ["جملة قصيرة"]],
  tour: [["افتح البرنامج", "نزّل الملف", "جرّب النكهة"], ["أ", "ب"], ["١", "٢", "٣", "٤", "٥", "٦", long]],
  kinetic: [["أول شي | ادخل Claude", "أو ارفع | ملف البوربوينت", "وبعدها | انسخ البرومبت"], ["أ", "ب"], ["١ | " + long, "٢", "٣", "٤", "٥", "٦"]],
};
const picks = ["copper-eclipse", "ivory-thesis", "lunar-glass", "emerald-atlas", "desert-bloom", "black-margin", ...WORLDS.filter((_, i) => i % 5 === 0).map((w) => w.id)];
for (const id of picks) for (const [type, sets] of Object.entries(samples)) for (let variant = 0; variant < (VARIANTS[type] || 1); variant++) for (const lines of sets) {
  const svg = renderInfographic({ type, title: "عنوان المشهد", lines, theme: worldName(id, [undefined, 30, 140, 215, 300][picks.indexOf(id) % 5]), variant });
  const where = `${type}/v${variant}/${id}`;
  assert.ok(!/NaN|undefined/.test(svg), `${where}: no NaN or undefined`);
  assert.ok(svg.includes(worldTheme(id).bg), `${where}: uses the world background`);
  assert.ok(!/…|\.\.\./.test(svg.replace(/<title>[\s\S]*?<\/title>/g, "")) || lines.some((l) => /…|\.\.\./.test(l)), `${where}: never an ellipsis cut`);
  const on = worldTheme(id).onAccent;
  for (const m of svg.matchAll(new RegExp(`<text[^>]*fill="${on}"`, "g"))) {
    const shape = [...svg.slice(0, m.index).matchAll(/<(?:circle|rect)\b[^>]*>/g)].at(-1)?.[0] || "";
    assert.ok(!/fill="url\(#sk-(?:blue|gold)\)"/.test(shape), `${where}: text on a gradient`);
  }
  if (type === "kinetic" || type === "tour") { for (const l of lines) assert.ok(svg.includes(`data-full="${l}"`), `${where}: phrase kept`); assert.ok(svg.includes("k-static") && svg.includes("k-last")); continue; }
  if (type === "quote") assert.ok(svg.includes(`data-full`) || svg.includes(lines[0].split(" ")[0]), `${where}: the sentence is drawn`);
  else for (const raw of lines.flatMap((l) => (type === "compare" ? l.split("|").map((x) => x.trim()) : [l]))) {
    if (type === "stat") continue;
    assert.ok(svg.includes(`data-full="${raw}"`), `${where}: the full text "${raw}" stays in the scene`);
  }
}
// the whole quote is drawn, word for word
const all = renderInfographic({ type: "quote", title: "t", lines: [long], theme: "world:ivory-thesis" });
for (const word of long.split(" ")) assert.ok(all.includes(word), `quote keeps "${word}"`);

// the ember theme (from the lecturer's reference video) is a normal fixed theme and passes the same contrast rules in scene-themes.mjs
assert.equal(validateSpec({ type: "kinetic", title: "x", lines: ["أ", "ب"], theme: "ember" }).theme, "ember");
assert.throws(() => validateSpec({ type: "kinetic", title: "x", lines: ["أ"] }));
assert.throws(() => validateSpec({ type: "tour", title: "x", lines: ["أ"] }));
assert.throws(() => validateSpec({ type: "tour", title: "x", lines: ["1", "2", "3", "4", "5", "6", "7", "8"] }));
assert.match(renderInfographic({ type: "tour", title: "x", lines: ["أ", "ب", "ج"] }), /3 \/ 3/, "the stepper counter reaches n / n");
assert.throws(() => validateSpec({ type: "kinetic", title: "x", lines: ["1", "2", "3", "4", "5", "6", "7"] }));

// 3. a scene's look travels in the spec and is validated
assert.equal(validateSpec({ type: "steps", title: "x", lines: ["أ", "ب"], theme: "world:copper-eclipse" }).theme, "world:copper-eclipse");
assert.equal(validateSpec({ type: "steps", title: "x", lines: ["أ", "ب"], theme: "world:no-such-world" }).theme, undefined);
assert.equal(validateSpec({ type: "steps", title: "x", lines: ["أ", "ب"], theme: "world:__proto__" }).theme, undefined);
assert.equal(validateSpec({ type: "steps", title: "x", lines: ["أ", "ب"], variant: 3 }).variant, 3);
for (const bad of [4, -1, 1.5, "1", null, NaN]) assert.equal(validateSpec({ type: "steps", title: "x", lines: ["أ", "ب"], variant: bad }).variant, undefined, `variant ${bad} is ignored`);
assert.equal(validateSpec({ type: "bars", title: "x", lines: ["أ | 10%", "ب | 20%"], variant: 1 }).variant, undefined, "types with one layout ignore variant");
assert.equal(validateSpec({ type: "quote", title: "x", lines: ["ا".repeat(300)] }).lines[0].length, 260);
assert.throws(() => validateSpec({ type: "quote", title: "x", lines: [] }));

// 4. the stylist: meaning picks the world, history prevents repeats
assert.equal(analyzeText("مشكلة وأزمة كبيرة").verb, "fracture");
assert.equal(analyzeText("لماذا نتعلم؟").verb, "question");
assert.equal(analyzeText("ثلاث خطوات في المسار").verb, "path");
const memory = () => { const d = {}; return { getItem: (k) => d[k] ?? null, setItem: (k, v) => { d[k] = v; } }; };
const topics = [["مراحل التعلم", "الاستماع", "الفهم", "التطبيق"], ["مشكلة الانتباه", "ضجيج", "تشتت", "فشل"], ["تواصل الفريق", "علاقة", "ربط", "تعاون"],
  ["مستقبل التعليم", "ابتكار", "ذكاء", "تقنية"], ["ذاكرة الطالب", "تذكر", "نسيان", "تاريخ"]];
const storage = memory(), seen = [], steps = [];
for (let i = 0; i < 30; i++) {
  const [title, ...lines] = topics[i % 5];
  const out = styleScene({ type: "steps", title, lines }, { storage });
  const p = parseWorld(out.theme);
  seen.push(p.id); steps.push(out.variant || 0);
  assert.ok(!worldTheme(p.id, p.hue).dark, "auto mode offers light worlds only");
}
assert.ok(new Set(seen).size >= 24, `30 scenes use ${new Set(seen).size} different worlds`);
for (let i = 0; i < seen.length; i++) assert.ok(!seen.slice(Math.max(0, i - 12), i).includes(seen[i]), `scene ${i}: no world within the last 12 scenes repeats`);
for (let i = 1; i < steps.length; i++) assert.notEqual(steps[i], steps[i - 1], `scene ${i}: layout differs from the previous steps scene`);
assert.equal(new Set(steps).size, VARIANTS.steps, "all layouts of the type get used");
// five lectures of the same content: no look is reused
const lectureLooks = [];
const lectureStore = memory();
for (let lecture = 0; lecture < 5; lecture++) lectureLooks.push(styleScene({ type: "concept", title: "الدافعية", lines: ["الانتباه", "الجهد", "المكافأة"] }, { storage: lectureStore }));
assert.equal(new Set(lectureLooks.map((s) => parseWorld(s.theme).id)).size, 5, "five lectures, five different worlds");
assert.ok(new Set(lectureLooks.map((s) => s.theme + (s.variant || 0))).size === 5);
// deterministic: the same text and history give the same look
const h = [];
assert.deepEqual(pickStyle({ type: "stat", text: "نسبة النجاح", history: h }), pickStyle({ type: "stat", text: "نسبة النجاح", history: h }));
// dark worlds only when the lecturer allows them
assert.ok(Array.from({ length: 50 }, (_, i) => pickStyle({ type: "stat", text: "نص " + i, allowDark: true, history: [] })).some((p) => p.world.id && worldTheme(p.world.id, p.hue).dark));
// a fixed theme keeps its colours; only the layout rotates
const fixed = memory(), fixedOut = [0, 1, 2, 3].map(() => styleScene({ type: "concept", title: "x", lines: ["أ", "ب"] }, { mode: "calm", storage: fixed }));
assert.ok(fixedOut.every((s) => s.theme === "calm"));
assert.ok(new Set(fixedOut.map((s) => s.variant || 0)).size >= 2, "a fixed theme still varies the layout");
assert.equal(pickVariant("bars", "x", []), 0, "types with one layout stay at 0");
// without storage (private mode) styling still works
assert.doesNotThrow(() => styleScene({ type: "steps", title: "x", lines: ["أ", "ب"] }, { storage: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } } }));

// 4b. smart tint: the accent hue follows the meaning, every world stays readable at every hue, bad hues are refused
for (const w of WORLDS) for (let hue = 0; hue < 360; hue += 45) {
  const t = worldTheme(w.id, hue);
  for (const bg of [t.bg, t.bg2, t.solid]) { assert.ok(contrast(t.blue, bg) >= 3 && contrast(t.ink, bg) >= 7 && contrast(t.mute, bg) >= 4.5, `${w.id}@${hue}: readable on ${bg}`); }
  assert.ok(contrast(t.onAccent, t.blue) >= 4.5 && contrast(t.blue, t.wash) >= 3, `${w.id}@${hue}: accent and badge`);
}
assert.equal(parseWorld("world:ivory-thesis@400"), null);
assert.equal(parseWorld("world:ivory-thesis@12x"), null);
assert.equal(parseWorld("world:nope@10"), null);
assert.deepEqual(parseWorld("world:ivory-thesis@210"), { id: "ivory-thesis", hue: 210 });
const hueOfScene = (text) => pickStyle({ type: "stat", text, history: [] }).hue;
const near = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b)) <= 30;
assert.ok(near(hueOfScene("مشكلة وأزمة كبيرة"), 8) || near(hueOfScene("مشكلة وأزمة كبيرة"), 14), "trouble leans warm red");
assert.ok(near(hueOfScene("تواصل وربط الفريق"), 215), "connection leans blue");
assert.ok(near(hueOfScene("نمو وجذور الهوية"), 120), "growth leans green");
assert.equal(hueOfScene("هذا نص عادي"), null, "no clear meaning: the world keeps its own colour");
// the two scenes in a row never share an accent hue
const hueMem = memory(); const hues = [];
for (let i = 0; i < 6; i++) hues.push(parseWorld(styleScene({ type: "stat", title: "نمو وجذور", lines: ["10%", "x"] }, { storage: hueMem }).theme).hue);
for (let i = 1; i < hues.length; i++) assert.ok(!near(hues[i], hues[i - 1]) || Math.min(Math.abs(hues[i] - hues[i - 1]), 360 - Math.abs(hues[i] - hues[i - 1])) >= 25, "consecutive scenes use different accent hues");

// 5. one world never leaks into the next render
const warm = renderInfographic({ type: "steps", title: "x", lines: ["أ", "ب"], theme: "warm" });
renderInfographic({ type: "steps", title: "x", lines: ["أ", "ب"], theme: "world:copper-eclipse", variant: 1 });
assert.equal(renderInfographic({ type: "steps", title: "x", lines: ["أ", "ب"], theme: "warm" }), warm, "no residue from the previous world");
console.log("scene worlds: 64 worlds readable, 5 lectures differ, layouts rotate, text kept");
