// Presenter-only contextual tools for ALFA Living Intelligence.
// No private notes, sources or unapproved options are broadcast to audience windows.
import { sourceRecord, createKnowledgeGraph, appendKnowledge, loadKnowledge, saveKnowledge, clearKnowledge,
  audienceGraph, eligibleShape, xrayProjection, findTimeBridge, validateScenario, calculateScenario, canEnterStage } from "./living-intelligence.js";
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
      !["living", "xray", "bridge", "whatif"].includes(value.kind) ||
      JSON.stringify(value).length > 16000) return false;
  if (value.kind === "living") return Array.isArray(value.nodes) && value.nodes.length <= 8 &&
    value.nodes.every((n) => typeof n.text === "string" && n.text.length <= 300) &&
    Array.isArray(value.edges) && value.edges.length <= 16;
  if (value.kind === "xray") return Array.isArray(value.boxes) && value.boxes.length >= 1 &&
    value.boxes.length <= 2 && value.boxes.every((b) => [b.x, b.y, b.w, b.h].every(Number.isFinite) &&
      b.x >= 0 && b.y >= 0 && b.w > 0 && b.h > 0 && b.x + b.w <= 1.001 && b.y + b.h <= 1.001);
  if (value.kind === "bridge") return typeof value.title === "string" &&
    typeof value.excerpt === "string" && value.excerpt.length <= 240;
  return typeof value.title === "string" && typeof value.question === "string" &&
    Array.isArray(value.options) && value.options.length >= 2 && value.options.length <= 3 &&
    value.options.every((v) => typeof v === "string") &&
    (!value.revealed || (Number.isInteger(value.chosen) && value.chosen >= 0 &&
      value.chosen < value.options.length && typeof value.result === "string"));
}
export function renderCognitiveProjection(stage, value) {
  if (!stage) return;
  const prior = stage.querySelector(".cognitive-projection");
  if (!value) { prior?.remove(); return; }
  if (!validCognitivePacket(value, { bundle: value.bundle, index: value.slide, step: value.step })) return;
  if (value.kind === "xray") {
    prior?.remove();
    const overlay = make("div", "", "info-layer cognitive-projection cognitive-xray");
    overlay.dataset.kind = "xray";
    for (const box of value.boxes) {
      const mark = make("div", "", "cognitive-focus-box");
      Object.assign(mark.style, { left: box.x * 100 + "%", top: box.y * 100 + "%",
        width: box.w * 100 + "%", height: box.h * 100 + "%" });
      overlay.append(mark);
    }
    stage.append(overlay);
    return;
  }
  let layer = prior;
  if (!layer || layer.dataset.kind !== value.kind) {
    layer?.remove();
    layer = make("section", "", "info-layer cognitive-projection cognitive-card-stage");
    layer.dataset.kind = value.kind;
    layer.append(make("h2", "", "cognitive-stage-heading"), make("div", "", "cognitive-stage-body"),
      make("p", "", "cognitive-stage-foot"));
    stage.append(layer);
  }
  layer.querySelector("h2").textContent = value.title || "المسرح المعرفي";
  const body = layer.querySelector(".cognitive-stage-body"), foot = layer.querySelector(".cognitive-stage-foot");
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
      el.querySelector("small").textContent = ({ topic:"الفكرة الرئيسية",concept:"مفهوم",example:"مثال",
        stat:"إحصائية",compare:"مقارنة",step:"خطوة",question:"سؤال",summary:"خلاصة" })[node.type] || "عنصر";
      el.querySelector("p").textContent = node.text;
      el.classList.toggle("cognitive-topic", node.type === "topic");
    }
    foot.textContent = "مجموعة " + (value.page + 1) + " من " + value.pages + " · محتوى اعتمده المحاضر";
  } else {
    body.replaceChildren();
    if (value.kind === "bridge") {
      body.append(make("p", value.excerpt, "cognitive-bridge-quote"));
      foot.textContent = value.lecture + " — الشريحة " + value.fromSlide;
    } else if (value.kind === "whatif") {
      body.append(make("p", value.question, "cognitive-question"));
      for (let i = 0; i < value.options.length; i++) {
        const item = make("article", value.options[i], "cognitive-node");
        if (value.revealed && i === value.chosen) item.classList.add("cognitive-chosen");
        body.append(item);
      }
      if (value.revealed) body.append(make("p", value.result, "cognitive-revealed-result"));
      foot.textContent = value.revealed ? "نتيجة كتبها واعتمدها المحاضر" : "النتائج لم تُكشف بعد";
    }
  }
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
  const section = (title) => {
    const details = make("details", "", "cognitive-tools-section");
    details.append(make("summary", title));
    root.append(details);
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
    const version = JSON.stringify(lectures.map((l) => [l.bundle, l.courseId, l.slideCount, l.title, l.builtAt]));
    if (referenceVersion === version) return [...referenceCache.values()].flat();
    referenceVersion = version; referenceCache = new Map();
    // Only manifests already stored on the lecturer's machine, never a remote service.
    for (const lecture of lectures) {
      const response = await fetch("/bundles/" + encodeURIComponent(lecture.bundle) + "/manifest.json");
      if (!response.ok) continue;
      const manifest = await response.json();
      referenceCache.set(lecture.bundle, (manifest.slides || []).slice(0, 300).flatMap((s, i) => {
        const texts = [s.text, s.notes].map((v) => String(v || "").trim()).filter(Boolean);
        return texts.map((passage) => ({ bundle: lecture.bundle, lecture: lecture.title,
          courseId: lecture.courseId, slide: i + 1, text: passage.slice(0, 2400) }));
      }));
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
            slide: item.slide, text: passage.slice(0, 2400) });
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
        item.append(make("strong", hit.lecture + " — شريحة " + hit.slide),
          make("p", hit.excerpt), make("p", hit.reason, "meta"));
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
  whatif.append(kind, make("p", "كل سطر: الخيار | نتيجته التي كتبتها | تفسيرك | مرجع اختياري. سطران أو ثلاثة.", "meta"));
  const choices = appendInput(whatif, "الخيار | النتيجة | التفسير | المرجع", 1800, true);
  choices.rows = 4;
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
    choices.value = s.options.map((o) => [o.text, o.result, o.explanation, o.reference].join(" | ")).join("\n");
  };
  refreshScenarioList();
  const scenarioActions = make("div", "", "cognitive-actions"); whatif.append(scenarioActions);
  btn(scenarioActions, "احفظ السيناريو", () => {
    try {
      const s = validateScenario({ title: title.value, question: question.value, type: kind.value,
        slide: context.getSlide(),
        options: choices.value.split("\n").filter(Boolean).map((line) => {
          const [text, result, explanation, reference] = line.split("|").map((v) => v.trim());
          return { text, result, explanation, reference };
        }) });
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
  whatif.append(calculator);
  root.append(status);
  mount.append(root);

  return {
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
      const candidates = (activeSlide().elements || []).filter((s) =>
        eligibleShape(s, activeSlide(), context.getStep()) && s.text && s.text.length >= 6 &&
        String(raw).includes(s.text));
      if (candidates.length === 1) {
        xrayMessage.textContent = "ذُكر عنصر موجود بالشريحة: " + candidates[0].text.slice(0, 100) +
          ". يمكنك اختياره يدوياً للتركيز؛ لم يُفعّل تلقائياً.";
      }
      const phrase = String(raw).trim().slice(0, 300);
      if (phrase.length < 12) return;
      // Voice can suggest but never approve, modify a slide or activate a scenario.
      suggestion = { text: phrase, original: String(raw).slice(0, 1200) };
      text.value = phrase;
      proposalLine.textContent = "اقتراح من الكلام المعترف به — راجع الدقة ثم اضغط أضف للمشهد.";
      // A voice reference does not trigger a library search without lecturer action.
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
