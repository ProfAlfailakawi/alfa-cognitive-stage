// Presenter-only contextual tools for ALFA Living Intelligence.
// No private notes, sources or unapproved options are broadcast to audience windows.
import { sourceRecord, createKnowledgeGraph, appendKnowledge, loadKnowledge, saveKnowledge, clearKnowledge,
  audienceGraph, graphPage as knowledgeGraphPage, eligibleShape, xrayProjection, findTimeBridge, validateScenario, calculateScenario, canEnterStage,
  exportLivingArchive, importLivingArchive, evaluateScenarioFormula, suggestXrayFromSpeech } from "./living-intelligence.js";
import { createContextualCognitiveDirector } from "./cognitive-context-director.js";
import { roomReadabilityStatus } from "./cognitive-readability.js";
const make = (tag, text = "", className = "") => {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  if (className) el.className = className;
  return el;
};
function appendInput(root, placeholder, maxLength = 240, multiline = false) {
  const node = make(multiline ? "textarea" : "input");
  if (!multiline) node.type = "text";
  node.placeholder = placeholder;
  node.maxLength = maxLength;
  root.append(node);
  return node;
}
function btn(parent, label, action, cls = "") {
  const element = make("button", label, cls);
  element.type = "button"; element.onclick = action; parent.append(element);
  return element;
}
const savedKey = (bundle) => "alfa-what-if-v1:" + bundle;
function storeScenarios(bundle, list) {
  try {
    const raw = JSON.stringify({ version: 1, scenarios: list.slice(-30) });
    if (raw.length > 65000) throw Error("حجم السيناريوهات كبير");
    localStorage.setItem(savedKey(bundle), raw);
    return true;
  } catch { return false; }
}
function readScenarios(bundle) {
  try {
    const data = JSON.parse(localStorage.getItem(savedKey(bundle)) || "null");
    if (data?.version !== 1 || !Array.isArray(data.scenarios)) return [];
    return data.scenarios.slice(-30).flatMap((s) => { try { return [validateScenario(s)]; } catch { return []; } });
  } catch { return []; }
}
export function validCognitivePacket(value, { bundle, index, step, videoPlaying = false } = {}) {
  if (!value || typeof value !== "object" || videoPlaying || value.bundle !== bundle ||
      value.slide !== index || value.step !== step ||
      !["living", "xray", "bridge", "whatif", "pulse"].includes(value.kind) ||
      JSON.stringify(value).length > 16000) return false;
  if (value.kind === "living") return Array.isArray(value.nodes) && value.nodes.length <= 8 &&
    value.nodes.every((n) => typeof n.text === "string" && n.text.length <= 300) &&
    Array.isArray(value.edges) && value.edges.length <= 16;
  if (value.kind === "xray") return Array.isArray(value.boxes) && value.boxes.length >= 1 &&
    value.boxes.length <= 2 && value.boxes.every((b) => [b.x, b.y, b.w, b.h].every(Number.isFinite) &&
      b.x >= 0 && b.y >= 0 && b.w > 0 && b.h > 0 && b.x + b.w <= 1.001 && b.y + b.h <= 1.001);
  if (value.kind === "pulse") return typeof value.question === "string" && value.question.length <= 200 &&
    Array.isArray(value.totals) && value.totals.length === 2 &&
    value.totals.every((n) => Number.isSafeInteger(n) && n >= 0) &&
    Array.isArray(value.values) && value.values.length >= 2 && value.values.length <= 6 &&
    value.values.every((v) => typeof v.option === "string" && v.option.length <= 200 &&
      [v.firstPercent,v.lastPercent,v.deltaPoints].every(Number.isFinite) &&
      v.firstPercent>=0 && v.firstPercent<=100 && v.lastPercent>=0 && v.lastPercent<=100 &&
      Math.abs(v.deltaPoints)<=100);
  if (value.kind === "bridge") return typeof value.title === "string" &&
    typeof value.excerpt === "string" && value.excerpt.length <= 240;
  return typeof value.title === "string" && typeof value.question === "string" &&
    Array.isArray(value.options) && value.options.length >= 2 && value.options.length <= 3 &&
    value.options.every((v) => typeof v === "string") &&
    (!value.revealed || (Number.isInteger(value.chosen) && value.chosen >= 0 &&
      value.chosen < value.options.length && typeof value.result === "string"));
}

