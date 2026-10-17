// Regression: rapid PowerPoint build clicks must not be rewound by a late image decode.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 4213;
const server = spawn(process.execPath, [join(root, "server/server.mjs")], {
  env: { ...process.env, PORT: String(port), VOTES_FILE: "/tmp/alfa-fade-votes.json",
    SCENES_FILE: "/tmp/alfa-fade-scenes.json" },
  stdio: ["ignore", "pipe", "pipe"],
});
let browser;
try {
  await Promise.race([
    new Promise((resolve, reject) => {
      server.once("error", reject);
      server.once("exit", (code) => reject(new Error("server exited: " + code)));
      server.stdout.once("data", resolve);
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("server startup timeout")), 12000)),
  ]);
  browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext();
  const presenter = await context.newPage();
  const audience = await context.newPage();
  const errors = [];
  for (const page of [presenter, audience]) page.on("pageerror", (e) => errors.push(e.message));
  await presenter.goto("http://localhost:" + port + "/#presenter");
  await presenter.waitForSelector("#meta");
  await audience.goto("http://localhost:" + port + "/#audience");
  await presenter.bringToFront();
  await presenter.keyboard.press("ArrowRight");
  await presenter.keyboard.press("ArrowRight");
  await presenter.waitForFunction(() => document.querySelector("#slide-img")?.src.endsWith("003-00.png"));
  await presenter.keyboard.press("ArrowRight");
  await presenter.keyboard.press("ArrowRight");
  for (const page of [presenter, audience]) {
    await page.waitForFunction(() => document.querySelector("#slide-img")?.src.endsWith("003-02.png"));
    await page.evaluate(() => {
      const original = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function () {
        return this.src.endsWith("/steps/003-01.png")
          ? new Promise((resolve) => setTimeout(resolve, 750))
          : original.call(this);
      };
    });
  }
  await presenter.keyboard.press("ArrowLeft");
  await presenter.keyboard.press("ArrowRight");
  await presenter.waitForTimeout(1600);
  for (const [label, page] of [["presenter", presenter], ["audience", audience]]) {
    const state = await page.evaluate(() => ({
      src: document.querySelector("#slide-img")?.getAttribute("src"),
      fades: document.querySelectorAll(".step-fade").length,
    }));
    assert.ok(state.src?.endsWith("003-02.png"), label + " rewound: " + JSON.stringify(state));
    assert.equal(state.fades, 0, label + " has a stale fade");
  }
  assert.deepEqual(errors, []);
  console.log("PASS: stale decode cannot rewind presenter or audience build state");
} finally {
  await browser?.close();
  server.kill();
}
