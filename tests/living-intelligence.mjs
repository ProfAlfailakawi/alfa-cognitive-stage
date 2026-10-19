import assert from "node:assert/strict";
import { sourceRecord, createKnowledgeGraph, appendKnowledge, graphPage,
  audienceGraph, saveKnowledge, loadKnowledge, clearKnowledge,
  eligibleShape, xrayProjection, canEnterStage, findTimeBridge,
  validateScenario, calculateScenario, comparePulse, validateKnowledgeSnapshot,
  exportLivingArchive, importLivingArchive, evaluateScenarioFormula,
  suggestXrayFromSpeech, cognitiveSpeechCue } from "../web/living-intelligence.js";
import { validCognitivePacket } from "../web/living-intelligence-ui.js";

const bundle = "abcdef123456";
const storage = new Map();
const adapter = {
  getItem: (k) => storage.get(k) || null,
  setItem: (k, v) => storage.set(k, v),
  removeItem: (k) => storage.delete(k),
};
const source = sourceRecord({ bundle, slide: 2, originalText: "الألعاب التعليمية تعزز الدافعية", kind: "speech", approved: true });
let graph = createKnowledgeGraph(bundle);
let added = appendKnowledge(graph, { type: "topic", text: "الألعاب التعليمية", source });
assert.equal(added.node.type, "topic");
graph = added.graph;
added = appendKnowledge(graph, { type: "concept", text: "الدافعية", source, parentId: graph.nodes[0].id });
graph = added.graph;
assert.equal(graph.edges[0].relation, "related");
assert.equal(appendKnowledge(graph, { type: "concept", text: "الدافعية", source }).duplicate, true);
assert.throws(() => appendKnowledge(graph, { type:"stat", text:"90%", source }), /النص/);
assert.throws(() => appendKnowledge(graph, { type:"concept", text:"الدافعية", source:{...source,approved:false} }), /معتمداً/);
assert.throws(() => sourceRecord({ bundle, slide:1, originalText:"", kind:"slide" }));
assert.equal(saveKnowledge(graph, adapter), true);
assert.equal(loadKnowledge(bundle, adapter).nodes.length, 2);
const publicState = audienceGraph(graph);
assert.equal(publicState.nodes.length, 2);
assert.equal(JSON.stringify(publicState).includes("originalText"), false);
assert.equal(JSON.stringify(publicState).includes("speech"), false);
assert.equal(graphPage(graph, 100, 1).nodes.length, 1);
assert.equal(clearKnowledge(bundle,adapter), true);
assert.equal(loadKnowledge(bundle,adapter).nodes.length, 0);
assert.equal(canEnterStage({ videoPlaying:true, requested:"xray", approved:true }).ok, false);
assert.equal(canEnterStage({ requested:"living", approved:false }).ok, false);
const normal = { elements:[] }, animated = { build:{ steps:[{},{}] } };
const box = { id:"s1-e2", type:"text", x:.1,y:.15,w:.2,h:.3 };
assert.equal(eligibleShape(box, normal), true);
assert.equal(eligibleShape(box, animated), false);
assert.equal(eligibleShape({...box,rotated:true}, normal), false);
assert.equal(eligibleShape({...box,w:2}, normal), false);
const xray=xrayProjection([box],normal,0);
assert.equal(xray.boxes[0].x,.1);
assert.throws(() => xrayProjection([{...box,x:-.5}],normal,0));
assert.equal(validCognitivePacket({...xray, bundle, slide:1,step:0},
  {bundle,index:1,step:0}), true);
assert.equal(validCognitivePacket({...xray, bundle, slide:1,step:0},
  {bundle,index:2,step:0}), false);
assert.equal(validCognitivePacket({...xray, bundle, slide:1,step:0},
  {bundle,index:1,step:0,videoPlaying:true}), false);
const entries=[
 {bundle:"bbbbbbbbbbbb",courseId:"course",lecture:"الأولى",slide:4,text:"الألعاب التعليمية تعزز الدافعية لدى الطلاب"},
 {bundle:"cccccccccccc",courseId:"course",lecture:"الثانية",slide:5,text:"الألعاب التعليمية لا تعزز الدافعية لدى الطلاب"},
 {bundle:"dddddddddddd",courseId:"other",lecture:"الثالثة",slide:3,text:"الألعاب التعليمية تعزز الدافعية بنسبة 30%"},
];
const hits=findTimeBridge("الألعاب التعليمية تعزز الدافعية لدى الطلاب",entries,bundle,{courseId:"course"});
assert.ok(hits.some((x)=>x.bundle==="bbbbbbbbbbbb"));
assert.ok(!hits.some((x)=>x.bundle==="cccccccccccc"));
assert.ok(!hits.some((x)=>x.bundle==="dddddddddddd"));
const scenario=validateScenario({title:"نشاط",question:"أي خيار؟",options:[
 {text:"أ",result:"يطبق أ",explanation:"المحاضر اختار أ"},
 {text:"ب",result:"يطبق ب",explanation:"المحاضر اختار ب"}
]});
assert.equal(scenario.options.length,2);
assert.throws(()=>validateScenario({...scenario,options:scenario.options.slice(0,1)}));
assert.throws(()=>validateScenario({...scenario,options:[scenario.options[0],scenario.options[0]]}));
assert.deepEqual(calculateScenario({operation:"sum",a:2,b:3,unitA:"طالب",unitB:"طالب"}).result,5);
assert.equal(calculateScenario({operation:"percent",a:30,b:60,unitA:"طالب",unitB:"طالب"}).result,50);
assert.throws(()=>calculateScenario({operation:"ratio",a:3,b:0}));
assert.throws(()=>calculateScenario({operation:"sum",a:2,b:3,unitA:"طلاب",unitB:"أيام"}));
assert.throws(()=>calculateScenario({operation:"javascript",a:1,b:1}));
const first={question:"سؤال",options:["أ","ب"],counts:[3,7]};
const after={question:"سؤال",options:["أ","ب"],counts:[6,4]};
const comparison=comparePulse(first,after,0);
assert.equal(comparison.values[0].points,30);
assert.deepEqual(comparison.totals,[10,10]);
assert.throws(()=>comparePulse(first,{...after,options:["ب","أ"]}));

