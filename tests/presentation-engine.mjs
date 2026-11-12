// ALFA Presentation Engine: state, versions, privacy and the local-only HTTP/SSE face.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPresentationEngine, sanitizeShowMessage } from "../server/presentation-engine.mjs";
import { createShowRoutes, audienceManifest } from "../server/show-routes.mjs";
import { createVersionGate } from "../web/show-gate.js";

let clock = 1_000_000;
const now = () => clock;
const B = "lecture01";

// 1. Privacy: only allow-listed types and fields travel.
assert.equal(sanitizeShowMessage({ type: "notes", bundle: B, notes: "secret" }), null);
assert.equal(sanitizeShowMessage({ type: "hello", bundle: B }), null, "viewer chatter is not state");
assert.deepEqual(sanitizeShowMessage({ type: "slide", bundle: B, index: 2, step: 0, main: 2, notes: "secret", token: "x" }),
  { type: "slide", bundle: B, index: 2, step: 0, main: 2 });
assert.equal(sanitizeShowMessage({ type: "slide", bundle: "../etc", index: 2 }), null);
const m = audienceManifest({ id: B, source: "/Users/x/a.pptx", problems: ["p"], slides: [{ index: 1, image: "slides/001.png", notes: "secret", text: "t", videos: [] }] });
assert.equal(JSON.stringify(m).includes("secret"), false); assert.equal(m.source, undefined); assert.equal(m.slides[0].image, "slides/001.png");

// 2. Engine: versions only grow; snapshot carries everything a late projector needs.
const e = createPresentationEngine({ now, sessionId: "s1" });
assert.equal(e.publish({ type: "slide", bundle: B, index: 3, step: 1, main: 3 }).version, 1);
e.publish({ type: "infographic", bundle: B, spec: { type: "stat", title: "t", lines: ["40%"] } });
e.publish({ type: "blackout", bundle: B, on: true });
let snap = e.snapshot().message;
assert.equal(snap.type, "restore"); assert.equal(snap.index, 3); assert.equal(snap.step, 1);
assert.equal(snap.infographic.lines[0], "40%"); assert.equal(snap.blackout, true);
e.publish({ type: "slide", bundle: B, index: 4, step: 0, main: 4 });
snap = e.snapshot().message;
assert.equal(snap.infographic, null, "a new slide clears the scene"); assert.equal(snap.blackout, true, "blackout survives a slide change");
// A playing video is restored where it is now, not where it was announced.
e.publish({ type: "video", bundle: B, index: 4, clip: 0, action: "play", time: 10 });
clock += 5000;
assert.ok(Math.abs(e.snapshot().message.videos[0].time - 15) < 0.01);
e.publish({ type: "video", bundle: B, index: 4, clip: 0, action: "pause", time: 15.5 });
clock += 5000;
assert.equal(e.snapshot().message.videos[0].time, 15.5);
assert.equal(e.snapshot().message.videos[0].playing, false);
// Acks.
assert.equal(e.ack("other", 1), false); assert.equal(e.ack("s1", 999), false); assert.equal(e.ack("s1", e.version), true);
assert.equal(e.status().ackedVersion, e.version);
// End: the next lecture is a new session, so stale packets cannot apply.
const end = e.end(); assert.equal(end.message.type, "session-end");
const next = e.publish({ type: "slide", bundle: B, index: 1, step: 0, main: 1 });
assert.notEqual(next.session, "s1"); assert.equal(next.version, 1);

// 3. Viewer gate: duplicates and late packets never step back; gaps and foreign sessions ask for a snapshot.
const g = createVersionGate();
assert.equal(g.accept({ session: "a", version: 5 }), "resync", "no snapshot yet");
assert.equal(g.accept({ session: "a", version: 5, snapshot: true }), "apply");
assert.equal(g.accept({ session: "a", version: 6 }), "apply");
assert.equal(g.accept({ session: "a", version: 6 }), "drop", "duplicate");
assert.equal(g.accept({ session: "a", version: 4 }), "drop", "out of order");
assert.equal(g.accept({ session: "a", version: 9 }), "resync", "gap");
assert.equal(g.accept({ session: "a", version: 9, snapshot: true }), "apply");
assert.equal(g.accept({ session: "a", version: 8, snapshot: true }), "drop", "an older snapshot is ignored");
assert.equal(g.accept({ session: "b", version: 1 }), "resync", "a new session needs its snapshot");
assert.equal(g.accept({ session: "b", version: 1, snapshot: true }), "apply");

// 4. HTTP/SSE: local only, writes need the custom header, viewers get a snapshot first.
const root = mkdtempSync(join(tmpdir(), "alfa-show-"));
mkdirSync(join(root, B));
writeFileSync(join(root, B, "manifest.json"), JSON.stringify({ id: B, slides: [{ index: 1, image: "slides/001.png", notes: "سري", text: "x" }] }));
const routes = createShowRoutes({ bundlesRoot: root, heartbeatMs: 200 });
const srv = createServer((req, res) => { const path = new URL(req.url, "http://x").pathname; if (path.startsWith("/api/show/")) routes.handle(req, res, path); else { res.writeHead(404); res.end(); } });
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${srv.address().port}/api/show`;
const post = (p, body, headers = { "content-type": "application/json", "x-alfa-show": "1" }) => fetch(base + p, { method: "POST", headers, body: JSON.stringify(body) });
assert.equal((await post("/publish", { message: { type: "slide", bundle: B, index: 2, step: 0, main: 2 } }, { "content-type": "text/plain" })).status, 403, "a web page's simple POST is refused");
assert.equal((await post("/publish", { message: { type: "slide", bundle: B, index: 2, step: 0, main: 2 } }, { "content-type": "application/json", "x-alfa-show": "1", origin: "https://evil.example" })).status, 403);
assert.equal((await fetch(base + "/status", { headers: { "x-forwarded-for": "10.0.0.5" } })).status, 403, "proxied requests are remote");
assert.equal((await post("/publish", { message: { type: "slide", bundle: B, index: 2, step: 0, main: 2, notes: "سري" } })).status, 200);
const am = await (await fetch(base + "/audience-manifest/" + B)).text();
assert.equal(am.includes("سري"), false, "audience manifest has no notes");
assert.equal((await fetch(base + "/audience-manifest/..%2Fx")).status, 400);
// SSE: snapshot first, then the next update, nothing private.
const ctrl = new AbortController();
const resp = await fetch(base + "/events?role=audience", { signal: ctrl.signal });
const reader = resp.body.getReader();
let text = "";
const readUntil = async (needle) => { while (!text.includes(needle)) { const { value } = await reader.read(); text += new TextDecoder().decode(value); } };
await readUntil("event: snapshot");
await post("/publish", { message: { type: "step", bundle: B, index: 2, step: 1 } });
await readUntil("event: update");
assert.equal(text.includes("سري"), false, "no notes on the wire");
assert.ok(/"snapshot":true/.test(text));
const status = await (await fetch(base + "/status")).json();
assert.equal(status.viewers.audience, 1); assert.equal(status.alfa, true);
ctrl.abort();
routes.close(); srv.close();
console.log("presentation engine: privacy, versions, snapshot, gate and local-only HTTP/SSE passed");
