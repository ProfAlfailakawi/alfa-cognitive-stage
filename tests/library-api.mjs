import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "alfa-library-api-"));
const PORT = 4229;
const TOKEN = "library-admin-testing-token";
const server = spawn(process.execPath, [join(root, "server/server.mjs")], {
  env: { ...process.env, PORT: String(PORT), ADMIN_TOKEN: TOKEN,
    VOTES_FILE: join(dir, "votes.json"), SCENES_FILE: join(dir, "scenes.json") },
  stdio: ["ignore", "pipe", "pipe"]
});
const base = "http://localhost:" + PORT;
try {
  await new Promise((resolve, reject) => {
    server.stdout.once("data", resolve);
    server.once("error", reject);
    setTimeout(() => reject(new Error("start timeout")), 5000).unref();
  });
  const bundle = "123456abcdef";
  const body = { bundle, slide: 1, utterance: "بقولكم قصة من الألعاب التعليمية",
    spec: { type:"story", title:"القصة", lines:["أول لحظة"] } };
  const post = (token) => fetch(base + "/api/library/scenes", {
    method:"POST", headers: { "Content-Type":"application/json", "X-Admin-Token": token },
    body:JSON.stringify(body)
  });
  assert.equal((await post("bad")).status, 401);
  const result = await post(TOKEN);
  assert.equal(result.status, 201);
  const created = (await result.json()).scene;
  assert.match(created.id, /^[a-f0-9]{24}$/);
  assert.equal((await fetch(base + "/api/library/scenes/" + bundle)).status, 401);
  const listed = await fetch(base + "/api/library/scenes/" + bundle, {
    headers: { "X-Admin-Token": TOKEN }
  });
  assert.equal((await listed.json()).scenes.length, 1);
  const deleted = await fetch(base + "/api/library/scenes/" + bundle + "/" + created.id, {
    method:"DELETE", headers: { "X-Admin-Token": TOKEN }
  });
  assert.equal((await deleted.json()).removed, true);
  const noFiles = await fetch(base + "/api/lectures/import", { method:"POST",
    headers:{ "X-Alfa-Filename":"lecture.pptx" } });
  assert.equal(noFiles.status, 401);
  console.log("authenticated scene-library / PPTX import API: all checks passed");
} finally { server.kill(); rmSync(dir,{recursive:true,force:true}); }
