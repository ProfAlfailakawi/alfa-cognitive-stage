// ALFA Cognitive Stage — presenter and audience views.
// The lecturer's window controls the deck. The audience window shows only the slide.
// Both windows talk over BroadcastChannel (same browser, same origin).

import { renderInfographic } from "./infographic.js";
import { interpretSpeech, eligibleForCloud } from "./director-core.js";
import { createSpeechDirector } from "./speech-director.js";
import { createStorySession, advanceStorySession, storySceneSpec } from "./storyboard.js";
import { rememberScene, recallScene, countSavedScenes } from "./scene-memory.js";

const app = document.getElementById("app");
const channel = new BroadcastChannel("alfa-cognitive-stage");
const params = new URLSearchParams(location.search);
const role = location.hash === "#audience" ? "audience" : "presenter";

const state = { index: 1, main: 1, count: 0, notes: [], slides: [], bundle: "", aspect: 16 / 9, problems: [] };
let videoEl = null;
let videoEls = [];
let clockStart = Date.now();
let slideGeneration = 0;
const directorRuntime = {
  speech: null, pending: null, lastKey: "", lastAt: 0,
  recent: [], cloudSeq: 0, activeOverlay: false,
  story: null, lastStoryVisual: 0, lastScene: null,
};

function send(message) {
  channel.postMessage(message);
}

function setAspect(aspect) {
  document.documentElement.style.setProperty("--aspect", String(aspect));
}

function stageHtml() {
  return `<div class="stage" id="stage">
    <img class="slide" id="slide-img" alt="" />
  </div>`;
}

function placeVideo(slide) {
  for (const old of videoEls) { old.pause(); old.remove(); }
  videoEls = [];
  videoEl = null;
  const stage = document.getElementById("stage");
  if (!stage) return;
  const clips = Array.isArray(slide.videos) ? slide.videos : [];
  clips.forEach((clip, i) => {
    const el = document.createElement("video");
    el.className = "clip";
    el.preload = "metadata";
    el.playsInline = true;
    el.controls = role === "presenter";
    for (const [type, src] of [["video/mp4", clip.src], ["video/webm", clip.webm]]) {
      if (!src) continue;
      const source = document.createElement("source");
      source.src = "/bundles/" + state.bundle + "/" + src;
      source.type = type;
      el.appendChild(source);
    }
    el.style.left = (clip.x * 100) + "%";
    el.style.top = (clip.y * 100) + "%";
    el.style.width = (clip.w * 100) + "%";
    el.style.height = (clip.h * 100) + "%";
    el.style.objectFit = "contain";
    stage.appendChild(el);
    videoEls.push(el);
    if (role === "presenter") {
      el.addEventListener("play", () => {
        for (const other of videoEls) if (other !== el && !other.paused) other.pause();
        directorRuntime.speech?.setMediaPlaying(true);
        send({ type: "video", action: "play", clip: i, time: el.currentTime });
      });
      el.addEventListener("pause", () => {
        if (videoEls.every((item) => item.paused)) directorRuntime.speech?.setMediaPlaying(false);
        send({ type: "video", action: "pause", clip: i, time: el.currentTime });
      });
      el.addEventListener("seeked", () => send({ type: "video", action: "seek", clip: i, time: el.currentTime }));
      el.addEventListener("ended", () => send({ type: "video", action: "ended", clip: i, index: state.index }));
    }
  });
  videoEl = videoEls[0] || null;
}

function showSlide(index) {
  const slide = state.slides[index - 1];
  if (!slide) return;
  state.index = index;
  if (role === "presenter") {
    directorRuntime.cloudSeq++;
    directorRuntime.pending = null;
    directorRuntime.story = null;
    const proposal = document.getElementById("director-proposal");
    if (proposal) proposal.hidden = true;
  }
  const img = document.getElementById("slide-img");
  const generation = ++slideGeneration;
  if (img) {
    img.classList.add("leaving");
    setTimeout(() => {
      if (generation !== slideGeneration) return;
      img.src = `/bundles/${state.bundle}/${slide.image}`;
      img.alt = `الشريحة ${index}`;
      img.classList.remove("leaving");
    }, 120);
  }
  placeVideo(slide);
  if (role === "presenter") renderPresenterPanels();
}

