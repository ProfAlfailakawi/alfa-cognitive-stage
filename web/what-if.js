// Conservative local detector: never invent a hypothetical result.
import { normalizeArabic } from './director-core.js';
const PERCENT = /(\d+(?:[.,]\d+)?)\s*(?:%|بالمئه|بالمائه|بالميه|بالمايه|في الميه)/g;
export function hasHypotheticalPercent(raw) {
  const text = normalizeArabic(raw);
  return /(?:^|\s)(?:لو|ولو|اذا|واذا|افترضنا|نفترض)(?=\s|$)/.test(text) && [...text.matchAll(PERCENT)].length > 0;
}
export function detectWhatIf(raw) {
  const text = normalizeArabic(raw);
  if (!hasHypotheticalPercent(text) || /(?:عفوا|اقصد|التصحيح|غلطت)/.test(text)) return null;
  const values = [...text.matchAll(PERCENT)];
  if (values.length !== 2) return null;
  const [current, assumed] = values;
  const before = text.slice(0, current.index);
  const between = text.slice(current.index + current[0].length, assumed.index);
  const after = text.slice(assumed.index + assumed[0].length);
  if (!/(?:^|\s)(?:حاليا|الحين|الان|فعليا)(?=\s|$)/.test(before) || !/نسبه/.test(before) || /\d/.test(before)) return null;
  const marker = /(?:^|\s)(?:و?لو\s+(?:افترضنا|فرضنا|صارت|صار|كانت)|و?اذا\s+افترضنا|و?نفترض)(?=\s|$)/.exec(between);
  if (!marker) return null;
  const lead = between.slice(0, marker.index).trim();
  const tail = between.slice(marker.index + marker[0].length).trim();
  if (lead && !/^[،؛,.\sو]+$/.test(lead)) return null;
  if (!/^(?:صارت|صار|كانت|تصير|تكون|وصلت|ارتفعت|انخفضت|النسبه|نسبتها|هالنسبه|نفس النسبه|صارت النسبه|تصير النسبه|تكون النسبه|وصلت النسبه|ارتفعت النسبه|انخفضت النسبه)?$/.test(tail) || /\d/.test(after)) return null;
  if ([current, assumed].some(m => /[-−]/.test(text[m.index - 1] || ''))) return null;
  const numbers = values.map(m => Number(m[1].replace(',', '.')));
  if (numbers.some(n => !Number.isFinite(n) || n < 0 || n > 100) || numbers[0] === numbers[1]) return null;
  return { type: 'whatif', title: 'افتراض رقمي من شرح المحاضر', lines: values.map(m => m[1].replace(',', '.') + '%') };
}
