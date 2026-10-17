// Field-trial recorder: a local black box for ONE real lecture. Off unless the lecturer ticks consent.
// It keeps what the director heard and decided so the lecturer can label decisions afterwards; labels
// are the only source of accuracy numbers. Nothing leaves the browser except an export the lecturer saves.
const PREFIX = "alfa-trial-v1:", CONSENT = "alfa-trial-consent";
const MAX_TRIALS = 10, MAX_EVENTS = 2500;
const clip = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const storageOrNull = (custom) => { if (custom) return custom; try { return globalThis.localStorage || null; } catch { return null; } };

export function createFieldRecorder({ bundle, storage: custom, now = () => Date.now() }) {
  const storage = storageOrNull(custom);
  const read = () => { try { const l = JSON.parse(storage?.getItem(PREFIX + bundle) || "[]"); return Array.isArray(l) ? l.filter((x) => x && Array.isArray(x.events)) : []; } catch { return []; } };
  let trials = storage ? read() : [];
  let current = null;
  const save = () => { try { storage?.setItem(PREFIX + bundle, JSON.stringify(trials.slice(-MAX_TRIALS))); } catch {} };
  const consented = () => { try { return storage?.getItem(CONSENT) === "1"; } catch { return false; } };
  const add = (type, data) => {
    if (!current) return null;
    const event = { id: current.events.length ? current.events.at(-1).id + 1 : 1, t: now() - current.startedAt, type, ...data };
    current.events.push(event);
    if (current.events.length > MAX_EVENTS) current.events.splice(0, current.events.length - MAX_EVENTS);
    save();
    return event.id;
  };
  return {
    consented,
    setConsent(on) { try { on ? storage?.setItem(CONSENT, "1") : storage?.removeItem(CONSENT); } catch {} if (!on) this.stop(); },
    recording: () => Boolean(current),
    start({ label = "" } = {}) {
      if (!consented()) return false;
      current = { startedAt: now(), label: clip(label, 60), events: [] };
      trials.push(current); trials = trials.slice(-MAX_TRIALS); save();
      return true;
    },
    stop() { if (current) { current.endedAt = now(); save(); current = null; } },
    utterance({ text, slide, engine = "" }) { return add("utterance", { text: clip(text, 400), slide, engine: clip(engine, 20) }); },
    decision({ slide, action, kind, why, opportunity, confidence, utteranceId, spec }) {
      return add("decision", { slide, action: clip(action, 20), kind: clip(kind, 20), why: clip(Array.isArray(why) ? why.at(-1) : why, 120),
        opportunity: opportunity ? clip(opportunity, 20) : null, confidence: Number.isFinite(confidence) ? confidence : 0,
        utteranceId: utteranceId ?? null, title: spec ? clip(spec.title, 80) : "" });
    },
    shown({ slide, type, source }) { return add("shown", { slide, sceneType: clip(type, 20), source: clip(source, 20) }); },
    declined({ slide, type }) { return add("declined", { slide, sceneType: clip(type, 20) }); },
    latency({ kind, totalMs, engine }) { if (Number.isFinite(totalMs)) add("latency", { kind: clip(kind, 20), totalMs: Math.round(totalMs), engine: clip(engine, 20) }); },
    note(type) { return add("feature", { name: clip(type, 30) }); },
    /** label: "ok" | "bad" | "missed" — set by the lecturer after the lecture. */
    label(decisionId, value, trial = trials.at(-1)) {
      const ev = trial?.events.find((e) => e.id === decisionId && e.type === "decision");
      if (!ev || !["ok", "bad", "missed", null].includes(value)) return false;
      if (value === null) delete ev.label; else ev.label = value;
      save();
      return true;
    },
    trials: () => trials.slice(),
    last: () => trials.at(-1) || null,
    exportJson: (trial = trials.at(-1)) => JSON.stringify({ format: "alfa-field-trial-v1", bundle, trial }, null, 1),
    clear() { trials = []; current = null; try { storage?.removeItem(PREFIX + bundle); } catch {} },
  };
}

