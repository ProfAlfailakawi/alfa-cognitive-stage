// Unit checks for the infographic renderer (runs in Node, no browser needed).
import { renderInfographic } from "../web/infographic.js";

let failures = 0;
const ok = (name, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
};
const throwsWith = (fn, text) => {
  try { fn(); return false; } catch (e) { return e.message.includes(text); }
};

const stat = renderInfographic({ type: "stat", title: "الألعاب التعليمية", lines: ["68%", "من المشاركين استفادوا"] });
ok("stat card shows the number exactly as typed", stat.includes(">68%</text>"));
ok("stat card shows the label as typed", stat.includes("من المشاركين استفادوا"));
ok("stat card has no invented source text", !/دراسة|باحث|سنة|عينة/.test(stat.replace("الألعاب التعليمية", "")));

const cmp = renderInfographic({ type: "compare", title: "فرق", lines: ["هدف تعليمي | هدف ترفيهي", "تغذية راجعة | تغذية مختلفة"] });
ok("compare renders both columns", cmp.includes("هدف تعليمي") && cmp.includes("هدف ترفيهي"));

const steps = renderInfographic({ type: "steps", title: "خطوات", lines: ["اختر الهدف", "صمم النشاط", "قيّم الأثر"] });
ok("steps render every step text", ["اختر الهدف", "صمم النشاط", "قيّم الأثر"].every((t) => steps.includes(t)));

ok("unknown type is refused", throwsWith(() => renderInfographic({ type: "pie", title: "x", lines: ["1", "2"] }), "نوع"));
ok("stat with too many lines is refused", throwsWith(() => renderInfographic({ type: "stat", title: "x", lines: ["1", "a", "b"] }), "رقماً"));
ok("compare line without a separator is refused", throwsWith(() => renderInfographic({ type: "compare", title: "x", lines: ["بدون فاصل"] }), "الأول"));
ok("steps with one item is refused", throwsWith(() => renderInfographic({ type: "steps", title: "x", lines: ["واحدة"] }), "خطوات"));

const hostile = renderInfographic({ type: "steps", title: "<img src=x onerror=alert(1)>", lines: ["<script>x</script>", "ok"] });
ok("markup in user text is escaped", !hostile.includes("<script>") && !hostile.includes("<img"));

console.log(failures ? `\n${failures} failed` : "\nall infographic checks passed");
process.exit(failures ? 1 : 0);