const portable = exportLivingArchive(bundle, graph, [scenario]);
const restored = importLivingArchive(portable, bundle);
assert.deepEqual(restored.graph.nodes.map((n) => n.text), graph.nodes.map((n) => n.text));
assert.equal(restored.scenarios[0].title, scenario.title);
assert.equal(validateKnowledgeSnapshot(graph, bundle).revision, 2);
assert.throws(() => importLivingArchive(portable, "other123"), /المحاضرة/);
assert.throws(() => importLivingArchive("{}", bundle), /المحاضرة/);
assert.throws(() => importLivingArchive(portable.slice(1), bundle), /JSON/);
assert.throws(() => importLivingArchive(JSON.stringify({
  ...JSON.parse(portable), graph:{...graph, nodes:[{...graph.nodes[0], status:"pending"},graph.nodes[1]]}
}), bundle), /غير معتمدة/);
assert.throws(() => importLivingArchive(JSON.stringify({
  ...JSON.parse(portable), graph:{...graph, nodes:[{...graph.nodes[0], source:{...source,approved:false}},graph.nodes[1]]}
}), bundle), /غير معتمدة/);
assert.throws(() => importLivingArchive(JSON.stringify({
  ...JSON.parse(portable), graph:{...graph, edges:[{from:"n1",to:"bad",relation:"related",approved:true}]}
}), bundle), /غير موثوقة/);
assert.throws(() => importLivingArchive(JSON.stringify({
  ...JSON.parse(portable), scenarios:[{...scenario,options:[{text:"مكسور"}]}]
}), bundle));
assert.equal(evaluateScenarioFormula("120*(1+15%)", "طالب").result, 138);
assert.equal(evaluateScenarioFormula("12+(5-3)*4").result, 20);
assert.equal(evaluateScenarioFormula("-(4+2)/3").result, -2);
assert.equal(evaluateScenarioFormula(".5*2").result, 1);
for (const malformed of ["0/0", "3/(2-2)", "1+abc", "Math.random()", "2**3",
  "1;", "", "1+(2", "10/(-0)", "2<3", "9".repeat(141)]) {
  assert.throws(() => evaluateScenarioFormula(malformed), undefined, malformed);
}
assert.throws(() => evaluateScenarioFormula("1+2", "<script>"));
const spokenSlide={elements:[{...box, text:"الألعاب التعليمية تعزز الدافعية"}]};
assert.equal(suggestXrayFromSpeech("الألعاب التعليمية تعزز الدافعية",spokenSlide)?.id,"s1-e2");
assert.equal(suggestXrayFromSpeech("الألعاب التعليمية لا تعزز الدافعية",spokenSlide),null);
assert.equal(suggestXrayFromSpeech("الألعاب التعليمية تعزز الدافعية",
  {...spokenSlide,build:{steps:[{},{}]}}),null);
assert.equal(suggestXrayFromSpeech("الألعاب التعليمية تعزز الدافعية",
  {elements:[spokenSlide.elements[0],{...spokenSlide.elements[0],id:"s1-e3"}]}),null);


assert.equal(cognitiveSpeechCue("كلام اعتيادي في سياق المحاضرة بدون طلب محدد"),null);
assert.equal(cognitiveSpeechCue("تذكرون لما شرحنا الألعاب التعليمية في المحاضرة السابقة؟")?.kind,"bridge");
assert.match(cognitiveSpeechCue("تذكرون لما شرحنا الألعاب التعليمية في المحاضرة السابقة؟")?.query||"",/الألعاب التعليمية/);
assert.equal(cognitiveSpeechCue("الخلاصة أن الألعاب التعليمية تعزز الدافعية")?.kind,"knowledge");
assert.equal(cognitiveSpeechCue("تذكرون المحاضرة السابقة؟"),null,"vague recall has no anchor");
console.log("Living Intelligence unit tests passed");
