// Local, text-free-of-students session record and the report built from it.
// Stored in this browser only (localStorage). It records what the LECTURER did: slides visited,
// scenes shown/declined, videos played. Student data enters a report only as aggregate poll counts.
const PREFIX = "alfa-sessions-v1:";
const MAX_SESSIONS = 20, MAX_EVENTS = 800, IDLE_SPLIT_MS = 3 * 3600 * 1000;
const SCENE_TYPES = new Set(["stat", "compare", "steps", "concept", "flow", "timeline", "story", "bars", "cycle", "activity"]);
const SOURCES = new Set(["auto", "approved", "manual", "memory"]);

function storageOrNull(custom) {
  if (custom) return custom;
  try { return globalThis.localStorage || null; } catch { return null; }
}
const clip = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
function load(bundle, storage) {
  try {
    const list = JSON.parse(storage.getItem(PREFIX + bundle) || "[]");
    return Array.isArray(list) ? list.filter((s) => s && Number.isFinite(s.startedAt) && Array.isArray(s.events)) : [];
  } catch { return []; }
}

export function createSessionLog({ bundle, storage: custom, now = () => Date.now() }) {
  const storage = storageOrNull(custom);
  let sessions = storage ? load(bundle, storage) : [];
  let current = null;
  const save = () => {
    if (!storage) return;
    try { storage.setItem(PREFIX + bundle, JSON.stringify(sessions.slice(-MAX_SESSIONS))); } catch {}
  };
  function ensure() {
    const t = now();
    const last = sessions.at(-1);
    if (current && t - (current.lastAt || current.startedAt) < IDLE_SPLIT_MS) return current;
    if (!current && last && t - (last.lastAt || last.startedAt) < IDLE_SPLIT_MS && !last.endedAt) current = last;
    else {
      current = { startedAt: t, lastAt: t, events: [] };
      sessions.push(current);
      sessions = sessions.slice(-MAX_SESSIONS);
    }
    return current;
  }
  function add(type, data) {
    const s = ensure();
    const t = now();
    s.events.push({ t: t - s.startedAt, type, ...data });
    s.lastAt = t;
    if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS);
    save();
  }
  return {
    slide(index, step = 0) { if (Number.isInteger(index) && index >= 1) add("slide", { i: index, s: Number.isInteger(step) ? step : 0 }); },
    scene({ slide, type, title, lines, source }) {
      if (!Number.isInteger(slide) || !SCENE_TYPES.has(type)) return;
      add("scene", { slide, sceneType: type, title: clip(title, 80), lines: (Array.isArray(lines) ? lines : []).slice(0, 3).map((l) => clip(l, 80)),
        source: SOURCES.has(source) ? source : "manual" });
    },
    declined({ slide, type }) { if (Number.isInteger(slide) && SCENE_TYPES.has(type)) add("declined", { slide, sceneType: type }); },
    video({ slide, clip: c = 0, action, at = 0 }) {
      if (Number.isInteger(slide) && ["play", "pause", "ended"].includes(action)) add("video", { slide, clip: c, action, at: Math.max(0, Number(at) || 0) });
    },
    digression(kind) { if (["enter", "return", "back"].includes(kind)) add("digression", { kind }); },
    end() { if (current) { current.endedAt = now(); save(); current = null; } },
    current: () => (current || sessions.at(-1) || null),
    all: () => sessions.slice(),
    clear() { sessions = []; current = null; try { storage?.removeItem(PREFIX + bundle); } catch {} },
  };
}

export function clearAllSessionLogs(customStorage) {
  const storage = storageOrNull(customStorage);
  if (!storage) return false;
  try {
    for (let i = (storage.length || 0) - 1; i >= 0; i--) {
      const key = storage.key?.(i);
      if (key && key.startsWith(PREFIX)) storage.removeItem(key);
    }
    return true;
  } catch { return false; }
}

/**
 * Build a factual summary. It states what happened; it does not grade teaching or learning.
 * `polls` = [{ question, options, counts, total }] aggregate only. `endAt` bounds the last slide's time.
 */