const SVG_NS = "http://www.w3.org/2000/svg";
const svgNode = (tag, attrs = {}) => {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
};
/** Single even-odd overlay: neither of two selected shapes can darken the other. */
function focusMask(boxes) {
  const svg = svgNode("svg", {viewBox:"0 0 1000 1000", preserveAspectRatio:"none",
    class:"cognitive-focus-mask", "aria-hidden":"true"});
  const coords = boxes.map((b) => ({x:b.x*1000,y:b.y*1000,w:b.w*1000,h:b.h*1000}));
  const holes = coords.map((b) => "M"+b.x+" "+b.y+"h"+b.w+"v"+b.h+"h"+(-b.w)+"Z").join(" ");
  svg.append(svgNode("path",{d:"M0 0h1000v1000h-1000Z "+holes,fill:"rgba(0,0,0,.42)","fill-rule":"evenodd"}));
  for (const b of coords) svg.append(svgNode("rect",{x:b.x,y:b.y,width:b.w,height:b.h,
    rx:3,ry:3,fill:"none",stroke:"#f1d9a8","stroke-width":"3",class:"cognitive-focus-outline"}));
  return svg;
}
/** Connect only lecturer-approved edges, measured using the actual rendered positions. */
function paintLivingLinks(layer, value) {
  if (!layer.isConnected || layer.dataset.kind !== "living") return;
  const body = layer.querySelector(".cognitive-stage-body");
  if (!body) return;
  let svg = body.querySelector(".cognitive-links");
  if (!svg) {svg = svgNode("svg",{class:"cognitive-links","aria-hidden":"true"});body.prepend(svg);}
  svg.replaceChildren();
  const w=body.clientWidth,h=body.clientHeight;
  if (!w || !h) return;
  svg.setAttribute("viewBox","0 0 "+w+" "+h);
  const parent=body.getBoundingClientRect(), coords=new Map();
  body.querySelectorAll(".cognitive-node[data-node]").forEach((el)=>{
    const r=el.getBoundingClientRect();
    coords.set(el.dataset.node,{x:r.left-parent.left+r.width/2,y:r.top-parent.top+r.height/2,w:r.width,h:r.height});
  });
  for (const edge of value.edges || []) {
    const a=coords.get(edge.from),b=coords.get(edge.to);
    if (!a || !b) continue;
    const dx=b.x-a.x,dy=b.y-a.y;
    if (Math.hypot(dx,dy)<1) continue;
    const horizontal=Math.abs(dx/a.w)>Math.abs(dy/a.h);
    const sx=a.x+(horizontal?Math.sign(dx)*a.w/2:0), sy=a.y+(horizontal?0:Math.sign(dy)*a.h/2);
    const ex=b.x-(horizontal?Math.sign(dx)*b.w/2:0), ey=b.y-(horizontal?0:Math.sign(dy)*b.h/2);
    svg.append(svgNode("path",{d:"M"+sx+" "+sy+" Q"+((sx+ex)/2)+" "+((sy+ey)/2)+" "+ex+" "+ey,
      class:"cognitive-link-path",fill:"none"}));
  }
}

function verifyStageLegibility(layer) {
  if (!layer.isConnected) return;
  const fit = roomReadabilityStatus(layer);
  layer.dataset.roomFit = fit.ok ? "ok" : "review";
  layer.classList.toggle("room-fit-tight", !fit.ok);
  if (!fit.ok) requestAnimationFrame(() => {
    if (layer.isConnected) layer.dataset.roomFit = roomReadabilityStatus(layer).ok ? "ok" : "review";
  });
}
export function renderCognitiveProjection(stage, value) {
  if (!stage) return;
  const prior = stage.querySelector(".cognitive-projection");
  if (!value) { prior?._alfaResize?.disconnect(); prior?.remove(); return; }
  if (!validCognitivePacket(value, { bundle: value.bundle, index: value.slide, step: value.step })) return;
  if (value.kind === "xray") {
    prior?._alfaResize?.disconnect();
    prior?.remove();
    const overlay = make("div", "", "info-layer cognitive-projection cognitive-xray");
    overlay.dataset.kind = "xray";
    overlay.append(focusMask(value.boxes));
    stage.append(overlay);
    return;
  }
  let layer = prior;
  if (!layer || layer.dataset.kind !== value.kind) {
    layer?._alfaResize?.disconnect();
    layer?.remove();
    layer = make("section", "", "info-layer cognitive-projection cognitive-card-stage");
    layer.dataset.kind = value.kind;
    layer.append(make("p", "ALFA", "cognitive-eyebrow"), make("h2", "", "cognitive-stage-heading"), make("div", "", "cognitive-stage-body"),
      make("p", "", "cognitive-stage-foot"));
    stage.append(layer);
  }
  layer.querySelector("h2").textContent = value.title || "المسرح المعرفي";
  const body = layer.querySelector(".cognitive-stage-body"), foot = layer.querySelector(".cognitive-stage-foot");
  body.classList.toggle("cognitive-branches", value.kind === "whatif");
  body.classList.toggle("cognitive-living-map", value.kind === "living");
  body.dataset.revealed = value.kind === "whatif" && value.revealed ? "true" : "false";
  layer.querySelector(".cognitive-eyebrow").textContent = ({
    living:"ALFA  /  شبكة المعرفة", whatif:"ALFA  /  مختبر القرارات",
    bridge:"ALFA  /  جسر الذاكرة",pulse:"ALFA  /  نبض الفهم"
  })[value.kind] || "ALFA";
  body.classList.toggle("cognitive-pulse-body", value.kind === "pulse");
  body.dataset.count = String(value.kind === "living" ? value.nodes.length :
    value.kind === "whatif" ? value.options.length : 1);
  if (value.kind === "living") {
    const ids = new Set(value.nodes.map((node) => node.id));
    body.querySelectorAll("[data-node]").forEach((el) => { if (!ids.has(el.dataset.node)) el.remove(); });
    for (const node of value.nodes) {
      let el = [...body.querySelectorAll("[data-node]")].find((x) => x.dataset.node === node.id);
      if (!el) {
        el = make("article", "", "cognitive-node");
        el.dataset.node = node.id;
        el.append(make("small"), make("p"));
        body.append(el);
      }
      const role = ({topic:"الفكرة الرئيسية",concept:"مفهوم",example:"مثال",
        stat:"إحصائية",compare:"مقارنة",step:"خطوة",question:"سؤال",summary:"خلاصة"})[node.type] || "عنصر";
      el.querySelector("small").textContent = role +
        (node.parts > 1 ? " · جزء " + node.part + " من " + node.parts : "");
      el.querySelector("p").textContent = node.text;
      el.querySelector("p").title = node.text;
      el.dataset.kind = node.type;
      el.classList.toggle("cognitive-topic", node.type === "topic");
    }
    const relationNames = {"related":"مرتبط بـ","part-of":"جزء من","example-of":"مثال على",
      "compared-with":"مقارنة مع","precedes":"يسبق","explains":"يشرح"};
    const names = new Map(value.nodes.map((node) => [node.id, node.text]));
    const links = (value.edges || []).filter((edge) => names.has(edge.from) && names.has(edge.to));
    foot.textContent = "اللقطة " + (value.page + 1) + " من " + value.pages +
      " · " + links.length + " علاقات معتمدة · النصوص محفوظة من المصدر";
    layer.setAttribute("aria-label", "روابط المعرفة: " +
      links.map((e) => names.get(e.from) + " " + (relationNames[e.relation] || "مرتبط بـ") + " " + names.get(e.to)).join("؛ "));
    layer._alfaRenderLinks = () => paintLivingLinks(layer, value);
    if (!layer._alfaResize && typeof ResizeObserver !== "undefined") {
      layer._alfaResize = new ResizeObserver(() => layer._alfaRenderLinks?.());
      layer._alfaResize.observe(body);
    }
    requestAnimationFrame(() => {layer._alfaRenderLinks?.();verifyStageLegibility(layer);});
  } else {
    body.replaceChildren();
    if (value.kind === "bridge") {
      body.append(make("p", value.excerpt, "cognitive-bridge-quote"));
      foot.textContent = value.lecture + " — الشريحة " + value.fromSlide;
    } else if (value.kind === "pulse") {
      const display=make("div","","cognitive-pulse-visual");
      for(const record of value.values){
        const row=make("article","","cognitive-pulse-item");
        row.append(make("h3",record.option));
        for(const [label,percent,style] of [["قبل",record.firstPercent,"before"],["بعد",record.lastPercent,"after"]]){
          const line=make("div","","cognitive-pulse-line");
          line.append(make("span",label+" · "+percent.toFixed(1)+"%"));
          const track=make("div","","cognitive-pulse-track");
          const fill=make("span","","cognitive-pulse-fill "+style);
          fill.style.width=percent+"%";track.append(fill);line.append(track);
          row.append(line);
        }
        display.append(row);
      }
      body.append(display);
      foot.textContent="قبل: "+value.totals[0]+" مشاركات · بعد: "+value.totals[1]+
        " مشاركات · فرق التوزيع لا يثبت السببية أو مشاركة الأشخاص أنفسهم.";
    } else if (value.kind === "whatif") {
      body.append(make("p", value.question, "cognitive-question"));
      for (let i = 0; i < value.options.length; i++) {
        const item = make("article", value.options[i], "cognitive-node cognitive-branch");
        item.dataset.branch = String(i + 1);
        item.setAttribute("aria-label", "المسار " + (i + 1) + ": " + value.options[i]);
        if (value.revealed && i === value.chosen) item.classList.add("cognitive-chosen");
        body.append(item);
      }
      if (value.revealed) {
        const outcome=make("section","","cognitive-outcome");
        outcome.append(make("small","المسار المختار — " + value.options[value.chosen]),
          make("p",value.result,"cognitive-revealed-result"));
        body.append(outcome);
      }
      foot.textContent = value.revealed ? "نتيجة كتبها واعتمدها المحاضر" : "النتائج لم تُكشف بعد";
    }
  }
  if (value.kind !== "living") requestAnimationFrame(() => verifyStageLegibility(layer));
}

