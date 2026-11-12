// ALFA Presentation Engine: the single source of truth for what the students' screen shows.
// The lecturer's console publishes what it does; the engine keeps an audience-safe live state with a
// version that only grows, and every viewer (projector window, notes window, desktop host) gets a full
// snapshot on connect and ordered updates afterwards. Pure logic, no I/O: the server wires it to HTTP/SSE.
import { randomBytes } from "node:crypto";

// Only these message types ever reach a projector, and only these fields of each. Notes, slide text,
// tokens and anything else the console may hold are dropped here, not just hidden on screen.
const FIELDS = {
  slide: ["index", "step", "main", "emergency"],
  step: ["index", "step"],
  restore: ["index", "step", "main", "infographic", "poll", "cognitive", "videos"],
  cognitive: ["index", "step", "data"],
  infographic: ["spec"],
  "infographic-hide": [],
  "poll-projection": ["data"],
  video: ["index", "clip", "action", "time"],
  blackout: ["on"],
};
const BUNDLE = /^[a-zA-Z0-9_-]{4,64}$/;
const MAX_JSON = 64 * 1024;

export const isShowType = (type) => Object.hasOwn(FIELDS, type);

/** Keep only the allow-listed fields of an allow-listed message; null when it must not travel. */
export function sanitizeShowMessage(message) {
  if (!message || typeof message !== "object" || !isShowType(message.type)) return null;
  if (typeof message.bundle !== "string" || !BUNDLE.test(message.bundle)) return null;
  const out = { type: message.type, bundle: message.bundle };
  for (const key of FIELDS[message.type]) if (message[key] !== undefined) out[key] = message[key];
  if (JSON.stringify(out).length > MAX_JSON) return null;
  return out;
}

const int = (value) => Number.isSafeInteger(value) && value >= 0;

export function createPresentationEngine({ now = () => Date.now(), sessionId } = {}) {
  let session = sessionId || randomBytes(8).toString("hex");
  let version = 0;
  let live = null; // { bundle, index, step, main, overlay, poll, cognitive, videos: [{time, playing, at}], blackout }
  let lastAck = { version: 0, at: 0 };
  let ended = false;

  const fresh = (bundle) => ({ bundle, index: 1, step: 0, main: 1, overlay: null, poll: null, cognitive: null, videos: [], blackout: false });

  function reduce(m) {
    if (!live || live.bundle !== m.bundle) live = fresh(m.bundle);
    switch (m.type) {
      case "slide":
      case "restore": {
        if (!int(m.index) || m.index < 1) return false;
        const changed = m.index !== live.index;
        live.index = m.index;
        live.step = int(m.step) ? m.step : 0;
        if (int(m.main) && m.main >= 1) live.main = m.main;
        if (m.type === "restore") {
          live.overlay = m.infographic || null;
          live.poll = m.poll || null;
          live.cognitive = m.cognitive || null;
          live.videos = Array.isArray(m.videos) ? m.videos.map((v) => ({ time: Number(v?.time) || 0, playing: Boolean(v?.playing), at: now() })) : [];
        } else if (changed) { live.overlay = null; live.cognitive = null; live.videos = []; }
        return true;
      }
      case "step":
        if (m.index === live.index && int(m.step)) live.step = m.step;
        return true;
      case "cognitive":
        live.cognitive = m.data ?? null;
        return true;
      case "infographic":
        live.overlay = m.spec ?? null; live.cognitive = null;
        return true;
      case "infographic-hide":
        live.overlay = null;
        return true;
      case "poll-projection":
        live.poll = m.data ?? null;
        return true;
      case "video": {
        if (m.index !== live.index || !int(m.clip) || m.clip > 16) return true;
        const time = Number(m.time);
        while (live.videos.length <= m.clip) live.videos.push({ time: 0, playing: false, at: now() });
        const v = live.videos[m.clip];
        if (Number.isFinite(time) && time >= 0) v.time = time;
        v.at = now();
        if (m.action === "play") { live.videos.forEach((o, i) => { if (i !== m.clip) o.playing = false; }); v.playing = true; }
        if (m.action === "pause" || m.action === "ended") v.playing = false;
        return true;
      }
      case "blackout":
        live.blackout = Boolean(m.on);
        return true;
      default:
        return false;
    }
  }

  return {
    get session() { return session; },
    get version() { return version; },
    /** Accept a lecturer message. Returns the versioned update to fan out, or null when it is dropped. */
    publish(raw) {
      if (ended) { ended = false; session = randomBytes(8).toString("hex"); version = 0; live = null; }
      const m = sanitizeShowMessage(raw);
      if (!m || !reduce(m)) return null;
      version += 1;
      return { session, version, message: m };
    },
    /** A full "restore" packet: everything a late or reloaded projector needs, never notes. */
    snapshot() {
      if (!live) return { session, version, message: null };
      const t = now();
      const videos = live.videos.map((v) => ({ time: v.playing ? v.time + Math.max(0, t - v.at) / 1000 : v.time, playing: v.playing }));
      return { session, version, message: {
        type: "restore", bundle: live.bundle, index: live.index, step: live.step, main: live.main,
        infographic: live.overlay, poll: live.poll, cognitive: live.cognitive, videos, blackout: live.blackout,
      } };
    },
    ack(sessionSeen, versionSeen) {
      if (sessionSeen !== session || !int(versionSeen) || versionSeen > version) return false;
      if (versionSeen >= lastAck.version) lastAck = { version: versionSeen, at: now() };
      return true;
    },
    status() {
      return { session, version, ackedVersion: lastAck.version, ackAgeMs: lastAck.at ? now() - lastAck.at : null, bundle: live?.bundle ?? null, blackout: Boolean(live?.blackout) };
    },
    /** End of lecture: viewers are told, and the next publish opens a new session so stale messages cannot apply. */
    end() { ended = true; version += 1; return { session, version, message: { type: "session-end" } }; },
  };
}
