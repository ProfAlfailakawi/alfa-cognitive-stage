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
const ok = summarizeLecture({ slides: [
  { index: 1, videos: [], compatibility: { animationsDetected: true, animationFidelity: "order-and-state" },
    build: { steps: [{ image: "steps/001-00.png" }, { image: "steps/001-01.png" }] } },
  { index: 2, videos: [], compatibility: { animationsDetected: true, animationFidelity: "partial" },
    build: { steps: [{ image: "steps/002-00.png" }, { image: "steps/002-01.png" }] } },
  { index: 3, videos: [], compatibility: { animationsDetected: true, animationFidelity: "unsupported" } },
], problems: [] });
assert.deepEqual(ok.reproducedBuildSlides, [1]);
assert.deepEqual(ok.partialBuildSlides, [2]);
assert.deepEqual(ok.unreproducedAnimationSlides, [3]);
assert.match(ok.summary, /لا تُعاد/);
const clean = summarizeLecture({ slides: [{ index: 1, videos: [], compatibility: { animationsDetected: true,
  animationFidelity: "order-and-state" }, build: { steps: [{ image: "a" }, { image: "b" }] } }], problems: [] });
assert.match(clean.summary, /خطوة بخطوة/);
console.log("lecturer readiness warnings are accurate and conservative");