function renderAudience() {
  app.innerHTML = `<div class="audience">${stageHtml()}</div>`;
  setAspect(state.aspect);
  showSlide(state.index);
}

function renderPresenter() {
  app.innerHTML = `
    <section class="presenter">
      <div class="main">
        <div class="bar">
          <div class="meta" id="meta"></div>
          <div class="meta" id="clock">00:00</div>
        </div>
        <div class="stage-wrap">${stageHtml()}</div>

        <div class="controls">
          <button id="prev" aria-label="الشريحة السابقة">السابقة</button>
          <button class="primary" id="next" aria-label="الشريحة التالية">التالية</button>
          <button id="playvid">تشغيل الفيديو</button>
          <button class="emergency" id="home" aria-label="عودة فورية إلى العرض الأصلي">عودة فورية (E)</button>
          <button id="open-audience">فتح نافذة الطلبة</button>
          <button id="open-vote">التصويت</button>
          <button id="toggle-info">إنفوجرافيك</button>
          <button id="import-lecture" type="button">إضافة PowerPoint</button>
          <button id="lecture-preflight" type="button">فحص جاهزية المحاضرة</button>
          <select id="lecture-picker" aria-label="اختيار المحاضرة"></select>
        </div>
      </div>
      <aside class="side">
        <div><div class="label">الشريحة التالية</div><div class="next" id="next-thumb"></div></div>
                <form class="info-form" id="info-form" hidden onsubmit="return false">
          <select id="info-type" aria-label="نوع الإنفوجرافيك">
            <option value="stat">بطاقة إحصائية</option>
            <option value="compare">مقارنة (الأول | الثاني)</option>
            <option value="steps">خطوات</option>
          </select>
          <input id="info-title" type="text" maxlength="120" placeholder="العنوان" />
          <textarea id="info-lines" rows="3" placeholder="البطاقة: الرقم في السطر الأول ثم الوصف&#10;المقارنة: سطر لكل مقارنة&#10;الخطوات: خطوة في كل سطر"></textarea>
          <div class="actions">
            <button class="primary" id="info-show" type="button">عرض للطلبة</button>
            <button id="info-hide" type="button">إخفاء</button>
            <span class="meta" id="info-msg" aria-live="polite"></span>
          </div>
        </form>
        <section class="director-box" id="director-box">
          <div class="label">المخرج الخفي — تجريبي</div>
          <div class="director-actions">
            <button id="director-start" type="button">🎙 بدء الاستماع</button>
            <button id="director-stop" type="button">إيقاف</button>
          </div>
          <select id="director-mode" aria-label="استقلالية المخرج">
            <option value="balanced">متوازن — الإحصائية الواضحة تلقائياً</option>
            <option value="shadow">وضع الظل — تحليل فقط</option>
            <option value="safe">محافظ — موافقتك على كل مشهد</option>
          </select>
          <label class="director-cloud"><input type="checkbox" id="director-cloud" /> تحليل سحابي اختياري (قد يتكلف)</label>
          <input id="director-admin-token" type="password" autocomplete="off" placeholder="رمز المحاضر من Terminal (لـAPI فقط)" />
          <p class="meta" id="director-status" aria-live="polite">المايك متوقف. لا توجد طلبات API.</p>
          <p class="meta" id="director-last"></p>
          <div class="director-actions">
            <button type="button" id="director-save" hidden>حفظ المشهد الحالي في مكتبتي</button>
            <button type="button" id="director-memory-sync">استرجاع المشاهد المحفوظة</button>
          </div>
          <div id="director-proposal" class="director-proposal" hidden>
            <div id="director-reason"></div>
            <div class="director-actions">
              <button class="primary" type="button" id="director-accept">عرض المشهد</button>
              <button type="button" id="director-reject">تجاهل</button>
            </div>
          </div>
          <details><summary>اختبار نصّي دون المايك</summary>
            <input id="director-test-text" type="text" maxlength="950" placeholder="في دراسة ذكرت أن 68% من الطلبة..." />
            <button id="director-test-run" type="button">اختبر العبارة</button>
          </details>
        </section>
        <div class="meta" id="compatibility" role="status"></div>
        <div><div class="label">ملاحظات المحاضر</div></div>
        <div class="notes" id="notes"></div>
      </aside>
    </section>`;
  setAspect(state.aspect);
  document.getElementById("prev").onclick = () => go(state.index - 1);
  document.getElementById("next").onclick = () => go(state.index + 1);
  document.getElementById("home").onclick = () => goMain();
  document.getElementById("playvid").onclick = () => toggleVideo();
  document.getElementById("open-vote").onclick = () => window.open("/vote-admin.html", "alfa-vote-admin");
  document.getElementById("import-lecture").onclick = () => openLectureImport();
  document.getElementById("lecture-preflight").onclick = () => openLecturePreflight();
  document.getElementById("toggle-info").onclick = () => {
    const form = document.getElementById("info-form");
    form.hidden = !form.hidden;
  };
  document.getElementById("info-show").onclick = showInfographicFromForm;
  fillLecturePicker();
  document.getElementById("info-hide").onclick = () => hideInfographic(true);
  document.getElementById("open-audience").onclick = () =>
    window.open(`${location.pathname}?bundle=${state.bundle}#audience`, "alfa-audience");
  showSlide(state.index);
  setupDirector();
}

