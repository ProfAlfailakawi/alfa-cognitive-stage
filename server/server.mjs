// Local server: serves the player (web/), lecture bundles (bundles/) and the voting API.
// HTTP Range requests are supported so video can seek.
import { createServer } from "node:http";
import { createReadStream, promises as fs } from "node:fs";
import { networkInterfaces } from "node:os";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { loadEnvFile } from "node:process";
import { analyzeWithAI, directorUsageStatus } from "./director-ai.mjs";
import { importLecture, prerequisitesStatus } from "./lecture-import.mjs";
import { createSceneStore, SceneStoreError } from "./scene-store.mjs";
import { allowedLectureClient, requestOrigin, studentSurfaceAllows } from "./security.mjs";
import { createServer as createSecureServer } from "node:https";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createVoteStore, VoteError } from "./votes.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
try { loadEnvFile(join(root, ".env")); } catch (err) { if (err.code !== "ENOENT") throw err; }
const webRoot = join(root, "web");
const bundlesRoot = resolve(process.env.ALFA_BUNDLES_DIR || join(root, "bundles"));
const port = Number(process.env.PORT || 4173);
const adminToken = process.env.ADMIN_TOKEN || randomBytes(16).toString("hex");
const store = createVoteStore({ file: process.env.VOTES_FILE || join(root, "data", "votes.json") });
const scenes = createSceneStore({ file: process.env.SCENES_FILE || join(root, "data", "scenes.json") });
const MAX_BODY = 4096;

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function safePath(base, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const full = resolve(join(base, normalize(decoded)));
  return full === base || full.startsWith(base + sep) ? full : null;
}

async function sendFile(req, res, file) {
  const stat = await fs.stat(file);
  const type = types[extname(file).toLowerCase()] || "application/octet-stream";
  const range = req.headers.range;
  res.setHeader("Content-Type", type);
  res.setHeader("Accept-Ranges", "bytes");
  const extension = extname(file).toLowerCase();
  const isLectureAsset = file.startsWith(bundlesRoot + sep);
  const cachePolicy = !isLectureAsset ? "no-cache"
    : [".mp4", ".webm"].includes(extension) ? "private, max-age=86400, immutable"
    : [".png", ".jpg"].includes(extension) ? "private, max-age=600"
    : "no-cache";
  res.setHeader("Cache-Control", cachePolicy);
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    let start = match && match[1] ? Number(match[1]) : 0;
    let end = match && match[2] ? Number(match[2]) : stat.size - 1;
    if (!match || (!match[1] && !match[2]) || start > end || end >= stat.size) {
      res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Content-Length": end - start + 1,
    });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { "Content-Length": stat.size });
  createReadStream(file).pipe(res);
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req, maxBody = MAX_BODY) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxBody) {
        tooLarge = true;
        chunks.length = 0;
        reject(new VoteError("الطلب كبير جداً", 413));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) return;
      try {
        resolveBody(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new VoteError("صيغة الطلب غير صحيحة"));
      }
    });
    req.on("error", reject);
  });
}

