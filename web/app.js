// ALFA Cognitive Stage — presenter and audience views.
// The lecturer's window controls the deck. The audience window shows only the slide.
// Both windows talk over BroadcastChannel (same browser, same origin).

import { renderInfographic } from "./infographic.js";
import { interpretSpeech, eligibleForCloud } from "./director-core.js";
import { createSpeechDirector } from "./speech-director.js";
import { rememberScene, recallScene, countSavedScenes } from "./scene-memory.js";
import { rememberRejectedProposal, wasProposalRejected, countRejectedProposals, clearRejectedProposals } from "./director-preferences.js";
import { mountImportPanel } from "./import-ui.js";
import { summarizeLecture } from "./lecture-readiness.js";
import { testLectureMedia } from "./media-preflight.js";
import { sameLecture, validMediaTime, validVideoPacket, validSnapshot, needsMediaSeek } from "./video-sync.js";

const app = document.getElementById("app");
const channel = new BroadcastChannel("alfa-cognitive-stage");
const params = new URLSearchParams(location.search);
const role = location.hash === "#audience" ? "audience" : "presenter";
const audienceRequestId = role === "audience"
  ? Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("")
  : null;

const state = { index: 1, main: 1, count: 0, notes: [], slides: [], bundle: "", aspect: 16 / 9, manifest: null };
let videoEl = null;
let videoEls = [];
const pollScreen = { visible: false, url: "", active: null };
let clockStart = Date.now();
let slideGeneration = 0;
const neighboringSlides = new Map();
const directorRuntime = {
  speech: null, pending: null, lastKey: "", lastAt: 0,
  recent: [], cloudSeq: 0, activeOverlay: false, story: null, questionDraft: null,
  mediaCheckAbort: null,
};

function send(message) {
  channel.postMessage({ ...message, bundle: state.bundle });
}