function renderPresenterPanels() {
  const slide = state.slides[state.index - 1];
  const meta = document.getElementById("meta");
  if (meta) meta.textContent = `الشريحة ${state.index} من ${state.count}`;
  const notes = document.getElementById("notes");
  if (notes) notes.textContent = slide.notes || "لا توجد ملاحظات لهذه الشريحة.";
  const compatibility = document.getElementById("compatibility");
  if (compatibility) {
    compatibility.textContent = slide.hasAnimations
      ? "⚠️ الشريحة تحتوي حركات PowerPoint أصلية لم تُنقل بعد إلى محرك الويب؛ تحقق منها قبل العرض."
      : (state.problems.length ? "⚠️ بعض الوسائط مرتبطة بخارج الملف. راجع تقرير الاستيراد." : "");
  }
  const next = state.slides[state.index];
  const thumb = document.getElementById("next-thumb");
  if (thumb) {
    thumb.innerHTML = next
      ? `<img src="/bundles/${state.bundle}/${next.image}" alt="الشريحة ${state.index + 1}" />`
      : "<p>نهاية العرض</p>";
  }
}

async function fillLecturePicker() {
  const picker = document.getElementById("lecture-picker");
  const list = await fetch("/bundles/lectures.json").then((r) => r.json()).catch(() => []);
  if (!picker || !list.length) return;
  picker.replaceChildren();
  for (const item of list) {
    const option = document.createElement("option");
    option.value = String(item.id);
    option.textContent = String(item.title);
    option.selected = item.id === state.bundle;
    picker.appendChild(option);
  }
  picker.onchange = () => {
    // Switching lectures reloads both windows on the chosen bundle; the audience tab must be reopened.
    location.search = `?bundle=${picker.value}`;
  };
}

function showInfographicFromForm() {
  const msg = document.getElementById("info-msg");
  try {
    const spec = {
      type: document.getElementById("info-type").value,
      title: document.getElementById("info-title").value,
      lines: document.getElementById("info-lines").value.split("\n"),
    };
    renderInfographic(spec); // validates before sending
    renderLayer(spec);
    send({ type: "infographic", spec });
    directorRuntime.activeOverlay = true;
    msg.textContent = "معروض للطلبة. يُخفى تلقائياً عند تغيير الشريحة.";
  } catch (err) {
    msg.textContent = err.message;
  }
}

function hideInfographic(notify) {
  const msg = document.getElementById("info-msg");
  if (msg) msg.textContent = "";
  if (notify) send({ type: "infographic-hide" });
  if (role === "presenter") directorRuntime.activeOverlay = false;
  document.querySelectorAll(".info-layer").forEach((el) => el.remove());
}

function go(index) {
  if (index < 1 || index > state.count) return;
  hideInfographic(true);
  state.main = index; // A normal slide change updates the safe return anchor.
  showSlide(index);
  send({ type: "slide", index, main: state.main });
}

