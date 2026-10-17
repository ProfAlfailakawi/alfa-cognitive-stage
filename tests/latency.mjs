import assert from "node:assert/strict";
import { createLatencyMeter } from "../web/latency-meter.js";
import { createSpeechDirector } from "../web/speech-director.js";

const meter = createLatencyMeter({ keep: 3 });
assert.equal(meter.summary().count, 0);
assert.equal(meter.summary().localP50, null);
assert.equal(meter.record({ kind: "scene", onsetAt: 1000, finalAt: 1400, decidedAt: 1410, shownAt: 1450 }), true);
assert.deepEqual(meter.summary().last, { kind: "scene", engine: "unknown", recognitionMs: 400, decisionMs: 10, renderMs: 40, localMs: 50, totalMs: 450 });
for (const bad of [
  { kind: "other", finalAt: 1, decidedAt: 2, shownAt: 3 },
  { kind: "scene", finalAt: 5, decidedAt: 2, shownAt: 3 },       // decision before the final transcript
  { kind: "scene", finalAt: 1, decidedAt: 2, shownAt: 1 },       // painted before decided
  { kind: "scene", finalAt: NaN, decidedAt: 2, shownAt: 3 },
]) assert.equal(meter.record(bad), false);
meter.record({ kind: "proposal", onsetAt: null, finalAt: 2000, decidedAt: 2005, shownAt: 2030, engine: "cloud" });
meter.record({ kind: "scene", onsetAt: 5000, finalAt: 5200, decidedAt: 5202, shownAt: 5230 });
meter.record({ kind: "scene", onsetAt: 6000, finalAt: 6100, decidedAt: 6101, shownAt: 6900 });
let s = meter.summary();
assert.equal(s.count, 3, "bounded history");
assert.equal(s.localP95, 800);
assert.equal(s.localP50, 30);
assert.equal(s.totalP50, 230, "samples without a first-transcript time are excluded from the total");
assert.deepEqual(s.engines.sort(), ["cloud", "unknown"]);
meter.reset(); assert.equal(meter.summary().count, 0);

// ---- engine choice ----
const make = (available, extra = {}) => {
  class Fake {
    static inst; constructor() { Fake.inst = this; this.started = 0; } start() { this.started++; } stop() {}
  }
  if (available !== undefined) Fake.available = async (opts) => { Fake.asked = opts; if (available instanceof Error) throw available; return available; };
  const statuses = [];
  const director = createSpeechDirector({ Recognition: Fake, onStatus: (m) => statuses.push(m), setTimer: () => 1, clearTimer() {}, ...extra });
  return { Fake, director, statuses };
};
const tick = () => new Promise((r) => setTimeout(r, 0));
{ const { Fake, director } = make("available"); director.start(); await tick(); await tick();
  assert.equal(Fake.inst.processLocally, true); assert.equal(director.engine(), "local"); assert.deepEqual(Fake.asked, { langs: ["ar-KW"], processLocally: true }); assert.equal(Fake.inst.started, 1); }
for (const state of ["downloadable", "downloading", "unavailable"]) {
  const { Fake, director } = make(state); director.start(); await tick(); await tick();
  assert.equal(Fake.inst.processLocally, undefined, state + " is never treated as local"); assert.equal(director.engine(), "cloud");
  assert.equal(director.diagnostics().localStatus, state);
}
{ const { Fake, director } = make(new Error("blocked by permissions policy")); director.start(); await tick(); await tick();
  assert.equal(director.engine(), "cloud"); assert.equal(Fake.inst.started, 1, "a failing availability probe falls back to the cloud engine"); }
{ const { Fake, director } = make(undefined); director.start(); assert.equal(Fake.inst.started, 1, "browsers without available() start synchronously"); assert.equal(director.engine(), "cloud"); }
// ---- offline: do not start the cloud engine; resume on reconnect ----
{
  let online = false, reconnect = null;
  const { Fake, director, statuses } = make(undefined, { isOnline: () => online, listenOnline: (h) => { reconnect = h; return () => { reconnect = null; }; } });
  director.start();
  assert.equal(Fake.inst.started, 0);
  assert.match(statuses.at(-1), /لا يوجد إنترنت/);
  assert.equal(director.diagnostics().lastError, "offline");
  online = true; reconnect();
  assert.equal(Fake.inst.started, 1, "resumes by itself");
  director.stop(); assert.equal(reconnect, null, "stop removes the listener");
}
// ---- on-device recognition keeps working offline ----
{
  const { Fake, director } = make("available", { isOnline: () => false }); director.start(); await tick(); await tick();
  assert.equal(Fake.inst.started, 1, "local engine does not need the network");
}
// ---- stable interim ----
{
  const timers = []; const stable = []; let t = 0;
  const { Fake, director } = make(undefined, { now: () => t, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: (id) => { if (timers[id - 1]) timers[id - 1].dead = true; },
    onStableInterim: (x) => stable.push(x) });
  director.start();
  const say = (text, final = false) => Fake.inst.onresult({ resultIndex: 0, results: [{ isFinal: final, 0: { transcript: text } }] });
  t = 1000; say("نرجع"); t = 1400; say("نرجع للعرض");
  const live = timers.filter((x) => !x.dead && x.ms === 800);
  assert.equal(live.length, 1, "only the latest interim is waiting to stabilise");
  live[0].fn(); live[0].dead = true; assert.deepEqual(stable, ["نرجع للعرض"]);
  say("جملة ثانية"); t = 3000; say("جملة ثانية كاملة", true);
  timers.filter((x) => !x.dead && x.ms === 800).forEach((x) => x.fn());
  assert.deepEqual(stable, ["نرجع للعرض"], "a final result cancels the pending stable callback");
}
console.log("latency meter, engine selection, offline fallback and stable-interim handling passed");
