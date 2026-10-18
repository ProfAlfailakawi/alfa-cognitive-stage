// ALFA Cognitive Stage — presenter and audience views.
// The lecturer's window controls the deck. The audience window shows only the slide.
// Both windows talk over BroadcastChannel (same browser, same origin).

import { renderInfographic } from "./infographic.js";
import { createDirectorBrain } from "./director-brain.js";
import { createLatencyMeter } from "./latency-meter.js";
import { createSpeechDirector } from "./speech-director.js";
import { rememberScene, recallScene, countSavedScenes, clearSceneMemory } from "./scene-memory.js";
import { fingerprint, rememberRejectedProposal, wasProposalRejected, countRejectedProposals, clearRejectedProposals } from "./director-preferences.js";
import { mountImportPanel } from "./import-ui.js";
import { summarizeLecture } from "./lecture-readiness.js";
import { testLectureMedia, probeMedia } from "./media-preflight.js";
import { buildSteps, clampStep, imageFor, lastStep, nextPosition, prevPosition, autoDelay, fadeMs } from "./build-steps.js";
import { recordDecision, tasteFor, summarizeTaste, clearTaste } from "./director-taste.js";
import { createReturnStack } from "./return-stack.js";
import { createSessionLog } from "./session-log.js";
import { mountLibraryPanel } from "./library-ui.js";
import { clockState, PLANNED_CHOICES } from "./lecture-clock.js";
import { runRehearsal } from "./rehearsal.js";
import { mountInsight } from "./insight-ui.js";
import { mountFieldTools } from "./field-ui.js";
import { interpretNav } from "./voice-nav.js";
import { THEMES, themeName } from "./scene-theme.js";
import { createFieldRecorder } from "./field-recorder.js";
import { createResume } from "./resume-state.js";
import { createNumberWitness } from "./number-witness.js";
import { sameLecture, validMediaTime, validVideoPacket, validSnapshot, needsMediaSeek } from "./video-sync.js";

const app = document.getElementById("app");
const channel = new BroadcastChannel("alfa-cognitive-stage");
const params = new URLSearchParams(location.search);
const role = location.hash === "#audience" ? "audience" : "presenter";
const audienceRequestId = role === "audience"
  ? Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("")
  : null;

const state = { index: 1, step: 0, main: 1, count: 0, notes: [], slides: [], bundle: "", aspect: 16 / 9, manifest: null };
let videoEl = null;
let videoEls = [];
let insight = null;
let recorder = null, resumeStore = null;
const numberWitness = createNumberWitness();
const pollScreen = { visible: false, url: "", active: null };
let clockStart = Date.now();
let slideGeneration = 0;
let autoStepTimer = null;
let currentOverlay = null; // spec of the scene now on screen, for return snapshots
const returnStack = createReturnStack();
const brain = createDirectorBrain();
const meter = createLatencyMeter();
let lastVoiceHealth = null;
let sessionLog = { slide() {}, scene() {}, declined() {}, video() {}, digression() {}, current: () => null, clear() {}, end() {} };
const neighboringSlides = new Map();
const directorRuntime = {
  speech: null, pending: null, lastKey: "", lastAt: 0,
  cloudSeq: 0, activeOverlay: false, questionDraft: null,
  mediaCheckAbort: null,
};

// Read-only counters for the stability tests (no behaviour depends on them).
globalThis.__alfaStats = () => ({
  videos: document.querySelectorAll("video").length, trackedVideos: videoEls.length,
  prefetched: neighboringSlides.size, overlays: document.querySelectorAll(".info-layer").length,
  fades: document.querySelectorAll(".step-fade").length, nodes: document.getElementsByTagName("*").length,
  heap: performance.memory?.usedJSHeapSize ?? null, stack: returnStack.depth(),
});
function send(message) {
  channel.postMessage({ ...message, bundle: state.bundle });
}

function currentVideoSnapshot() {
  return videoEls.map((el) => ({ time: validMediaTime(el.currentTime) ? el.currentTime : 0,
    playing: !el.paused && !el.ended }));
}
function broadcastSnapshot(requestId) {
  if (typeof requestId !== "string" || !/^[a-f0-9]{16}$/.test(requestId)) return;
  send({ type: "snapshot", requestId, index: state.index, step: state.step, main: state.main,
    videos: currentVideoSnapshot() });
}
function adjustAudienceMediaTime(el, time, force = false) {
  if (!el || !validMediaTime(time)) return;
  const apply = () => {
    if (!videoEls.includes(el)) return; // Ignore a previous slide that finished loading late.
    if (force || needsMediaSeek(el.currentTime, time)) {
      try { el.currentTime = time; } catch {} // A source may be unsupported in this browser.
    }
  };
  if (el.readyState < 1) el.addEventListener("loadedmetadata", apply, { once: true });
  else apply();
}
function playAudienceMedia(el) {
  const attempt = el.play();
  attempt?.catch?.(() => send({ type: "audience-media-issue", index: state.index,
    issue: "تعذر التشغيل التلقائي للفيديو على شاشة الطلبة؛ اختبر إذن التشغيل والصوت." }));
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
    // Dynamically attached <source> children are not always fetched until load() is called.
    // Trigger metadata loading explicitly so the lecturer can play/seek immediately.
    el.load();
    videoEls.push(el);
    if (role === "presenter") {
      let lastProgressAt = 0;
      const relay = (action) => {
        if (videoEls[i] !== el) return; // Prevent delayed events from a replaced slide.
        send({ type: "video", action, index: state.index, clip: i,
          time: validMediaTime(el.currentTime) ? el.currentTime : 0 });
      };
      el.addEventListener("play", () => {
        if (videoEls[i] !== el) return;
        sessionLog.video({ slide: state.index, clip: i, action: "play", at: el.currentTime });
        for (const other of videoEls) if (other !== el && !other.paused) other.pause();
        directorRuntime.speech?.setMediaPlaying(true);
        relay("play");
      });
      el.addEventListener("pause", () => {
        if (videoEls[i] !== el) return;
        sessionLog.video({ slide: state.index, clip: i, action: "pause", at: el.currentTime });
        if (videoEls.every((item) => item.paused)) directorRuntime.speech?.setMediaPlaying(false);
        relay("pause");
      });
      el.addEventListener("seeked", () => relay("seek"));
      el.addEventListener("ended", () => relay("ended"));
      el.addEventListener("timeupdate", () => {
        if (videoEls[i] !== el || el.paused || Date.now() - lastProgressAt < 1500) return;
        lastProgressAt = Date.now();
        relay("progress");
      });
    }
  });
  videoEl = videoEls[0] || null;
}

