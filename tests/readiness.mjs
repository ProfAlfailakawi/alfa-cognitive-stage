import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkReadiness } from "../server/readiness.mjs";

const root = mkdtempSync(join(tmpdir(),"alfa-preflight-"));
const bundle = "a0b1c2d3e4f5";
try {
  const dir = join(root,bundle);
  mkdirSync(join(dir,"slides"),{recursive:true});
  writeFileSync(join(dir,"slides","001.png"),Buffer.from("png"));
  const manifest = {id:bundle,source:"lecture.pptx",slideCount:2,problems:[],
    slides:[
      {index:1,image:"slides/001.png",hasAnimations:false,videos:[]},
      {index:2,image:"slides/002.png",hasAnimations:true,videos:[]}
    ]};
  writeFileSync(join(dir,"manifest.json"),JSON.stringify(manifest));
  const bad = await checkReadiness({bundlesRoot:root,bundle});
  assert.equal(bad.status,"blocked");
  assert.equal(bad.animationSlides.length,1);
  assert.equal(bad.missingAssets.length,1);
  writeFileSync(join(dir,"slides","002.png"),Buffer.from("png"));
  const hasAnimation=await checkReadiness({bundlesRoot:root,bundle});
  assert.equal(hasAnimation.status,"review");
  assert.equal(hasAnimation.playableFilesPresent,true);
  manifest.slides[1].hasAnimations=false;
  writeFileSync(join(dir,"manifest.json"),JSON.stringify(manifest));
  assert.equal((await checkReadiness({bundlesRoot:root,bundle})).status,"files-ready");
  await assert.rejects(checkReadiness({bundlesRoot:root,bundle:"../../etc"}),/غير صالح/);
} finally {rmSync(root,{recursive:true,force:true});}
console.log("preflight flags missing media and original animations accurately");
