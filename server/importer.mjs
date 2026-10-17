// One-step authenticated PPTX upload and bundle compilation.
// Uses streaming upload, local tools and a child process; uploads never expose original PPTX over HTTP.
import { spawn } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const MAX_PPTX_BYTES = 150 * 1024 * 1024;

export function sanitizePptxName(input) {
  let name = "";
  try { name = decodeURIComponent(String(input || "")); } catch { return null; }
  name = basename(name.replaceAll("\\", "/")).replace(/[\u0000-\u001f]/g, "").trim();
  if (!name || name.length > 180 || !/\.pptx$/i.test(name)) return null;
  return name;
}

export async function streamPptx(req, destination, { maxBytes = MAX_PPTX_BYTES } = {}) {
  const announced = Number(req.headers?.["content-length"]);
  if (Number.isFinite(announced) && announced > maxBytes) {
    const err = new Error("حجم PowerPoint أكبر من المسموح"); err.status = 413; throw err;
  }
  let count = 0;
  const limit = new Transform({
    transform(chunk, enc, cb) {
      count += chunk.length;
      if (count > maxBytes) {
        const err = new Error("حجم PowerPoint أكبر من المسموح"); err.status = 413;
        cb(err);
      } else cb(null, chunk);
    }
  });
  try {
    await pipeline(req, limit, createWriteStream(destination, { flags: "wx", mode: 0o600 }));
  } catch (err) {
    await fs.rm(destination, { force: true }).catch(() => {});
    throw err;
  }
  if (count < 256) {
    const err = new Error("ملف PPTX غير صالح أو فارغ"); err.status = 400; throw err;
  }
  const handle = await fs.open(destination, "r");
  try {
    const header = Buffer.alloc(4);
    await handle.read(header, 0, 4, 0);
    if (header[0] !== 0x50 || header[1] !== 0x4b) {
      const err = new Error("الملف ليس PowerPoint PPTX صالحاً"); err.status = 400; throw err;
    }
  } finally { await handle.close(); }
  return count;
}

export async function runBundleBuild({ file, bundlesRoot, root, displayName, python = "python3", timeoutMs = 10 * 60 * 1000 }) {
  const args = [join(root, "tools", "build_bundle.py"), file, "--bundles", bundlesRoot, "--display-name", displayName];
  return new Promise((resolvePromise, reject) => {
    let log = "";
    let closed = false;
    const child = spawn(python, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    const timeout = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const collect = (data) => { log = (log + String(data)).slice(-8000); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => { if (!closed) { closed = true; clearTimeout(timeout); reject(error); } });
    child.on("close", async (code, signal) => {
      clearTimeout(timeout);
      if (closed) return;
      closed = true;
      if (code !== 0) {
        const err = new Error(signal === "SIGKILL"
          ? "انتهت مهلة تحويل PowerPoint"
          : "فشل تحويل PowerPoint. تحقق من LibreOffice وffmpeg والخطوط وسلامة الفيديو.");
        err.status = 422; err.detail = log.slice(-1200); return reject(err);
      }
      try {
        const registry = JSON.parse(await fs.readFile(join(bundlesRoot, "current.json"), "utf8"));
        const id = String(registry.id || "");
        if (!/^[a-f0-9]{12}$/.test(id)) throw new Error("Invalid bundle identifier");
        const location = resolve(bundlesRoot, id);
        if (!location.startsWith(resolve(bundlesRoot) + sep)) throw new Error("Invalid output location");
        const manifest = JSON.parse(await fs.readFile(join(location, "manifest.json"), "utf8"));
        resolvePromise({ id, title: manifest.source, slideCount: manifest.slideCount,
          animatedSlides: manifest.slides.filter((s) => s.hasAnimations).length,
          problems: manifest.problems || [] });
      } catch (error) { reject(error); }
    });
  });
}

export async function importLecture(req, { bundlesRoot, root, filename }) {
  const name = sanitizePptxName(filename);
  if (!name) { const err = new Error("اختر ملف PPTX صالحاً"); err.status = 400; throw err; }
  const dir = await fs.mkdtemp(join(tmpdir(), "alfa-pptx-"));
  try {
    const path = join(dir, "upload.pptx");
    await streamPptx(req, path);
    return await runBundleBuild({ file: path, bundlesRoot, root, displayName: name });
  } finally {
    await fs.rm(dir, { force: true, recursive: true }).catch(() => {});
  }
}
