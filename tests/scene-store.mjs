import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSceneStore } from "../server/scene-store.mjs";
const root=mkdtempSync(join(tmpdir(),"alfa-scenes-"));
try {
  const filename=join(root,"scenes.json");
  const s=createSceneStore({file:filename});
  const scene=s.save("lecture_01",{slide:12,utterance:"في دراسة ألعاب تعليمية ذكرت نسبة 68% للمشاركين",
    spec:{type:"stat",title:"نسبة من كلام المحاضر",lines:["68%","كما ذكر المحاضر"]}});
  assert.equal(s.list("lecture_01").length,1);
  assert.equal(s.list("lecture_02").length,0);
  const restarted=createSceneStore({file:filename});
  assert.equal(restarted.list("lecture_01")[0].spec.lines[0],"68%");
  assert.throws(()=>s.save("../secret",{slide:1,utterance:"abcdefgh",spec:scene.spec}),/معرّف/);
  assert.throws(()=>s.save("lecture_01",{slide:1,utterance:"abcdefgh",spec:{type:"unknown",lines:["x"]}}),/المشهد/);
  const id=scene.id;
  assert.equal(restarted.remove("lecture_01",id).removed,true);
  assert.equal(createSceneStore({file:filename}).list("lecture_01").length,0);
  console.log("durable scene library: persistence/isolation/auth data constraints passed");
} finally { rmSync(root,{recursive:true,force:true}); }
