// Survives a crash, reload or power cut: the stage position is saved every few seconds, and on the next
// start the lecturer can resume from it. Resuming never starts a video on its own.
const KEY = "alfa-resume-v1";
const MAX_AGE_MS = 6 * 3600 * 1000;
const storageOrNull = (custom) => { if (custom) return custom; try { return globalThis.localStorage || null; } catch { return null; } };

export function createResume({ bundle, storage: custom, now = () => Date.now() }) {
  const storage = storageOrNull(custom);
  return {
    save(snapshot) {
      if (!storage || !snapshot || !Number.isInteger(snapshot.index) || snapshot.index < 1) return;
      const videos = (Array.isArray(snapshot.videos) ? snapshot.videos : []).slice(0, 12).map((v) => ({ time: Number.isFinite(v?.time) && v.time >= 0 ? v.time : 0 }));
      try { storage.setItem(KEY, JSON.stringify({ bundle, savedAt: now(), index: snapshot.index, step: Number.isInteger(snapshot.step) ? snapshot.step : 0,
        videos, overlay: snapshot.overlay && typeof snapshot.overlay === "object" ? snapshot.overlay : null, poll: Boolean(snapshot.poll) })); } catch {}
    },
    /** A resumable snapshot for this lecture, or null (too old, other lecture, or nothing worth resuming). */
    pending() {
      try {
        const s = JSON.parse(storage?.getItem(KEY) || "null");
        if (!s || s.bundle !== bundle || !Number.isFinite(s.savedAt) || now() - s.savedAt > MAX_AGE_MS) return null;
        const meaningful = s.index > 1 || s.step > 0 || s.overlay || s.videos?.some((v) => v.time > 1);
        return meaningful ? { ...s, ageMs: now() - s.savedAt } : null;
      } catch { return null; }
    },
    /** Snapshot shaped for restoreStageState, with every video paused. */
    toStage(s) { return { index: s.index, step: s.step, overlay: s.overlay, poll: false, videos: (s.videos || []).map((v) => ({ time: v.time, playing: false })) }; },
    clear() { try { storage?.removeItem(KEY); } catch {} },
  };
}
