import assert from "node:assert/strict";
import {splitVerbatim,roomKnowledgePages,ROOM_LIMITS} from "../web/cognitive-readability.js";
import {createContextualCognitiveDirector} from "../web/cognitive-context-director.js";
import {createKnowledgeGraph,appendKnowledge,sourceRecord,audienceGraph,graphPage} from "../web/living-intelligence.js";

const bundle="abcdef123456";
const original="الدافعية  37.5٪ ترتبط بأمثلة موجودة؛ والطالب يراجع الدليل قبل الاستنتاج. ".repeat(5).trim();
const segments=splitVerbatim(original);
assert.equal(segments.join(""),original,"no original numeric, Arabic or whitespace content may be lost");
assert.ok(segments.length>1 && segments.every((x)=>x.length<=ROOM_LIMITS.maxCharsPerFragment));
const unspaced="م".repeat(330)+"📘"+"ن".repeat(40);
assert.equal(splitVerbatim(unspaced).join(""),unspaced,"non-breaking tokens are still verbatim");
const source=sourceRecord({bundle,slide:1,originalText:original,kind:"lecturer",approved:true});
let graph=createKnowledgeGraph(bundle);
graph=appendKnowledge(graph,{type:"topic",text:"الدافعية",source}).graph;
graph=appendKnowledge(graph,{type:"concept",text:original.slice(0,300),source,parentId:graph.nodes[0].id}).graph;
const pages=roomKnowledgePages(graph);
assert.ok(pages.length>1,"long concepts must be read on consecutive full-resolution pages");
assert.equal(pages.flatMap(p=>p.nodes).filter(n=>n.sourceId==="n2").map(n=>n.text).join(""),original.slice(0,300));
assert.ok(pages.every(p=>p.nodes.length<=6 && p.nodes.reduce((a,n)=>a+n.readingUnits,0)<=6));
assert.ok(pages[0].edges.every(e=>pages[0].nodes.some(n=>n.id===e.from)&&pages[0].nodes.some(n=>n.id===e.to)));
const visual=audienceGraph(graph,0);
assert.equal(visual.kind,"living");
assert.equal(visual.pages,pages.length);
assert.equal(graphPage(graph,Infinity).page,pages.length-1);
assert.equal(graphPage(graph,100,1).nodes.length,1,"legacy explicit page size stays supported");
assert.equal(JSON.stringify(visual).includes("originalText"),false,"provenance must remain lecturer-only");

// A bounded local history gives contextual hints, not generated claims.
let clock=1000;
const director=createContextualCognitiveDirector({now:()=>clock,cooldownMs:18000});
const slide={text:"الألعاب التعليمية والدافعية والتعلم التعاوني",notes:""};
assert.equal(director.observe("نشرح الألعاب التعليمية والدافعية الآن",{bundle,slideIndex:1,slide,graph}),null);
const summary="الخلاصة أن الألعاب التعليمية تعزز الدافعية";
const first=director.observe(summary,{bundle,slideIndex:1,slide,graph});
assert.equal(first.kind,"knowledge");
assert.equal(first.nodeType,"summary");
assert.equal(first.text,summary,"utterances are quoted literally");
assert.equal(first.groundedIn,"literal lecturer utterance");
assert.equal(director.observe(summary,{bundle,slideIndex:1,slide,graph}),null,"duplicate cue is suppressed");
clock+=20000;
const example=director.observe("مثال على الألعاب التعليمية هو نشاط تعاوني في الفصل",
  {bundle,slideIndex:1,slide,graph});
assert.equal(example?.nodeType,"example");
director.dismiss(example);
clock+=19000;
assert.equal(director.observe("مثال على الألعاب التعليمية هو نشاط تعاوني في الفصل",
  {bundle,slideIndex:1,slide,graph}),null,"dismissed cues stay suppressed locally");
clock+=20000;
assert.equal(director.observe("عفوا مو قصدي المثال على النشاط، الرقم غلط",
  {bundle,slideIndex:1,slide,graph}),null,"corrections are never proposed as new knowledge");
const recall=director.observe("تذكرون لما شرحنا الألعاب التعليمية في المحاضرة السابقة؟",
  {bundle,slideIndex:1,slide,graph});
assert.equal(recall?.kind,"bridge","explicit anchored lecture recall searches privately");
clock+=20000;
assert.equal(director.observe("تذكرون المحاضرة السابقة؟",{bundle,slideIndex:1,slide,graph}),null,
  "vague recall lacks a supported reference");
clock+=20000;
const mismatch=director.observe("الخلاصة أن النسبة 20% من الطلاب تتحسن بالألعاب التعليمية",
 {bundle,slideIndex:2,slide:{text:"النسبة 30% من الطلاب تتحسن بالألعاب التعليمية"},graph});
assert.equal(mismatch?.evidence.onSlide,false,"different numeric claims must never be considered slide support");
assert.equal(mismatch?.needsSourceReview,true,"lecturer reviews source disagreement");
clock+=20000;
const newSlide=director.observe("الخلاصة أن التقنية الحديثة تغير التعلم",
 {bundle,slideIndex:3,slide:{text:"التقنية الحديثة تغير التعلم"}});
assert.equal(newSlide?.nodeType,"summary","new slide resets old topic history");
console.log("ALFA projector page fidelity and bounded cognitive director tests passed");
