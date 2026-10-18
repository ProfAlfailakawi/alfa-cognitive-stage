// PDF import through the real server and a real browser. Needs: python tools/make_test_pdf.py <file>
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pdf = process.env.ALFA_TEST_PDF || "/tmp/alfa-test.pdf";
if (!existsSync(pdf)) throw Error("Missing PDF fixture: run tools/make_test_pdf.py");
const port = 4293, base = "http://127.0.0.1:" + port, token = "pdf-test-admin-abc123456789";
const scratch = mkdtempSync(join(tmpdir(), "alfa-pdf-"));
const child = spawn(process.execPath, [join(root, "server/server.mjs")], {
  env: { ...process.env, PORT: String(port), ADMIN_TOKEN: token, ALFA_BUNDLES_DIR: join(scratch, "bundles"), VOTES_FILE: join(scratch, "v.json"), SCENES_FILE: join(scratch, "s.json") },
  stdio: ["ignore", "pipe", "pipe"] });
let logs = "", browser;
child.stderr.on("data", (b) => { logs += b; }); child.stdout.on("data", (b) => { logs += b; });
const upload = (name, body) => fetch(base + "/api/lectures/import", { method: "POST",
  headers: { "X-Admin-Token": token, "X-Lecture-Filename": encodeURIComponent(name) }, body });
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base + "/api/admin/check", { headers: { "X-Admin-Token": token } })).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const ok = await upload("محاضرة PDF.pdf", readFileSync(pdf));
  const body = await ok.json();
  assert.equal(ok.status, 201, JSON.stringify(body));
  assert.equal(body.lecture.slides, 4);
  assert.equal(body.lecture.videoCount, 0);
  const id = body.lecture.id;
  const manifest = await (await fetch(`${base}/bundles/${id}/manifest.json`)).json();
  assert.equal(manifest.format, "pdf");
  assert.ok(manifest.slides[2].text.includes("Slide 3"), "text is extracted for the director");
  // A PDF with a PPTX name (or the reverse) is refused by content, not by extension.
  const liar = await upload("fake.pdf", Buffer.from("PK\u0003\u0004 not a pdf, just a zip header"));
  assert.equal(liar.status, 400);
  const liar2 = await upload("fake.pptx", readFileSync(pdf));
  assert.equal(liar2.status, 400);
  assert.equal((await upload("macro.exe", Buffer.from("MZ"))).status, 400);
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath(), args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/?bundle=${id}&dev=1#presenter`);
  await page.waitForSelector("#meta");
  assert.match(await page.textContent("#meta"), /1 من 4$/);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(500);
  assert.match(await page.textContent("#meta"), /2 من 4$/, "PDF pages navigate like slides (no build steps)");
  assert.ok(await page.locator("#slide-img").evaluate((i) => i.naturalWidth > 100));
  assert.equal(await page.locator("video.clip").count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS PDF import: pages, extracted text, content-type verification and navigation in Chromium");
} catch (error) { console.error(logs); throw error; }
finally { await browser?.close(); child.kill(); rmSync(scratch, { recursive: true, force: true }); }
