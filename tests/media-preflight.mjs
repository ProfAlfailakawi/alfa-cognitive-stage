import assert from "node:assert/strict";
import { lectureMediaList, testLectureMedia, probeMedia } from "../web/media-preflight.js";

const slides=[
  {index:1,videos:[{src:"media/first.mp4",webm:"media/first.webm"}]},
  {index:2,videos:[]},
  {index:3,videos:[{src:"../danger.mp4",webm:null}]}
];
const items=lectureMediaList(slides,"abcdef123456");
assert.equal(items.length,1);
assert.equal(items[0].sources.length,2);
assert.equal(lectureMediaList(slides,"../bad").length,0);
assert.equal(items[0].slide,1);
function mockVideo() {
  const listeners=new Map();
  const children=[];
  const video={
    style:{},readyState:3,videoWidth:320,currentSrc:"/bundles/abcdef123456/media/first.webm",
    ownerDocument:{createElement:()=>({src:"",type:""})},
    addEventListener:(key,handler)=>listeners.set(key,handler),
    removeEventListener:(key)=>listeners.delete(key),
    appendChild:(child)=>children.push(child),
    querySelector:(sel)=>sel==="source"?children[0]:null,
    load(){},
    play(){listeners.get("loadeddata")?.();return Promise.resolve()},
    pause(){},remove(){},
  };
  return video;
}
const mount={appendChild(){}};
assert.equal((await probeMedia(items[0],{createVideo:mockVideo,mount})).status,"ready");
const report=await testLectureMedia(slides,"abcdef123456",{createVideo:mockVideo,mount});
assert.equal(report.total,1);
assert.equal(report.passed,1);
assert.equal(report.failed,0);
const aborted=new AbortController();aborted.abort();
assert.equal((await testLectureMedia(slides,"abcdef123456",{signal:aborted.signal})).tested,0);
console.log("browser media preflight logic: all checks passed");
