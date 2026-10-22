// Fusing two opinions about "which slide is this sentence about": the built-in lexical index (always available) and an
// optional neural embedding. Each is z-scored across the candidate slides so their scales do not matter, then blended.
// The lexical index alone is NOT reliable enough to act on (its margin does not predict correctness); the hybrid is,
// above CONFIDENT_MARGIN — see docs/SEMANTIC_MATCHING_AR.md for the measurement and its limits.
export const NEURAL_WEIGHT = 0.7;
export const CONFIDENT_MARGIN = 1.2;

export function zscores(values) {
  const n = values.length;
  if (!n) return [];
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return values.map((v) => (sd > 1e-9 ? (v - mean) / sd : 0));
}
export const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/**
 * @param lexical  number[] one score per candidate
 * @param neural   number[] | null  the same candidates, or null when no neural backend answered
 * @returns { mode, scores (z-blended), order (candidate indexes, best first), margin (best - second, in z units) }
 */
export function fuse(lexical, neural = null, weight = NEURAL_WEIGHT) {
  const zl = zscores(lexical);
  const hybrid = Array.isArray(neural) && neural.length === lexical.length && lexical.length > 1;
  const zn = hybrid ? zscores(neural) : null;
  const scores = zl.map((l, i) => (hybrid ? weight * zn[i] + (1 - weight) * l : l));
  const order = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a]);
  const margin = order.length > 1 ? scores[order[0]] - scores[order[1]] : 0;
  return { mode: hybrid ? "hybrid" : "lexical", scores, order, margin };
}
