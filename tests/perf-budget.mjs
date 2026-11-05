// Performance regression guard. Budgets are CPU time (not wall time, so a busy laptop cannot fail it) with a wide margin
// over measured values: they catch an accidental O(n^2)/re-parse regression, they are not benchmark targets.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { renderInfographic } from "../web/infographic.js";
import { clusterQuestions } from "../web/engagement-insights.js";
import { rememberScene, recallScene } from "../web/scene-memory.js";
import { createVoteStore } from "../server/votes.mjs";
import { buildCourseMap } from "../web/course-map.js";

const cpuMs = (fn) => { const c0 = process.cpuUsage(); const out = fn(); const c = process.cpuUsage(c0); return { ms: (c.user + c.system) / 1000, out }; };
const rows = [];
const budget = (name, ms, limit, unit = "ms") => { rows.push(`${name.padEnd(54)} ${ms.toFixed(2).padStart(9)} ${unit}  (limit ${limit})`); assert.ok(ms <= limit, `${name}: ${ms.toFixed(2)} > ${limit}`); };

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } }; };
const topics = ["الدافعية", "التغذية الراجعة", "التقويم البنائي", "التعلم النشط", "التلعيب", "الواقع المعزز", "المدرسة الذكية", "تصميم الاختبار"];

// 1. Scene recall: 50 saved scenes in one lecture + 150 in the cross-lecture index; the lecturer speaks every few seconds.
{
  const storage = mem();
  for (let b = 0; b < 4; b++) for (let i = 0; i < 40; i++) {
    const text = `${topics[i % 8]} في الوحدة ${i} تعني ${topics[(i + b) % 8]} داخل الصف رقم ${b}${i}`;
    rememberScene({ bundle: "bundle" + String(b).repeat(8), slide: 1 + (i % 9), utterance: text, spec: { type: "steps", title: "خطوات", lines: ["أولا " + text, "ثانيا " + text] } }, storage);
  }
  const ask = () => recallScene({ bundle: "bundle" + "0".repeat(8), slide: 3, utterance: "نتكلم الحين عن التقويم البنائي ودوره في الصف" }, storage);
  ask(); // cold: decodes the stores
  const warm = cpuMs(() => { for (let i = 0; i < 100; i++) ask(); });
  budget("scene recall, warm (per utterance)", warm.ms / 100, 2);
}

// 2. Question clustering for a 200-question session (runs every poll refresh in the lecturer panel).
{
  const qs = Array.from({ length: 200 }, (_, i) => ({ id: i, text: `ما معنى ${topics[i % 8]} وكيف نطبقها في المحاضرة رقم ${i % 13}؟` }));
  budget("cluster 200 questions", cpuMs(() => clusterQuestions(qs)).ms, 800);
}

// 3. Course map over 6 lectures x 8 confusing slides (embeds each slide once).
{
  const lectures = Array.from({ length: 6 }, (_, l) => ({ bundle: "b" + l, title: "محاضرة " + l, sessions: 3,
    slides: Array.from({ length: 8 }, (_, s) => ({ slide: s + 1, got: 3, lost: 6, questions: 2 })) }));
  const texts = Object.fromEntries(lectures.map((l, li) => [l.bundle, Object.fromEntries(l.slides.map((x, s) => [x.slide, `${topics[(s + li) % 8]} وتطبيقها في الصف الدراسي`]))]));
  const map = buildCourseMap(lectures, texts);
  assert.ok(map.recurring.length > 0, "the fixture must exercise the pair loop");
  budget("course map 6 lectures", cpuMs(() => buildCourseMap(lectures, texts)).ms, 600);
}

// 4. Rendering every scene type (the lecturer sees one at a time; this guards against a slow layout path).
{
  const types = [["stat", ["68%", "من المشاركين استفادوا"]], ["compare", ["أ | ب", "ج | د"]], ["steps", ["أول", "ثاني", "ثالث", "رابع"]], ["concept", ["أ", "ب", "ج"]],
    ["flow", ["سبب", "نتيجة"]], ["timeline", ["2001 — أ", "2005 — ب", "2010 — ج"]], ["story", ["بداية", "وسط", "نهاية"]], ["cycle", ["أ", "ب", "ج", "د"]], ["bars", ["أ | 30%", "ب | 50%", "ج | 20%"]], ["quote", ["جملة قصيرة تلخص الفكرة كاملة"]]];
  const { ms } = cpuMs(() => { for (let i = 0; i < 30; i++) for (const [type, lines] of types) renderInfographic({ type, title: "عنوان", lines }); });
  budget("render a scene (mean of 300)", ms / 300, 6);
}

// 5. Vote store with 1000 devices voting and the durable write that follows each change.
{
  const dir = mkdtempSync(join(tmpdir(), "alfa-perf-"));
  try {
    const store = createVoteStore({ file: join(dir, "votes.json") });
    const code = store.createSession();
    const poll = store.createPoll(code, { question: "أي خيار؟", options: ["أ", "ب", "ج"] });
    store.setStatus(code, poll.id, "open");
    const { ms } = cpuMs(() => { for (let i = 0; i < 1000; i++) store.vote(code, i.toString(16).padStart(32, "0"), i % 3); });
    budget("1000 votes incl. durable writes (per vote)", ms / 1000, 4);
    assert.ok(statSync(join(dir, "votes.json")).size < 200_000, "votes file stays small (no per-device records)");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// 6. Static assets revalidate with 304 instead of being re-sent.
{
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const port = 4392;
  const srv = spawn(process.execPath, [join(root, "server/server.mjs")], { env: { ...process.env, PORT: String(port), ADMIN_TOKEN: "test-perf-admin-0123456789abcdef" }, stdio: "ignore" });
  try {
    let tag = null;
    for (let i = 0; i < 40 && !tag; i++) { try { const r = await fetch(`http://localhost:${port}/app.js`); tag = r.headers.get("etag"); await r.arrayBuffer(); } catch { await new Promise((r) => setTimeout(r, 250)); } }
    assert.ok(tag, "static files carry an ETag");
    const again = await fetch(`http://localhost:${port}/app.js`, { headers: { "If-None-Match": tag } });
    assert.equal(again.status, 304, "unchanged scripts are revalidated, not re-downloaded");
    const ranged = await fetch(`http://localhost:${port}/app.js`, { headers: { Range: "bytes=0-9", "If-None-Match": tag } });
    assert.equal(ranged.status, 206, "range requests (video seeking) are unaffected");
    rows.push("static revalidation: 304 + range intact".padEnd(54));
  } finally { srv.kill(); }
}
console.log(rows.join("\n"));
console.log("\nall performance budgets held");
