// Local server: serves the player (web/) and lecture bundles (bundles/).
// Supports HTTP Range requests so video can seek.
import { createServer } from "node:http";
import { createReadStream, promises as fs } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const webRoot = join(root, "web");
const bundlesRoot = join(root, "bundles");
const port = Number(process.env.PORT || 4173);

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
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
  res.setHeader("Cache-Control", "no-cache");
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

const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://x").pathname;
    const isBundle = path.startsWith("/bundles/");
    const file = isBundle
      ? safePath(bundlesRoot, path.slice("/bundles/".length))
      : safePath(webRoot, path === "/" ? "/index.html" : path);
    if (!file) {
      res.writeHead(403);
      return res.end();
    }
    await sendFile(req, res, file);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("غير موجود");
  }
});

server.listen(port, () => {
  console.log(`ALFA Cognitive Stage على http://localhost:${port}`);
});

export { server };
