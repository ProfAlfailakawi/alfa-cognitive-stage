import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundlesRoot = join(root, "bundles");
const id = "0123456789ab";
const dir = join(bundlesRoot, id);
const temp = mkdtempSync(join(tmpdir(), "alfa-browser-smoke-"));
const port = 4231;
const base = "http://localhost:" + port;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/MHsAAAAASUVORK5CYII=", "base64");
mkdirSync(join(dir, "slides"), {recursive:true});
for (let n = 1; n <= 3; n++) {
  writeFileSync(join(dir, "slides", String(n).padStart(3,"0") + ".png"), png);
}
writeFileSync(join(dir, "manifest.json"), JSON.stringify({
  id, source:"اختبار.pptx", slideCount:3, aspect:16/9, problems:[],
  slides: [1,2,3].map((n) => ({index:n, image:"slides/" + String(n).padStart(3,"0") + ".png",
    text:n===2?"الألعاب التعليمية":"التعلم", notes:"", videos:[],
    hasAnimations:n===2, animationElements:n===2?1:0}))
}));
const server = spawn(process.execPath, [join(root,"server/server.mjs")], {
  env:{...process.env, PORT:String(port), ADMIN_TOKEN:"browser-test-secret",
    VOTES_FILE:join(temp,"votes.json"), SCENES_FILE:join(temp,"scenes.json")},
  stdio:["ignore","pipe","pipe"]
});
let browser;
try {
  await new Promise((resolve,reject) => {
    server.stdout.once("data",resolve);
    server.once("error",reject);
    setTimeout(()=>reject(new Error("server startup timeout")),7000).unref();
  });
  browser = await chromium.launch({
    executablePath:process.env.CHROME_PATH || chromium.executablePath(),
    args:["--no-sandbox"]
  });
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const presenter=await context.newPage();
  const audience=await context.newPage();
  await presenter.goto(base + "/?bundle=" + id);
  await presenter.locator("#director-box").waitFor();
  await presenter.locator("#director-box details summary").click();
  await audience.goto(base + "/?bundle=" + id + "#audience");
  await presenter.locator("#next").click();
  await audience.waitForFunction(()=>document.querySelector("#slide-img")?.getAttribute("src")?.endsWith("002.png"));
  assert.match(await presenter.locator("#compatibility").textContent(),/حركات PowerPoint/);

  await presenter.locator("#director-test-text").fill("بقولكم قصة عن شخص كان يلعب كل يوم");
  await presenter.locator("#director-test-run").click();
  await audience.locator(".info-layer svg").waitFor();
  assert.match(await audience.locator(".info-layer").textContent(),/القصة الحية/);
  await presenter.locator("#director-test-text").fill("زين نرجع لموضوعنا الأصلي");
  await presenter.locator("#director-test-run").click();
  await audience.waitForFunction(()=>document.querySelectorAll(".info-layer").length===0);
  assert.match(await presenter.locator("#meta").textContent(),/الشريحة 2 من 3/);

  await presenter.locator("#director-test-text").fill("في دراسة ذكرت أن ٦٨٪ من الطلبة استفادوا");
  await presenter.locator("#director-test-run").click();
  await audience.locator(".info-layer svg").waitFor();
  assert.match(await audience.locator(".info-layer").textContent(),/68%/);

  await presenter.locator("#director-admin-token").fill("browser-test-secret");
  await presenter.locator("#lecture-preflight").click();
  await presenter.locator("#alfa-preflight-dialog[open]").waitFor();
  assert.match(await presenter.locator("#preflight-report").textContent(), /شرائح فيها حركات PowerPoint غير منقولة: 1/);
  await presenter.locator("#preflight-close").click();

  await presenter.locator("#import-lecture").click();
  await presenter.locator("#alfa-import-dialog[open]").waitFor();
  assert.equal(await presenter.locator("#import-file").getAttribute("accept"), ".pptx");
  await presenter.locator("#import-cancel").click();
  assert.equal(await presenter.locator("#alfa-import-dialog").getAttribute("open"), null);
  await context.close();
  console.log("presenter & student browser: slide, story, return, statistic and importer passed");
} finally {
  await browser?.close();
  server.kill();
  rmSync(dir,{recursive:true,force:true});
  rmSync(temp,{recursive:true,force:true});
}
