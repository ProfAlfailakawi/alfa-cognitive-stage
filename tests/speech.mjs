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
delete globalThis.SpeechRecognition;
console.log("Web Speech interim preview/final event isolation/video pause passed");