function prefetchNeighbors(index) {
  // Quietly warm the browser cache for next/previous slides, with small memory cap.
  const wanted = [index - 1, index + 1, index + 2].filter((n) => n >= 1 && n <= state.count);
  for (const target of wanted) {
    if (neighboringSlides.has(target)) continue;
    const slide = state.slides[target - 1];
    if (!slide?.image) continue;
    const preview = new Image();
    preview.decoding = "async";
    preview.src = "/bundles/" + state.bundle + "/" + slide.image;
    neighboringSlides.set(target, preview);
  }
  const here = state.slides[index - 1];
  const steps = buildSteps(here);
  if (steps) {
    for (let k = state.step + 1; k <= Math.min(state.step + 2, steps.length - 1); k++) {
      const key = "s" + index + "-" + k;
      if (neighboringSlides.has(key)) continue;
      const preview = new Image();
      preview.decoding = "async";
      preview.src = slideImageUrl(here, k);
      neighboringSlides.set(key, preview);
    }
  }
  for (const known of [...neighboringSlides.keys()]) {
    if (typeof known === "string") {
      if (!steps || !known.startsWith("s" + index + "-")) neighboringSlides.delete(known);
      continue;
    }
    if (!wanted.includes(known)) neighboringSlides.delete(known);
  }
}
function slideImageUrl(slide, step) {
  return `/bundles/${state.bundle}/${imageFor(slide, step)}`;
}
// Calm single cross-fade between two build states of the SAME slide; never restarts the slide.
function swapStepImage(img, url, alt, generation, ms) {
  const incoming = new Image();
  incoming.decoding = "async";
  incoming.src = url;
  const commit = () => {
    if (generation !== slideGeneration) return;
    const layer = document.createElement("img");
    layer.className = "slide step-fade";
    layer.alt = alt;
    layer.src = url;
    layer.style.transition = `opacity ${ms}ms ease`;
    img.after(layer);
    requestAnimationFrame(() => requestAnimationFrame(() => { layer.style.opacity = "1"; }));
    setTimeout(() => {
      if (generation === slideGeneration) { img.src = url; img.alt = alt; }
      layer.remove();
    }, ms + 40);
  };
  incoming.decode ? incoming.decode().then(commit, commit) : (incoming.onload = commit);
}
function scheduleAutoStep() {
  clearTimeout(autoStepTimer);
  autoStepTimer = null;
  if (role !== "presenter") return;
  const slide = state.slides[state.index - 1];
  const delay = autoDelay(slide, state.step);
  if (delay === null) return;
  const generation = slideGeneration, index = state.index, step = state.step;
  autoStepTimer = setTimeout(() => {
    if (generation === slideGeneration && state.index === index && state.step === step) {
      setStep(step + 1);
    }
  }, delay + 150);
}
// Move to another click state of the current slide without touching the slide, videos or overlays.
function setStep(step, { broadcast = true } = {}) {
  const slide = state.slides[state.index - 1];
  const target = clampStep(slide, step);
  if (!slide || !buildSteps(slide) || target === state.step) return;
  state.step = target;
  if (role === "presenter") sessionLog.slide(state.index, target);
  const img = document.getElementById("slide-img");
  if (img) swapStepImage(img, slideImageUrl(slide, target), `الشريحة ${state.index}`, slideGeneration, fadeMs(slide, target));
  prefetchNeighbors(state.index);
  if (role === "presenter") {
    if (broadcast) send({ type: "step", index: state.index, step: target });
    renderPresenterPanels();
    scheduleAutoStep();
  }
}
function showSlide(index, step = 0) {
  const slide = state.slides[index - 1];
  if (!slide) return;
  state.index = index;
  state.step = clampStep(slide, step);
  clearTimeout(autoStepTimer);
  if (role === "presenter") sessionLog.slide(index, state.step);
  if (role === "presenter") insight?.slideChanged();
  if (role === "presenter") {
    directorRuntime.cloudSeq++;
    directorRuntime.pending = null;
    brain.resetSlide();
  }
  const img = document.getElementById("slide-img");
  const generation = ++slideGeneration;
  if (img) {
    img.classList.add("leaving");
    const url = slideImageUrl(slide, state.step);
    setTimeout(() => {
      if (generation !== slideGeneration) return;
      img.src = url;
      img.alt = `الشريحة ${index}`;
      img.classList.remove("leaving");
    }, 120);
  }
  document.querySelectorAll(".step-fade").forEach((el) => el.remove());
  placeVideo(slide);
  prefetchNeighbors(index);
  if (role === "presenter") { renderPresenterPanels(); scheduleAutoStep(); }
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
          <div class="meta clock-box"><span id="clock">00:00</span>
            <select id="planned-minutes" aria-label="مدة المحاضرة المخططة"></select>
            <span id="clock-hint" class="clock-hint"></span></div>
          <div class="clock-track" aria-hidden="true"><span id="clock-fill"></span></div>
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
          <select id="lecture-picker" aria-label="اختيار المحاضرة"></select>
        </div>
      </div>
      <aside class="side">
        <div><div class="label">الشريحة التالية</div><div class="next" id="next-thumb"></div></div>
        <div id="lecture-import-mount"></div>
        <div id="library-mount"></div>
        <div id="insight-mount"></div>
        <div id="field-mount"></div>
        <details class="readiness-drawer" id="readiness-drawer">
          <summary>جاهزية العرض وتوافق PowerPoint</summary>
          <div id="readiness-content" aria-live="polite"></div>
        </details>
        <details id="voting-drawer" class="voting-drawer">
          <summary>التصويت الطلابي داخل الاستوديو</summary>
          <div class="director-actions">
            <button id="project-poll" type="button">إظهار QR والسؤال للطلبة</button>
            <button id="hide-poll" type="button">إخفاء التصويت عن الشاشة</button>
          </div>
          <iframe id="vote-iframe" src="/vote-admin.html?embed=1" title="لوحة إدارة التصويت" loading="lazy"></iframe>
        </details>
                <form class="info-form" id="info-form" hidden>
          <select id="info-type" aria-label="نوع الإنفوجرافيك">
            <option value="stat">بطاقة إحصائية</option>
            <option value="compare">مقارنة (الأول | الثاني)</option>
            <option value="steps">خطوات</option>
            <option value="concept">خريطة مفاهيم</option>
            <option value="flow">تسلسل تعليمي</option>
            <option value="timeline">خط زمني</option>
            <option value="story">مشهد قصصي</option>
            <option value="bars">أعمدة نسب (التسمية | 40%)</option>
            <option value="cycle">دورة (مراحل متكررة)</option>
            <option value="activity">نشاط (تعليماتك ثم المدة: …)</option>
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
            <option value="creative">إبداعي — القصص المؤكدة تلقائياً</option>
          </select>
          <label class="director-cloud"><input type="checkbox" id="director-nav" checked /> التنقل بالصوت («الشريحة التالية»، «السابقة»، «روح للشريحة خمسة»)</label>
          <label class="director-cloud">ألوان المشاهد <select id="scene-theme" aria-label="ألوان المشاهد">${Object.entries(THEMES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("")}</select></label>
          <button type="button" id="nav-undo" hidden>تراجع عن آخر انتقال صوتي</button>
          <label class="director-cloud"><input type="checkbox" id="director-cloud" /> تحليل سحابي اختياري (قد يتكلف)</label>
          <p class="meta" id="director-usage">السحابة مغلقة. المشاهد المحلية بلا API.</p>
          <input id="director-admin-token" type="password" autocomplete="off" placeholder="رمز المحاضر من Terminal (للذاكرة والتصويت وAPI)" />
          <button type="button" id="director-memory-sync">مزامنة المشاهد المعتمدة محلياً</button>
          <button type="button" id="director-forget-dismissals">مسح الاقتراحات المتجاهلة لهذه المحاضرة</button>
          <p class="meta" id="director-status" aria-live="polite">المايك متوقف. لا توجد طلبات API.</p>
          <p class="meta" id="director-voice-health" aria-label="تشخيص استجابة التعرف الصوتي" hidden></p>
          <p class="meta" id="director-last"></p>
          <div id="director-proposal" class="director-proposal" hidden>
            <div id="director-reason"></div>
            <div class="director-actions">
              <button class="primary" type="button" id="director-accept">عرض المشهد</button>
              <button type="button" id="director-reject">تجاهل</button>
            </div>
          </div>
          <details><summary>أدوات متقدمة: اختبار نصّي وإدارة الذاكرة</summary>
            <input id="director-test-text" type="text" maxlength="950" placeholder="في دراسة ذكرت أن 68% من الطلبة..." />
            <button id="director-test-run" type="button">اختبر العبارة</button>
            <p class="meta" id="director-taste" aria-live="polite"></p>
            <div class="director-actions">
              <button type="button" id="director-clear-taste">نسيان تفضيلات الأسلوب</button>
              <button type="button" id="director-clear-scenes">مسح مشاهد هذه المحاضرة المحفوظة</button>
              <button type="button" id="director-clear-all-scenes">مسح كل ذاكرة المشاهد</button>
            </div>
          </details>
        </section>
        <div><div class="label">ملاحظات المحاضر</div></div>
        <div class="notes" id="notes"></div>
      </aside>
    </section>`;
  setAspect(state.aspect);
  document.getElementById("prev").onclick = () => retreat();
  document.getElementById("next").onclick = () => advance();
  document.getElementById("home").onclick = () => goMain();
  document.getElementById("playvid").onclick = () => toggleVideo();
  document.getElementById("open-vote").onclick = () => {
    const drawer = document.getElementById("voting-drawer");
    drawer.open = true;
    drawer.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  document.getElementById("vote-iframe").addEventListener("load", () => {
    if (directorRuntime.questionDraft) postPollDraft(directorRuntime.questionDraft);
  });
  document.getElementById("project-poll").onclick = () => {
    recorder?.note("poll");
    if (!pollScreen.url) {
      document.getElementById("project-poll").textContent = "سجّل دخولك وأنشئ جلسة أولاً";
      return;
    }
    if (!pollScreen.visible) beginDigression();
    pollScreen.visible = true;
    renderPollScreen(pollScreen);
    send({ type: "poll-projection", data: pollScreen });
  };
  document.getElementById("hide-poll").onclick = () => {
    pollScreen.visible = false;
    clearPollScreen();
    send({ type: "poll-projection", data: { visible: false } });
  };
  document.getElementById("toggle-info").onclick = () => {
    const form = document.getElementById("info-form");
    form.hidden = !form.hidden;
  };
  document.getElementById("info-form").addEventListener("submit", (event) => event.preventDefault()); // no inline handlers (CSP)
  document.getElementById("info-show").onclick = showInfographicFromForm;
  fillLecturePicker();
  document.getElementById("info-hide").onclick = () => {
    if (returnStack.active()) backOneLevel(); else hideInfographic(true);
  };
  document.getElementById("open-audience").onclick = () =>
    window.open(`${location.pathname}?bundle=${state.bundle}#audience`, "alfa-audience");
  showSlide(state.index);
  setupDirector();
  setupSceneTheme();
  mountImportPanel(document.getElementById("lecture-import-mount"));
  mountLibraryPanel(document.getElementById("library-mount"), {
    getToken: directorAdminToken, getBundle: () => state.bundle, getManifest: () => state.manifest, sessionLog,
    getPollCode: () => { try { return new URL(pollScreen.url).searchParams.get("s"); } catch { return null; } },
    getUsage: async () => { const r = await fetch("/api/director/status", { headers: { "X-Admin-Token": directorAdminToken() } }); return r.ok ? r.json() : null; },
    onOpen: (bundle) => { sessionLog.end(); location.search = "?bundle=" + bundle; },
  });
  insight = mountInsight(document.getElementById("insight-mount"), {
    getToken: directorAdminToken, getBundle: () => state.bundle, getManifest: () => state.manifest,
    getSlide: () => state.index, sessionLog, getSlides: () => state.slides,
    getPollCode: () => { try { return new URL(pollScreen.url).searchParams.get("s"); } catch { return null; } },
  });
  recorder = createFieldRecorder({ bundle: state.bundle });
  resumeStore = createResume({ bundle: state.bundle });
  mountFieldTools(document.getElementById("field-mount"), {
    getToken: directorAdminToken, getBundle: () => state.bundle, getSlides: () => state.slides,
    goToSlide: (index) => go(index),
    recorder, resume: resumeStore, restoreStage: restoreStageState, noteFeature: (name) => recorder.note(name),
  });
  setInterval(() => { if (role === "presenter") resumeStore.save(captureStageState()); }, 2500);
  if (globalThis.__alfaGuest) document.body.append(Object.assign(document.createElement("div"), { className: "guest-badge", id: "guest-badge", textContent: "وضع الضيف: لا يُحفظ شيء في هذا المتصفح" }));
  renderReadiness();
  setupPlannedClock();
}

// Does an audience window answer? (same-browser BroadcastChannel round trip)
function pingAudience() {
  return new Promise((resolve) => {
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
    const probe = new BroadcastChannel("alfa-cognitive-stage");
    const done = (value) => { clearTimeout(timer); probe.close(); resolve(value); };
    const timer = setTimeout(() => done(false), 700);
    probe.onmessage = (event) => { if (event.data?.type === "pong" && event.data.nonce === nonce) done(true); };
    probe.postMessage({ type: "ping", nonce, bundle: state.bundle });
  });
}
function renderReadiness() {
  const target = document.getElementById("readiness-content");
  if (!target || !state.manifest) return;
  const summary = summarizeLecture(state.manifest);
  const info = document.createElement("p");
  info.textContent = summary.slideCount + " شريحة، " + summary.embeddedVideoCount +
    " فيديو مضمّن، " + summary.animatedSlides.length + " شريحة بها حركات أصلية (" +
    summary.reproducedBuildSlides.length + " تعمل خطوة بخطوة).";
  const verdict = document.createElement("p");
  verdict.textContent = summary.summary;
  target.replaceChildren(info, verdict);
  const mediaButton = document.createElement("button");
  mediaButton.id = "media-preflight-run";
  mediaButton.type = "button";
  mediaButton.textContent = "اختبار فك ترميز فيديوهات هذه المحاضرة";
  const mediaResults = document.createElement("div");
  mediaResults.id = "media-preflight-results";
  mediaResults.setAttribute("role", "status");
  mediaResults.setAttribute("aria-live", "polite");
  mediaResults.textContent = summary.embeddedVideoCount
    ? "اختبار صامت داخل هذا المتصفح. تأكد من صوت المقاطع يدوياً بعده."
    : "لا توجد فيديوهات مضمنة في هذه المحاضرة.";
  mediaButton.disabled = summary.embeddedVideoCount === 0;
  target.append(mediaButton, mediaResults);
  const rehearsalButton = document.createElement("button");
  rehearsalButton.id = "rehearsal-run";
  rehearsalButton.type = "button";
  rehearsalButton.textContent = "بروفة قبل الدرس";
  const rehearsalList = document.createElement("ol");
  rehearsalList.className = "rehearsal-list";
  rehearsalList.id = "rehearsal-results";
  rehearsalList.setAttribute("aria-live", "polite");
  target.append(rehearsalButton, rehearsalList);
  rehearsalButton.onclick = async () => {
    rehearsalButton.disabled = true;
    rehearsalList.replaceChildren();
    const mark = { ok: "✓ ", warn: "⚠ ", fail: "✗ " };
    try {
      const outcome = await runRehearsal({
        manifest: state.manifest, slides: state.slides, bundle: state.bundle,
        fetchImpl: (url, init) => fetch(url, init), testMedia: testLectureMedia,
        nav: { onLine: navigator.onLine, hasRecognition: Boolean(directorRuntime.speech?.supported),
          audioInputs: await navigator.mediaDevices?.enumerateDevices?.().then((d) => d.filter((x) => x.kind === "audioinput").length).catch(() => null) },
        audienceOpen: pingAudience,
        adminCheck: async () => {
          const token = directorAdminToken();
          if (!token) return null;
          try { return (await fetch("/api/admin/check", { headers: { "X-Admin-Token": token } })).ok; } catch { return false; }
        },
        probeBroken: async () => {
          const started = Date.now();
          const result = await probeMedia({ sources: [{ type: "video/mp4", src: "/bundles/" + state.bundle + "/media/__rehearsal_missing__.mp4" }] }, { timeoutMs: 3000 });
          return ["failed", "timeout"].includes(result.status) && Date.now() - started < 5000;
        },
        onProgress(result) {
          const row = document.createElement("li");
          row.className = "rehearsal-" + result.level;
          row.textContent = mark[result.level] + result.text;
          rehearsalList.append(row);
        },
      });
      const headline = document.createElement("li");
      headline.className = "rehearsal-" + outcome.level;
      headline.textContent = outcome.level === "ok" ? "البروفة اكتملت بلا مشاكل." : outcome.level === "warn" ? "البروفة اكتملت مع تنبيهات؛ راجعها قبل الدخول." : "فشل في بند أو أكثر؛ أصلحه قبل الدخول.";
      rehearsalList.prepend(headline);
    } catch (error) {
      rehearsalList.textContent = "تعذرت البروفة: " + error.message;
    } finally { rehearsalButton.disabled = false; }
  };
  mediaButton.onclick = async () => {
    if (directorRuntime.mediaCheckAbort) directorRuntime.mediaCheckAbort.abort();
    const controller = new AbortController();
    directorRuntime.mediaCheckAbort = controller;
    mediaButton.disabled = true;
    const report = document.createElement("ol");
    report.className = "media-preflight-list";
    mediaResults.replaceChildren(report);
    let checked = 0;
    try {
      const results = await testLectureMedia(state.slides, state.bundle, {
        signal: controller.signal, timeoutMs: 7000,
        onProgress(item,completed,total) {
          checked = completed;
          const row = document.createElement("li");
          row.textContent = "الشريحة " + item.slide + " — فيديو " + item.clipIndex + ": " +
            (item.status === "ready" ? "تم فك ترميز أول إطار" :
              item.status === "blocked" ? "المتصفح منع التشغيل التلقائي؛ اختبره يدوياً" :
              item.status === "cancelled" ? "أُلغي الاختبار" :
              "تعذّر تشغيله: " + (item.message || item.status));
          report.appendChild(row);
          if (!item.message && item.status === "ready") row.className = "media-ready";
          mediaButton.textContent = "فحص الفيديو " + completed + " من " + total;
        },
      });
      const headline = document.createElement("p");
      headline.textContent = results.cancelled
        ? "أُلغي فحص الفيديو قبل اكتماله."
        : "فُحص " + checked + " من " + results.total + " فيديو: " +
          results.passed + " نجح فك ترميزه، " + results.failed + " يحتاج مراجعة.";
      mediaResults.prepend(headline);
    } catch (err) { mediaResults.textContent = "لم يكتمل الفحص: " + err.message; }
    finally {
      if (directorRuntime.mediaCheckAbort === controller) directorRuntime.mediaCheckAbort = null;
      mediaButton.disabled = false;
      mediaButton.textContent = "إعادة اختبار فيديوهات المحاضرة";
    }
  };
  for (const warning of summary.warnings) {
    const p = document.createElement("p");
    p.className = "readiness-warning";
    p.textContent = (warning.slide ? "الشريحة " + warning.slide + ": " : "") + warning.problem;
    target.append(p);
  }
  if (summary.animatedSlides.length && (summary.unreproducedAnimationSlides.length || summary.partialBuildSlides.length)) {
    const head = document.getElementById("readiness-drawer");
    if (head) head.open = true;
  }
}

function renderPresenterPanels() {
  const slide = state.slides[state.index - 1];
  const meta = document.getElementById("meta");
  if (meta) meta.textContent = `الشريحة ${state.index} من ${state.count}`;
  const notes = document.getElementById("notes");
  if (notes) notes.textContent = slide.notes || "لا توجد ملاحظات لهذه الشريحة.";
  const steps = buildSteps(slide);
  if (steps && meta) meta.textContent += ` — حركة ${state.step} من ${steps.length - 1}`;
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

// The colour theme travels inside the scene, so the audience window draws exactly what the lecturer chose.
function sceneTheme() {
  const box = document.getElementById("scene-theme");
  const chosen = box?.value || (() => { try { return localStorage.getItem("alfa-scene-theme"); } catch { return null; } })();
  return themeName(chosen);
}
function setupSceneTheme() {
  const box = document.getElementById("scene-theme");
  if (!box) return;
  try { box.value = themeName(localStorage.getItem("alfa-scene-theme")); } catch {}
  box.onchange = () => { try { localStorage.setItem("alfa-scene-theme", box.value); } catch {} };
}
function showInfographicFromForm() {
  const msg = document.getElementById("info-msg");
  try {
    const spec = {
      type: document.getElementById("info-type").value,
      title: document.getElementById("info-title").value,
      lines: document.getElementById("info-lines").value.split("\n"),
      theme: sceneTheme(),
    };
    renderInfographic(spec); // validates before sending
    beginDigression();
    renderLayer(spec);
    currentOverlay = spec;
    sessionLog.scene({ slide: state.index, type: spec.type, title: spec.title, lines: spec.lines, source: "manual" });
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
  if (role === "presenter") {
    directorRuntime.activeOverlay = false;
    currentOverlay = null;
    pollScreen.visible = false; // Emergency/slide navigation must not keep projecting QR.
  }
  document.querySelectorAll(".info-layer").forEach((el) => el.remove());
}

// Normal navigation: the lecturer is resuming the lecture, so any digression anchor is obsolete.
function resumeLecture() {
  returnStack.clear();
  currentOverlay = null;
  hideInfographic(true);
}
function go(index, step = 0) {
  if (index < 1 || index > state.count) return;
  resumeLecture();
  state.main = index; // A normal slide change updates the safe return anchor.
  showSlide(index, step);
  send({ type: "slide", index, step: state.step, main: state.main });
}
function advance() {
  const target = nextPosition(state.slides, state.index, state.step);
  if (!target) return;
  if (target.index === state.index) { resumeLecture(); setStep(target.step); }
  else go(target.index, target.step);
}
function retreat() {
  const target = prevPosition(state.slides, state.index, state.step);
  if (!target) return;
  if (target.index === state.index) { resumeLecture(); setStep(target.step); }
  else go(target.index, target.step);
}

function captureStageState() {
  return { index: state.index, step: state.step,
    videos: videoEls.map((el) => ({ time: validMediaTime(el.currentTime) ? el.currentTime : 0,
      playing: !el.paused && !el.ended })),
    overlay: currentOverlay, poll: pollScreen.visible };
}
// Call right before any scene/poll goes on screen so one "return" can restore everything.
function beginDigression() { returnStack.enter(captureStageState); sessionLog.digression("enter"); }

function restoreStageState(snapshot) {
  if (!snapshot) return;
  if (state.index !== snapshot.index) {
    state.main = snapshot.index;
    showSlide(snapshot.index, snapshot.step);
  } else if (state.step !== snapshot.step) setStep(snapshot.step, { broadcast: false });
  document.querySelectorAll(".info-layer").forEach((el) => el.remove());
  currentOverlay = null;
  directorRuntime.activeOverlay = false;
  if (snapshot.overlay) {
    try { renderLayer(snapshot.overlay); currentOverlay = snapshot.overlay; directorRuntime.activeOverlay = true; }
    catch {}
  }
  pollScreen.visible = Boolean(snapshot.poll);
  if (pollScreen.visible) renderPollScreen(pollScreen);
  videoEls.forEach((el, i) => {
    const wanted = snapshot.videos?.[i];
    if (!wanted) return;
    el.pause();
    try { if (Math.abs(el.currentTime - wanted.time) > 0.05) el.currentTime = wanted.time; } catch {}
    if (wanted.playing) el.play()?.catch?.(() => {});
  });
  send({ type: "restore", index: state.index, step: state.step, main: state.main,
    infographic: currentOverlay, poll: pollScreen.visible ? pollScreen : { visible: false },
    videos: snapshot.videos?.length === videoEls.length ? snapshot.videos : currentVideoSnapshot() });
}

function goMain() {
  // Emergency/return: back to the exact lecture state captured when the digression began.
  noteQuickHide();
  const original = returnStack.home();
  if (original) { sessionLog.digression("return"); restoreStageState(original); return; }
  // No digression recorded: stop clips, hide scenes, stay on the current slide and click state.
  for (const el of videoEls) el.pause();
  hideInfographic(true);
  if (state.index !== state.main) showSlide(state.main);
  send({ type: "slide", index: state.main, step: state.step, main: state.main, emergency: true });
}
// One level back out of nested digressions (scene inside a scene).
function backOneLevel() {
  noteQuickHide();
  const previous = returnStack.back();
  if (previous) { sessionLog.digression("back"); restoreStageState(previous); } else goMain();
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
  if (!proposal || wasProposalRejected({ bundle: state.bundle, slide: state.index, utterance: proposal.utterance })) return;
  directorRuntime.pending = { ...proposal, slide: state.index, at: Date.now() };
  const panel = document.getElementById("director-proposal");
  const description = document.getElementById("director-reason");
  if (description) description.textContent = reason;
  if (panel) panel.hidden = false;
}
function directorAdminToken() {
  return document.getElementById("director-admin-token")?.value.trim() ||
    sessionStorage.getItem("alfa-admin-token") || "";
}
async function saveApprovedSceneServer(proposal) {
  if (!proposal?.utterance || !proposal?.spec) return;
  const token = directorAdminToken();
  if (!token) return; // Browser cache still works; no paid API request is involved.
  try {
    const response = await fetch("/api/memory/" + encodeURIComponent(state.bundle), {
      method: "POST",
      headers: { "X-Admin-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ slide: state.index, utterance: proposal.utterance, spec: proposal.spec }),
    });
    if (!response.ok) {
      setDirectorStatus("المشهد معروض ومحفوظ بالمتصفح، لكن لم يُحفظ في مكتبة الخادم.");
    }
  } catch {
    setDirectorStatus("المشهد محفوظ بالمتصفح فقط؛ اتصال الذاكرة المحلية غير متاح.");
  }
}
async function syncApprovedScenes() {
  const token = directorAdminToken();
  if (!token) { setDirectorStatus("مزامنة الذاكرة تحتاج رمز المحاضر."); return; }
  const button = document.getElementById("director-memory-sync");
  if (button) button.disabled = true;
  try {
    const response = await fetch("/api/memory/" + encodeURIComponent(state.bundle),
      { headers: { "X-Admin-Token": token } });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "تعذر فتح ذاكرة المحاضرة");
    let recovered = 0;
    // The current lecture stays a first-class cache, even when a second
    // cross-lecture index request is not available (older local servers).
    for (const item of data.scenes || []) {
      if (rememberScene({ bundle: state.bundle, slide: item.slide, utterance: item.utterance,
        spec: item.spec })) recovered++;
    }
    let restoredAcross = 0;
    try {
      const libraryResponse = await fetch("/api/memory/library",
        { headers: { "X-Admin-Token": token } });
      if (libraryResponse.ok) {
        const library = await libraryResponse.json();
        for (const item of Array.isArray(library.scenes) ? library.scenes : []) {
          if (item.bundle === state.bundle || typeof item.bundle !== "string" ||
              !/^[a-zA-Z0-9_-]{4,64}$/.test(item.bundle)) continue;
          try {
            if (rememberScene({ bundle: item.bundle, slide: item.slide,
              utterance: item.utterance, spec: item.spec })) restoredAcross++;
          } catch {} // A damaged stored scene cannot interrupt the lecture.
        }
      }
    } catch {} // Current lecture cache still works if cross-lecture sync fails.
    setDirectorStatus("تمت مزامنة " + recovered + " مشهد لهذه المحاضرة و" +
      restoredAcross + " من محاضرات سابقة محلياً. بلا API.");
  } catch (error) { setDirectorStatus(error.message); }
  finally { if (button) button.disabled = false; }
}

function revealDirectorScene(proposal, source = "approved") {
  if (!proposal?.spec || proposal.slide !== state.index ||
      Date.now() - proposal.at > 30000 || videoEls.some((el) => !el.paused)) return false;
  try {
    beginDigression();
    proposal.spec.theme = sceneTheme();
    renderLayer(proposal.spec);
    currentOverlay = proposal.spec;
    sessionLog.scene({ slide: state.index, type: proposal.spec.type, title: proposal.spec.title, lines: proposal.spec.lines, source });
    recorder?.shown({ slide: state.index, type: proposal.spec.type, source });
    send({ type: "infographic", spec: proposal.spec });
    directorRuntime.activeOverlay = true;
    if (proposal.utterance) {
      rememberScene({
        bundle: state.bundle, slide: state.index, utterance: proposal.utterance, spec: proposal.spec
      });
      void saveApprovedSceneServer(proposal);
    }
    clearDirectorProposal();
    setDirectorStatus("مشهد بصري — زر E للعودة الفورية");
    return true;
  } catch (err) {
    setDirectorStatus("لم يتم عرض المشهد: " + err.message);
    return false;
  }
}
async function refreshDirectorUsage() {
  const target = document.getElementById("director-usage");
  if (!target) return;
  if (!document.getElementById("director-cloud")?.checked) {
    target.textContent = "السحابة مغلقة. المشاهد المحلية بلا API.";
    return;
  }
  const token = directorAdminToken();
  if (!token) { target.textContent = "عرض الاستهلاك يحتاج رمز المحاضر."; return; }
  try {
    const response = await fetch("/api/director/status", { headers: { "X-Admin-Token": token } });
    if (!response.ok) throw Error("status unavailable");
    const info = await response.json();
    if (!document.getElementById("director-cloud")?.checked) return;
    const daily = info.daily;
    if (info.available && daily && !daily.healthy) {
      target.textContent = "تعذر قراءة سجل سقف API اليومي؛ أُوقفت الطلبات المدفوعة لحماية التكلفة.";
      return;
    }
    const money = info.costUsd === null ? "لا سعر موثوق للنموذج؛ الطلبات المدفوعة موقوفة"
      : "تقدير اليوم $" + info.costUsd.toFixed(4) + " من سقف $" + info.capUsd.toFixed(2) + " (تقدير لا فاتورة المزود)";
    target.textContent = info.available
      ? "السحابة اليوم (UTC): " + daily.callsUsed + "/" + daily.maxCalls +
        " طلب، " + (daily.inputTokens + daily.outputTokens) + " توكن مبلّغ عنه" +
        (daily.unknownUsageCalls ? "، " + daily.unknownUsageCalls + " طلب بتوكنات غير معروفة (محتسبة بأسوأ حالة)" : "") +
        (daily.unreportedCalls ? "، " + daily.unreportedCalls + " طلب لم تكتمل بياناته" : "") +
        " — " + money + (info.cacheHits ? " — " + info.cacheHits + " إجابة من الذاكرة بلا تكلفة" : "")
      : "السحابة غير مجهزة بمفتاح API؛ العرض المحلي مستمر.";
  } catch { target.textContent = "تعذر قراءة عداد API المحلي."; }
}
async function requestDirectorAI(text, seq) {
  const token = directorAdminToken();
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
    void refreshDirectorUsage();
    if (seq !== directorRuntime.cloudSeq) return; // Topic or slide changed.
    if (!response.ok) { setDirectorStatus(data.error || "تعذر تحليل المخرج"); return; }
    if (!data.proposal?.spec) { setDirectorStatus("لا يوجد مشهد إضافي يستحق الظهور."); return; }
    showDirectorProposal({ ...data.proposal, utterance: text }, data.proposal.reason || "مشهد من التحليل السحابي — يحتاج موافقتك.");
  } catch (err) {
    void refreshDirectorUsage();
    if (seq === directorRuntime.cloudSeq) setDirectorStatus("الاتصال السحابي غير متاح؛ العرض مستمر.");
  }
}
function directorContext() {
  const slide = state.slides[state.index - 1] || {};
  return { slide: { index: state.index, text: String(slide.text || ""), notes: String(slide.notes || "") },
    overlay: currentOverlay, mode: document.getElementById("director-mode")?.value || "balanced",
    mediaPlaying: videoEls.some((el) => !el.paused) };
}
function revealAndRecord(proposal, { automatic = false } = {}) {
  if (!revealDirectorScene(proposal, automatic ? "auto" : proposal.fromMemory ? "memory" : "approved")) return false;
  brain.noteShown(state.index);
  directorRuntime.autoShown = automatic && proposal.spec
    ? { type: proposal.spec.type, at: Date.now(), fp: fingerprint(proposal.utterance) } : null;
  refreshTasteLine();
  return true;
}
// Hiding an automatically shown scene within seconds is a (weak) sign it was unwanted.
function noteQuickHide() {
  const shown = directorRuntime.autoShown;
  directorRuntime.autoShown = null;
  if (shown && Date.now() - shown.at < 6000) {
    recordDecision({ bundle: state.bundle, type: shown.type, approved: false, fingerprint: shown.fp || "", weight: 0.5 });
    refreshTasteLine();
  }
}
function refreshTasteLine() {
  const el = document.getElementById("director-taste");
  if (!el) return;
  const names = { stat: "إحصائية", compare: "مقارنة", steps: "خطوات", story: "قصة", timeline: "خط زمني", concept: "مفاهيم", flow: "تسلسل", bars: "أعمدة", cycle: "دورة", activity: "نشاط" };
  const rows = summarizeTaste(state.bundle).map((x) => (names[x.type] || x.type) + ": قبول " + x.approvals.toFixed(1) +
    " / رفض " + x.rejections.toFixed(1) + (x.suppressed ? " (موقوف)" : x.quieter ? " (بموافقتك فقط)" : ""));
  el.textContent = rows.length ? "تفضيلات متعلمة (تتلاشى بعد أسابيع): " + rows.join(" · ")
    : "لا تفضيلات متعلمة بعد؛ الرفض المنفرد لا يغيّر السلوك.";
}
// All interpretation lives in director-brain.js; this function only applies its decision.
// Spoken navigation: whole-utterance imperatives only (see voice-nav.js), never while a video plays,
// at most once per command per 2 s, and always undoable.
const voiceNav = { last: null, undoTimer: null };
function navEnabled() {
  const box = document.getElementById("director-nav");
  return !box || box.checked;
}
function handleVoiceNav(command) {
  if (videoEls.some((el) => !el.paused)) { setDirectorStatus("الفيديو يعمل؛ لم أنفّذ أمر التنقل الصوتي."); return; }
  const key = command.kind + ":" + (command.index ?? "");
  if (voiceNav.last && voiceNav.last.key === key && Date.now() - voiceNav.last.at < 2000) return;
  voiceNav.last = { key, at: Date.now() };
  const before = { index: state.index, step: state.step };
  if (command.kind === "next") advance();
  else if (command.kind === "prev") retreat();
  else if (command.kind === "first") go(1);
  else if (command.kind === "last") go(state.count);
  else if (command.index > state.count) { setDirectorStatus(`الشريحة ${command.index} غير موجودة؛ عدد الشرائح ${state.count}.`); return; }
  else go(command.index);
  recorder?.note("nav");
  if (before.index === state.index && before.step === state.step) { setDirectorStatus("لا مزيد في هذا الاتجاه."); return; }
  setDirectorStatus(`انتقلتُ بالصوت إلى الشريحة ${state.index}. اضغط «تراجع» إن لم تقصد ذلك.`);
  const undo = document.getElementById("nav-undo");
  if (undo) {
    undo.hidden = false;
    undo.onclick = () => { undo.hidden = true; go(before.index, before.step); setDirectorStatus("تم التراجع عن الانتقال الصوتي."); };
    clearTimeout(voiceNav.undoTimer);
    voiceNav.undoTimer = setTimeout(() => { undo.hidden = true; }, 10000);
  }
}
function receiveDirectorSpeech(text, meta = {}) {
  const raw = String(text || "").trim();
  if (!raw) return;
  const navCommand = navEnabled() ? interpretNav(raw) : null;
  if (navCommand) { handleVoiceNav(navCommand); return; }
  // A return command already executed from a stable interim transcript must not run twice.
  const early = directorRuntime.interimReturn;
  if (early && Date.now() - early.at < 5000 && brain.peekReturn(raw)) { directorRuntime.interimReturn = null; return; }
  const finalAt = Number.isFinite(meta.finalAt) ? meta.finalAt : Date.now();
  const timed = (kind) => {
    const decidedAt = Date.now();
    requestAnimationFrame(() => { // the frame in which the scene/proposal is actually painted
      if (meter.record({ kind, onsetAt: meta.firstInterimAt, finalAt, decidedAt, shownAt: Date.now(), engine: meta.engine })) renderVoiceHealth();
      recorder?.latency({ kind, totalMs: Date.now() - (Number.isFinite(meta.firstInterimAt) ? meta.firstInterimAt : finalAt), engine: meta.engine });
    });
  };
  const last = document.getElementById("director-last");
  if (last) last.textContent = "سمعت: " + raw.slice(0, 160);
  directorRuntime.cloudSeq++;
  const context = directorContext();
  const decision = brain.observe(raw, context);
  const heardId = recorder?.recording() ? recorder.utterance({ text: raw, slide: state.index, engine: meta.engine }) : null;
  if (heardId) recorder.decision({ slide: state.index, action: decision.action, kind: decision.kind, why: decision.why, opportunity: decision.opportunity,
    confidence: decision.confidence, utteranceId: heardId, spec: decision.spec });
  const slip = numberWitness.check(state.index, raw, context.slide.text + " " + context.slide.notes);
  if (slip) { insight?.witness(slip.message); recorder?.note("witness"); }
  if (decision.action === "return" || decision.action === "return-level") recorder?.note("return");
  if (decision.topic.shifted) {
    clearDirectorProposal();
    setDirectorStatus("لاحظت تغيّر الموضوع؛ أغلقت الاقتراحات المعلقة.");
  } else if (decision.topic.returnedTo) {
    setDirectorStatus("عدتَ إلى موضوع سابق: " + decision.topic.returnedTo);
  }
  if (decision.action === "return" || decision.action === "return-level") {
    directorRuntime.cloudSeq++;
    clearDirectorProposal();
    if (directorRuntime.activeOverlay || returnStack.active()) {
      if (decision.action === "return-level") backOneLevel(); else goMain();
    }
    setDirectorStatus(decision.action === "return-level"
      ? "رجعنا خطوة واحدة في الاستطراد." : "تم فهم العودة إلى الموضوع الأصلي.");
    return;
  }
  const rejected = wasProposalRejected({ bundle: state.bundle, slide: state.index, utterance: raw });
  if (decision.retract) {
    showDirectorProposal({ retract: true, spec: null, utterance: raw }, decision.reason);
    return;
  }
  if (decision.spec && (decision.action === "auto" || decision.action === "propose")) {
    const taste = tasteFor({ bundle: state.bundle, type: decision.spec.type });
    if (decision.action === "propose" && taste.suppressed && decision.kind !== "correction") {
      setDirectorStatus("أخفيت اقتراحاً من هذا النمط لأنك رفضته مراراً. «نسيان تفضيلات الأسلوب» يعيده.");
      return;
    }
    if (decision.action === "auto" && taste.quieter) decision.action = "propose";
    if (rejected) {
      setDirectorStatus("تم تجاوز اقتراح تجاهلته سابقاً على هذه الشريحة. يمكنك مسح التجاهلات.");
      return;
    }
    const proposal = { spec: decision.spec, utterance: decision.utterance || raw, slide: state.index, at: Date.now() };
    if (decision.action === "auto") {
      if (revealAndRecord(proposal, { automatic: true })) timed("scene");
      else { showDirectorProposal(proposal, decision.reason || "راجع المشهد قبل إظهاره."); timed("proposal"); }
    } else {
      showDirectorProposal(proposal, decision.reason || (decision.kind === "stat"
        ? "إحصائية التقطت من حديث المحاضر — تأكد من الرقم."
        : "اقتراح من حديثك كما نطقته؛ راجعه قبل إظهاره."));
      timed("proposal");
    }
    return;
  }
  if (decision.action === "observe") {
    setDirectorStatus("وضع الظل: اكتُشف " + decision.kind + " دون تغيير شاشة الطلبة.");
    return;
  }
  // No local scene: explain what was noticed, then try memory, then (rarely) the optional cloud.
  if (decision.kind === "question") postPollDraft(raw);
  const names = { story: "بداية قصة أو استطراد", compare: "فرصة مقارنة تعليمية", question: "سؤال موجه للطلبة",
    concept: "تعريف مفهوم", example: "مثال", timeline: "تسلسل زمني" };
  const noticed = decision.opportunity || decision.kind;
  if (noticed && names[noticed]) setDirectorStatus("التقطت " + names[noticed] + " — لم أعرض حقائق غير مؤكدة.");
  if (rejected || context.mode === "shadow") return;
  const saved = recallScene({ bundle: state.bundle, slide: state.index, utterance: raw });
  if (saved) {
    showDirectorProposal({ spec: saved.spec, utterance: raw, fromMemory: true },
      noticed ? "مشهد محفوظ — لا يحتاج API." : "مشهد محفوظ سابقاً — بلا تكلفة API. أكد ظهوره أمام الطلبة.");
    return;
  }
  if (decision.cloudText && document.getElementById("director-cloud")?.checked) {
    const seq = ++directorRuntime.cloudSeq;
    brain.noteCloudRequest();
    requestDirectorAI(decision.cloudText, seq); // Explicitly enabled, billed API; never auto-displays response.
  }
}
function renderVoiceHealth() {
  const element = document.getElementById("director-voice-health");
  const health = lastVoiceHealth;
  if (!element || !health) return;
  const latency = meter.summary();
  element.hidden = !health.finalSegments && !health.errors && !health.restarts && !latency.count;
  const pieces = ["نتائج نهائية: " + health.finalSegments];
  if (health.engine && health.engine !== "unknown" && health.engine !== "pending")
    pieces.push(health.engine === "local" ? "التعرف على الجهاز" : "التعرف عبر خدمة المتصفح" +
      (health.localStatus && health.localStatus !== "available" ? " (المحلي: " + health.localStatus + ")" : ""));
  if (health.interimToFinalMs !== null) pieces.push("أول معاينة ← النص النهائي: " + Math.round(health.interimToFinalMs) + "ms");
  if (latency.count) {
    pieces.push("إلى ظهور المشهد/الاقتراح بعد النص النهائي: وسيط " + Math.round(latency.localP50) + "ms، 95٪ " + Math.round(latency.localP95) + "ms");
    if (latency.totalP50 !== null) pieces.push("من أول معاينة: وسيط " + Math.round(latency.totalP50) + "ms (ن=" + latency.count + ")");
  }
  if (health.errors) pieces.push("أخطاء المتصفح: " + health.errors);
  if (health.restarts) pieces.push("إعادة الاستماع: " + health.restarts);
  element.textContent = pieces.join(" · ") + " (من أول نص مسموع، لا من موجة الصوت ولا يشمل مخزن المايك)";
}
function setupDirector() {
  const speech = createSpeechDirector({
    onUtterance: receiveDirectorSpeech,
    onStatus: (message) => {
      setDirectorStatus(message);
      // No microphone service: bring the typed fallback forward instead of leaving the lecturer stranded.
      if (/لا يوجد إنترنت|not-allowed|service-not-allowed/.test(message)) {
        const details = document.querySelector("#director-box details");
        if (details) details.open = true;
      }
    },
    onDiagnostics: (health) => { lastVoiceHealth = health; renderVoiceHealth(); },
    onStableInterim: (transcript) => {
      // Only reversible navigation commands may act before the final transcript arrives.
      const kind = brain.peekReturn(transcript);
      if (!kind || !(directorRuntime.activeOverlay || returnStack.active())) return;
      directorRuntime.interimReturn = { at: Date.now() };
      directorRuntime.cloudSeq++;
      clearDirectorProposal();
      if (kind === "return-level") backOneLevel(); else goMain();
      setDirectorStatus("فُهمت العودة من المعاينة المستقرة قبل اكتمال الجملة.");
    },
    onInterim: (transcript) => {
      const preview = document.getElementById("director-last");
      if (preview) preview.textContent = "أسمع الآن: " + transcript;
    }
  });
  directorRuntime.speech = speech;
  navigator.mediaDevices?.addEventListener?.("devicechange", () => speech.deviceChanged());
  const start = document.getElementById("director-start");
  const stop = document.getElementById("director-stop");
  start.onclick = () => speech.start();
  stop.onclick = () => speech.stop();
  document.getElementById("director-accept").onclick = () => {
    const pending = directorRuntime.pending;
    if (pending?.retract) { clearDirectorProposal(); backOneLevel(); setDirectorStatus("أُخفي المشهد بعد تراجعك عن المعلومة."); return; }
    if (pending && !revealAndRecord(pending)) setDirectorStatus("المشهد انتهت صلاحيته أو يوجد فيديو نشط.");
    else if (pending?.spec) { recordDecision({ bundle: state.bundle, type: pending.spec.type, approved: true,
      fingerprint: fingerprint(pending.utterance) }); refreshTasteLine(); }
  };
  document.getElementById("director-reject").onclick = () => {
    const proposal = directorRuntime.pending;
    const saved = proposal && rememberRejectedProposal({
      bundle: state.bundle, slide: proposal.slide, utterance: proposal.utterance
    });
    if (proposal?.spec) {
      sessionLog.declined({ slide: proposal.slide, type: proposal.spec.type });
      recorder?.declined({ slide: proposal.slide, type: proposal.spec.type });
      recordDecision({ bundle: state.bundle, type: proposal.spec.type, approved: false,
        fingerprint: fingerprint(proposal.utterance) });
      refreshTasteLine();
    }
    directorRuntime.cloudSeq++; // Ignore any outdated paid analysis still in flight.
    clearDirectorProposal();
    setDirectorStatus(saved ? "تم تجاهل الاقتراح وتذكّر القرار محلياً لهذه الشريحة (14 يوماً)." : "تم تجاهل الاقتراح لهذه المرة.");
  };
  document.getElementById("director-forget-dismissals").onclick = () => {
    const cleared = clearRejectedProposals(state.bundle);
    setDirectorStatus(cleared ? "تم مسح التجاهلات المحفوظة لهذه المحاضرة." : "تعذر مسح التجاهلات من المتصفح.");
  };
  document.getElementById("director-memory-sync").onclick = syncApprovedScenes;
  document.getElementById("director-clear-taste").onclick = () => {
    setDirectorStatus(clearTaste(null) ? "نُسيت تفضيلات الأسلوب المتعلمة." : "تعذر مسح التفضيلات.");
    refreshTasteLine();
  };
  const eraseOnServer = async (path) => {
    const token = directorAdminToken();
    if (!token) return "المحلي فقط (لم يُدخل رمز المحاضر)";
    try {
      const r = await fetch(path, { method: "DELETE", headers: { "X-Admin-Token": token } });
      return r.ok ? "والخادم" : "تعذر مسح نسخة الخادم";
    } catch { return "تعذر الاتصال بالخادم"; }
  };
  document.getElementById("director-clear-scenes").onclick = async () => {
    const local = clearSceneMemory(state.bundle);
    const where = await eraseOnServer("/api/memory/" + encodeURIComponent(state.bundle));
    setDirectorStatus((local ? "مُسحت مشاهد هذه المحاضرة من المتصفح " : "تعذر المسح المحلي ") + where + ".");
  };
  document.getElementById("director-clear-all-scenes").onclick = async () => {
    if (!confirm("مسح كل المشاهد المعتمدة لكل المحاضرات؟")) return;
    const local = clearSceneMemory(null);
    const where = await eraseOnServer("/api/memory/library");
    setDirectorStatus((local ? "مُسحت كل المشاهد من المتصفح " : "تعذر المسح المحلي ") + where + ".");
  };
  refreshTasteLine();
  document.getElementById("director-cloud").addEventListener("change", () => void refreshDirectorUsage());
  document.getElementById("director-admin-token").addEventListener("change", () => {
    if (directorAdminToken()) void syncApprovedScenes();
    if (document.getElementById("director-cloud")?.checked) void refreshDirectorUsage();
  });
  if (sessionStorage.getItem("alfa-admin-token")) void syncApprovedScenes();
  setDirectorStatus("مكتبة المشاهد المعتمدة لهذه المحاضرة: " +
    countSavedScenes(state.bundle) + " — الاقتراحات المتجاهلة: " +
    countRejectedProposals(state.bundle) + " — الاستماع متوقف.");
  document.getElementById("director-test-run").onclick = () => receiveDirectorSpeech(
    document.getElementById("director-test-text").value);
}

function clearPollScreen() {
  document.querySelectorAll(".vote-projection").forEach((element) => element.remove());
}
function renderPollScreen(data) {
  clearPollScreen();
  if (!data?.visible || !data.url) return;
  const root = document.getElementById("stage");
  if (!root) return;
  const overlay = document.createElement("section");
  overlay.className = "info-layer vote-projection";
  const heading = document.createElement("h2");
  heading.textContent = data.active?.question || "شارك في التصويت";
  overlay.append(heading);
  const qrBlock = document.createElement("div");
  qrBlock.className = "vote-qr";
  if (typeof qrcode === "function") {
    const qr = qrcode(0, "M");
    qr.addData(data.url);
    qr.make();
    qrBlock.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 1 });
  }
  const url = document.createElement("p");
  url.className = "vote-url";
  url.textContent = data.url;
  qrBlock.append(url);
  overlay.append(qrBlock);
  if (data.active?.reveal && data.active?.kind === "words" && Array.isArray(data.active.words)) {
    const cloud = document.createElement("div");
    cloud.className = "vote-wordcloud";
    const max = Math.max(1, ...data.active.words.map((w) => Number(w.count) || 0));
    for (const w of data.active.words.slice(0, 40)) {
      const span = document.createElement("span");
      span.textContent = String(w.word).slice(0, 24); // student text is only ever textContent
      span.style.fontSize = (0.9 + 2.4 * ((Number(w.count) || 0) / max)).toFixed(2) + "em";
      cloud.append(span);
    }
    overlay.append(cloud);
  } else if (data.active?.reveal && Array.isArray(data.active?.counts)) {
    const counts = data.active.counts;
    const total = counts.reduce((a, b) => a + b, 0);
    const bars = document.createElement("div");
    bars.className = "vote-live-results";
    data.active.options.forEach((option, index) => {
      const percentage = total ? Math.round(100 * (counts[index] || 0) / total) : 0;
      const label = document.createElement("p");
      label.textContent = String(option) + " — " + percentage + "%";
      const bar = document.createElement("div");
      bar.className = "vote-result-bar";
      const fill = document.createElement("span");
      fill.style.width = percentage + "%";
      bar.append(fill);
      bars.append(label, bar);
    });
    overlay.append(bars);
  }
  root.append(overlay);
}
function postPollDraft(question) {
  directorRuntime.questionDraft = String(question || "").slice(0, 200);
  const frame = document.getElementById("vote-iframe");
  if (!frame?.contentWindow) return;
  frame.contentWindow.postMessage({ alfaQuestionDraft: directorRuntime.questionDraft }, location.origin);
}