function currentVideoSnapshot() {
  return videoEls.map((el) => ({ time: validMediaTime(el.currentTime) ? el.currentTime : 0,
    playing: !el.paused && !el.ended }));
}
function broadcastSnapshot(requestId) {
  if (typeof requestId !== "string" || !/^[a-f0-9]{16}$/.test(requestId)) return;
  send({ type: "snapshot", requestId, index: state.index, main: state.main,
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
        for (const other of videoEls) if (other !== el && !other.paused) other.pause();
        directorRuntime.speech?.setMediaPlaying(true);
        relay("play");
      });
      el.addEventListener("pause", () => {
        if (videoEls[i] !== el) return;
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
  for (const known of [...neighboringSlides.keys()]) {
    if (!wanted.includes(known)) neighboringSlides.delete(known);
  }
}
function showSlide(index) {
  const slide = state.slides[index - 1];
  if (!slide) return;
  state.index = index;
  if (role === "presenter") {
    directorRuntime.cloudSeq++;
    directorRuntime.pending = null;
    directorRuntime.story = null;
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
  prefetchNeighbors(index);
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
          <select id="lecture-picker" aria-label="اختيار المحاضرة"></select>
        </div>
      </div>
      <aside class="side">
        <div><div class="label">الشريحة التالية</div><div class="next" id="next-thumb"></div></div>
        <div id="lecture-import-mount"></div>
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
                <form class="info-form" id="info-form" hidden onsubmit="return false">
          <select id="info-type" aria-label="نوع الإنفوجرافيك">
            <option value="stat">بطاقة إحصائية</option>
            <option value="compare">مقارنة (الأول | الثاني)</option>
            <option value="steps">خطوات</option>
            <option value="concept">خريطة مفاهيم</option>
            <option value="flow">تسلسل تعليمي</option>
            <option value="timeline">خط زمني</option>
            <option value="story">مشهد قصصي</option>
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
          <label class="director-cloud"><input type="checkbox" id="director-cloud" /> تحليل سحابي اختياري (قد يتكلف)</label>
          <p class="meta" id="director-usage">السحابة مغلقة. المشاهد المحلية بلا API.</p>
          <input id="director-admin-token" type="password" autocomplete="off" placeholder="رمز المحاضر من Terminal (للذاكرة والتصويت وAPI)" />
          <button type="button" id="director-memory-sync">مزامنة المشاهد المعتمدة محلياً</button>
          <button type="button" id="director-forget-dismissals">مسح الاقتراحات المتجاهلة لهذه المحاضرة</button>
          <p class="meta" id="director-status" aria-live="polite">المايك متوقف. لا توجد طلبات API.</p>
          <p class="meta" id="director-last"></p>
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
        <div><div class="label">ملاحظات المحاضر</div></div>
        <div class="notes" id="notes"></div>
      </aside>
    </section>`;
  setAspect(state.aspect);
  document.getElementById("prev").onclick = () => go(state.index - 1);
  document.getElementById("next").onclick = () => go(state.index + 1);
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
    if (!pollScreen.url) {
      document.getElementById("project-poll").textContent = "سجّل دخولك وأنشئ جلسة أولاً";
      return;
    }
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
  document.getElementById("info-show").onclick = showInfographicFromForm;
  fillLecturePicker();
  document.getElementById("info-hide").onclick = () => hideInfographic(true);
  document.getElementById("open-audience").onclick = () =>
    window.open(`${location.pathname}?bundle=${state.bundle}#audience`, "alfa-audience");
  showSlide(state.index);
  setupDirector();
  mountImportPanel(document.getElementById("lecture-import-mount"));
  renderReadiness();
}

function renderReadiness() {
  const target = document.getElementById("readiness-content");
  if (!target || !state.manifest) return;
  const summary = summarizeLecture(state.manifest);
  const info = document.createElement("p");
  info.textContent = summary.slideCount + " شريحة، " + summary.embeddedVideoCount +
    " فيديو مضمّن، " + summary.animatedSlides.length + " شريحة بها حركات أصلية.";
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
  if (summary.animatedSlides.length) {
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
  if (role === "presenter") {
    directorRuntime.activeOverlay = false;
    pollScreen.visible = false; // Emergency/slide navigation must not keep projecting QR.
  }
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
    for (const item of data.scenes || []) {
      if (rememberScene({ bundle: state.bundle, slide: item.slide, utterance: item.utterance,
        spec: item.spec })) recovered++;
    }
    setDirectorStatus("تمت مزامنة " + recovered + " مشهد معتمد من الذاكرة المحلية. بلا API.");
  } catch (error) { setDirectorStatus(error.message); }
  finally { if (button) button.disabled = false; }
}

function revealDirectorScene(proposal) {
  if (!proposal?.spec || proposal.slide !== state.index ||
      Date.now() - proposal.at > 30000 || videoEls.some((el) => !el.paused)) return false;
  try {
    renderLayer(proposal.spec);
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
    target.textContent = info.available
      ? "السحابة: " + info.callsUsed + "/" + info.maxCalls + " طلب، " +
        (info.inputTokens + info.outputTokens) + " توكن مُبلّغ عنه" +
        (info.callsWithoutUsage ? " (" + info.callsWithoutUsage + " طلب بلا بيانات استخدام)" : "") +
        " — لا يوجد حساب تكلفة بالدولار. يُصفّر العداد عند إعادة تشغيل الخادم."
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
function observeStorySpeech(utterance, mode) {
  const story = directorRuntime.story;
  if (!story || story.slide !== state.index || Date.now() - story.started > 75000) {
    directorRuntime.story = null;
    return;
  }
  const clean = String(utterance || "").trim();
  if (!clean || clean.length < 15 || story.last === clean) return;
  story.last = clean;
  story.events.push(clean.slice(0, 100));
  story.events = story.events.slice(0, 4);
  if (story.events.length < 2) return;
  const spec = { type: "story", title: "قصة يرويها المحاضر", lines: [...story.events] };
  const proposal = { spec, utterance: story.events.join(" "), slide: state.index, at: Date.now() };
  if (mode === "creative" && !videoEls.some((el) => !el.paused)) {
    revealDirectorScene(proposal);
  } else if (mode !== "shadow") {
    showDirectorProposal(proposal, "قصة من حديثك كما نطقتها دون اختراع أحداث. راجع النص قبل إظهاره.");
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
  if (!moment) {
    if (directorRuntime.story) {
      observeStorySpeech(raw, mode);
      return;
    }
    if (wasProposalRejected({ bundle: state.bundle, slide: state.index, utterance: raw })) return;
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
  if (moment.kind === "return") {
    directorRuntime.story = null;
    directorRuntime.cloudSeq++;
    clearDirectorProposal();
    if (directorRuntime.activeOverlay) goMain();
    setDirectorStatus("تم فهم العودة إلى الموضوع الأصلي.");
    return;
  }
  // Avoid repeating a dismissed exact proposal on the same slide; skip paid AI too.
  if (wasProposalRejected({ bundle: state.bundle, slide: state.index, utterance: raw })) {
    setDirectorStatus("تم تجاوز اقتراح تجاهلته سابقاً على هذه الشريحة. يمكنك مسح التجاهلات.");
    return;
  }
  if (moment.kind === "story") {
    directorRuntime.story = {
      slide: state.index, started: Date.now(), last: raw,
      events: [raw.slice(0, 100)],
    };
  }
  if (mode === "shadow") {
    setDirectorStatus("وضع الظل: اكتُشف " + moment.kind + " دون تغيير شاشة الطلبة.");
    return;
  }
  if (moment.spec) {
    const proposal = { spec: moment.spec, utterance: raw, slide: state.index, at: Date.now() };
    if (mode === "balanced" && moment.confidence >= 0.95 && !videoEls.some((el) => !el.paused)) {
      revealDirectorScene(proposal);
    } else showDirectorProposal(proposal, "إحصائية التقطت من حديث المحاضر — تأكد من الرقم.");
    return;
  }
  if (moment.kind === "question") postPollDraft(raw);
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
function setupDirector() {
  const speech = createSpeechDirector({
    onUtterance: receiveDirectorSpeech,
    onStatus: setDirectorStatus,
    onInterim: (transcript) => {
      const preview = document.getElementById("director-last");
      if (preview) preview.textContent = "أسمع الآن: " + transcript;
    }
  });
  directorRuntime.speech = speech;
  const start = document.getElementById("director-start");
  const stop = document.getElementById("director-stop");
  start.onclick = () => speech.start();
  stop.onclick = () => speech.stop();
  document.getElementById("director-accept").onclick = () => {
    const pending = directorRuntime.pending;
    if (pending && !revealDirectorScene(pending)) setDirectorStatus("المشهد انتهت صلاحيته أو يوجد فيديو نشط.");
  };
  document.getElementById("director-reject").onclick = () => {
    const proposal = directorRuntime.pending;
    const saved = proposal && rememberRejectedProposal({
      bundle: state.bundle, slide: proposal.slide, utterance: proposal.utterance
    });
    directorRuntime.cloudSeq++; // Ignore any outdated paid analysis still in flight.
    clearDirectorProposal();
    setDirectorStatus(saved ? "تم تجاهل الاقتراح وتذكّر القرار محلياً لهذه الشريحة (14 يوماً)." : "تم تجاهل الاقتراح لهذه المرة.");
  };
  document.getElementById("director-forget-dismissals").onclick = () => {
    const cleared = clearRejectedProposals(state.bundle);
    setDirectorStatus(cleared ? "تم مسح التجاهلات المحفوظة لهذه المحاضرة." : "تعذر مسح التجاهلات من المتصفح.");
  };
  document.getElementById("director-memory-sync").onclick = syncApprovedScenes;
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
  if (data.active?.reveal && Array.isArray(data.active?.counts)) {
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
    if (message.index !== state.index) showSlide(message.index);
    return;
  }
  if (message.type === "snapshot") {
    if (message.requestId !== audienceRequestId) return; // Do not disturb other audience tabs.
    if (!Number.isInteger(message.index) || message.index < 1 || message.index > state.count) return;
    state.main = message.main;
    if (message.index !== state.index) showSlide(message.index);
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
      adjustAudienceMediaTime(target, message.time);
    }
    if (message.action === "seek") adjustAudienceMediaTime(target, message.time);
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
    send({ type: "slide", index: state.index, main: state.main });
  }
}

boot();
