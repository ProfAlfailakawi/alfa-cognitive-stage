import assert from "node:assert/strict";
import { renderInfographic, validateSpec } from "../web/infographic.js";
for(const type of ["concept","flow","timeline","story"]) {
 const svg=renderInfographic({type,title:"التعلم المباشر",lines:["تحفيز المتعلم","التغذية الراجعة","المشاركة"]});
 assert.match(svg,/viewBox="0 0 960 540"/);
 assert.ok(svg.includes("تحفيز المتعلم")&&svg.includes("المشاركة"));
}
assert.throws(()=>validateSpec({type:"story",title:"x",lines:["بداية"]}),/المشهد/);
assert.throws(()=>validateSpec({type:"flow",title:"x",lines:["1","2","3","4","5","6","7"]}),/المشهد/);
const html=renderInfographic({type:"concept",title:"<script>alert(1)</script>",lines:["اختبار","مفهوم"]});
assert.ok(!html.includes("<script>"));
assert.ok(html.includes("&lt;script&gt;"));
console.log("extra vector layouts passed");
