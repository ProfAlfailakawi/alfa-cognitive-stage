import assert from "node:assert/strict";
import { summarizeLecture } from "../web/lecture-readiness.js";
const summary=summarizeLecture({slides:[
  {index:1,videos:[],compatibility:{}},
  {index:2,videos:[{src:"a.mp4"}],compatibility:{animationsDetected:true}},
],problems:[{slide:2,problem:"powerpoint animations are not preserved in PNG rendering"}]});
assert.equal(summary.slideCount,2);
assert.equal(summary.embeddedVideoCount,1);
assert.deepEqual(summary.animatedSlides,[2]);
assert.equal(summary.readyForUnattendedLiveUse,false);
assert.match(summary.summary,/حركات/);
assert.equal(summarizeLecture({slides:[],problems:[]}).animatedSlides.length,0);
console.log("lecturer readiness warnings are accurate and conservative");
