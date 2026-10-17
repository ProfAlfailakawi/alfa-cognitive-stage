import assert from "node:assert/strict";
import { buildSteps, lastStep, clampStep, imageFor, nextPosition, prevPosition, autoDelay, fadeMs } from "../web/build-steps.js";
import { createReturnStack } from "../web/return-stack.js";

const step = (k, extra = {}) => ({ image: `steps/002-0${k}.png`, auto: false, delayMs: 0, durationMs: 0, effects: [], ...extra });
const plain = { index: 1, image: "slides/001.png" };
const animated = { index: 2, image: "slides/002.png", build: { steps: [step(0), step(1), step(2, { auto: true, delayMs: 400, durationMs: 900 })] } };
const slides = [plain, animated, { index: 3, image: "slides/003.png" }];

assert.equal(buildSteps(plain), null);
assert.equal(lastStep(plain), 0);
assert.equal(lastStep(animated), 2);
assert.equal(clampStep(animated, 9), 2);
assert.equal(clampStep(animated, -1), 0);
assert.equal(clampStep(animated, 1.5), 0);
assert.equal(imageFor(animated, 1), "steps/002-01.png");
assert.equal(imageFor(plain, 5), "slides/001.png");
// Hostile manifest paths are rejected, never used as image sources.
assert.equal(buildSteps({ build: { steps: [{ image: "../x.png" }, { image: "steps/002-01.png" }] } }), null);
assert.equal(buildSteps({ build: { steps: [step(0)] } }), null);
// Navigation order: slide 1 -> slide 2 click 0 -> 1 -> 2 -> slide 3.
assert.deepEqual(nextPosition(slides, 1, 0), { index: 2, step: 0 });
assert.deepEqual(nextPosition(slides, 2, 0), { index: 2, step: 1 });
assert.deepEqual(nextPosition(slides, 2, 2), { index: 3, step: 0 });
assert.equal(nextPosition(slides, 3, 0), null);
assert.deepEqual(prevPosition(slides, 3, 0), { index: 2, step: 2 }, "going back lands on the final state");
assert.deepEqual(prevPosition(slides, 2, 2), { index: 2, step: 1 });
assert.deepEqual(prevPosition(slides, 2, 0), { index: 1, step: 0 });
assert.equal(prevPosition(slides, 1, 0), null);
assert.equal(autoDelay(animated, 0), null);
assert.equal(autoDelay(animated, 1), 400);
assert.equal(fadeMs(animated, 2), 700);
assert.equal(fadeMs(animated, 0), 260);

// Return stack: nested digressions restore level by level, then exactly to the original.
const stack = createReturnStack();
const snap = (overlay) => () => ({ index: 2, step: 1, videos: [{ time: 3.5, playing: false }], overlay, poll: false });
assert.equal(stack.active(), false);
assert.equal(stack.enter(snap("scene-A-would-be-ignored-for-base")), 1);
assert.equal(stack.enter(snap({ type: "stat" })), 2);
assert.equal(stack.enter(snap({ type: "story" })), 3);
assert.deepEqual(stack.back().overlay, { type: "story" });
assert.deepEqual(stack.back().overlay, { type: "stat" });
const original = stack.back();
assert.equal(original.overlay, null, "base is captured before any overlay");
assert.equal(original.step, 1);
assert.equal(original.videos[0].time, 3.5);
assert.equal(stack.back(), null);
stack.enter(snap(null)); stack.enter(snap({ type: "x" }));
assert.equal(stack.home().step, 1);
assert.equal(stack.active(), false);
stack.enter(snap(null)); stack.clear();
assert.equal(stack.back(), null);
const bounded = createReturnStack(2);
for (let i = 0; i < 10; i++) bounded.enter(snap({ i }));
assert.ok(bounded.depth() <= 3);
console.log("build steps navigation and nested return stack passed");
