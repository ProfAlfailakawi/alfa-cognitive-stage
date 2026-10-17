import assert from "node:assert/strict";
import { runRehearsal, speechDrills, brainSelfTest, checkFiles } from "../web/rehearsal.js";

const slides = [
  { index: 1, image: "slides/001.png", text: "مقدمة", videos: [] },
  { index: 2, image: "slides/002.png", text: "", videos: [{ src: "media/a.mp4" }],
    build: { steps: [{ image: "steps/002-00.png" }, { image: "steps/002-01.png" }] }, compatibility: { animationsDetected: true, animationFidelity: "order-and-state" } },
];
const manifest = { slides, problems: [{ slide: 2, problem: "video has no audio track" }] };
const fetchImpl = (missing = []) => async (url) => ({ ok: !missing.some((m) => url.endsWith(m)) });
const base = { manifest, slides, bundle: "abcdef123456", fetchImpl: fetchImpl(), testMedia: async () => ({ total: 1, passed: 1, failed: 0 }),
  nav: { onLine: true, hasRecognition: true, audioInputs: 1 }, audienceOpen: async () => true, adminCheck: async () => true, probeBroken: async () => true };

const good = await runRehearsal(base);
assert.equal(good.level, "warn", "a slide without text and a silent video are warnings, not failures");
const byId = Object.fromEntries(good.results.map((r) => [r.id, r]));
assert.equal(byId.files.level, "ok");
assert.match(byId.files.text, /4 حالة عرض/, "step images are checked too");
assert.equal(byId.text.level, "warn");
assert.equal(byId.builds.level, "ok");
assert.equal(byId["media-notes"].level, "warn");
for (const id of ["drill-permission", "drill-network", "drill-video-silence", "drill-director", "drill-broken-video"]) assert.equal(byId[id].level, "ok", id + ": " + byId[id].text);

// Failures are reported precisely.
const broken = await runRehearsal({ ...base, fetchImpl: fetchImpl(["steps/002-01.png"]), testMedia: async () => ({ total: 2, passed: 1, failed: 1 }),
  nav: { onLine: false, hasRecognition: false, audioInputs: 0 }, audienceOpen: async () => false, adminCheck: async () => false, probeBroken: async () => false });
const b = Object.fromEntries(broken.results.map((r) => [r.id, r]));
assert.equal(broken.level, "fail");
assert.match(b.files.text, /2/);
assert.equal(b.media.level, "fail");
assert.equal(b.online.level, "warn"); assert.equal(b.speech.level, "warn"); assert.equal(b.mic.level, "warn");
assert.equal(b.audience.level, "warn"); assert.equal(b.admin.level, "fail");
assert.equal(b["drill-broken-video"].level, "fail");
// Progress callback streams every result.
const seen = []; await runRehearsal({ ...base, onProgress: (r) => seen.push(r.id) });
assert.ok(seen.length >= 10 && seen[0] === "files");
// Drills are isolated: they never touch globals or a shared recogniser.
assert.equal(typeof globalThis.SpeechRecognition, "undefined");
assert.ok((await speechDrills()).every((r) => r.level === "ok"));
assert.equal(brainSelfTest().level, "ok");
assert.equal((await checkFiles({ slides, bundle: "abcdef123456", fetchImpl: async () => { throw new Error("offline"); } })).level, "fail");
console.log("rehearsal: file/media/environment checks and isolated failure drills passed");
