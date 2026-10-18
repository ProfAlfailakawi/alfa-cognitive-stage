// Lecturer-controlled memory and conservative preference learning in real Chromium.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 4196, base = `http://localhost:${port}`, ADMIN = "memory-test-token-0123456789abcdef";
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures.push(name);
};
const server = spawn(process.execPath, [join(root, "server/server.mjs")], {
  env: { ...process.env, PORT: String(port), ADMIN_TOKEN: ADMIN, VOTES_FILE: "/tmp/alfa-mem-votes.json", SCENES_FILE: "/tmp/alfa-mem-scenes-" + Date.now() + ".json" },
  stdio: ["ignore", "pipe", "pipe"],
});
await new Promise((resolve) => server.stdout.once("data", resolve));
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ["--no-sandbox"],
});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on("pageerror", (e) => { console.log("pageerror: " + e); failures.push("pageerror"); });
const api = (path, init = {}) => fetch(base + path, { ...init, headers: { "X-Admin-Token": ADMIN, "Content-Type": "application/json", ...(init.headers || {}) } });
try {
  // ---- server erasure routes are lecturer-only ----
  const scene = { slide: 2, utterance: "في دراسة عن تحفيز الألعاب نسبة 68%", spec: { type: "stat", title: "x", lines: ["68%", "من حديث المحاضر"] } };
  for (const b of ["lecture_erase_a", "lecture_erase_b"]) await api("/api/memory/" + b, { method: "POST", body: JSON.stringify(scene) });
  check("students cannot erase scene memory", (await fetch(base + "/api/memory/lecture_erase_a", { method: "DELETE" })).status === 401 &&
    (await fetch(base + "/api/memory/library", { method: "DELETE" })).status === 401);
  const one = await (await api("/api/memory/lecture_erase_a", { method: "DELETE" })).json();
  check("one lecture's scenes can be erased", one.removed === 1 && (await (await api("/api/memory/lecture_erase_a")).json()).scenes.length === 0 &&
    (await (await api("/api/memory/lecture_erase_b")).json()).scenes.length === 1);
  const all = await (await api("/api/memory/library", { method: "DELETE" })).json();
  check("the whole library can be erased", all.removed >= 1 && (await (await api("/api/memory/library")).json()).scenes.length === 0);

  // ---- preference learning: one decline changes nothing, repeated declines quiet only that type ----
  await page.goto(`${base}/?dev=1#presenter`);
  await page.waitForSelector("#director-box");
  await page.selectOption("#director-mode", "safe");
  await page.locator("#director-box details").evaluate((d) => { d.open = true; });
  const say = async (text) => { await page.fill("#director-test-text", text); await page.click("#director-test-run"); };
  const proposal = () => page.locator("#director-proposal").isVisible();
  await say("ذكرت دراسة أن نسبة 41% من الطلبة تعلموا بالألعاب");
  check("first proposal appears", await proposal());
  await page.click("#director-reject");
  await say("ذكرت دراسة أن نسبة 42% من الطلبة تعلموا بالألعاب");
  check("one earlier decline does not change behaviour", await proposal());
  await page.click("#director-reject");
  for (const n of [43, 44]) {
    await say(`ذكرت دراسة أن نسبة ${n}% من الطلبة تعلموا بالألعاب`);
    if (await proposal()) await page.click("#director-reject");
  }
  await say("ذكرت دراسة أن نسبة 45% من الطلبة تعلموا بالألعاب");
  check("after repeated declines that type is no longer proposed", !(await proposal()) &&
    (await page.locator("#director-status").textContent()).includes("رفضته مراراً"),
    await page.locator("#director-status").textContent());
  check("learned preference is visible and explained", (await page.locator("#director-taste").textContent()).includes("موقوف"));
  await say("ارتفعت النسبة من ٣٠٪ إلى ٧٠٪");
  check("other scene types are unaffected", await proposal());
  await page.click("#director-reject");
  await page.click("#director-clear-taste");
  await say("ذكرت دراسة أن نسبة 46% من الطلبة تعلموا بالألعاب");
  check("lecturer can reset the learned style", await proposal() &&
    (await page.locator("#director-taste").textContent()).includes("لا تفضيلات"));
  await page.click("#director-accept");
  await page.waitForTimeout(300);

  // ---- clearing this lecture's approved scenes (browser + server) ----
  await page.fill("#director-admin-token", ADMIN);
  await page.locator("#director-admin-token").press("Tab"); // commits the token and starts the one-time sync
  await page.waitForFunction(() => document.querySelector("#director-status")?.textContent?.includes("تمت مزامنة"));
  const countBefore = await page.evaluate(async () => (await import("/scene-memory.js")).countSavedScenes(
    (await (await fetch("/bundles/current.json")).json()).id));
  check("approved scene was saved in the browser", countBefore >= 1, String(countBefore));
  page.once("dialog", (d) => d.accept());
  await page.click("#director-clear-scenes");
  await page.waitForFunction(() => document.querySelector("#director-status")?.textContent?.includes("مُسحت"));
  const countAfter = await page.evaluate(async () => (await import("/scene-memory.js")).countSavedScenes(
    (await (await fetch("/bundles/current.json")).json()).id));
  const bundle = (await (await fetch(base + "/bundles/current.json")).json()).id;
  check("this lecture's scenes are gone from browser and server", countAfter === 0 &&
    (await (await api("/api/memory/" + bundle)).json()).scenes.length === 0);
} catch (error) {
  console.error(error);
  failures.push("exception");
} finally {
  await browser.close();
  server.kill();
}
if (failures.length) { console.log(`\n${failures.length} check(s) failed`); process.exit(1); }
console.log("\nall memory-control and preference checks passed");
