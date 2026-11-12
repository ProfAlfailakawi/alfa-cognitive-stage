// Browser side of the ALFA Presentation Engine (server/presentation-engine.mjs).
// The console publishes what it does, in order; the projector and notes windows subscribe, apply
// versioned updates through a gate, acknowledge what they show, and resynchronise after any gap.
import { createVersionGate } from "./show-gate.js";

const SHOW_TYPES = new Set(["slide", "step", "restore", "cognitive", "infographic", "infographic-hide", "poll-projection", "video", "blackout"]);
const HEADERS = { "content-type": "application/json", "x-alfa-show": "1" };
const post = (path, body) => fetch("/api/show/" + path, { method: "POST", headers: HEADERS, body: JSON.stringify(body), keepalive: true });

/** Console: one request at a time so the engine receives commands in the order they happened. */
export function createEnginePublisher() {
  let chain = Promise.resolve();
  let healthy = true;
  return {
    publish(message) {
      if (!message || !SHOW_TYPES.has(message.type)) return;
      chain = chain.then(() => post("publish", { message })
        .then((r) => { healthy = r.ok || r.status === 202; })
        .catch(() => { healthy = false; }));
    },
    get healthy() { return healthy; },
  };
}

export async function engineStatus() {
  try { const r = await fetch("/api/show/status", { cache: "no-store" }); return r.ok ? await r.json() : null; } catch { return null; }
}
export async function engineControl(action, displayId) {
  try { const r = await post("control", { action, ...(Number.isSafeInteger(displayId) ? { displayId } : {}) }); return r.ok ? await r.json() : null; } catch { return null; }
}

/**
 * Projector / notes: follow the engine. `apply(message)` receives restore/slide/... packets exactly as the
 * BroadcastChannel path delivers them; `onEnd()` runs when the lecture ends; `onLink(ok)` reports the link.
 */
export function connectViewer({ role, apply, onEnd = () => {}, onLink = () => {} }) {
  const gate = createVersionGate();
  let source = null, closed = false, ackTimer = null, watchdog = null, lastSeen = Date.now();
  const resync = async () => {
    try {
      const r = await post("resync", {});
      if (r.ok) handle(await r.json());
    } catch {}
  };
  const handle = (update) => {
    lastSeen = Date.now();
    const verdict = gate.accept(update);
    if (verdict === "resync") { resync(); return; }
    if (verdict !== "apply" || !update.message) return;
    if (update.message.type === "session-end") { onEnd(); return; }
    try { apply(update.message); } catch {}
  };
  const open = () => {
    if (closed) return;
    source = new EventSource(`/api/show/events?role=${encodeURIComponent(role)}`);
    for (const name of ["snapshot", "update"]) source.addEventListener(name, (event) => {
      try { handle(JSON.parse(event.data)); } catch {}
    });
    source.addEventListener("heartbeat", () => { lastSeen = Date.now(); });
    source.onopen = () => { lastSeen = Date.now(); onLink(true); };
    source.onerror = () => onLink(false); // EventSource reconnects by itself; the server sends a fresh snapshot
  };
  open();
  if (role === "audience") ackTimer = setInterval(() => {
    const { session, version } = gate.state;
    if (session) post("ack", { session, version }).catch(() => {});
  }, 2000);
  // The server sends a heartbeat every few seconds; silence means a dead link that the browser has not noticed.
  watchdog = setInterval(() => {
    if (Date.now() - lastSeen > 15000 && source) { source.close(); onLink(false); lastSeen = Date.now(); open(); }
  }, 5000);
  return { close() { closed = true; source?.close(); clearInterval(ackTimer); clearInterval(watchdog); }, get state() { return gate.state; } };
}