function receiveVoteAdminMessage(event) {
  if (role !== "presenter" || event.origin !== location.origin) return;
  const iframe = document.getElementById("vote-iframe");
  if (!iframe || event.source !== iframe.contentWindow) return;
  const data = event.data;
  if (!data || data.alfaVoting !== "status") return;
  let url;
  try { url = new URL(data.url); } catch { return; }
  if (url.pathname !== "/vote.html" || !/^[A-Z2-9]{6}$/.test(url.searchParams.get("s") || "")) return;
  pollScreen.url = url.href;
  pollScreen.active = data.active || null;
  if (pollScreen.visible) {
    renderPollScreen(pollScreen);
    send({ type: "poll-projection", data: pollScreen });
  }
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
  if (!sameLecture(message, state.bundle)) return;
  if (message.type === "slide") {
    if (!Number.isInteger(message.index) || message.index < 1 || message.index > state.count) return;
    state.main = message.main;
    const wanted = Number.isInteger(message.step) ? message.step : 0;
    if (message.index !== state.index) showSlide(message.index, wanted);
    else if (wanted !== state.step) setStep(wanted, { broadcast: false });
    return;
  }
  if (message.type === "step") {
    if (message.index === state.index && Number.isInteger(message.step)) setStep(message.step, { broadcast: false });
    return;
  }
  if (message.type === "restore") {
    if (!Number.isInteger(message.index) || message.index < 1 || message.index > state.count) return;
    state.main = message.main;
    const wanted = Number.isInteger(message.step) ? message.step : 0;
    if (message.index !== state.index) showSlide(message.index, wanted);
    else if (wanted !== state.step) setStep(wanted, { broadcast: false });
    hideInfographic(false);
    if (message.infographic) { try { renderLayer(message.infographic); } catch {} }
    renderPollScreen(message.poll);
    if (Array.isArray(message.videos) && message.videos.length === videoEls.length &&
        message.videos.every((item) => item && validMediaTime(item.time) && typeof item.playing === "boolean")) {
      message.videos.forEach((item, i) => {
        const el = videoEls[i];
        el.pause();
        adjustAudienceMediaTime(el, item.time, true);
        if (item.playing) playAudienceMedia(el);
      });
    }
    return;
  }
  if (message.type === "snapshot") {
    if (message.requestId !== audienceRequestId) return; // Do not disturb other audience tabs.
    if (!Number.isInteger(message.index) || message.index < 1 || message.index > state.count) return;
    state.main = message.main;
    const wanted = Number.isInteger(message.step) ? message.step : 0;
    if (message.index !== state.index) showSlide(message.index, wanted);
    else if (wanted !== state.step) setStep(wanted, { broadcast: false });
    if (!validSnapshot(message, state.bundle, videoEls.length)) return;
    message.videos.forEach((item, i) => {
      const el = videoEls[i];
      if (!item.playing) el.pause();
      adjustAudienceMediaTime(el, item.time, true);
      if (item.playing) {
        for (const other of videoEls) if (other !== el) other.pause();
        playAudienceMedia(el);
      }
    });
    return;
  }
  if (message.type === "infographic") {
    hideInfographic(false);
    renderLayer(message.spec);
  }
  if (message.type === "infographic-hide") hideInfographic(false);
  if (message.type === "poll-projection") renderPollScreen(message.data);
  if (message.type === "video") {
    if (!validVideoPacket(message, state.bundle, state.index, videoEls.length)) return;
    const target = videoEls[message.clip];
    if (message.action === "play") {
      for (const el of videoEls) if (el !== target) el.pause();
      adjustAudienceMediaTime(target, message.time);
      playAudienceMedia(target);
    }
    if (message.action === "pause" || message.action === "ended") {
      target.pause();
      adjustAudienceMediaTime(target, message.time, true);
    }
    if (message.action === "seek") adjustAudienceMediaTime(target, message.time, true);
    if (message.action === "progress" && !target.paused && !target.seeking) {
      adjustAudienceMediaTime(target, message.time);
    }
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
        advance();
        break;
      case "ArrowLeft":
      case "PageUp":
        event.preventDefault();
        retreat();
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

function plannedKey() { return "alfa-planned-minutes:" + state.bundle; }
function setupPlannedClock() {
  const select = document.getElementById("planned-minutes");
  if (!select) return;
  for (const m of PLANNED_CHOICES) select.append(Object.assign(document.createElement("option"), {
    value: String(m), textContent: m ? "مخطط " + m + " د" : "بلا وقت مخطط" }));
  try { select.value = localStorage.getItem(plannedKey()) || "0"; } catch {}
  select.onchange = () => { try { localStorage.setItem(plannedKey(), select.value); } catch {} };
}
function setupClock() {
  setInterval(() => {
    const el = document.getElementById("clock");
    if (!el) return;
    const planned = Number(document.getElementById("planned-minutes")?.value || 0);
    const info = clockState(Date.now() - clockStart, planned);
    el.textContent = info.label;
    const hint = document.getElementById("clock-hint");
    if (hint) { hint.textContent = info.hint; hint.dataset.phase = info.phase; }
    const fill = document.getElementById("clock-fill");
    if (fill) { fill.style.width = Math.round(info.ratio * 100) + "%"; fill.dataset.phase = info.phase; }
  }, 1000);
}

async function boot() {
  const current = await fetch("/bundles/current.json").then((r) => r.json()).catch(() => null);
  state.bundle = params.get("bundle") || (current && current.id);
  if (!state.bundle) {
    if (role === "presenter") {
      app.replaceChildren();
      mountImportPanel(app, { empty: true });
    } else {
      app.textContent = "لا توجد محاضرة مفتوحة بعد.";
    }
    return;
  }
  if (role === "presenter") {
    sessionLog = createSessionLog({ bundle: state.bundle });
    addEventListener("pagehide", () => sessionLog.end());
  }
  const manifest = await fetch(`/bundles/${state.bundle}/manifest.json`).then((r) => r.json());
  state.manifest = manifest;
  state.slides = manifest.slides;
  state.count = manifest.slideCount;
  state.aspect = manifest.aspect;

  // Install listeners before the first hello to avoid missing a fast snapshot reply.
  channel.onmessage = (event) => {
    const message = event.data;
    if (!sameLecture(message, state.bundle)) return;
    if (role === "presenter" && message.type === "hello") {
      broadcastSnapshot(message.requestId); // Targeted late-join playback state.
      return;
    }
    if (role === "presenter" && message.type === "audience-media-issue" &&
        message.index === state.index && typeof message.issue === "string") {
      setDirectorStatus("شاشة الطلبة: " + message.issue.slice(0, 150));
      return;
    }
    if (role === "audience" && message.type === "ping" && typeof message.nonce === "string" && /^[a-f0-9]{12}$/.test(message.nonce)) {
      send({ type: "pong", nonce: message.nonce });
      return;
    }
    if (role === "audience") applyRemote(message);
  };
  if (role === "audience") {
    renderAudience();
    send({ type: "hello", requestId: audienceRequestId });
  } else {
    renderPresenter();
    window.addEventListener("message", receiveVoteAdminMessage);
    setupKeys();
    setupClock();
    send({ type: "slide", index: state.index, step: state.step, main: state.main });
  }
}

boot();
