// Remote (phone/tunnel/proxy) requests may only use the student surface; HTTPS is optional.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { requestOrigin, studentSurfaceAllows } from "../server/security.mjs";

// ---- classification ----
assert.equal(requestOrigin("127.0.0.1", { host: "localhost:4173" }), "local");
assert.equal(requestOrigin("::1", { host: "127.0.0.1:4173" }), "local");
assert.equal(requestOrigin("::ffff:127.0.0.1", {}), "local");
assert.equal(requestOrigin("192.168.1.20", { host: "192.168.1.5:4173" }), "remote");
assert.equal(requestOrigin("127.0.0.1", { host: "localhost:4173", "x-forwarded-for": "1.2.3.4" }), "remote", "a tunnel on this Mac");
assert.equal(requestOrigin("127.0.0.1", { host: "abc.trycloudflare.com" }), "remote", "tunnel host name / DNS rebinding");
assert.equal(requestOrigin("127.0.0.1", { host: "localhost.evil.com" }), "remote");
assert.equal(requestOrigin("127.0.0.1", { host: "localhost:4173", "cf-connecting-ip": "9.9.9.9" }), "remote");
assert.equal(requestOrigin("127.0.0.1", { host: "localhost:4173", via: "1.1 proxy" }), "remote");
for (const [method, path, ok] of [
  ["GET", "/vote.html", true], ["GET", "/vote.js", true], ["GET", "/style.css", true],
  ["GET", "/fonts/cairo-arabic-400-normal.woff2", true],
  ["GET", "/api/sessions/ABC234/state", true], ["POST", "/api/sessions/ABC234/vote", true],
  ["POST", "/api/sessions/ABC234/questions", true], ["GET", "/api/sessions/ABC234/questions", false],
  ["GET", "/", false], ["GET", "/app.js", false], ["GET", "/index.html", false], ["GET", "/bundles/x/manifest.json", false],
  ["GET", "/api/sessions/ABC234/presenter", false], ["POST", "/api/sessions", false], ["DELETE", "/api/sessions/ABC234/questions/1", false],
  ["GET", "/api/memory/library", false], ["GET", "/api/local-token", false],
  ["POST", "/api/lectures/import", false], ["GET", "/api/admin/check", false], ["GET", "/vote-admin.html", false],
  ["GET", "/fonts/../server/server.mjs", false],
]) assert.equal(studentSurfaceAllows(method, path), ok, method + " " + path);

// ---- live server ----
const root = fileURLToPath(new URL("..", import.meta.url));
const ADMIN = "remote-surface-token-0123456789";
const scratch = mkdtempSync(join(tmpdir(), "alfa-remote-"));
const start = (port, extra = {}) => {
  const child = spawn(process.execPath, [join(root, "server/server.mjs")], {
    env: { ...process.env, PORT: String(port), ADMIN_TOKEN: ADMIN, VOTES_FILE: join(scratch, "v" + port + ".json"),
      SCENES_FILE: join(scratch, "s" + port + ".json"), ...extra }, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve) => child.stdout.once("data", () => resolve(child)));
};
const call = (port, { path = "/", method = "GET", headers = {}, https = false, body } = {}) => new Promise((resolve, reject) => {
  const lib = https ? httpsRequest : httpRequest;
  const req = lib({ host: "127.0.0.1", port, path, method, headers, rejectUnauthorized: false }, (res) => {
    let data = ""; res.on("data", (c) => data += c); res.on("end", () => resolve({ status: res.statusCode, body: data }));
  });
  req.on("error", reject); if (body) req.write(body); req.end();
});
let server, secure;
try {
  server = await start(4291);
  const local = { host: "localhost:4291" };
  assert.equal((await call(4291, { path: "/", headers: local })).status, 200, "the lecturer's own page works");
  const created = JSON.parse((await call(4291, { path: "/api/sessions", method: "POST", headers: { ...local, "x-admin-token": ADMIN } })).body);
  assert.match(created.code, /^[A-Z2-9]{6}$/);
  // A tunnel forwards phone traffic from 127.0.0.1 with proxy headers: only the student surface is reachable.
  const tunnel = { host: "classroom.example.org", "x-forwarded-for": "5.6.7.8" };
  for (const path of ["/", "/app.js", "/index.html", "/bundles/current.json", "/api/lectures/prerequisites", "/api/memory/library",
    "/api/director/status", "/api/admin/check", "/vote-admin.html", "/api/network"]) {
    const r = await call(4291, { path, headers: { ...tunnel, "x-admin-token": ADMIN } });
    assert.equal(r.status, 403, path + " must not be reachable through a tunnel, even with a valid lecturer token");
  }
  assert.equal((await call(4291, { path: "/vote.html", headers: tunnel })).status, 200);
  const state = await call(4291, { path: `/api/sessions/${created.code}/state`, headers: tunnel });
  assert.equal(state.status, 200);
  assert.equal((await call(4291, { path: `/api/sessions/${created.code}/presenter`, headers: { ...tunnel, "x-admin-token": ADMIN } })).status, 403,
    "presenter state (with notes/results) is not a student route");
  assert.equal((await call(4291, { path: `/api/sessions/${created.code}/questions`, headers: { ...tunnel, "x-admin-token": ADMIN } })).status, 403,
    "reading the question inbox is lecturer-only, locally");
  // Host header that is not localhost (DNS rebinding) is treated as remote even from the loopback.
  assert.equal((await call(4291, { path: "/api/admin/check", headers: { host: "evil.example", "x-admin-token": ADMIN } })).status, 403);
  assert.equal((await call(4291, { path: "/api/admin/check", headers: { ...local, "x-admin-token": ADMIN } })).status, 200);

  // ---- optional HTTPS ----
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(scratch, "k.pem"), "-out", join(scratch, "c.pem"),
    "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });
  secure = await start(4292, { ALFA_TLS_KEY: join(scratch, "k.pem"), ALFA_TLS_CERT: join(scratch, "c.pem") });
  const tls = await call(4292, { path: "/vote.html", https: true, headers: { host: "localhost:4292" } });
  assert.equal(tls.status, 200, "server speaks HTTPS when a certificate is configured");
  console.log("remote surface: tunnels/proxies/rebinding see only the student surface; local lecturer unaffected; optional HTTPS works");
} finally {
  server?.kill(); secure?.kill(); rmSync(scratch, { recursive: true, force: true });
}
