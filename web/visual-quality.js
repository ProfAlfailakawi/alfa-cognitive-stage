// Conservative visual quality gate. It does not alter the lecturer's words or numbers.
// Prefer an uncluttered, readable scene when text is dense; never silently delete content.
// Measure displayed graphemes; Arabic vowel marks must not count as extra letters.
// The lecturer's original content is never normalized or rewritten.
export function visualLength(value) {
  const visible = String(value ?? "").replace(/[\u0640\u064b-\u065f\u0670\u06d6-\u06ed\u200b-\u200d\ufeff]/g, "");
  if (typeof Intl.Segmenter === "function") return [...new Intl.Segmenter("ar", { granularity: "grapheme" }).segment(visible)].length;
  return Array.from(visible).length;
}

export function assessVisualDensity(spec) {
  const items = Array.isArray(spec?.lines) ? spec.lines : [];
  const lines = items.map((line) => Array.isArray(line) ? line.map(String).join(" | ") : String(line));
  const title = String(spec?.title || "");
  const maxLine = Math.max(0, ...lines.map(visualLength));
  const total = lines.reduce((n, s) => n + visualLength(s), visualLength(title));
  const count = items.length;
  const crowded = (count >= 5 && maxLine > 50) || (count >= 6 && total > 240);
  const longToken = lines.some((line) => line.split(/\s+/).some((token) => visualLength(token) > 34));
  const dense = visualLength(title) > 65 || maxLine > 85 || total > 320 || crowded || longToken;
  const reasons = [
    ...(visualLength(title) > 65 ? ["long-title"] : []),
    ...(longToken ? ["unbroken-token"] : []),
    ...(maxLine > 85 ? ["long-item"] : []),
    ...(total > 320 ? ["total-copy"] : []),
    ...(crowded ? ["crowded-items"] : []),
  ];
  return { dense, reasons, count, total, maxLine };
}

/** Select a restrained layout when the automatic choice would overwhelm a dense scene.
 * This is a visual preference, not a semantic veto. Explicit lecturer choices remain untouched.
 */
export function refineVisualStyle(spec, styled, { explicitVariant = false, explicitTheme = false } = {}) {
  const quality = assessVisualDensity(spec);
  if (!quality.dense) return styled;
  const out = { ...styled };
  if (!explicitVariant) delete out.variant;
  if (!explicitTheme) out.theme = "warm";
  return out;
}
