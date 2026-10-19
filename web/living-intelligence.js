// ALFA Living Intelligence: bounded, deterministic models. No external AI calls.
// Suggestions are never published without an explicit lecturer action.
import { embed, compatible } from "./semantic-index.js";

export const KNOWLEDGE_VERSION = 1;
export const NODE_TYPES = Object.freeze(["topic", "concept", "example", "stat", "compare", "step", "question", "summary"]);
export const RELATIONS = Object.freeze(["part-of", "example-of", "related", "compared-with", "precedes", "explains"]);
const SOURCE_TYPES = new Set(["slide", "notes", "speech", "approved-scene", "lecturer", "poll"]);
const GRAPH_LIMIT = 120;
const STORAGE_PREFIX = "alfa-living-intelligence-v1:";
const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const plain = (v) => String(v || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
const own = (x, k) => Object.prototype.hasOwnProperty.call(x, k);

export function sourceRecord({ bundle, slide, elementId = null, originalText, kind = "slide", approved = false, capturedAt = Date.now() }) {
  if (typeof bundle !== "string" || !/^[a-zA-Z0-9_-]{4,64}$/.test(bundle) ||
      !Number.isInteger(slide) || slide < 1 || slide > 10000 ||
      !SOURCE_TYPES.has(kind) || !clip(originalText, 1200)) throw Error("مصدر معرفي غير صالح");
  return { version: 1, bundle, slide, elementId: elementId == null ? null : clip(elementId, 100),
    originalText: clip(originalText, 1200), kind, approved: Boolean(approved),
    capturedAt: Number.isFinite(capturedAt) ? capturedAt : null };
}

export function createKnowledgeGraph(bundle) {
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(String(bundle))) throw Error("معرّف المحاضرة غير صالح");
  return { version: KNOWLEDGE_VERSION, bundle, nodes: [], edges: [], revision: 0 };
}
export function appendKnowledge(graph, { type = "concept", text, source, parentId = null, relation = "related" }) {
  if (!graph || graph.version !== KNOWLEDGE_VERSION || !NODE_TYPES.includes(type) ||
      !RELATIONS.includes(relation) || !source?.approved || source.bundle !== graph.bundle)
    throw Error("الإضافة تحتاج مصدراً معتمداً من المحاضرة نفسها");
  const value = clip(text, 300);
  if (!value || !(plain(source.originalText).includes(plain(value)) || source.kind === "poll"))
    throw Error("النص يجب أن يكون مقتطفاً حرفياً من المصدر المعتمد");
  const duplicate = graph.nodes.find((n) => n.type === type && plain(n.text) === plain(value));
  if (duplicate) return { graph, node: duplicate, duplicate: true };
  if (graph.nodes.length >= GRAPH_LIMIT) throw Error("بلغت الذاكرة المعرفية حد العناصر");
  const id = "n" + (graph.revision + 1);
  const node = { id, type, text: value, source: { ...source }, status: "approved", slide: source.slide };
  const edges = [...graph.edges];
  if (parentId) {
    if (!graph.nodes.some((n) => n.id === parentId)) throw Error("العقدة المرتبطة غير موجودة");
    if (edges.length >= GRAPH_LIMIT * 2) throw Error("بلغت العلاقات حدها");
    edges.push({ from: id, to: parentId, relation, approved: true });
  }
  return { graph: { ...graph, nodes: [...graph.nodes, node], edges, revision: graph.revision + 1 }, node, duplicate: false };
}
export function graphPage(graph, page = 0, pageSize = 6) {
  const size = Math.max(1, Math.min(8, pageSize));
  const pages = Math.max(1, Math.ceil((graph?.nodes?.length || 0) / size));
  const index = Math.max(0, Math.min(pages - 1, Math.trunc(page) || 0));
  const nodes = (graph?.nodes || []).slice(index * size, (index + 1) * size);
  return { nodes, edges: (graph?.edges || []).filter((e) =>
    nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to)), page: index, pages };
}
export function saveKnowledge(graph, storage = globalThis.localStorage) {
  if (!storage || !graph || graph.version !== KNOWLEDGE_VERSION) return false;
  try {
    const raw = JSON.stringify(graph);
    if (raw.length > 200000) return false;
    storage.setItem(STORAGE_PREFIX + graph.bundle, raw);
    return true;
  } catch { return false; }
}
export function loadKnowledge(bundle, storage = globalThis.localStorage) {
  try {
    const data = JSON.parse(storage?.getItem(STORAGE_PREFIX + bundle) || "null");
    if (data?.version !== KNOWLEDGE_VERSION || data.bundle !== bundle ||
        !Array.isArray(data.nodes) || data.nodes.length > GRAPH_LIMIT || !Array.isArray(data.edges) ||
        data.edges.length > GRAPH_LIMIT * 2 || data.nodes.some((n) =>
          !n.source?.approved || n.source.bundle !== bundle || typeof n.text !== "string" ||
          !NODE_TYPES.includes(n.type) || !SOURCE_TYPES.has(n.source.kind))) return createKnowledgeGraph(bundle);
    return data;
  } catch { return createKnowledgeGraph(bundle); }
}
export function clearKnowledge(bundle, storage = globalThis.localStorage) {
  try { storage?.removeItem(STORAGE_PREFIX + bundle); return true; } catch { return false; }
}
// The audience never receives raw provenance, transcript, notes, rejected suggestions or graph history.
export function audienceGraph(graph, page = 0) {
  const slice = graphPage(graph, page);
  return { kind: "living", title: slice.nodes.find((n) => n.type === "topic")?.text ||
      graph?.nodes?.find((n) => n.type === "topic")?.text || "المسرح المعرفي",
    nodes: slice.nodes.map((n) => ({ id: n.id, type: n.type, text: n.text })),
    edges: slice.edges.map((e) => ({ from: e.from, to: e.to, relation: e.relation })),
    page: slice.page, pages: slice.pages };
}
export function canEnterStage({ videoPlaying = false, mode = "slide", requested, approved = false }) {
  if (videoPlaying) return { ok: false, reason: "الفيديو قيد التشغيل" };
  if (!approved) return { ok: false, reason: "تحتاج موافقة المحاضر" };
  if (!["slide", "visual", "living", "xray", "poll", "whatif", "bridge"].includes(mode) ||
      !["living", "xray", "poll", "whatif", "bridge"].includes(requested))
    return { ok: false, reason: "حالة المسرح غير معروفة" };
  return { ok: true };
}
export function eligibleShape(shape, slide, step = 0) {
  if (!shape || !slide || !Number.isInteger(step) || step < 0 || typeof shape.id !== "string" ||
      !["text", "shape", "picture", "table"].includes(shape.type) ||
      ![shape.x, shape.y, shape.w, shape.h].every((v) => Number.isFinite(v)) ||
      shape.x < 0 || shape.y < 0 || shape.w <= 0 || shape.h <= 0 ||
      shape.x + shape.w > 1.001 || shape.y + shape.h > 1.001 ||
      shape.rotated || shape.grouped || shape.hidden || shape.clipped) return false;
  // Conservative: no focus during click-builds unless per-element visibility can be verified.
  if (Array.isArray(slide?.build?.steps) && slide.build.steps.length > 1) return false;
  return true;
}
export function xrayProjection(shapes, slide, step) {
  if (!Array.isArray(shapes) || shapes.length < 1 || shapes.length > 2 ||
      !shapes.every((s) => eligibleShape(s, slide, step))) throw Error("موضع العنصر غير موثوق");
  return { kind: "xray", boxes: shapes.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h })) };
}
export function findTimeBridge(query, entries, currentBundle, { courseId = null, allCourses = false } = {}) {
  const q = embed(query);
  if (q.size < 2) return [];
  const found = [];
  for (const row of (Array.isArray(entries) ? entries : []).slice(0, 12000)) {
    if (!row || row.bundle === currentBundle || !row.text || (courseId && !allCourses && row.courseId !== courseId)) continue;
    const e = embed(row.text);
    if (e.size < 2) continue;
    const match = compatible(q, e, { threshold: 0.68 });
    if (!match.ok) continue;
    found.push({ bundle: row.bundle, lecture: clip(row.lecture, 100), slide: row.slide,
      excerpt: clip(row.text, 240), similarity: match.similarity,
      reason: "تشابه محلي مع مراعاة الأرقام والنفي والاتجاه؛ راجع المرجع قبل عرضه" });
  }
  return found.sort((a, b) => b.similarity - a.similarity).slice(0, 3);
}
export function validateScenario(input) {
  const title = clip(input?.title, 100), question = clip(input?.question, 240);
  const type = input?.type === "numeric" ? "numeric" : "concept";
  const options = Array.isArray(input?.options) ? input.options : [];
  if (!title || !question || options.length < 2 || options.length > 3) throw Error("أكمل العنوان والسؤال وخيارين أو ثلاثة");
  const choices = options.map((o) => ({ text: clip(o?.text, 140), result: clip(o?.result, 320),
    explanation: clip(o?.explanation, 350), reference: clip(o?.reference, 180) }));
  if (choices.some((o) => !o.text || !o.result || !o.explanation)) throw Error("اكتب نتائج وتفسيرات كل الخيارات صراحة");
  if (new Set(choices.map((o) => plain(o.text))).size !== choices.length) throw Error("الخيارات مكررة");
  const slide = input?.slide == null ? null : Number(input.slide);
  if (slide !== null && (!Number.isSafeInteger(slide) || slide < 1 || slide > 10000))
    throw Error("مرجع الشريحة غير صالح");
  return { version: 1, type, title, question, slide, options: choices, createdBy: "lecturer" };
}
export function calculateScenario({ operation, a, b, unitA = "", unitB = "" }) {
  if (!["sum", "difference", "ratio", "percent"].includes(operation) ||
      !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 1e9 || Math.abs(b) > 1e9) throw Error("مدخلات الحساب غير صالحة");
  if ((operation === "sum" || operation === "difference") && unitA !== unitB) throw Error("الوحدات غير متوافقة");
  if ((operation === "ratio" || operation === "percent") && (b === 0 || unitA !== unitB)) throw Error("القسمة أو الوحدات غير صالحة");
  const result = operation === "sum" ? a + b : operation === "difference" ? a - b : operation === "ratio" ? a / b : a / b * 100;
  if (!Number.isFinite(result)) throw Error("النتيجة غير صالحة");
  return { result, unit: operation === "percent" ? "%" : operation === "ratio" ? "" : unitA,
    formula: operation, inputs: [a, b] };
}
export function comparePulse(first, last, correctIndex = null) {
  if (!first || !last || first.question !== last.question ||
      JSON.stringify(first.options) !== JSON.stringify(last.options) ||
      !Array.isArray(first.counts) || !Array.isArray(last.counts) ||
      first.counts.length !== first.options.length || last.counts.length !== last.options.length ||
      [...first.counts, ...last.counts].some((n) => !Number.isSafeInteger(n) || n < 0))
    throw Error("يجب استخدام السؤال والخيارات نفسها في الجولتين");
  const totals = [first.counts.reduce((a, b) => a + b, 0), last.counts.reduce((a, b) => a + b, 0)];
  const values = first.options.map((option, i) => {
    const before = totals[0] ? first.counts[i] * 100 / totals[0] : 0;
    const after = totals[1] ? last.counts[i] * 100 / totals[1] : 0;
    return { option, before: +before.toFixed(1), after: +after.toFixed(1), points: +(after - before).toFixed(1) };
  });
  return { question: first.question, totals, values, correctIndex: Number.isInteger(correctIndex) &&
    correctIndex >= 0 && correctIndex < values.length ? correctIndex : null,
    warning: Math.min(...totals) < 8 ? "المشاركات محدودة؛ لا تعمم النتائج." :
      "تغير في التوزيع لا يثبت أن الشرح تسبب في التغير؛ ولا يفترض مشاركة الطلبة أنفسهم." };
}
