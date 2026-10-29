// Server hardening: traversal, headers, secrets, hostile bodies, damaged data files.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { request } from "node:http";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const ADMIN = "hardening-admin-token-0123456789", KEY = "sk-test-SECRET-KEY-DO-NOT-LEAK-123456";
const scratch = mkdtempSync(join(tmpdir(), "alfa-hard-"));
const votes = join(scratch, "votes.json");
writeFileSync(votes, "{ this is not json");
const start = (port) => new Promise((resolve) => {
  const child = spawn(process.execPath, [join(root, "server/server.mjs")], { env: { ...process.env, PORT: String(port), ADMIN_TOKEN: ADMIN,
    OPENAI_API_KEY: KEY, VOTES_FILE: votes, SCENES_FILE: join(scratch, "s.json"), LIBRARY_FILE: join(scratch, "l.json"),
    ALFA_BUNDLES_DIR: join(scratch, "bundles"), DIRECTOR_USAGE_FILE: join(scratch, "usage.json") }, stdio: ["ignore", "pipe", "pipe"] });
  let err = ""; child.stderr.on("data", (b) => { err += b; });
  child.stdout.once("data", () => resolve({ child, errors: () => err }));
});
const call = (port, { path = "/", method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = request({ host: "127.0.0.1", port, path, method, headers: { host: "localhost:" + port, ...headers } }, (res) => {
    const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
  });
  req.on("error", reject); if (body !== undefined) req.write(body); req.end();
});
let server;
try {
  server = await start(4295);
  const p = 4295;
  // ---- a damaged votes file does not crash the server and is kept aside, not overwritten ----
  assert.ok(readdirSync(scratch).some((f) => f.startsWith("votes.json.damaged-")), "the damaged file is preserved");
  assert.equal((await call(p, { path: "/api/admin/check", headers: { "x-admin-token": ADMIN } })).status, 200);
  // ---- headers ----
  const page = await call(p, { path: "/" });
  const h = page.headers;
  assert.match(h["content-security-policy"], /default-src 'self'/);
  assert.match(h["content-security-policy"], /object-src 'none'/);
  assert.equal(h["x-content-type-options"], "nosniff");
  assert.equal(h["referrer-policy"], "no-referrer");
  assert.equal(h["x-frame-options"], "SAMEORIGIN");
  assert.ok(!/unsafe-inline/.test(h["content-security-policy"].match(/script-src[^;]*/)[0]), "scripts are never inline");
  assert.match(h["content-security-policy"].match(/connect-src[^;]*/)[0], /^connect-src 'self' https:\/\/orbitq8\.web\.app$/, "connect-src allows only self and the Orbit origin");
  assert.equal((await call(p, { path: "/api/admin/check" })).headers["x-content-type-options"], "nosniff", "API responses are hardened too");
  // ---- traversal and odd paths never reach files outside web/ or bundles/ ----
  for (const path of ["/../server/server.mjs", "/..%2fserver/server.mjs", "/%2e%2e/server/server.mjs", "/..%5cserver%5cserver.mjs", "/bundles/../../server/server.mjs",
    "/bundles/..%2f..%2fserver/server.mjs", "/%00.html", "//etc/passwd", "/.env", "/data/votes.json", "/package.json", "/tools/build_bundle.py", "/server/votes.mjs", "/.git/config"]) {
    const r = await call(p, { path });
    assert.ok([403, 404].includes(r.status) || r.status === 400, path + " -> " + r.status);
    assert.ok(!r.body.includes("createServer") && !r.body.includes("OPENAI") && !r.body.includes("[core]"), path + " leaked content");
  }
  // ---- a folder path is a plain 404 and never stops the server (any page in the lecturer's browser can request one) ----
  for (const path of ["/fonts/", "/fonts", "/vendor/", "/fonts/%2e"]) {
    assert.equal((await call(p, { path })).status, 404, path + " is a folder, not a file");
  }
  assert.equal((await call(p, { path: "/api/admin/check", headers: { "x-admin-token": ADMIN } })).status, 200, "the server is still up after folder requests");
  // ---- the lecturer's token is handed only to this machine's own same-origin page (nothing to type, nothing for a phone) ----
  const own = await call(p, { path: "/api/local-token", headers: { "sec-fetch-site": "same-origin" } });
  assert.equal(own.status, 200); assert.equal(JSON.parse(own.body).token, ADMIN);
  assert.equal((await call(p, { path: "/api/local-token" })).status, 200, "a direct local request (no fetch metadata) works too");
  assert.equal((await call(p, { path: "/api/local-token", headers: { "sec-fetch-site": "cross-site" } })).status, 403, "another website in the lecturer's browser cannot read it");
  assert.equal((await call(p, { path: "/api/local-token", headers: { "sec-fetch-site": "same-site" } })).status, 403);
  assert.equal((await call(p, { path: "/api/local-token", headers: { "x-forwarded-for": "5.6.7.8" } })).status, 403, "a tunnel cannot read it");
  assert.equal((await call(p, { path: "/api/local-token", headers: { host: "classroom.example.org" } })).status, 403, "a LAN/other host name cannot read it");
  assert.equal((await call(p, { path: "/api/local-token", method: "POST" })).status === 200, false);
  // ---- the API key never appears in any response ----
  const created = JSON.parse((await call(p, { path: "/api/sessions", method: "POST", headers: { "x-admin-token": ADMIN } })).body);
  const everything = [];
  for (const [path, headers] of [["/api/admin/check", { "x-admin-token": ADMIN }], ["/api/library", { "x-admin-token": ADMIN }], ["/api/data/summary", { "x-admin-token": ADMIN }],
    ["/api/network", {}], ["/api/memory/library", { "x-admin-token": ADMIN }], ["/api/lectures/prerequisites", { "x-admin-token": ADMIN }],
    [`/api/sessions/${created.code}/presenter`, { "x-admin-token": ADMIN }], [`/api/sessions/${created.code}/state`, {}], ["/nonexistent", {}], ["/api/nonexistent", {}]]) {
    const r = await call(p, { path, headers }); everything.push(r.body + JSON.stringify(r.headers));
  }
  assert.ok(!everything.join("\n").includes(KEY) && !everything.join("\n").includes("SECRET"), "the API key is never reflected");
  // ---- authorisation: wrong, empty, short and long tokens ----
  for (const token of ["", "x", ADMIN.slice(0, -1), ADMIN + "x", "A".repeat(5000)]) {
    assert.equal((await call(p, { path: "/api/admin/check", headers: { "x-admin-token": token } })).status, 401, "token: " + token.slice(0, 10));
  }
  // ---- hostile bodies ----
  const big = await call(p, { path: `/api/sessions/${created.code}/questions`, method: "POST", headers: { "content-type": "application/json", "x-voter-token": "ab".repeat(16) }, body: JSON.stringify({ text: "x".repeat(100000) }) });
  assert.equal(big.status, 413, "oversized bodies are cut off");
  const bad = await call(p, { path: `/api/sessions/${created.code}/vote`, method: "POST", headers: { "content-type": "application/json", "x-voter-token": "ab".repeat(16) }, body: "{not json" });
  assert.equal(bad.status, 400);
  for (const body of ['{"option":"__proto__"}', '{"__proto__":{"polluted":true}}', '{"option":{"$gt":0}}', "[]", "null", '"string"']) {
    const r = await call(p, { path: `/api/sessions/${created.code}/vote`, method: "POST", headers: { "content-type": "application/json", "x-voter-token": "ab".repeat(16) }, body });
    assert.ok([400, 409].includes(r.status), body + " -> " + r.status);
  }
  assert.equal(({}).polluted, undefined, "no prototype pollution in this process");
  assert.equal((await call(p, { path: "/api/sessions/ZZZZZZ/state" })).status, 404);
  assert.equal((await call(p, { path: "/api/sessions/<script>/state" })).status, 404);
  // ---- upload filename and path inputs ----
  for (const name of ["../../evil.pptx", "a%0d%0aX-Injected: 1.pptx", "con.pptx%00.exe", "x".repeat(400) + ".pptx"]) {
    const r = await call(p, { path: "/api/lectures/import", method: "POST", headers: { "x-admin-token": ADMIN, "x-lecture-filename": name }, body: "PK\u0003\u0004" });
    assert.equal(r.status, 400, name.slice(0, 20));
  }
  assert.equal((await call(p, { path: "/api/lectures/..%2f..%2fetc", method: "DELETE", headers: { "x-admin-token": ADMIN } })).status, 400);
  assert.equal((await call(p, { path: "/api/memory/..%2f..%2fx", method: "DELETE", headers: { "x-admin-token": ADMIN } })).status >= 400, true);
  assert.equal(server.errors().includes("TypeError"), false, "hostile input never crashes a handler: " + server.errors().slice(0, 300));
  console.log("hardening: headers/CSP, traversal, key non-disclosure, token and body abuse, damaged data file passed");
} finally { server?.child.kill(); rmSync(scratch, { recursive: true, force: true }); }