function isAdmin(req) {
  const given = Buffer.from(String(req.headers["x-admin-token"] || ""));
  const expected = Buffer.from(adminToken);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function requireAdmin(req) {
  if (!isAdmin(req)) throw new VoteError("غير مصرح", 401);
}

function voterToken(req) {
  return String(req.headers["x-voter-token"] || "");
}

async function handleApi(req, res, path) {
  const parts = path.split("/").filter(Boolean); // api, sessions, CODE, ...
  const [, resource, code, action, pollId, verb] = parts;
  if (resource === "memory" && code) {
    requireAdmin(req);
    try {
      if (code === "library") {
        if (req.method === "GET" && !action)
          return sendJson(res, 200, { scenes: scenes.listAll() });
        if (req.method === "DELETE" && !action) return sendJson(res, 200, scenes.clear(null));
        throw new SceneStoreError("مكتبة المشاهد العامة للقراءة فقط", 405);
      }
      if (req.method === "GET" && !action) return sendJson(res, 200, { scenes: scenes.list(code) });
      if (req.method === "POST" && !action) return sendJson(res, 201, { scene: scenes.save(code, await readBody(req)) });
      if (req.method === "DELETE" && action) return sendJson(res, 200, scenes.remove(code, action));
      if (req.method === "DELETE" && !action) return sendJson(res, 200, scenes.clear(code));
    } catch (err) {
      if (err instanceof SceneStoreError) return sendJson(res, err.status, { error: err.message });
      throw err;
    }
  }
  if (resource === "lectures" && code === "prerequisites" && req.method === "GET") {
    requireAdmin(req);
    return sendJson(res, 200, await prerequisitesStatus());
  }
  if (resource === "lectures" && code === "import" && req.method === "POST") {
    requireAdmin(req);
    try {
      const lecture = await importLecture(req, { root, bundlesRoot });
      return sendJson(res, 201, { ok: true, lecture });
    } catch (err) {
      // Upload errors are private to the lecturer; never expose command paths.
      console.error("PPTX import:", err);
      return sendJson(res, err.status || 500, { error:
        err.status ? err.message : "فشل تحويل الملف؛ راجع Terminal للتحقق من LibreOffice والوسائط" });
    }
  }
  if (resource === "network" && req.method === "GET") {
    const addresses = Object.values(networkInterfaces()).flat().filter(Boolean)
      .filter((x) => x.family === "IPv4" && !x.internal);
    const preferred = addresses.find((x) => /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(x.address));
    const ip = (preferred || addresses[0])?.address || null;
    const publicUrl = process.env.PUBLIC_URL || (ip ? (tls ? "https://" : "http://") + ip + ":" + port : null);
    return sendJson(res, 200, { publicUrl });
  }
  if (resource === "director" && code === "status" && req.method === "GET") {
    requireAdmin(req);
    return sendJson(res, 200, directorUsageStatus());
  }
  if (resource === "director" && code === "analyze" && req.method === "POST") {
    requireAdmin(req);
    try { return sendJson(res, 200, await analyzeWithAI(await readBody(req, 12000))); }
    catch (err) { return sendJson(res, err.status || 502, { error: err.message || "تعذر تحليل الكلام" }); }
  }
  if (resource === "admin" && code === "check" && req.method === "GET") {
    requireAdmin(req);
    return sendJson(res, 200, { ok: true });
  }
  if (resource !== "sessions") throw new VoteError("غير موجود", 404);

  if (!code && req.method === "POST") {
    requireAdmin(req);
    return sendJson(res, 201, { code: store.createSession() });
  }
  if (!code) throw new VoteError("غير موجود", 404);
  const upper = code.toUpperCase();
  if (!store.hasSession(upper)) throw new VoteError("الجلسة غير موجودة", 404);

  if (action === "questions") {
    if (req.method === "POST" && !pollId) {
      const body = await readBody(req);
      return sendJson(res, 201, { ok: true, ...store.submitQuestion(upper, voterToken(req), body.text) });
    }
    if (req.method === "GET" && !pollId) {
      requireAdmin(req);
      return sendJson(res, 200, { questions: store.listQuestions(upper) });
    }
    if (req.method === "DELETE" && pollId) {
      requireAdmin(req);
      return sendJson(res, 200, store.dismissQuestion(upper, Number(pollId)));
    }
  }
  if (action === "state" && req.method === "GET") {
    return sendJson(res, 200, store.studentState(upper, voterToken(req)));
  }
  if (action === "vote" && req.method === "POST") {
    const body = await readBody(req);
    const result = store.vote(upper, voterToken(req), body.option);
    return sendJson(res, 200, { ok: true, ...result });
  }
  if (action === "presenter" && req.method === "GET") {
    requireAdmin(req);
    return sendJson(res, 200, store.presenterState(upper));
  }
  if (action === "polls" && req.method === "POST" && !pollId) {
    requireAdmin(req);
    const poll = store.createPoll(upper, await readBody(req));
    return sendJson(res, 201, { poll });
  }
  if (action === "polls" && pollId && req.method === "POST") {
    requireAdmin(req);
    if (verb === "repeat") return sendJson(res, 201, { poll: store.repeatPoll(upper, Number(pollId)) });
    const id = Number(pollId);
    if (verb === "open") return sendJson(res, 200, { poll: store.setStatus(upper, id, "open") });
    if (verb === "close") return sendJson(res, 200, { poll: store.setStatus(upper, id, "closed") });
    if (verb === "reveal") return sendJson(res, 200, { poll: store.setReveal(upper, id, true) });
    if (verb === "hide") return sendJson(res, 200, { poll: store.setReveal(upper, id, false) });
  }
  throw new VoteError("غير موجود", 404);
}

const handler = async (req, res) => {
  try {
    const path = new URL(req.url, "http://x").pathname;
    // Remote clients (phones, tunnels, proxies) only ever see the student surface, even with a valid token.
    if (requestOrigin(req.socket.remoteAddress, req.headers) === "remote" &&
        process.env.ALFA_ALLOW_REMOTE_SLIDES !== "1" && !studentSurfaceAllows(req.method, path)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      return res.end("هذه الصفحة متاحة على جهاز المحاضر فقط");
    }
    if (path.startsWith("/api/")) return await handleApi(req, res, path);
    const isBundle = path.startsWith("/bundles/");
    if (isBundle && !allowedLectureClient(req.socket.remoteAddress,
        process.env.ALFA_ALLOW_REMOTE_SLIDES === "1")) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("ملفات المحاضرة متاحة على جهاز المحاضر فقط");
    }
    const file = isBundle
      ? safePath(bundlesRoot, path.slice("/bundles/".length))
      : safePath(webRoot, path === "/" ? "/index.html" : path);
    if (!file) {
      res.writeHead(403);
      return res.end();
    }
    await sendFile(req, res, file);
  } catch (err) {
    if (err instanceof VoteError) return sendJson(res, err.status, { error: err.message });
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("غير موجود");
  }
};
// Optional HTTPS for the LAN (e.g. a mkcert certificate): ALFA_TLS_KEY and ALFA_TLS_CERT file paths.
let tls = null;
if (process.env.ALFA_TLS_KEY && process.env.ALFA_TLS_CERT) {
  const { readFileSync } = await import("node:fs");
  tls = { key: readFileSync(process.env.ALFA_TLS_KEY), cert: readFileSync(process.env.ALFA_TLS_CERT) };
}
const server = tls ? createSecureServer(tls, handler) : createServer(handler);

server.listen(port, () => {
  console.log(`ALFA Cognitive Stage على ${tls ? "https" : "http"}://localhost:${port}`);
  if (!process.env.ADMIN_TOKEN) console.log(`رمز المحاضر (لا تشاركه): ${adminToken}`);
});

export { server, adminToken };