function goMain() {
  // Emergency: stop any playing clip, hide any infographic, and return to the main deck position at once.
  for (const el of videoEls) el.pause();
  directorRuntime.story = null;
  directorRuntime.lastScene = null;
  const saveBtn = document.getElementById("director-save");
  if (saveBtn) saveBtn.hidden = true;
  clearDirectorProposal();
  hideInfographic(true);
  // Preserve the current slide and its paused video state when already at the safe anchor.
  if (state.index !== state.main) showSlide(state.main);
  send({ type: "slide", index: state.main, main: state.main, emergency: true });
}

function toggleVideo() {
  if (!videoEl) return;
  if (videoEl.paused) videoEl.play();
  else videoEl.pause();
}


function setDirectorStatus(value) {
  const el = document.getElementById("director-status");
  if (el) el.textContent = value;
}
function clearDirectorProposal() {
  directorRuntime.pending = null;
  const panel = document.getElementById("director-proposal");
  if (panel) panel.hidden = true;
}
function showDirectorProposal(proposal, reason) {
  if (!proposal) return;
  directorRuntime.pending = { ...proposal, slide: state.index, at: Date.now() };
  const panel = document.getElementById("director-proposal");
  const description = document.getElementById("director-reason");
  if (description) description.textContent = reason;
  if (panel) panel.hidden = false;
}
function revealDirectorScene(proposal) {
  if (!proposal?.spec || proposal.slide !== state.index ||
      Date.now() - proposal.at > 30000 || videoEls.some((el) => !el.paused)) return false;
  try {
    renderLayer(proposal.spec);
    send({ type: "infographic", spec: proposal.spec });
    directorRuntime.activeOverlay = true;
    directorRuntime.lastScene = proposal.utterance ? { bundle:state.bundle, slide:state.index,
      utterance: proposal.utterance, spec: proposal.spec } : null;
    const saveBtn = document.getElementById("director-save");
    if (saveBtn) saveBtn.hidden = !directorRuntime.lastScene;
    if (proposal.utterance) rememberScene({
      bundle: state.bundle, slide: state.index, utterance: proposal.utterance, spec: proposal.spec
    });
    clearDirectorProposal();
    setDirectorStatus("مشهد بصري — زر E للعودة الفورية");
    return true;
  } catch (err) {
    setDirectorStatus("لم يتم عرض المشهد: " + err.message);
    return false;
  }
}
async function requestDirectorAI(text, seq) {
  const token = document.getElementById("director-admin-token")?.value.trim() ||
    sessionStorage.getItem("alfa-admin-token") || "";
  if (!token) { setDirectorStatus("API يحتاج رمز المحاضر من شاشة Terminal."); return; }
  try {
    const current = state.slides[state.index - 1] || {};
    const response = await fetch("/api/director/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Token": token },
      body: JSON.stringify({ utterance: text.slice(0, 950),
        slideText: String(current.text || "").slice(0, 1600),
        notes: String(current.notes || "").slice(0, 500) }),
    });
    const data = await response.json();
    if (seq !== directorRuntime.cloudSeq) return; // Topic or slide changed.
    if (!response.ok) { setDirectorStatus(data.error || "تعذر تحليل المخرج"); return; }
    if (!data.proposal?.spec) { setDirectorStatus("لا يوجد مشهد إضافي يستحق الظهور."); return; }
    showDirectorProposal({ ...data.proposal, utterance: text }, data.proposal.reason || "مشهد من التحليل السحابي — يحتاج موافقتك.");
  } catch (err) {
    if (seq === directorRuntime.cloudSeq) setDirectorStatus("الاتصال السحابي غير متاح؛ العرض مستمر.");
  }
}
function receiveDirectorSpeech(text) {
  const raw = String(text || "").trim();
  if (!raw) return;
  const last = document.getElementById("director-last");
  if (last) last.textContent = "سمعت: " + raw.slice(0, 160);
  directorRuntime.cloudSeq++;
  directorRuntime.recent.push({ text: raw, at: Date.now() });
  directorRuntime.recent = directorRuntime.recent.filter((r) => Date.now() - r.at < 25000).slice(-3);
  const recent = directorRuntime.recent.map((r) => r.text).join(" ");
  const moment = interpretSpeech(raw) || interpretSpeech(recent);
  const mode = document.getElementById("director-mode")?.value || "balanced";
  if (moment?.kind === "return") {
    directorRuntime.story = null;
    directorRuntime.cloudSeq++;
    clearDirectorProposal();
    if (directorRuntime.activeOverlay) goMain();
    setDirectorStatus("تم فهم العودة إلى الموضوع الأصلي.");
    return;
  }
  if (directorRuntime.story && !moment) {
    const next = advanceStorySession(directorRuntime.story, raw);
    if (!next) directorRuntime.story = null;
    else {
      directorRuntime.story = next;
      if (mode === "shadow") { setDirectorStatus("وضع الظل: القصة تتقدم دون تغيير الشاشة."); return; }
      if (mode === "balanced" && directorRuntime.activeOverlay &&
          next.lines.length > 1 && Date.now() - directorRuntime.lastStoryVisual > 8000) {
        const proposal = { spec: storySceneSpec(next), utterance: next.lines.join(" "),
          slide: state.index, at: Date.now() };
        if (revealDirectorScene(proposal)) directorRuntime.lastStoryVisual = Date.now();
      } else if (mode === "safe" && next.lines.length > 1) {
        showDirectorProposal({spec:storySceneSpec(next), utterance:next.lines.join(" ")},
          "تطور القصة من كلامك، دون اختراع أحداث.");
      }
      return;
    }
  }
  if (!moment) {
    const saved = recallScene({ bundle: state.bundle, slide: state.index, utterance: raw });
    if (saved && document.getElementById("director-mode")?.value !== "shadow") {
      showDirectorProposal({ spec: saved.spec, utterance: raw },
        "مشهد محفوظ سابقاً — بلا تكلفة API. أكد ظهوره أمام الطلبة.");
    }
    return;
  }
  const key = moment.kind + ":" + (moment.spec?.lines?.[0] || raw.slice(0, 35));
  if (key === directorRuntime.lastKey && Date.now() - directorRuntime.lastAt < 15000) return;
  directorRuntime.lastKey = key;
  directorRuntime.lastAt = Date.now();
  if (moment.kind === "story") {
    directorRuntime.story = createStorySession(raw);
    const proposal = { spec: storySceneSpec(directorRuntime.story),
      utterance: raw, slide: state.index, at: Date.now() };
    if (mode === "shadow") {
      setDirectorStatus("وضع الظل: بداية قصة، ولم يتغير عرض الطلبة.");
      return;
    }
    if (mode === "balanced" && !videoEls.some((el) => !el.paused)) {
      if (revealDirectorScene(proposal)) directorRuntime.lastStoryVisual = Date.now();
    } else showDirectorProposal(proposal, "مشهد قصصي رمزي من حديثك — بدون توليد صور أو اختراع أحداث.");
    return;
  }
  if (mode === "shadow") {
    setDirectorStatus("وضع الظل: اكتُشف " + moment.kind + " دون تغيير شاشة الطلبة.");
    return;
  }
  if (moment.spec) {
    const proposal = { spec: moment.spec, utterance: raw, slide: state.index, at: Date.now() };
    if (mode === "balanced" && moment.confidence >= 0.95 && !(videoEl && !videoEl.paused)) {
      revealDirectorScene(proposal);
    } else showDirectorProposal(proposal, "إحصائية التقطت من حديث المحاضر — تأكد من الرقم.");
    return;
  }
  const names = { story: "بداية قصة أو استطراد", compare: "فرصة مقارنة تعليمية", question: "سؤال موجه للطلبة" };
  setDirectorStatus("التقطت " + (names[moment.kind] || moment.kind) + " — لم أعرض حقائق غير مؤكدة.");
  const saved = recallScene({ bundle: state.bundle, slide: state.index, utterance: raw });
  if (saved) {
    showDirectorProposal({ spec: saved.spec, utterance: raw }, "مشهد محفوظ — لا يحتاج API.");
    return;
  }
  if (document.getElementById("director-cloud")?.checked && eligibleForCloud(moment, raw)) {
    const seq = ++directorRuntime.cloudSeq;
    requestDirectorAI(raw, seq); // Explicitly enabled, billed API; never auto-displays response.
  }
}

