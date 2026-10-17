import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_PPTX_BYTES, sanitizePptxName, streamPptx } from "../server/importer.mjs";

assert.equal(sanitizePptxName(encodeURIComponent("محاضرة الألعاب التعليمية.pptx")), "محاضرة الألعاب التعليمية.pptx");
assert.equal(sanitizePptxName("../lecture.pptx"), "lecture.pptx");
assert.equal(sanitizePptxName("bad.pdf"), null);
assert.equal(sanitizePptxName("bad.pptx.exe"), null);
assert.equal(sanitizePptxName("%XX"), null);
assert.ok(MAX_PPTX_BYTES >= 50 * 1024 * 1024);

const dir = await mkdtemp(join(tmpdir(), "alfa-import-test-"));
try {
  const tiny = join(dir, "tiny.pptx");
  await assert.rejects(streamPptx(Object.assign(Readable.from([Buffer.from("PK")]), { headers: {} }), tiny),
    /غير صالح/);
  const invalid = join(dir, "notzip.pptx");
  await assert.rejects(streamPptx(Object.assign(Readable.from([Buffer.alloc(400, 5)]), { headers: {} }), invalid),
    /ليس PowerPoint/);
  const oversized = join(dir, "huge.pptx");
  await assert.rejects(streamPptx(
    Object.assign(Readable.from([Buffer.alloc(1500, 42)]), { headers: {} }),
    oversized, { maxBytes: 1000 }), /أكبر/);
  const validHeader = join(dir, "header.pptx");
  assert.equal(await streamPptx(Object.assign(Readable.from([
    Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(300, 0)])
  ]), { headers: {} }), validHeader), 304);
  assert.equal((await readFile(validHeader))[0], 0x50);
} finally { await rm(dir, { force: true, recursive: true }); }
console.log("PPTX import guards: all checks passed");
