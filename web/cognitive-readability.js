// ALFA projector readability: deterministic, verbatim pages. No word or number is invented or dropped.
// Each page has a limited visual reading load; the underlying approved graph remains untouched.
export const ROOM_LIMITS = Object.freeze({
  maxCards: 6, maxUnits: 6, maxCharsPerFragment: 154
});

/** Preserve every character, including Arabic digits, punctuation and whitespace, across fragments. */
export function splitVerbatim(value, limit = ROOM_LIMITS.maxCharsPerFragment) {
  const text = String(value ?? "");
  const max = Math.max(48, Math.min(220, Math.trunc(limit) || ROOM_LIMITS.maxCharsPerFragment));
  if (!text) return [""];
  if (text.length <= max) return [text];
  const words = text.match(/\S+\s*|\s+/gu) || [text];
  const pieces = [];
  let buffer = "";
  const flush = () => { if (buffer) pieces.push(buffer); buffer = ""; };
  for (const token of words) {
    if (buffer.length + token.length <= max) { buffer += token; continue; }
    flush();
    if (token.length <= max) { buffer = token; continue; }
    // A long non-breaking sequence must be displayed in successive frames, never clipped.
    for (let at = 0; at < token.length; at += max) {
      const part = token.slice(at, at + max);
      if (part.length === max) pieces.push(part);
      else buffer = part;
    }
  }
  flush();
  return pieces;
}

const weight = (text) => text.length > 115 ? 3 : text.length > 65 ? 2 : 1;

export function roomKnowledgePages(graph) {
  const originals = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const all = [];
  const headIds = new Map();
  for (const node of originals) {
    if (typeof node?.text !== "string") continue;
    const parts = splitVerbatim(node.text);
    for (let i = 0; i < parts.length; i++) {
      const id = parts.length === 1 ? node.id : node.id + ":part-" + (i + 1);
      if (i === 0) headIds.set(node.id, id);
      all.push({ id, sourceId: node.id, type: node.type, text: parts[i],
        part: i + 1, parts: parts.length, readingUnits: weight(parts[i]) });
    }
  }
  const pages = [];
  let current = [], units = 0;
  const flush = () => {
    if (!current.length) return;
    const visible = new Set(current.map((n) => n.id));
    const edges = (graph?.edges || []).map((e) => ({
      from: headIds.get(e.from), to: headIds.get(e.to), relation: e.relation
    })).filter((e) => visible.has(e.from) && visible.has(e.to));
    pages.push({nodes:current,edges});
    current = []; units = 0;
  };
  for (const node of all) {
    if (current.length && (current.length >= ROOM_LIMITS.maxCards ||
        units + node.readingUnits > ROOM_LIMITS.maxUnits)) flush();
    current.push(node);
    units += node.readingUnits;
  }
  flush();
  return pages.length ? pages : [{nodes:[],edges:[]}];
}

/** Browser-facing measurement. Never silently shrink an illegible paragraph to make it fit. */
export function roomReadabilityStatus(layer) {
  if (!layer || typeof layer.querySelectorAll !== "function") return {ok:false,reason:"missing-layer"};
  const samples = [...layer.querySelectorAll(".cognitive-node p,.cognitive-question,.cognitive-revealed-result,.cognitive-bridge-quote,.cognitive-pulse-item h3")];
  const clipped = samples.some((node) => node.clientHeight > 0 && (
    node.scrollHeight > node.clientHeight + 2 || node.scrollWidth > node.clientWidth + 2));
  const stage = layer.getBoundingClientRect?.();
  const outside = samples.some((node) => {
    const r = node.getBoundingClientRect();
    return stage && (r.left < stage.left - 2 || r.right > stage.right + 2 ||
      r.top < stage.top - 2 || r.bottom > stage.bottom + 2);
  });
  return {ok:!clipped && !outside,clipped,outside,count:samples.length};
}
