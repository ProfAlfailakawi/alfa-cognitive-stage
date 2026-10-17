import assert from "node:assert/strict";
import { compareRounds, exportAggregateCsv } from "../web/poll-analytics.js";
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
console.log("aggregate poll CSV and before/after distribution checks passed");