function lecturerToken() {
  return document.getElementById("director-admin-token")?.value.trim() ||
    sessionStorage.getItem("alfa-admin-token") || "";
}
async function syncSavedScenes() {
  const token = lecturerToken();
  if (!token) {
    setDirectorStatus("للمزامنة بين الشعب أدخل رمز المحاضر أولاً. المحفوظ محلياً يعمل دون اتصال.");
    return;
  }
  try {
    const check = await fetch("/api/admin/check", { headers: { "X-Admin-Token": token } });
    if (!check.ok) throw new Error("رمز المحاضر غير صحيح.");
    sessionStorage.setItem("alfa-admin-token", token);
    const response = await fetch("/api/library/scenes/" + encodeURIComponent(state.bundle), {
      headers: { "X-Admin-Token": token }
    });
    if (!response.ok) throw new Error("تعذر استرجاع المكتبة.");
    const data = await response.json();
    let count = 0;
    for (const scene of data.scenes || []) {
      if (rememberScene(scene)) count++;
    }
    setDirectorStatus("تم استرجاع " + count + " مشهد محفوظ لهذه المحاضرة دون API.");
  } catch (err) {
    setDirectorStatus(err.message || "فشل استرجاع المكتبة.");
  }
}
async function saveSceneToLibrary() {
  const scene = directorRuntime.lastScene;
  if (!scene) return;
  // A successful visual already has a local copy. Server sync is an explicit decision.
  rememberScene(scene);
  const token = lecturerToken();
  if (!token) {
    setDirectorStatus("المشهد محفوظ في هذا المتصفح. أدخل رمز المحاضر لمزامنته على الماك.");
    return;
  }
  try {
    const response = await fetch("/api/library/scenes", {
      method: "POST",
      headers: { "X-Admin-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify(scene),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "تعذر حفظ المشهد على الخادم");
    sessionStorage.setItem("alfa-admin-token", token);
    setDirectorStatus("تم حفظ المشهد في مكتبة المحاضرة للشعب القادمة — بلا توليد جديد.");
  } catch (err) {
    setDirectorStatus("بقي المشهد محفوظاً في المتصفح فقط: " + err.message);
  }
}

function setupDirector() {
  const speech = createSpeechDirector({ onUtterance: receiveDirectorSpeech, onStatus: setDirectorStatus });
  directorRuntime.speech = speech;
  const start = document.getElementById("director-start");
  const stop = document.getElementById("director-stop");
  start.onclick = () => speech.start();
  stop.onclick = () => speech.stop();
  document.getElementById("director-accept").onclick = () => {
    const pending = directorRuntime.pending;
    if (pending && !revealDirectorScene(pending)) setDirectorStatus("المشهد انتهت صلاحيته أو يوجد فيديو نشط.");
  };
  document.getElementById("director-reject").onclick = () => { clearDirectorProposal(); setDirectorStatus("تم تجاهل الاقتراح."); };
  document.getElementById("director-save").onclick = () => saveSceneToLibrary();
  document.getElementById("director-memory-sync").onclick = () => syncSavedScenes();
  if (sessionStorage.getItem("alfa-admin-token")) syncSavedScenes();
  setDirectorStatus("مكتبة المشاهد المعتمدة لهذه المحاضرة: " +
    countSavedScenes(state.bundle) + " — الاستماع متوقف.");
  document.getElementById("director-test-run").onclick = () => receiveDirectorSpeech(
    document.getElementById("director-test-text").value);
}

function renderLayer(spec) {
  const stage = document.getElementById("stage");
  if (!stage) return;
  stage.querySelectorAll(".info-layer").forEach((el) => el.remove());
  const layer = document.createElement("div");
  layer.className = "info-layer";
  layer.innerHTML = renderInfographic(spec);
  stage.appendChild(layer);
}

function applyRemote(message) {
  if (message.type === "slide") {
    state.main = message.main;
    if (message.index !== state.index) showSlide(message.index);
  }
  if (message.type === "infographic") {
    hideInfographic(false);
    renderLayer(message.spec);
  }
  if (message.type === "infographic-hide") hideInfographic(false);
  if (message.type === "video") {
    const target = videoEls[Number(message.clip) || 0];
    if (!target) return;
    if (message.action === "play") {
      for (const el of videoEls) if (el !== target) el.pause();
      if (Number.isFinite(message.time)) target.currentTime = message.time;
      target.play().catch(() => {});
    }
    if (message.action === "pause") target.pause();
    if (message.action === "seek" && Number.isFinite(message.time)) target.currentTime = message.time;
  }
}

function setupKeys() {
  document.addEventListener("keydown", (event) => {
    if (role !== "presenter") return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("input,textarea,select,[contenteditable=true]")) return;
    if (target instanceof HTMLButtonElement) target.blur();
    switch (event.key) {
      case "ArrowRight":
      case "PageDown":
      case " ":
        event.preventDefault();
        go(state.index + 1);
        break;
      case "ArrowLeft":
      case "PageUp":
        event.preventDefault();
        go(state.index - 1);
        break;
      case "Home":
        go(1);
        break;
      case "e":
      case "E":
      case "Escape":
        goMain();
        break;
      case "v":
      case "V":
        toggleVideo();
        break;
      default:
        break;
    }
  });
}

function setupClock() {
  setInterval(() => {
    const el = document.getElementById("clock");
    if (!el) return;
    const total = Math.floor((Date.now() - clockStart) / 1000);
    const mm = String(Math.floor(total / 60)).padStart(2, "0");
    const ss = String(total % 60).padStart(2, "0");
    el.textContent = `${mm}:${ss}`;
  }, 1000);
}



async function openLecturePreflight() {
  const token = lecturerToken();
  if (!token) {
    setDirectorStatus("أدخل رمز المحاضر لفتح تقرير جاهزية الفيديو والحركات.");
    return;
  }
  let dialog = document.getElementById("alfa-preflight-dialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "alfa-preflight-dialog";
    dialog.className = "import-dialog";
    dialog.innerHTML = '<h2>فحص جاهزية المحاضرة</h2><div id="preflight-report" class="preflight-report"></div><button id="preflight-close" type="button">إغلاق</button>';
    document.body.appendChild(dialog);
    dialog.querySelector("#preflight-close").onclick = () => dialog.close();
  }
  const report = dialog.querySelector("#preflight-report");
  report.replaceChildren();
  report.textContent = "جارٍ فحص الوسائط وملفات العرض...";
  dialog.showModal();
  try {
    const res = await fetch("/api/lectures/readiness/" + encodeURIComponent(state.bundle), {
      headers: { "X-Admin-Token": token }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "تعذر تنفيذ الفحص");
    const lines = [
      "الشرائح: " + data.slideCount,
      "الفيديوهات المضمنة: " + data.videoCount + " (تحتاج اختبار تشغيل وصوت على الماك)",
      "شرائح فيها حركات PowerPoint غير منقولة: " + data.animationSlides.length,
      "ملفات مفقودة: " + data.missingAssets.length,
      "روابط/وسائط تحتاج مراجعة: " + data.problems.length,
      "اتصال OpenAI مهيأ: " + (data.cloudConfigured ? "نعم (غير مختبر فعلياً)" : "لا"),
      "أدوات الاستيراد غير الموجودة: " +
        (data.dependencies.filter((d) => !d.installed).map((d) => d.name).join("، ") || "لا شيء ظاهر في PATH"),
      "الحالة: " + (data.status === "blocked" ? "هناك ملفات مفقودة" :
        data.status === "review" ? "يحتاج مراجعة يدوية" : "الملفات الأساسية موجودة"),
    ];
    if (data.animationSlides.length) lines.push("شرائح الحركة: " + data.animationSlides.join("، "));
    lines.push(...data.missingAssets.slice(0, 8));
    const list = document.createElement("ul");
    for (const text of lines) {
      const li = document.createElement("li");
      li.textContent = text;
      list.appendChild(li);
    }
    report.replaceChildren(list);
    const note = document.createElement("p");
    note.textContent = "هذا فحص ملفات، وليس إثباتاً لعمل حركة PowerPoint أو الصوت أو التصويت على أجهزة الطلبة.";
    report.appendChild(note);
  } catch (err) { report.textContent = err.message || "تعذر فحص المحاضرة"; }
}

function openLectureImport() {
  let dialog = document.getElementById("alfa-import-dialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "alfa-import-dialog";
    dialog.className = "import-dialog";
    dialog.innerHTML = `<form method="dialog" id="alfa-import-form">
      <h2>إضافة محاضرة PowerPoint</h2>
      <p>ارفع PPTX كما هو. يحتفظ النظام بالفيديوهات ويخبرك بالحركات التي تحتاج اختباراً. لا يُعدّل الملف الأصلي.</p>
      <label>ملف المحاضرة <input id="import-file" type="file" accept=".pptx" required /></label>
      <label>رمز المحاضر من Terminal <input id="import-token" type="password" autocomplete="off" required /></label>
      <p class="import-status" id="import-status" role="status" aria-live="polite">قد يستغرق تحويل الفيديوهات بعض الوقت.</p>
      <div class="director-actions">
        <button id="import-submit" type="submit" class="primary">ابدأ التحويل</button>
        <button id="import-cancel" type="button">إلغاء</button>
      </div>
    </form>`;
    document.body.appendChild(dialog);
    const form = dialog.querySelector("#alfa-import-form");
    dialog.querySelector("#import-cancel").onclick = () => dialog.close();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const file = dialog.querySelector("#import-file").files[0];
      const token = dialog.querySelector("#import-token").value.trim();
      const label = dialog.querySelector("#import-status");
      const submit = dialog.querySelector("#import-submit");
      if (!file || !/\.pptx$/i.test(file.name) || !token) {
        label.textContent = "اختر ملف PPTX وأدخل رمز المحاضر."; return;
      }
      if (file.size > 150 * 1024 * 1024) {
        label.textContent = "حجم الملف يتجاوز 150 ميغابايت."; return;
      }
      submit.disabled = true;
      label.textContent = "جارٍ استيراد العرض وتحويل الوسائط. لا تغلق هذه النافذة…";
      try {
        const res = await fetch("/api/lectures/import", {
          method: "POST",
          headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "X-Admin-Token": token, "X-Alfa-Filename": encodeURIComponent(file.name) },
          body: file,
        });
        const response = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(response.error || "فشل التحويل");
        sessionStorage.setItem("alfa-admin-token", token);
        const warning = response.animatedSlides
          ? "تم اكتشاف " + response.animatedSlides + " شريحة فيها حركات غير محفوظة بصيغة الويب. "
          : "";
        label.textContent = "تم الاستيراد. " + warning + "سيفتح العرض الجديد.";
        window.location.assign("/?bundle=" + encodeURIComponent(response.id));
      } catch (err) {
        label.textContent = err.message || "لم يكتمل الاستيراد؛ تحقق من Terminal.";
      } finally { submit.disabled = false; }
    });
  }
  dialog.querySelector("#import-token").value = sessionStorage.getItem("alfa-admin-token") || "";
  dialog.showModal();
}

