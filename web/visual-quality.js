// Conservative visual quality gate. It does not alter the lecturer's words or numbers.
// Prefer an uncluttered, readable scene when text is dense; never silently delete content.
export function assessVisualDensity(spec) {
  const lines = Array.isArray(spec?.lines) ? spec.lines.flat(Infinity).map(String) : [];
  const title = String(spec?.title || "");
  const maxLine = Math.max(0, ...lines.map((s) => s.length));
  const total = lines.reduce((n, s) => n + s.length, title.length);
  const count = lines.length;
  const crowded = (count >= 5 && maxLine > 50) || (count >= 6 && total > 240);
  const dense = title.length > 65 || maxLine > 85 || total > 320 || crowded;
  const reasons = [
    ...(title.length > 65 ? ["long-title"] : []),
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
