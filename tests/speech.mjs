import assert from "node:assert/strict";
import { createSpeechDirector } from "../web/speech-director.js";
class FakeRecognition {
  static instance;
  constructor() { FakeRecognition.instance=this; this.started=0; this.stopped=0; }
  start() { this.started++; }
  stop() { this.stopped++; }
}
globalThis.SpeechRecognition=FakeRecognition;
const final=[],partial=[],statuses=[];
const mic=createSpeechDirector({
  onUtterance:(text)=>final.push(text),
  onInterim:(text)=>partial.push(text),
  onStatus:(status)=>statuses.push(status)
});
assert.equal(mic.supported,true);
mic.start();
const r=FakeRecognition.instance;
assert.equal(r.lang,"ar-KW");
assert.equal(r.started,1);
r.onresult({resultIndex:0,results:[{isFinal:false,0:{transcript:"قصة تعليمية"} }]});
assert.equal(partial.length,1);
assert.equal(final.length,0);
r.onresult({resultIndex:0,results:[{isFinal:true,0:{transcript:"بقولكم قصة مهمة"} }]});
assert.deepEqual(final,["بقولكم قصة مهمة"]);
mic.setMediaPlaying(true);
r.onresult({resultIndex:0,results:[{isFinal:true,0:{transcript:"كلام الفيديو"} }]});
assert.equal(final.length,1);
assert.ok(r.stopped>=1);
mic.stop();
// Fully synthetic timing; does not claim microphone-to-display latency or call STT services.
const snapshots = [];
let tick = 1000;
const scheduled = new Map();
let nextTimer = 1;
const diagnosticMic = createSpeechDirector({
  onUtterance: () => { tick += 7; }, // Measured local callback work.
  onDiagnostics: (value) => snapshots.push(value),
  now: () => tick,
  setTimer: (fn, ms) => { const id = nextTimer++; scheduled.set(id, { fn, ms }); return id; },
  clearTimer: (id) => scheduled.delete(id),
});
diagnosticMic.start();
const recognizer = FakeRecognition.instance;
tick = 1500;
recognizer.onresult({ resultIndex: 0,
  results: [{ isFinal: false, 0: { transcript: "القصة تبدأ الآن" } }] });
tick = 1920;
recognizer.onresult({ resultIndex: 0,
  results: [{ isFinal: true, 0: { transcript: "القصة تبدأ الآن" } }] });
assert.equal(diagnosticMic.diagnostics().finalSegments, 1);
assert.equal(diagnosticMic.diagnostics().interimToFinalMs, 420);
assert.equal(diagnosticMic.diagnostics().localHandlerMs, 7);
assert.equal(snapshots.at(-1).finalSegments, 1);
recognizer.onerror({ error: "network" });
recognizer.onend();
assert.equal(diagnosticMic.diagnostics().errors, 1);
assert.equal([...scheduled.values()][0].ms, 1800, "Network failure gets bounded backoff");
const pending = [...scheduled.entries()][0];
scheduled.delete(pending[0]);
pending[1].fn();
assert.equal(diagnosticMic.diagnostics().restarts, 1);
assert.equal(recognizer.started, 2);
recognizer.onend(); // Clean end after error: should still back off until a successful final.
assert.equal([...scheduled.values()][0].ms, 1800);
diagnosticMic.setMediaPlaying(true);
assert.equal(scheduled.size, 0, "Video playback cancels a delayed microphone restart");
recognizer.onerror({ error: "aborted" });
assert.equal(diagnosticMic.diagnostics().errors, 1, "Expected video interruption is not an error");
recognizer.onend();
assert.equal(scheduled.size, 0);
diagnosticMic.setMediaPlaying(false);
assert.equal(recognizer.started, 3);
recognizer.onerror({ error: "not-allowed" });
recognizer.onend();
assert.equal(scheduled.size, 0, "Permission refusal never restarts microphone");
assert.equal(diagnosticMic.diagnostics().errors, 2);
diagnosticMic.stop();

delete globalThis.SpeechRecognition;
console.log("Web Speech interim preview/final event isolation/video pause passed");