export function summarizeSession(session, { manifest = {}, polls = [], pendingQuestions = null, usage = null, endAt = null } = {}) {
  const events = Array.isArray(session?.events) ? session.events : [];
  const slideCount = Number(manifest.slideCount) || (manifest.slides || []).length || 0;
  const endOffset = Number.isFinite(endAt) ? endAt - session.startedAt : (events.at(-1)?.t ?? 0);
  const perSlide = new Map();
  let open = null;
  const close = (t) => { if (open) { perSlide.set(open.i, (perSlide.get(open.i) || 0) + Math.max(0, t - open.t)); open = null; } };
  for (const e of events) if (e.type === "slide") { close(e.t); open = { i: e.i, t: e.t }; }
  close(Math.max(endOffset, open?.t ?? 0));
  const visited = [...perSlide].map(([index, ms]) => ({ index, ms })).sort((a, b) => a.index - b.index);
  const unvisited = [];
  for (let i = 1; i <= slideCount; i++) if (!perSlide.has(i)) unvisited.push(i);
  const scenes = events.filter((e) => e.type === "scene");
  const declined = events.filter((e) => e.type === "declined");
  const byType = {};
  for (const s of scenes) byType[s.sceneType] = (byType[s.sceneType] || 0) + 1;
  const videoMs = new Map();
  let playing = new Map();
  for (const e of events.filter((x) => x.type === "video")) {
    const key = e.slide + ":" + e.clip;
    if (e.action === "play") playing.set(key, e.t);
    else if (playing.has(key)) { videoMs.set(key, (videoMs.get(key) || 0) + Math.max(0, e.t - playing.get(key))); playing.delete(key); }
  }
  for (const [key, started] of playing) videoMs.set(key, (videoMs.get(key) || 0) + Math.max(0, endOffset - started));
  const digressions = events.filter((e) => e.type === "digression" && e.kind === "enter").length;
  const total = visited.reduce((a, b) => a + b.ms, 0);
  return {
    lecture: String(manifest.source || ""), startedAt: session?.startedAt ?? null,
    durationMs: Math.max(endOffset, 0), slideCount,
    slidesVisited: visited.length, slides: visited, unvisited,
    longest: [...visited].sort((a, b) => b.ms - a.ms).slice(0, 3).filter((x) => x.ms > 0),
    timeOnSlidesMs: total,
    scenes: { shown: scenes.length, byType, auto: scenes.filter((s) => s.source === "auto").length,
      approved: scenes.filter((s) => s.source === "approved" || s.source === "memory").length,
      manual: scenes.filter((s) => s.source === "manual").length, declined: declined.length,
      list: scenes.slice(0, 40).map((s) => ({ slide: s.slide, type: s.sceneType, title: s.title, source: s.source })) },
    videos: [...videoMs].map(([key, ms]) => { const [slide, clip] = key.split(":").map(Number); return { slide, clip: clip + 1, playedMs: ms }; }),
    digressions,
    polls: (Array.isArray(polls) ? polls : []).slice(0, 20).map((p) => ({
      question: clip(p.question, 200), options: (p.options || []).map((o) => clip(o, 100)),
      counts: (p.counts || []).map((c) => (Number.isSafeInteger(c) && c >= 0 ? c : 0)), total: Number.isSafeInteger(p.total) ? p.total : 0 })),
    pendingQuestions: Number.isInteger(pendingQuestions) ? pendingQuestions : null,
    cloud: usage && typeof usage === "object" ? { calls: usage.callsUsed ?? null, costUsd: usage.costUsd ?? null } : null,
  };
}

const minutes = (ms) => (ms < 60000 ? Math.round(ms / 1000) + " ث" : Math.round(ms / 60000) + " د");
export function reportToMarkdown(report) {
  const lines = [];
  lines.push("# ملخص الجلسة" + (report.lecture ? " — " + report.lecture : ""));
  if (report.startedAt) lines.push("- البداية: " + new Date(report.startedAt).toISOString().replace("T", " ").slice(0, 16) + " (UTC)");
  lines.push("- المدة: " + minutes(report.durationMs));
  lines.push(`- الشرائح التي عُرضت: ${report.slidesVisited} من ${report.slideCount}` +
    (report.unvisited.length ? " — لم تُعرض: " + report.unvisited.slice(0, 30).join("، ") : ""));
  if (report.longest.length) lines.push("- أطول وقت: " + report.longest.map((x) => `شريحة ${x.index} (${minutes(x.ms)})`).join("، "));
  lines.push("");
  lines.push("## المشاهد البصرية");
  lines.push(`- عُرض ${report.scenes.shown} (تلقائي ${report.scenes.auto}، باعتماد المحاضر أو الذاكرة ${report.scenes.approved}، يدوي ${report.scenes.manual})، وتُجوهل ${report.scenes.declined}.`);
  for (const s of report.scenes.list) lines.push(`- شريحة ${s.slide}: ${s.type}${s.title ? " — " + s.title : ""}`);
  if (report.videos.length) { lines.push(""); lines.push("## الفيديو"); for (const v of report.videos) lines.push(`- شريحة ${v.slide} فيديو ${v.clip}: ${minutes(v.playedMs)} تشغيل`); }
  if (report.digressions) lines.push(`\n- الاستطرادات المسجلة: ${report.digressions}`);
  if (report.polls.length) {
    lines.push(""); lines.push("## التصويت (أعداد مجمعة)");
    for (const p of report.polls) {
      lines.push(`- ${p.question} — ${p.total} مشارك`);
      p.options.forEach((o, i) => lines.push(`  - ${o}: ${p.counts[i] ?? 0}` + (p.total ? ` (${Math.round(100 * (p.counts[i] ?? 0) / p.total)}%)` : "")));
    }
  }
  if (report.pendingQuestions !== null) lines.push(`\n- أسئلة الطلبة التي لم تُراجَع بعد: ${report.pendingQuestions}`);
  if (report.cloud && report.cloud.calls !== null) lines.push(`- طلبات السحابة اليوم: ${report.cloud.calls}` + (report.cloud.costUsd !== null ? ` — تقدير الكلفة $${Number(report.cloud.costUsd).toFixed(4)} (تقدير لا فاتورة)` : ""));
  lines.push("");
  lines.push("> هذا سجل لما حدث فقط، وليس تقييماً لمستوى فهم الطلبة أو جودة الشرح.");
  return lines.join("\n");
}
