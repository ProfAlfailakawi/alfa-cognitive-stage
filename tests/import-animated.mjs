// Real PPTX with PowerPoint-structured click builds: import through the server (LibreOffice),
// then step through it in Chromium. Needs `python tools/animated_fixture.py <file>` first.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pptx = process.env.ALFA_ANIMATED_PPTX || "/tmp/alfa-animated.pptx";
if (!existsSync(pptx)) throw Error("Missing animated PPTX fixture: run tools/animated_fixture.py");
const port = 4289, base = "http://127.0.0.1:" + port, token = "animated-test-admin-abc123456789";
const scratch = mkdtempSync(join(tmpdir(), "alfa-anim-"));
const child = spawn(process.execPath, [join(root, "server/server.mjs")], {
  env: { ...process.env, PORT: String(port), ADMIN_TOKEN: token, ALFA_BUNDLES_DIR: join(scratch, "bundles"), VOTES_FILE: join(scratch, "v.json"), SCENES_FILE: join(scratch, "s.json") },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "", browser;
child.stderr.on("data", (b) => { logs += b; });
child.stdout.on("data", (b) => { logs += b; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const digest = async (url) => createHash("sha256").update(Buffer.from(await (await fetch(url)).arrayBuffer())).digest("hex");
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base + "/api/admin/check", { headers: { "X-Admin-Token": token } })).ok) break; } catch {}
    await sleep(100);
  }
  const result = await fetch(base + "/api/lectures/import", { method: "POST", headers: {
    "X-Admin-Token": token, "X-Lecture-Filename": encodeURIComponent("animated.pptx") }, body: readFileSync(pptx) });
  const body = await result.json();
  assert.equal(result.status, 201, JSON.stringify(body));
  const id = body.lecture.id;
  const manifest = await (await fetch(`${base}/bundles/${id}/manifest.json`)).json();
  assert.equal(manifest.slides.length, 3);
  const [text, chart, plain] = manifest.slides;
  assert.equal(text.build.steps.length, 3, "two clicks = three states");
  assert.equal(chart.build.steps.length, 3);
  assert.equal(plain.build ?? null, null);
  assert.equal(text.compatibility.animationFidelity, "order-and-state");
  assert.equal(manifest.problems.length, 0, JSON.stringify(manifest.problems));
  const hashes = [];
  for (const step of [...text.build.steps, ...chart.build.steps]) {
    const r = await fetch(`${base}/bundles/${id}/${step.image}`);
    assert.equal(r.status, 200, step.image);
    hashes.push(await digest(`${base}/bundles/${id}/${step.image}`));
  }
  assert.equal(new Set(hashes.slice(0, 3)).size, 3, "text steps must all differ");
  assert.equal(new Set(hashes.slice(3)).size, 3, "chart steps must all differ");

  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath(),
    args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/?bundle=${id}#presenter`);
  await page.waitForSelector("#meta");
  const meta = () => page.textContent("#meta");
  assert.match(await meta(), /1 من 3.*حركة 0 من 2/);
  const shown = [];
  for (let click = 0; click < 2; click++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(900);
    const url = await page.getAttribute("#slide-img", "src");
    assert.ok(url.endsWith(text.build.steps[click + 1].image), url);
    assert.ok(await page.locator("#slide-img").evaluate((i) => i.naturalWidth > 100), "step image decodes");
    shown.push(url);
  }
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(700);
  assert.match(await meta(), /2 من 3.*حركة 0 من 2/, "third press leaves slide 1 after its last click");
  assert.deepEqual(errors, []);
  console.log("PASS real PPTX click builds: text and chart steps rendered, distinct and navigable in Chromium");
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  await browser?.close();
  child.kill();
  rmSync(scratch, { recursive: true, force: true });
}
