// Extract *explicit* ordered stages from Kuwaiti/Modern Standard Arabic speech.
// Zero API, no dates, facts or steps are added by the program.
import { normalizeWithMap, rawSlice } from "./director-core.js";

const ORDER = [
  /^(?:اولا|اول شي|اول شيء|الخطوه الاولي)$/,
  /^(?:ثانيا|ثاني شي|ثاني شيء|الخطوه الثانيه)$/,
  /^(?:ثالثا|ثالث شي|ثالث شيء|الخطوه الثالثه)$/,
  /^(?:رابعا|رابع شي|رابع شيء|الخطوه الرابعه)$/,
  /^(?:خامسا|خامس شي|خامس شيء|الخطوه الخامسه)$/,
  /^(?:سادسا|سادس شي|سادس شيء|الخطوه السادسه)$/,
];
const MARKER = /(?:^|[\s،,:؛])(?:و|ثم\s+|بعدين\s+)?((?:الخطوه\s+(?:الاولي|الثانيه|الثالثه|الرابعه|الخامسه|السادسه))|(?:(?:اول|ثاني|ثالث|رابع|خامس|سادس)\s+(?:شي|شيء))|(?:اولا|ثانيا|ثالثا|رابعا|خامسا|سادسا))(?=\s|$|[،,:؛])/gu;

export function extractSpokenSteps(utterance) {
  const raw = String(utterance || "").trim();
  if (!raw || raw.length > 950) return null;
  const norm = normalizeWithMap(raw), text = norm.text.toLowerCase();
  const markers = [...text.matchAll(MARKER)].map((match) => ({
    stage: ORDER.findIndex((re) => re.test(match[1])),
    start: match.index,
    end: match.index + match[0].length,
  }));
  if (markers.length < 3 || markers.length > 6) return null;
  // A full ordered sequence is required. Scattered conversational ordinal mentions
  // must not be turned into a fictional teaching process.
  if (markers.some((m, i) => m.stage !== i)) return null;
  const lines = markers.map((m, i) => {
    const end = i + 1 < markers.length ? markers[i + 1].start : text.length;
    // Shown in the lecturer's own spelling; a trailing "و"/"ثم" that belongs to the next marker is dropped.
    return rawSlice(norm, m.end, end).replace(/^[\s،:؛.-]+|[\s،:؛.-]+$/gu, "").replace(/\s+(?:و|ثم|بعدين)$/u, "").trim();
  });
  if (lines.some((line) => line.length < 5 || line.length > 110 ||
      !/[\p{L}]/u.test(line))) return null;
  if (new Set(lines).size !== lines.length) return null;
  return {
    type: "steps", title: "خطوات من شرح المحاضر", lines
  };
}
