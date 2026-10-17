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
  const sibling = restarted.save("lecture_02", { slide: 2,
    utterance: "في دراسة عن تحفيز الألعاب نسبة 68% من المشاركين", spec: scene.spec });
  assert.equal(restarted.listAll().length, 2);
  assert.deepEqual(new Set(restarted.listAll().map(x => x.bundle)),
    new Set(["lecture_01", "lecture_02"]));
  assert.equal(restarted.listAll()[0].bundle, "lecture_02",
    "Newest approved scene should be offered first");
  assert.equal(restarted.listAll(1).length, 1);
  assert.equal(restarted.listAll(1000000).length, 2);
  const newInstance = createSceneStore({ file: filename });
  assert.equal(newInstance.listAll().length, 2, "Cross-lecture library survives restart");
  const safeCopy = restarted.listAll();
  safeCopy[0].spec.title = "tampered";
  assert.notEqual(restarted.listAll()[0].spec.title, "tampered", "Never expose mutable store references");
  for (let i = 0; i < 156; i++) {
    restarted.save("lecture_many", { slide: i+1,
      utterance: "محاضرة تعليمية تجربة محفوظة رقم " + i + " مع أرقام مختلفة",
      spec: scene.spec });
  }
  assert.equal(restarted.listAll().length, 150, "Server response is bounded");
  assert.equal(restarted.listAll().some(x => x.id === sibling.id), true,
    "An unrelated approved prior scene should remain until enough newer scenes exist");
  const id=scene.id;
  assert.equal(restarted.remove("lecture_01",id).removed,true);
  assert.equal(createSceneStore({file:filename}).list("lecture_01").length,0);
  console.log("durable scene library: persistence/isolation/auth data constraints passed");
} finally { rmSync(root,{recursive:true,force:true}); }
