// HTTP face of the ALFA Presentation Engine. Everything here is for this Mac only: the projector window,
// the notes window and the desktop host are local viewers. Phones, tunnels and proxies never reach it,
// even when ALFA_ALLOW_REMOTE_SLIDES opens the slide files to the LAN.
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createPresentationEngine } from "./presentation-engine.mjs";
import { requestOrigin } from "./security.mjs";

const ROLES = new Set(["audience", "notes", "host"]);
const ACTIONS = new Set(["start", "end", "change-display", "identify", "notes", "choose-display"]);
const BUNDLE = /^[a-zA-Z0-9_-]{4,64}$/;
const LOCAL_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;
const MAX_BODY = 96 * 1024;

/** The lecture as a projector needs it: images, videos and builds, never the lecturer's notes or source path. */
export function audienceManifest(manifest) {
  if (!manifest || !Array.isArray(manifest.slides)) return null;
  const { notes: _n, source: _s, problems: _p, ...rest } = manifest;
  return { ...rest, slides: manifest.slides.map(({ notes: _notes, text: _text, ...slide }) => slide) };
}

export function createShowRoutes({ bundlesRoot, now, heartbeatMs = 5000 } = {}) {
  const engine = createPresentationEngine({ now });
  const viewers = new Map([["audience", new Set()], ["notes", new Set()], ["host", new Set()]]);
  let lastControl = null;

  const write = (res, event, data, id) => {
    try { res.write((id !== undefined ? `id: ${id}\n` : "") + `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
  };
  const fanOut = (event, data, roles = ["audience", "notes"]) => {
    for (const role of roles) for (const res of viewers.get(role)) write(res, event, data, data.version);
  };
  const beat = setInterval(() => {
    for (const set of viewers.values()) for (const res of set) { try { res.write("event: heartbeat\ndata: {}\n\n"); } catch {} }
  }, heartbeatMs);
  beat.unref?.();

  function json(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  }
  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error("too large"), { status: 413 })); req.destroy(); } else chunks.push(c); });
      req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { reject(Object.assign(new Error("bad json"), { status: 400 })); } });
      req.on("error", reject);
    });
  }
  /** A write must come from this Mac's own pages: a custom header (forces a CORS preflight a web page cannot pass) and a local Origin. */
  function trustedWrite(req) {
    if (req.headers["x-alfa-show"] !== "1") return false;
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] || ""))) return false;
    const origin = req.headers.origin;
    return origin === undefined || LOCAL_ORIGIN.test(String(origin));
  }

  async function handle(req, res, path) {
    if (requestOrigin(req.socket.remoteAddress, req.headers) !== "local") return json(res, 403, { error: "local only" });
    const [, , , what, arg] = path.split("/"); // "", api, show, what, arg
    try {
      if (what === "events" && req.method === "GET") {
        const role = new URL(req.url, "http://x").searchParams.get("role");
        if (!ROLES.has(role)) return json(res, 400, { error: "role" });
        res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
        res.write("retry: 1000\n\n");
        viewers.get(role).add(res);
        if (role === "host") { if (lastControl) write(res, "control", lastControl); }
        else write(res, "snapshot", { ...engine.snapshot(), snapshot: true });
        req.on("close", () => viewers.get(role).delete(res));
        return;
      }
      if (what === "status" && req.method === "GET") {
        return json(res, 200, { alfa: true, ...engine.status(),
          viewers: Object.fromEntries([...viewers].map(([k, v]) => [k, v.size])) });
      }
      if (what === "audience-manifest" && req.method === "GET") {
        if (!BUNDLE.test(arg || "")) return json(res, 400, { error: "bundle" });
        const raw = JSON.parse(await fs.readFile(join(bundlesRoot, arg, "manifest.json"), "utf8"));
        const safe = audienceManifest(raw);
        return safe ? json(res, 200, safe) : json(res, 404, { error: "missing" });
      }
      if (req.method !== "POST") return json(res, 405, { error: "method" });
      if (!trustedWrite(req)) return json(res, 403, { error: "untrusted" });
      const body = await readJson(req);
      if (what === "publish") {
        const update = engine.publish(body?.message);
        if (!update) return json(res, 202, { dropped: true, version: engine.version });
        fanOut("update", update);
        return json(res, 200, { version: update.version, session: update.session });
      }
      if (what === "ack") return json(res, engine.ack(body?.session, body?.version) ? 200 : 409, engine.status());
      if (what === "resync") {
        const snap = { ...engine.snapshot(), snapshot: true };
        return json(res, 200, snap);
      }
      if (what === "control") {
        const action = body?.action;
        if (!ACTIONS.has(action)) return json(res, 400, { error: "action" });
        const displayId = Number.isSafeInteger(body?.displayId) ? body.displayId : undefined;
        lastControl = { action, displayId, at: Date.now() };
        if (action === "end") fanOut("update", engine.end());
        for (const res2 of viewers.get("host")) write(res2, "control", lastControl);
        return json(res, 200, { delivered: viewers.get("host").size });
      }
      return json(res, 404, { error: "unknown" });
    } catch (err) {
      if (err?.code === "ENOENT") return json(res, 404, { error: "missing" });
      return json(res, err?.status || 500, { error: err?.status ? err.message : "failed" });
    }
  }

  return { handle, engine, close() { clearInterval(beat); for (const set of viewers.values()) for (const res of set) { try { res.end(); } catch {} } } };
}
