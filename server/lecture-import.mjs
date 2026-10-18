// Authenticated PPTX import. Uploaded source is temporary and never served to students.
// Requires Python, python-pptx, LibreOffice, poppler and ffmpeg installed on the lecturer's Mac.
import { createWriteStream, existsSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, basename, dirname, delimiter } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const LIMIT = 80 * 1024 * 1024;
let busy = false;
const python = () => process.env.ALFA_PYTHON || "python3";
const prerequisites = ["python3", "soffice", "pdftoppm", "pdftotext", "pdfinfo", "ffmpeg", "ffprobe"];
function toolEnvironment() {
  const macSoffice = "/Applications/LibreOffice.app/Contents/MacOS/soffice";
  const pathExtra = process.platform === "darwin" && existsSync(macSoffice)
    ? delimiter + dirname(macSoffice) : "";
  return { ...process.env, PATH: (process.env.PATH || "") + pathExtra };
}
const isAllowed = (name) => /^[\p{L}\p{N}_ ().\-]{1,180}\.(?:pptx|pdf|key)$/iu.test(name);
export const lectureKind = (name) => name.toLowerCase().endsWith(".pdf") ? "pdf" : name.toLowerCase().endsWith(".key") ? "key" : "pptx";

export function lectureFileName(raw) {
  let name;
  try { name = decodeURIComponent(String(raw || "")); } catch { return null; }
  // Only file names, never paths. Some clients send full local paths.
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return null;
  return isAllowed(name) ? name : null;
}

export async function prerequisitesStatus() {
  const missing = [];
  for (const cmd of prerequisites) {
    try { await exec("which", [cmd], { timeout: 4000, env: toolEnvironment() }); }
    catch { missing.push(cmd); }
  }
  try { await exec(python(), ["-c", "import pptx, lxml, PIL"], { timeout: 10000, env: toolEnvironment() }); }
  catch { missing.push("python-pptx/lxml/Pillow"); }
  return { ready: missing.length === 0, missing };
}

async function receivePptx(req, path) {
  let size = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > LIMIT) return callback(Object.assign(new Error("حجم الملف يتجاوز 80 MB"), { status: 413 }));
      callback(null, chunk);
    }
  });
  await pipeline(req, limiter, createWriteStream(path, { flags: "wx", mode: 0o600 }));
  if (size < 100) throw Object.assign(new Error("الملف فارغ أو ليس PowerPoint صالحاً"), { status: 400 });
  const handle = await fs.open(path, "r");
  try {
    const first = Buffer.alloc(5);
    await handle.read(first, 0, 5, 0);
    const kind = lectureKind(path);
    const isZip = first.toString("hex").slice(0, 4) === "504b";
    const isPdf = first.toString("latin1") === "%PDF-";
    if ((kind === "pdf" && !isPdf) || (kind !== "pdf" && !isZip)) {
      throw Object.assign(new Error("محتوى الملف لا يطابق صيغته (" + kind.toUpperCase() + ")"), { status: 400 });
    }
  } finally { await handle.close(); }
}

export async function importLecture(req, { root, bundlesRoot }) {
  if (busy) throw Object.assign(new Error("توجد محاضرة قيد التحويل؛ انتظر اكتمالها"), { status: 409 });
  const filename = lectureFileName(req.headers["x-lecture-filename"]);
  if (!filename) throw Object.assign(new Error("اختر ملف PowerPoint أو PDF أو Keynote باسم صالح"), { status: 400 });
  const length = Number(req.headers["content-length"]);
  if (Number.isFinite(length) && length > LIMIT) throw Object.assign(new Error("حجم الملف أكبر من 80 MB"), { status: 413 });
  busy = true;
  let directory;
  try {
    const readiness = await prerequisitesStatus();
    if (!readiness.ready) throw Object.assign(new Error("أدوات الاستيراد غير متوفرة: " + readiness.missing.join(", ")), { status: 503 });
    directory = await fs.mkdtemp(join(tmpdir(), "alfa-import-"));
    const file = join(directory, filename);
    await receivePptx(req, file);
    const { stdout } = await exec(python(), [resolve(root, "tools/build_bundle.py"), file,
      "--bundles", bundlesRoot], { timeout: 12 * 60 * 1000, maxBuffer: 512 * 1024, env: toolEnvironment() });
    const produced = stdout.trim().split(/\r?\n/).at(-1);
    const id = basename(produced);
    if (!/^[a-f0-9]{12}$/.test(id)) throw new Error("لم يتم إنتاج حزمة محاضرة صحيحة");
    const manifest = JSON.parse(await fs.readFile(join(bundlesRoot, id, "manifest.json"), "utf8"));
    return { id, slides: manifest.slideCount,
      videoCount: manifest.slides.reduce((sum, s) => sum + (s.videos?.length || 0), 0),
      warningCount: (manifest.problems || []).length,
      problems: (manifest.problems || []).slice(0, 30) };
  } catch (error) {
    if (error.killed || error.code === "ETIMEDOUT") error.message = "استغرق تحويل المحاضرة وقتاً طويلاً. تأكد من الفيديوهات.";
    throw error;
  } finally {
    busy = false;
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
}
