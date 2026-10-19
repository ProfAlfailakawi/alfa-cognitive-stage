// Lecturer-only contextual director: local cues and short bounded history, not a neural semantic model.
// Suggestions are private drafts. The module never publishes or changes the presentation.
import { cognitiveSpeechCue } from "./living-intelligence.js";
import { normalizeArabic } from "./director-core.js";
import { contentWords, embed, compatible } from "./semantic-index.js";

const normalize = (s) => normalizeArabic(String(s || "")).replace(/\s+/g," ").trim();
const CORRECTION = /(?:عفوا|قصدي|مو قصدي|التصحيح|اصحح|انسوا اللي|تراجع عن|المعلومة غلط|الرقم غلط)/u;
const KINDS = [
  ["compare",/(?:الفرق بين|بالمقارن[ةه]|في المقابل|بينما)/u,"مقارنة صريحة"],
  ["example",/(?:مثال على|مثال علي|خذوا مثال|على سبيل المثال)/u,"مثال صريح"],
  ["summary",/(?:الخلاص[ةه]|وباختصار|النقط[ةه] الرئيسي[ةه]|النقط[ةه] الاساسي[ةه])/u,"خلاصة صريحة"],
  ["concept",/(?:المقصود|بمعنى|نقصد ب|تعريف)/u,"توضيح مفهوم"]
];

/** Consent and freshness are enforced in the presenter UI; this layer only prioritizes drafts. */
export function createContextualCognitiveDirector({now=()=>Date.now(),cooldownMs=18000}={}) {
  let active = "", lastKey = "", lastTime = -Infinity;
  const recent = [];
  const dismissed = new Map();
  function reset(bundle="",slide=0) {
    active=bundle+"#"+slide; recent.length=0;
    lastKey="";lastTime=-Infinity;
  }
  function contextEvidence(raw, slide, graph, at) {
    const candidate=contentWords(raw).map((w)=>w.stem);
    const overlap=(text)=>{
      const terms=new Set(contentWords(text).map((w)=>w.stem));
      return [...new Set(candidate)].filter((word)=>terms.has(word)).length;
    };
    const slideText=String(slide?.text||"")+" "+String(slide?.notes||"");
    const q=embed(raw), e=embed(slideText);
    const compatibleSlide=q.size>=2&&e.size>=2&&
      compatible(q,e,{threshold:.40}).ok;
    const onSlide=compatibleSlide&&overlap(slideText)>=2;
    const approved=(graph?.nodes||[]).some((n)=>
      n?.status==="approved" && n.source?.approved && overlap(n.text)>=2 &&
      q.size>=2 && embed(n.text).size>=2 &&
      compatible(q,embed(n.text),{threshold:.32}).ok);
    const prior=recent.filter((x)=>at-x.at<60000 && x.slide===active)
      .some((x)=>overlap(x.text)>=2 && compatible(q,embed(x.text),{threshold:.32}).ok);
    return {onSlide,approved,prior};
  }
  function observe(rawText,{bundle="",slideIndex=1,slide={},graph=null}={}) {
    const key=bundle+"#"+slideIndex;
    if (active!==key) reset(bundle,slideIndex);
    const at=now(), raw=String(rawText||"").trim().slice(0,1200);
    if (!raw || raw.length<12 || CORRECTION.test(normalize(raw))) return null;
    const signal=cognitiveSpeechCue(raw);
    const evidence=contextEvidence(raw,slide,graph,at);
    recent.push({text:raw,at,slide:active});
    while(recent.length>4 || (recent.length && at-recent[0].at>60000))recent.shift();
    if (!signal) return null;
    const fingerprint=signal.kind+"#"+normalize(signal.kind==="bridge"?signal.query:signal.text);
    if ((fingerprint===lastKey && at-lastTime<cooldownMs) ||
        (dismissed.get(fingerprint)||-Infinity)>at) return null;
    // Normal spoken narration must not break the cooldown even when it has a topic match.
    if(at-lastTime<cooldownMs) return null;
    if (signal.kind==="bridge") {
      // Recall searches require a specific named concept; otherwise there is no safe target.
      if(contentWords(signal.query).length<2) return null;
      lastKey=fingerprint;lastTime=at;
      return {kind:"bridge",query:signal.query,evidence,reason:"إشارة صريحة لاسترجاع مفهوم سابق"};
    }
    const norm=normalize(raw);
    const type=KINDS.find(([,regex])=>regex.test(norm));
    if(!type) return null;
    // Do not attempt to construct a combined or inferred statement out of nearby utterances.
    lastKey=fingerprint;lastTime=at;
    return {kind:"knowledge",text:signal.text,nodeType:type[0],reason:type[2],evidence,
      needsSourceReview:!evidence.onSlide&&!evidence.approved,
      groundedIn:"literal lecturer utterance"};
  }
  function dismiss(cue) {
    if(!cue)return;
    const fingerprint=cue.kind+"#"+normalize(cue.kind==="bridge"?cue.query:cue.text);
    dismissed.set(fingerprint,now()+120000);
    if(dismissed.size>32) dismissed.clear();
  }
  return {observe,dismiss,reset};
}