const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
const p95 = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]; };

/**
 * Honest report. Counts and latencies are measured. Precision exists only over decisions the lecturer labelled,
 * and says how many that was. "Missed" opportunities are those the lecturer marked, plus unanswered detections.
 */
export function analyzeTrial(trial) {
  const events = Array.isArray(trial?.events) ? trial.events : [];
  const decisions = events.filter((e) => e.type === "decision");
  const byAction = {};
  for (const d of decisions) byAction[d.action] = (byAction[d.action] || 0) + 1;
  const shown = events.filter((e) => e.type === "shown"), declined = events.filter((e) => e.type === "declined");
  const lat = events.filter((e) => e.type === "latency").map((e) => e.totalMs);
  const labelled = decisions.filter((d) => d.label === "ok" || d.label === "bad" || d.label === "missed");
  const ok = labelled.filter((d) => d.label === "ok").length;
  const lateOpportunities = decisions.filter((d) => d.opportunity && d.action === "none" && !events.some((e) => e.type === "shown" && e.t >= d.t && e.t - d.t < 15000));
  const features = new Set(events.filter((e) => e.type === "feature").map((e) => e.name));
  return {
    durationMs: Math.max(0, (trial?.endedAt ? trial.endedAt - trial.startedAt : events.at(-1)?.t) || 0),
    utterances: events.filter((e) => e.type === "utterance").length,
    decisions: decisions.length, byAction,
    scenes: { shown: shown.length, declined: declined.length },
    latencyMs: { samples: lat.length, median: median(lat), p95: p95(lat) },
    labelled: labelled.length,
    precision: labelled.length >= 5 ? Number((ok / labelled.length).toFixed(2)) : null,
    precisionNote: labelled.length >= 5 ? `${labelled.length} قراراً صنّفتَه أنت (مناسب مقابل غير مناسب أو فاتته فرصة)` : labelled.length ? `${labelled.length} قرارات مُصنَّفة فقط؛ لا تكفي لنسبة` : "لم تُصنَّف قرارات بعد",
    missedMarked: decisions.filter((d) => d.label === "missed").length,
    opportunitiesWithoutScene: lateOpportunities.length,
    unusedFeatures: ["poll", "pulse", "review", "witness", "return", "rehearsal"].filter((f) => !features.has(f)),
  };
}

export function trialToMarkdown(report) {
  const mins = (ms) => (ms < 60000 ? Math.round(ms / 1000) + " ث" : Math.round(ms / 60000) + " د");
  const lines = ["# تقرير المحاضرة التجريبية", "", `- المدة: ${mins(report.durationMs)}`, `- جمل سُمعت: ${report.utterances}`, `- قرارات المخرج: ${report.decisions} (${Object.entries(report.byAction).map(([k, v]) => k + " " + v).join("، ") || "—"})`,
    `- مشاهد عُرضت ${report.scenes.shown}، وتُجوهلت ${report.scenes.declined}`];
  lines.push(report.latencyMs.samples ? `- التأخير المقيس (${report.latencyMs.samples} عينة): وسيط ${report.latencyMs.median}ms، و95٪ منها أقل من ${report.latencyMs.p95}ms` : "- التأخير: لا عينات");
  lines.push(`- نسبة القرارات المناسبة: ${report.precision === null ? "غير محسوبة" : Math.round(report.precision * 100) + "٪"} — ${report.precisionNote}`);
  if (report.missedMarked) lines.push(`- فرص فاتت وسجّلتَها: ${report.missedMarked}`);
  if (report.opportunitiesWithoutScene) lines.push(`- فرص رصدها المخرج دون مشهد: ${report.opportunitiesWithoutScene}`);
  if (report.unusedFeatures.length) lines.push(`- ميزات لم تُستخدم في هذه المحاضرة: ${report.unusedFeatures.join("، ")}`);
  lines.push("", "> هذه أرقام محاضرة واحدة وبتصنيفك؛ لا تُعمَّم على غيرها.");
  return lines.join("\n");
}
