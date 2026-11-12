// Display decisions for the Mac app, over simulated Electron displays (no hardware needed).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chooseConsoleDisplay, chooseAudienceDisplay, describeDisplays, locate } = createRequire(import.meta.url)("../desktop/display-manager.cjs");

const mac = { id: 1, internal: true, scaleFactor: 2, bounds: { x: 0, y: 0, width: 1512, height: 982 } };
const proj = { id: 7, internal: false, scaleFactor: 1, bounds: { x: 1512, y: 0, width: 1920, height: 1080 } };
const left = { id: 9, internal: false, scaleFactor: 1, bounds: { x: -1280, y: -200, width: 1280, height: 720 } };
const mirror = { id: 8, internal: false, scaleFactor: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 } };

// Console stays on the Mac even when the projector is the system's main display.
assert.equal(chooseConsoleDisplay([proj, mac], 7).id, 1);
assert.equal(chooseConsoleDisplay([proj], 7).id, 7, "no internal screen (Mac mini): the main display");
// One screen: no projector to use.
assert.deepEqual(chooseAudienceDisplay([mac], { consoleId: 1 }), { display: null, needsChoice: false, reason: "single" });
// Two screens: the projector, whichever side it sits on and whatever its scale.
assert.equal(chooseAudienceDisplay([mac, proj], { consoleId: 1 }).display.id, 7);
assert.equal(chooseAudienceDisplay([left, mac], { consoleId: 1 }).display.id, 9, "negative coordinates");
// Mirroring: same picture, cannot separate the notes from the slide.
assert.equal(chooseAudienceDisplay([mac, mirror], { consoleId: 1 }).reason, "mirrored");
// Three screens: propose the largest, ask the lecturer to confirm; a confirmed choice is reused.
const three = chooseAudienceDisplay([mac, proj, left], { consoleId: 1 });
assert.equal(three.display.id, 7); assert.equal(three.needsChoice, true);
assert.deepEqual(chooseAudienceDisplay([mac, proj, left], { consoleId: 1, savedId: 9 }), { display: left, needsChoice: false, reason: "saved" });
// The audience never lands on the console, even if that was saved.
assert.notEqual(chooseAudienceDisplay([mac, proj], { consoleId: 1, savedId: 1 }).display.id, 1);
// Hot-plug: a projector connected later is found; an unplugged one is gone.
assert.equal(locate([mac], 7), null);
assert.equal(locate([mac, proj], 7).id, 7);
// Labels show real pixels.
assert.equal(describeDisplays([mac], { consoleId: 1 })[0].resolution, "3024×1964");
console.log("display manager: one, two, three screens, mirroring, negative coordinates, saved choice and hot-plug passed");