async function boot() {
  const current = await fetch("/bundles/current.json").then((r) => r.json()).catch(() => null);
  state.bundle = params.get("bundle") || (current && current.id);
  if (!state.bundle) {
    if (role === "presenter") {
      app.innerHTML = '<section class="empty-library"><h1>ALFA Cognitive Stage</h1><p>مكتبة المحاضرات فارغة. أضف PowerPoint لبدء التحضير، دون كتابة أي برومبت.</p><button id="import-first" class="primary">رفع محاضرة PPTX</button></section>';
      document.getElementById("import-first").onclick = openLectureImport;
    } else app.textContent = "لا توجد محاضرة جاهزة بعد.";
    return;
  }
  const response = await fetch("/bundles/" + encodeURIComponent(state.bundle) + "/manifest.json");
  if (!response.ok) {
    app.textContent = "تعذر تحميل هذه المحاضرة. تحقق من مكتبة المحاضرات.";
    return;
  }
  const manifest = await response.json();
  state.problems = manifest.problems || [];
  state.slides = manifest.slides;
  state.count = manifest.slideCount;
  state.aspect = manifest.aspect;

  if (role === "audience") {
    renderAudience();
    send({ type: "hello" });
  } else {
    renderPresenter();
    setupKeys();
    setupClock();
    channel.postMessage({ type: "slide", index: state.index, main: state.main });
  }
  channel.onmessage = (event) => {
    const message = event.data;
    if (role === "presenter" && message.type === "hello") {
      send({ type: "slide", index: state.index, main: state.main });
      return;
    }
    if (role === "audience") applyRemote(message);
  };
  if (role === "audience") {
    // Audience tab mirrors whatever the presenter is showing.
    channel.onmessage = (event) => applyRemote(event.data);
  }
}

boot();
