import assert from "node:assert/strict";
import {
  DRIFT_LIMIT_SECONDS, validMediaTime, sameLecture, validVideoPacket,
  validSnapshot, needsMediaSeek
} from "../web/video-sync.js";

assert.equal(DRIFT_LIMIT_SECONDS, 0.85);
for (const bad of [NaN, Infinity, -Infinity, -0.1, "1.5", null, undefined]) {
  assert.equal(validMediaTime(bad), false, String(bad));
}
assert.equal(validMediaTime(0), true);
assert.equal(validMediaTime(23.5), true);
assert.equal(sameLecture({ bundle: "course-a" }, "course-b"), false);
assert.equal(sameLecture(null, "course-a"), false);
assert.equal(sameLecture({ bundle: "course-a" }, "course-a"), true);
const packet = { bundle: "course-a", type: "video", index: 7, clip: 0, time: 8, action: "progress" };
assert.equal(validVideoPacket(packet, "course-a", 7, 1), true);
assert.equal(validVideoPacket({ ...packet, index: 6 }, "course-a", 7, 1), false);
assert.equal(validVideoPacket({ ...packet, clip: 1 }, "course-a", 7, 1), false);
assert.equal(validVideoPacket({ ...packet, action: "unknown" }, "course-a", 7, 1), false);
assert.equal(validVideoPacket({ ...packet, time: -1 }, "course-a", 7, 1), false);
assert.equal(validVideoPacket({ ...packet, time: "8" }, "course-a", 7, 1), false);
assert.equal(validVideoPacket({ ...packet, bundle: "other" }, "course-a", 7, 1), false);
assert.equal(validVideoPacket({ ...packet, index: 1.5 }, "course-a", 1.5, 1), false);
for (const action of ["play", "pause", "seek", "ended", "progress"]) {
  assert.equal(validVideoPacket({ ...packet, action }, "course-a", 7, 1), true);
}
const snapshot = { bundle: "course-a", type: "snapshot", index: 7, main: 7,
  videos: [{ time: 13.2, playing: true }, { time: 0, playing: false }] };
assert.equal(validSnapshot(snapshot, "course-a", 2), true);
assert.equal(validSnapshot(snapshot, "course-a", 1), false);
assert.equal(validSnapshot({ ...snapshot, videos: [{ time: 13.2, playing: "yes" }, snapshot.videos[1]] }, "course-a", 2), false);
assert.equal(validSnapshot({ ...snapshot, videos: [{ time: -2, playing: true }, snapshot.videos[1]] }, "course-a", 2), false);
assert.equal(validSnapshot({ ...snapshot, bundle: "course-b" }, "course-a", 2), false);
assert.equal(needsMediaSeek(0, 2), true);
assert.equal(needsMediaSeek(10, 10.4), false);
assert.equal(needsMediaSeek(10, 11.1), true);
assert.equal(needsMediaSeek(Infinity, 5), false);
assert.equal(needsMediaSeek(10, -2), false);
console.log("video synchronization: same-lecture isolation, stale-slide safety, valid packets and drift thresholds passed");
