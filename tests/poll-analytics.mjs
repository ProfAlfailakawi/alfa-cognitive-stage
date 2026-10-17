import assert from "node:assert/strict";
import { compareRounds, exportAggregateCsv, summarizePollDistribution } from "../web/poll-analytics.js";
const polls=[
  { id:1,question:"هل نجحت التجربة؟",options:["نعم","لا"],total:10,counts:[4,6] },
  { id:2,question:"سؤال مستقل",options:["A","B"],total:5,counts:[5,0] },
  { id:3,question:"هل نجحت التجربة؟",options:["نعم","لا"],total:20,counts:[16,4] }
];
const rounds=compareRounds(polls);
assert.equal(rounds.length,1);
assert.equal(rounds[0].values[0].firstPercent,40);
assert.equal(rounds[0].values[0].lastPercent,80);
assert.equal(rounds[0].values[0].deltaPoints,40);
assert.equal(compareRounds([polls[0]]).length,0);
assert.equal(compareRounds([{...polls[0],total:0},polls[2]]).length,0);
const csv=exportAggregateCsv([...polls,{id:4,question:"=2+2",options:["-cmd","مضمون"],counts:[1,0],total:1}]);
assert.ok(csv.startsWith("\ufeff"));
assert.ok(csv.includes("'\u003d2+2"));
assert.ok(csv.includes("'-cmd"));
assert.ok(csv.includes("40.0"));

// Anonymized distribution can support discussion prompts, never a learning diagnosis.
const distribution = (counts) => ({
  question: "نقاش", options: counts.map((_,i)=>"خيار "+i), counts,
  total: counts.reduce((a,b)=>a+b,0)
});
const concentrated = summarizePollDistribution(distribution([16,2,2]));
assert.equal(concentrated.kind, "concentrated");
assert.ok(concentrated.text.includes("الأغلبية لا تثبت صحة"));
assert.equal(summarizePollDistribution(distribution([9,8,3])).kind, "divided");
assert.equal(summarizePollDistribution(distribution([9,6,5])).kind, "varied");
assert.equal(summarizePollDistribution(distribution([2,2,1])).kind, "small");
assert.equal(summarizePollDistribution(distribution([0,0])).kind, "empty");
assert.equal(summarizePollDistribution({...distribution([8,2]),total:19}), null);
assert.equal(summarizePollDistribution({...distribution([8,2]),counts:[8,-1]}), null);
assert.equal(summarizePollDistribution({...distribution([8,2]),counts:[8,2,1]}), null);
assert.equal(summarizePollDistribution({...distribution([8,2]),counts:[8,NaN]}), null);
assert.equal(summarizePollDistribution(distribution([8])), null);
assert.equal(summarizePollDistribution(null), null);
console.log("aggregate poll CSV and before/after distribution checks passed");