export function mountLivingIntelligence(mount, context) {
  const bundle = context.getBundle();
  let graph = loadKnowledge(bundle), graphPage = 0, scenarios = readScenarios(bundle);
  let currentScenario = null, lastRevealedBranch = null, suggestion = null, referenceResults = [];
  let referenceStamp = 0, referenceCache = new Map(), referenceVersion = "";
  const root = make("details", "", "cognitive-drawer");
  root.id = "cognitive-drawer";
  root.append(make("summary", "المسرح المعرفي — ALFA Living Intelligence"));
  const status = make("p", "الأدوات اختيارية، ولا تنشر أي معلومة دون موافقتك.", "meta");
  status.setAttribute("role", "status");
  const say = (v) => { status.textContent = String(v); };
  const safeProject = (payload) => {
    const verdict = canEnterStage({ videoPlaying: context.videoPlaying(),
      mode: context.currentMode(), requested: payload.kind, approved: true });
    if (!verdict.ok) { say(verdict.reason); return false; }
    context.project({ ...payload, bundle, slide: context.getSlide(), step: context.getStep() });
    return true;
  };
  const activeSlide = () => context.getSlides()[context.getSlide() - 1] || {};
  const sections = [];
  const section = (title) => {
    const details = make("details", "", "cognitive-tools-section");
    details.append(make("summary", title));
    root.append(details);
    sections.push(details);
    details.addEventListener("toggle", () => {
      if (details.open) for (const other of sections) if (other !== details) other.open = false;
    });
    return details;
  };
  const living = section("01 · بناء المعرفة");
  const graphSummary = make("p", "", "meta"), proposalLine = make("p", "", "meta");
  const text = appendInput(living, "اكتب عبارة من المصدر أو من كلامك (تُراجع قبل الإضافة)", 300, true);
  const type = make("select"); type.setAttribute("aria-label", "نوع العقدة");
  for (const [id, label] of Object.entries({topic:"فكرة رئيسية",concept:"مفهوم",example:"مثال",stat:"إحصائية",
    compare:"مقارنة",step:"خطوة",question:"سؤال",summary:"خلاصة"})) {
    const o = make("option", label); o.value = id; type.append(o);
  }
  const parentNode = make("select"); parentNode.setAttribute("aria-label", "العقدة المرتبطة");
  const relation = make("select"); relation.setAttribute("aria-label", "نوع العلاقة");
  for (const [value, label] of Object.entries({
    "related":"مرتبط بـ", "part-of":"جزء من", "example-of":"مثال على",
    "compared-with":"مقارنة مع", "precedes":"يسبق", "explains":"يشرح"
  })) { const o = make("option", label); o.value = value; relation.append(o); }
  living.append(type, parentNode, relation, proposalLine);
  const actions = make("div", "", "cognitive-actions"); living.append(actions);
  function summaryGraph() {
    graphSummary.textContent = "عناصر معتمدة: " + graph.nodes.length + " · علاقات معتمدة: " + graph.edges.length;
    const selected = parentNode.value;
    parentNode.replaceChildren();
    const none = make("option", graph.nodes.length ? "العقدة الرئيسية (افتراضي)" : "لا علاقة — أول عنصر");
    none.value = graph.nodes[0]?.id || ""; parentNode.append(none);
    for (const n of graph.nodes) {
      const o = make("option", n.text.slice(0, 70)); o.value = n.id; parentNode.append(o);
    }
    parentNode.value = graph.nodes.some((n) => n.id === selected) ? selected : (graph.nodes[0]?.id || "");
  }
  btn(actions, "أضف للمشهد", () => {
    if (!text.value.trim()) { say("أدخل نصاً صريحاً أو اختر اقتراحاً"); return; }
    const raw = text.value.trim();
    try {
      const original = suggestion && suggestion.text === raw ? suggestion.original : raw;
      const source = sourceRecord({ bundle, slide: context.getSlide(), originalText: original,
        kind: suggestion && suggestion.text === raw ? "speech" : "lecturer", approved: true });
      const result = appendKnowledge(graph, { type: type.value, text: raw, source,
        parentId: parentNode.value || null, relation: relation.value });
      graph = result.graph; saveKnowledge(graph); summaryGraph(); suggestion = null; proposalLine.textContent = "";
      graphPage = Math.ceil(graph.nodes.length / 6) - 1;
      if (!safeProject(audienceGraph(graph, graphPage))) return;
      text.value = "";
      say(result.duplicate ? "المفهوم موجود بالفعل؛ لم نكرر العقدة." : "أُضيفت العبارة التي وافقت عليها وحُفظ المصدر.");
    } catch (e) { say(e.message); }
  }, "primary");
  btn(actions, "تجاهل", () => { suggestion = null; text.value = ""; proposalLine.textContent = ""; say("تجاهلت الاقتراح؛ لم يُرسل للطلبة."); });
  btn(actions, "السابق", () => { graphPage--; safeProject(audienceGraph(graph, graphPage)); graphPage = Math.max(0, graphPage); });
  btn(actions, "التالي", () => { graphPage = Math.min(Math.ceil(graph.nodes.length / 6) - 1, graphPage + 1);
    graphPage = Math.max(0, graphPage); safeProject(audienceGraph(graph, graphPage)); });
  btn(actions, "مسح هذه الشبكة", () => {
    if (!confirm("حذف الشبكة المعرفية المحفوظة لهذه المحاضرة؟")) return;
    graph = createKnowledgeGraph(bundle); clearKnowledge(bundle); summaryGraph(); context.hide(); say("حُذفت الشبكة.");
  });
  living.append(graphSummary);
  summaryGraph();
  living.append(make("p", "النسخة الخاصة تحتوي عبارات ومصادر المحاضر؛ احتفظ بها في مكان آمن. الاستيراد يستبدل بيانات هذه المحاضرة فقط، ولا ينشر شيئاً للطلبة.", "meta"));
  btn(actions, "صدّر نسخة خاصة", () => {
    try {
      const archive = exportLivingArchive(bundle, graph, scenarios);
      const url = URL.createObjectURL(new Blob([archive], {type:"application/json;charset=utf-8"}));
      const download = make("a"); download.href = url;
      download.download = "alfa-living-" + bundle + ".json";
      document.body.append(download); download.click(); download.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      say("تم إعداد نسخة خاصة لهذه المحاضرة؛ لا تشاركها مع الطلبة.");
    } catch (error) { say(error.message); }
  });
  const importFile = make("input");
  importFile.type = "file"; importFile.accept = ".json,application/json";
  importFile.hidden = true; importFile.style.display = "none";
  importFile.setAttribute("aria-label", "استيراد نسخة المسرح المعرفي");
  living.append(importFile);
  btn(actions, "استورد نسخة خاصة", () => { importFile.value = ""; importFile.click(); });
  importFile.onchange = async () => {
    const file = importFile.files?.[0]; if (!file) return;
    try {
      if (file.size > 400000) throw Error("حجم الملف أكبر من الحد المسموح");
      const archive = importLivingArchive(await file.text(), bundle);
      if (!confirm("استبدال الشبكة والسيناريوهات المحفوظة لهذه المحاضرة بالنسخة المحددة؟")) return;
      const oldGraph = graph, oldScenarios = scenarios;
      if (!saveKnowledge(archive.graph)) throw Error("تعذّر حفظ الشبكة محلياً");
      if (!storeScenarios(bundle, archive.scenarios)) {
        saveKnowledge(oldGraph); storeScenarios(bundle, oldScenarios);
        throw Error("تعذّر حفظ السيناريوهات؛ استُعيدت البيانات السابقة");
      }
      graph = archive.graph; scenarios = archive.scenarios;
      currentScenario = null; lastRevealedBranch = null; graphPage = 0;
      summaryGraph(); refreshScenarioList(); refreshBranch();
      context.hide();
      say("استُعيدت الشبكة والسيناريوهات محلياً بعد التحقق، دون عرض أي محتوى للطلبة.");
    } catch (error) { say(error.message); }
  };

  const xray = section("02 · X-Ray داخل الشريحة");
  const xrayMessage = make("p", "", "meta"), shapeList = make("div", "", "cognitive-shapes");
  xray.append(xrayMessage, shapeList);
  let xraySelection = new Set();
  function refreshShapes() {
    xraySelection.clear(); shapeList.replaceChildren();
    const slide = activeSlide(), shapes = (slide.elements || []).filter((s) => eligibleShape(s, slide, context.getStep()));
    xrayMessage.textContent = shapes.length ? "اختر عنصراً أو عنصرين كما هما على الشريحة." :
      "لا تتوفر إحداثيات آمنة لهذه الشريحة أو تحتوي على حركات لا تسمح بالتركيز.";
    for (const s of shapes.slice(0, 45)) {
      const label = make("label", "", "cognitive-shape-choice");
      const check = make("input"); check.type = "checkbox"; check.value = s.id;
      check.onchange = () => {
        if (check.checked) {
          if (xraySelection.size >= 2) { check.checked = false; say("الحد عنصران للمقارنة."); return; }
          xraySelection.add(s.id);
        } else xraySelection.delete(s.id);
      };
      label.append(check, make("span", s.text || s.type + " — " + s.id)); shapeList.append(label);
    }
  }
  xray.addEventListener("toggle", () => { if (xray.open) refreshShapes(); });
  btn(xray, "ركّز على الاختيار", () => {
    const slide = activeSlide(), chosen = (slide.elements || []).filter((s) => xraySelection.has(s.id));
    try { safeProject(xrayProjection(chosen, slide, context.getStep())); } catch (e) { say(e.message); }
  }, "primary");
  btn(xray, "ألغِ التركيز", () => context.hide());
  let picking = false, stopPicking = null;
  btn(xray, "تحديد بالنقر على معاينة الشريحة", () => {
    const stage = context.getStage();
    if (!stage || context.videoPlaying()) { say("لا يمكن تحديد عناصر أثناء تشغيل الفيديو."); return; }
    if (picking) { stopPicking?.(); say("أُلغي تحديد العنصر."); return; }
    picking = true; say("انقر على العنصر في معاينة الشريحة مرة واحدة.");
    stage.classList.add("cognitive-pick-mode");
    const cancel = () => {
      stage.removeEventListener("click", selectAtPoint, true);
      stage.classList.remove("cognitive-pick-mode"); picking = false; stopPicking = null;
    };
    const selectAtPoint = (event) => {
      event.preventDefault(); event.stopImmediatePropagation();
      cancel();
      const rect = stage.getBoundingClientRect(),
        x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
      const slide = activeSlide();
      const matches = (slide.elements || []).filter((s) => eligibleShape(s, slide, context.getStep()) &&
        x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h)
        .sort((a, b) => a.w * a.h - b.w * b.h);
      if (!matches.length) { say("لا يوجد عنصر موثوق في الموضع المحدد."); return; }
      try { safeProject(xrayProjection([matches[0]], slide, context.getStep())); }
      catch (e) { say(e.message); }
    };
    stage.addEventListener("click", selectAtPoint, true);
    stopPicking = cancel;
  });

  const pulse = section("03 · نبض الفهم: قبل وبعد");
  pulse.append(make("p", "استخدم التصويت الحالي: أنشئ سؤالاً قبل الشرح، أغلق الجولة، ثم أعد السؤال نفسه بالخيارات والترتيب نفسيهما. تظهر المقارنة المجمّعة في لوحة التصويت.", "meta"));
  btn(pulse, "فتح إدارة السؤال القبلي/البعدي", () => context.openVoting());

  const bridge = section("04 · جسر المحاضرات السابقة");
  const bridgeInput = appendInput(bridge, "مفهوم أو عبارة من محاضرة سابقة", 180);
  const across = make("label", " تضمين بقية المقررات");
  const acrossBox = make("input"); acrossBox.type = "checkbox"; across.prepend(acrossBox);
  bridge.append(across);
  const results = make("div", "", "cognitive-bridge-results"); bridge.append(results);
  async function loadReferences() {
    const token = context.getToken();
    if (!token) throw Error("أدخل رمز المحاضر للوصول للمكتبة");
    const snapshot = await fetch("/api/library", { headers: { "X-Admin-Token": token } }).then((r) => {
      if (!r.ok) throw Error("تعذّر قراءة مكتبة المحاضر"); return r.json();
    });
    const current = snapshot.lectures.find((l) => l.bundle === bundle);
    const lectures = snapshot.lectures.filter((l) => l.bundle !== bundle &&
      (acrossBox.checked || (current?.courseId && l.courseId === current.courseId))).slice(0, 40);
    const localGraphs = new Map(lectures.map((l) => [l.bundle, loadKnowledge(l.bundle)]));
    const version = JSON.stringify(lectures.map((l) => [l.bundle, l.courseId, l.slideCount,
      l.title, l.builtAt, localGraphs.get(l.bundle)?.revision || 0]));
    if (referenceVersion === version) return [...referenceCache.values()].flat();
    referenceVersion = version; referenceCache = new Map();
    // Only manifests already stored on the lecturer's machine, never a remote service.
    for (const lecture of lectures) {
      const response = await fetch("/bundles/" + encodeURIComponent(lecture.bundle) + "/manifest.json");
      if (!response.ok) continue;
      const manifest = await response.json();
      referenceCache.set(lecture.bundle, (manifest.slides || []).slice(0, 300).flatMap((s, i) => {
        const texts = [["slide", s.text], ["notes", s.notes]]
          .map(([sourceKind, value]) => [sourceKind, String(value || "").trim()])
          .filter(([, value]) => Boolean(value));
        return texts.map(([sourceKind, passage]) => ({ bundle: lecture.bundle,
          lecture: lecture.title, courseId: lecture.courseId, slide: i + 1,
          text: passage.slice(0, 2400), sourceKind }));
      }));
      // Only explicit approved knowledge from the same locally stored lecture is searchable.
      // This does not send private provenance to the audience.
      const approved = localGraphs.get(lecture.bundle);
      const rows = referenceCache.get(lecture.bundle) || [];
      for (const node of (approved?.nodes || [])) {
        if (rows.length >= 650) break;
        if (node.status !== "approved" || !node.source?.approved ||
            node.source.bundle !== lecture.bundle || !node.text || !Number.isInteger(node.slide)) continue;
        rows.push({bundle:lecture.bundle, lecture:lecture.title, courseId:lecture.courseId,
          slide:node.slide, text:node.text, sourceKind:"approved-scene"});
      }
      referenceCache.set(lecture.bundle, rows);
    }
    // The existing, lecturer-authenticated memory store contains real previously approved scenes.
    // Its records are not sent to students; only a chosen short literal excerpt can be projected.
    try {
      const reply = await fetch("/api/memory/library", { headers: { "X-Admin-Token": token } });
      if (reply.ok) {
        const data = await reply.json();
        const authorized = new Map(lectures.map((l) => [l.bundle, l]));
        for (const item of (Array.isArray(data.scenes) ? data.scenes : []).slice(0, 150)) {
          const lecture = authorized.get(item.bundle);
          if (!lecture || !Number.isInteger(item.slide)) continue;
          const passage = String(item.utterance || item.spec?.title || "").trim();
          if (!passage) continue;
          const entries = referenceCache.get(item.bundle) || [];
          if (entries.length >= 650) continue;
          entries.push({ bundle: item.bundle, lecture: lecture.title, courseId: lecture.courseId,
            slide: item.slide, text: passage.slice(0, 2400), sourceKind:"approved-scene" });
          referenceCache.set(item.bundle, entries);
        }
      }
    } catch { /* Previously approved scenes are optional; slide index still works offline. */ }
    return [...referenceCache.values()].flat();
  }
  btn(bridge, "ابحث محلياً", async () => {
    const stamp = ++referenceStamp; results.replaceChildren(); say("أبحث في المحاضرات المخزنة على الجهاز...");
    try {
      const entries = await loadReferences();
      if (stamp !== referenceStamp) return;
      const matches = findTimeBridge(bridgeInput.value, entries, bundle,
        { allCourses: true }); // The course restriction was enforced when loading authorized manifests.
      referenceResults = matches;
      if (!matches.length) { say("لا يوجد تطابق موثوق؛ لن يُخترع مرجع."); return; }
      for (const hit of matches) {
        const item = make("div", "", "cognitive-reference");
        const origin = {"slide":"من نص الشريحة", "notes":"من ملاحظات المحاضر",
          "approved-scene":"من معرفة أو مشهد اعتُمد سابقاً"}[hit.sourceKind] || "مرجع محلي";
        item.append(make("strong", hit.lecture + " — شريحة " + hit.slide),
          make("p", hit.excerpt), make("p", origin + " · " + hit.reason, "meta"));
        btn(item, "اعرض التذكير", () => safeProject({ kind:"bridge", title:"تذكّر من المحاضرة السابقة",
          lecture: hit.lecture, fromSlide: hit.slide, excerpt: hit.excerpt }));
        btn(item, "افتح الشريحة الأصلية في نافذة مستقلة", () =>
          window.open("/?bundle=" + encodeURIComponent(hit.bundle) + "&start=" + hit.slide,
            "alfa-reference-" + hit.bundle, "noopener"));
        results.append(item);
      }
      say("عُرضت اقتراحات للمحاضر فقط؛ لا يُنشر شيء حتى تختار «اعرض التذكير».");
    } catch (e) { if (stamp === referenceStamp) say(e.message); }
  });

  const whatif = section("05 · تجربة ماذا لو");
  const title = appendInput(whatif, "عنوان السيناريو", 100);
  const question = appendInput(whatif, "السؤال أو الموقف", 240, true);
  const kind = make("select"); kind.setAttribute("aria-label", "نوع السيناريو");
  for (const [v, t] of [["concept","سيناريو مفاهيمي"],["numeric","سيناريو حسابي حتمي"]]) {
    const o = make("option", t); o.value = v; kind.append(o);
  }
  whatif.append(kind, make("p", "اكتب الخيارات ونتائجها وتفسيراتها في حقول مستقلة؛ لا تظهر النتائج للطلاب قبل موافقتك.", "meta"));
  const editor=make("div","","cognitive-scenario-editor");whatif.append(editor);
  const rows=[];
  function appendChoice(initial={}) {
    if (rows.length>=3) {say("الحد ثلاثة مسارات.");return;}
    const group=make("fieldset","","cognitive-choice-editor");
    const legend=make("legend","المسار "+(rows.length+1));group.append(legend);
    const fields=[
      appendInput(group,"الخيار",140),
      appendInput(group,"النتيجة المعتمدة",320,true),
      appendInput(group,"التفسير التعليمي",350,true),
      appendInput(group,"المرجع (اختياري)",180)];
    const values=[initial.text,initial.result,initial.explanation,initial.reference];
    fields.forEach((field,i)=>{
      field.value=values[i]||"";
      field.setAttribute("aria-label",["الخيار","النتيجة","التفسير","المرجع"][i]+" للمسار "+(rows.length+1));
    });
    btn(group,"حذف المسار",()=>{
      if(rows.length<=2){say("يلزم مساران على الأقل.");return;}
      group.remove();
      rows.splice(rows.findIndex((row)=>row.group===group),1);
      rows.forEach((row,i)=>{row.group.querySelector("legend").textContent="المسار "+(i+1);});
    });
    rows.push({group,fields});editor.append(group);
  }
  function populateChoices(options) {
    editor.replaceChildren();rows.length=0;
    for(const choice of options)appendChoice(choice);
    while(rows.length<2)appendChoice();
  }
  function readChoices() {
    return rows.map((r)=>({text:r.fields[0].value.trim(),
      result:r.fields[1].value.trim(),explanation:r.fields[2].value.trim(),
      reference:r.fields[3].value.trim()}));
  }
  populateChoices([{},{}]);
  btn(whatif,"أضف مسارًا ثالثًا",()=>appendChoice());
  const storedList = make("select"); storedList.setAttribute("aria-label","سيناريو محفوظ"); whatif.append(storedList);
  function refreshScenarioList() {
    storedList.replaceChildren();
    const empty = make("option", "اختر سيناريو محفوظاً"); empty.value = ""; storedList.append(empty);
    scenarios.forEach((s, i) => { const o = make("option", s.title); o.value = String(i); storedList.append(o); });
  }
  storedList.onchange = () => {
    if (storedList.value === "") return;
    const s = scenarios[Number(storedList.value)];
    if (!s) return;
    currentScenario = s; title.value = s.title; question.value = s.question; kind.value = s.type;
    populateChoices(s.options);
  };
  refreshScenarioList();
  const scenarioActions = make("div", "", "cognitive-actions"); whatif.append(scenarioActions);
  btn(scenarioActions, "احفظ السيناريو", () => {
    try {
      const s = validateScenario({ title: title.value, question: question.value, type: kind.value,
        slide: context.getSlide(),
        options: readChoices() });
      currentScenario = s;
      scenarios = scenarios.filter((x) => x.title !== s.title).concat(s).slice(-30);
      if (!storeScenarios(bundle, scenarios)) throw Error("تعذّر الحفظ المحلي");
      refreshScenarioList(); storedList.value = String(scenarios.findIndex((item) => item.title === s.title));
      refreshBranch(); say("حُفظ السيناريو الذي ألفته، دون توليد نتائج.");
    } catch (e) { say(e.message); }
  }, "primary");
  btn(scenarioActions, "اعرض السؤال", () => {
    if (!currentScenario) { say("احفظ السيناريو أولاً"); return; }
    lastRevealedBranch = null;
    safeProject({ kind:"whatif", title: currentScenario.title, question: currentScenario.question,
      options: currentScenario.options.map((o) => o.text), revealed:false });
  });
  btn(scenarioActions, "تصويت عبر QR الحالي", () => {
    if (!currentScenario) { say("احفظ السيناريو أولاً"); return; }
    context.openScenarioVote({ question: currentScenario.question, options: currentScenario.options.map((o) => o.text) });
    say("أُرسل السؤال إلى لوحة التصويت الحالية. تأكد من عدم وجود سؤال نشط.");
  });
  const branchSelect = make("select"); branchSelect.setAttribute("aria-label","فرع النتيجة"); whatif.append(branchSelect);
  const refreshBranch = () => {
    branchSelect.replaceChildren();
    (currentScenario?.options || []).forEach((o, i) => {
      const node = make("option", o.text); node.value = String(i); branchSelect.append(node);
    });
  };
  storedList.addEventListener("change", refreshBranch);
  btn(scenarioActions, "اكشف النتيجة المختارة", () => {
    if (!currentScenario) { say("اختر سيناريو محفوظاً"); return; }
    const i = Number(branchSelect.value);
    const option = currentScenario.options[i];
    if (!option) return;
    if (safeProject({ kind:"whatif", title:currentScenario.title, question:currentScenario.question,
      options:currentScenario.options.map((o) => o.text), revealed:true, chosen:i,
      result:option.result + (option.explanation ? " — " + option.explanation : "") })) {
      lastRevealedBranch = { scenario: currentScenario, option };
    }
  });
  btn(scenarioActions, "أضف نتيجة الفرع للمسرح المعرفي", () => {
    if (!lastRevealedBranch) { say("اعتمد واعرض نتيجة الفرع أولاً."); return; }
    const { scenario, option } = lastRevealedBranch;
    const literal = "فرع اختاره المحاضر: " + option.text + ". نتيجة السيناريو: " + option.result +
      ". تفسير المحاضر: " + option.explanation;
    try {
      const source = sourceRecord({ bundle, slide: context.getSlide(), kind: "lecturer",
        originalText: literal, approved: true });
      const result = appendKnowledge(graph, { type: "example", text: literal.slice(0, 300), source,
        parentId: graph.nodes[0]?.id || null });
      graph = result.graph; saveKnowledge(graph); summaryGraph();
      graphPage = Math.max(0, Math.ceil(graph.nodes.length / 6) - 1);
      safeProject(audienceGraph(graph, graphPage));
      say("أُضيف الفرع المحدد والنتيجة التي كتبها المحاضر، دون الادعاء أنه خيار الأغلبية.");
    } catch (e) { say(e.message); }
  });
  btn(scenarioActions, "إخفاء النشاط", () => context.hide());
  const calculator = make("details"); calculator.append(make("summary","حساب حتمي معتمد (لا محاكاة سببية)"));
  const operation = make("select");
  for (const [v, t] of [["sum","جمع"],["difference","طرح"],["ratio","نسبة عددية"],["percent","نسبة مئوية"]]) {
    const option = make("option", t); option.value = v; operation.append(option);
  }
  calculator.append(operation);
  const a = appendInput(calculator, "القيمة الأولى", 25), b = appendInput(calculator, "القيمة الثانية", 25);
  const units = appendInput(calculator, "الوحدة المشتركة (مثل طالب)", 30);
  a.type = b.type = "number"; a.step = b.step = "any";
  btn(calculator, "احسب", () => {
    try {
      if (!a.value || !b.value) throw Error("القيمتان مطلوبتان");
      const output = calculateScenario({ operation: operation.value,
        a: Number(a.value), b: Number(b.value), unitA: units.value, unitB: units.value });
      say("نتيجة الحساب: " + output.result + (output.unit ? " " + output.unit : "") + " — عملية " + output.formula);
    } catch (e) { say(e.message); }
  });
  calculator.append(make("p", "صيغة حسابية اختيارية: أرقام وأقواس و + − × ÷ و %. مثال: 120*(1+15%). النسب المئوية تتحول إلى كسور؛ الوحدة النهائية يحددها المحاضر. لا توجد تنبؤات سببية.", "meta"));
  const formulaInput = appendInput(calculator, "120*(1+15%)", 140);
  btn(calculator, "قيّم الصيغة", () => {
    try {
      const output = evaluateScenarioFormula(formulaInput.value, units.value);
      say("نتيجة الصيغة: " + output.result + (output.unit ? " " + output.unit : "") +
        " — حساب حتمي، وليس تنبؤاً سببيّاً.");
    } catch (error) { say(error.message); }
  });
  whatif.append(calculator);
  root.append(status);
  mount.append(root);

  return {
    showPulseComparison(payload) {
      const data={kind:"pulse",question:payload?.question,title:"قبل وبعد الشرح",
        totals:payload?.totals,values:payload?.values};
      if(!validCognitivePacket({...data,bundle,slide:context.getSlide(),step:context.getStep()},
          {bundle,index:context.getSlide(),step:context.getStep()})) {
        say("بيانات المقارنة غير صالحة؛ لم تُعرض.");return false;
      }
      return safeProject(data);
    },
    addPollSummary(payload) {
      if (!payload || typeof payload.question !== "string" || payload.question.length > 200 ||
          !Array.isArray(payload.totals) || payload.totals.length !== 2 ||
          !payload.totals.every((n) => Number.isSafeInteger(n) && n >= 0) ||
          !Array.isArray(payload.values) || payload.values.length < 2 || payload.values.length > 6 ||
          payload.values.some((v) => typeof v.option !== "string" || v.option.length > 200 ||
            ![v.firstPercent, v.lastPercent, v.deltaPoints].every((n) => typeof n === "number" && Number.isFinite(n))))
        { say("توزيع التصويت غير صالح"); return false; }
      const original = "سؤال: " + payload.question + ". قبل: " + payload.totals[0] +
        " مشاركة، بعد: " + payload.totals[1] + " مشاركة. " +
        payload.values.map((v) => v.option + ": " + v.firstPercent +
          "% قبل، " + v.lastPercent + "% بعد، الفرق " + v.deltaPoints + " نقطة مئوية").join("؛ ") +
        ". تغير توزيعي لا يثبت السببية.";
      const text = original.slice(0, 300);
      try {
        const source = sourceRecord({ bundle, slide: context.getSlide(), originalText: original,
          kind: "poll", approved: true });
        const result = appendKnowledge(graph, { type: "stat", text, source,
          parentId: graph.nodes[0]?.id || null });
        graph = result.graph; saveKnowledge(graph); summaryGraph();
        graphPage = Math.max(0, Math.ceil(graph.nodes.length / 6) - 1);
        safeProject(audienceGraph(graph, graphPage));
        say("أُضيف توزيع الإجابات الفعلي مع أعداد الجولتين، بلا استنتاج سببي.");
        return true;
      } catch (error) { say(error.message); return false; }
    },
    onSpeech(raw) {
      if (context.videoPlaying() || !raw || !root.isConnected) return;
      if (/(?:ماذا لو|شنو لو|لو غيرنا|لو غيّرنا)/.test(String(raw))) {
        const scenario = scenarios.find((s) => s.slide === context.getSlide());
        if (scenario) say("يوجد سيناريو «" + scenario.title + "» لهذه الشريحة. يمكنك اختياره وعرضه بعد المراجعة.");
      }
      const shape = suggestXrayFromSpeech(String(raw), activeSlide(), context.getStep());
      if (shape) {
        xrayMessage.textContent = "تطابق دلالي محلي محتمل مع عنصر الشريحة: " + shape.text.slice(0, 100) +
          ". راجع العنصر واختره يدوياً؛ لم يُفعّل X-Ray تلقائياً.";
      }
      const cue=cognitiveSpeechCue(raw);
      if (!cue) return; // The director stays silent for ordinary narration.
      if (cue.kind === "bridge") {
        bridgeInput.value=cue.query;
        const stamp=++referenceStamp;
        say("إشارة واضحة لمحاضرة سابقة — أتحقق محلياً للمحاضر فقط.");
        void (async()=>{
          try {
            const entries=await loadReferences();
            if(stamp!==referenceStamp||!root.isConnected||context.videoPlaying())return;
            const matches=findTimeBridge(cue.query,entries,bundle,{allCourses:true});
            referenceResults=matches;results.replaceChildren();
            for(const hit of matches){
              const item=make("div","","cognitive-reference");
              item.append(make("strong",hit.lecture+" — شريحة "+hit.slide),make("p",hit.excerpt));
              btn(item,"اعرض التذكير",()=>safeProject({kind:"bridge",
                title:"تذكّر من المحاضرة السابقة",lecture:hit.lecture,
                fromSlide:hit.slide,excerpt:hit.excerpt}));
              results.append(item);
            }
            say(matches.length?"وجدت "+matches.length+" مراجع محتملة — راجع قبل العرض.":
              "لا يوجد مرجع مطابق بما يكفي. لم يُخترع شيء.");
          }catch{if(stamp===referenceStamp)say("البحث غير متاح الآن؛ لا تغيير في العرض.");}
        })();
        return;
      }
      suggestion={text:cue.text,original:String(raw).slice(0,1200)};
      text.value=cue.text;
      proposalLine.textContent="اقتراح تعليمي صريح — راجع دقته واضغط أضف للمشهد.";
    },
    onSlideChange() {
      stopPicking?.();
      ++referenceStamp; suggestion = null; proposalLine.textContent = ""; text.value = "";
      if (xray.open) refreshShapes();
    },
    graph: () => graph,
    dispose() { stopPicking?.(); ++referenceStamp; root.remove(); },
  };
}
