// Measures what the lecturer actually waits for: first audible transcript -> decision -> scene on screen.
// Onset is the browser's first interim result (a proxy for speech onset, not the audio waveform);
// recognition-service time is therefore included, and microphone/OS buffering before it is NOT.
const percentile = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : null;

export function createLatencyMeter({ keep = 30 } = {}) {
  const samples = [];
  return {
    record({ kind, onsetAt, finalAt, decidedAt, shownAt, engine = "unknown" }) {
      const nums = [finalAt, decidedAt, shownAt];
      if (!["scene", "proposal"].includes(kind) || !nums.every(Number.isFinite) || !(decidedAt >= finalAt) || !(shownAt >= decidedAt)) return false;
      const start = Number.isFinite(onsetAt) && onsetAt <= finalAt ? onsetAt : null;
      samples.push({ kind, engine,
        recognitionMs: start === null ? null : finalAt - start, decisionMs: decidedAt - finalAt, renderMs: shownAt - decidedAt,
        localMs: shownAt - finalAt, totalMs: (start === null ? finalAt : start) <= shownAt ? shownAt - (start ?? finalAt) : null });
      if (samples.length > keep) samples.shift();
      return true;
    },
    summary() {
      const local = samples.map((s) => s.localMs).sort((a, b) => a - b);
      const total = samples.filter((s) => s.recognitionMs !== null).map((s) => s.totalMs).sort((a, b) => a - b);
      return { count: samples.length, localP50: percentile(local, 0.5), localP95: percentile(local, 0.95),
        totalP50: percentile(total, 0.5), totalP95: percentile(total, 0.95), last: samples.at(-1) || null,
        engines: [...new Set(samples.map((s) => s.engine))] };
    },
    reset() { samples.length = 0; },
  };
}
