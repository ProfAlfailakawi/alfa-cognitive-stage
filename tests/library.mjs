import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSceneLibrary } from "../server/scene-library.mjs";

const dir = mkdtempSync(join(tmpdir(), "alfa-memory-"));
const file = join(dir, "scenes.json");
const bundle = "123456abcdef";
const scene = { bundle, slide: 3, utterance: "بقولكم قصة عن الألعاب التعليمية وتأثيرها",
  spec: { type:"story", title:"القصة الحية", lines:["بقولكم قصة عن الألعاب التعليمية"] } };
try {
  const first = createSceneLibrary({file});
  const saved = first.save(scene);
  assert.match(saved.id, /^[a-f0-9]{24}$/);
  assert.equal(first.save(scene).id, saved.id); // no duplicate
  assert.equal(first.list(bundle).length, 1);
  const next = createSceneLibrary({file});
  assert.equal(next.list(bundle).length, 1); // survives restart
  assert.equal(next.list("fedcba654321").length, 0);
  assert.throws(() => next.save({ ...scene, bundle:"../../etc" }), /المحاضرة/);
  assert.throws(() => next.save({ ...scene, slide:-2 }), /الشريحة/);
  assert.throws(() => next.save({ ...scene, spec:{ type:"stat",title:"x",lines:[] } }));
  assert.equal(next.remove(bundle, saved.id), true);
  assert.equal(createSceneLibrary({file}).list(bundle).length, 0);
  assert.equal(next.remove(bundle, saved.id), false);
} finally { rmSync(dir, {recursive:true,force:true}); }
console.log("persistent lecture scene library: all checks passed");
