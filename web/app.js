// ALFA Cognitive Stage — presenter and audience views.
// The lecturer's window controls the deck. The audience window shows only the slide.
// Both windows talk over BroadcastChannel (same browser, same origin).

const app = document.getElementById("app");
const channel = new BroadcastChannel("alfa-cognitive-stage");
const params = new URLSearchParams(location.search);
const role = location.hash === "#audience" ? "audience" : "presenter";

const state = { index: 1, main: 1, count: 0, notes: [], slides: [], bundle: "", aspect: 16 / 9 };
let videoEl = null;
let clockStart = Date.now();

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
  if (videoEl) {
    videoEl.pause();
    videoEl.remove();
    videoEl = null;
  }
  const clip = slide.videos[0];
  if (!clip) return;
  const stage = document.getElementById("stage");
  videoEl = document.createElement("video");
  videoEl.className = "clip";
  videoEl.preload = "auto";
  videoEl.playsInline = true;
  videoEl.controls = role === "presenter";
  for (const [type, src] of [["video/mp4", clip.src], ["video/webm", clip.webm]]) {
    if (!src) continue;
    const source = document.createElement("source");
    source.src = `/bundles/${state.bundle}/${src}`;
    source.type = type;
    videoEl.appendChild(source);
  }
  videoEl.style.left = `${clip.x * 100}%`;
  videoEl.style.top = `${clip.y * 100}%`;
  videoEl.style.width = `${clip.w * 100}%`;
  videoEl.style.height = `${clip.h * 100}%`;
  videoEl.style.objectFit = "contain";
  stage.appendChild(videoEl);
  videoEl.addEventListener("ended", () => {
    if (role === "presenter") send({ type: "video", action: "ended", index: state.index });
  });
  if (role === "presenter") {
    // Use the element held by the closure: events can fire after videoEl was replaced.
    const el = videoEl;
    el.addEventListener("play", () => send({ type: "video", action: "play", time: el.currentTime }));
    el.addEventListener("pause", () => send({ type: "video", action: "pause", time: el.currentTime }));
    el.addEventListener("seeked", () => send({ type: "video", action: "seek", time: el.currentTime }));
  }
}

function showSlide(index) {
  const slide = state.slides[index - 1];
  if (!slide) return;
  state.index = index;
  const img = document.getElementById("slide-img");
  if (img) {
    img.classList.add("leaving");
    setTimeout(() => {
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
        </div>
      </div>
      <aside class="side">
        <div><div class="label">الشريحة التالية</div><div class="next" id="next-thumb"></div></div>
        <div><div class="label">ملاحظات المحاضر</div></div>
        <div class="notes" id="notes"></div>
      </aside>
    </section>`;
  setAspect(state.aspect);
  document.getElementById("prev").onclick = () => go(state.index - 1);
  document.getElementById("next").onclick = () => go(state.index + 1);
  document.getElementById("home").onclick = () => goMain();
  document.getElementById("playvid").onclick = () => toggleVideo();
  document.getElementById("open-audience").onclick = () =>
    window.open(`${location.pathname}?bundle=${state.bundle}#audience`, "alfa-audience");
  showSlide(state.index);
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

function go(index) {
  if (index < 1 || index > state.count) return;
  showSlide(index);
  send({ type: "slide", index, main: state.main });
}

function goMain() {
  // Emergency: stop any playing clip and return to the main deck position at once.
  if (videoEl) videoEl.pause();
  showSlide(state.main);
  send({ type: "slide", index: state.main, main: state.main, emergency: true });
}

function toggleVideo() {
  if (!videoEl) return;
  if (videoEl.paused) videoEl.play();
  else videoEl.pause();
}

function applyRemote(message) {
  if (message.type === "slide") {
    state.main = message.main;
    if (message.index !== state.index) showSlide(message.index);
  }
  if (message.type === "video" && videoEl) {
    if (message.action === "play") videoEl.play().catch(() => {});
    if (message.action === "pause") videoEl.pause();
    if (message.action === "seek") videoEl.currentTime = message.time;
  }
}

function setupKeys() {
  document.addEventListener("keydown", (event) => {
    if (role !== "presenter") return;
    const target = event.target;
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
    app.innerHTML = `<p class="error">لا توجد محاضرة مجهزة. شغّل أداة البناء أولاً.</p>`;
    return;
  }
  const manifest = await fetch(`/bundles/${state.bundle}/manifest.json`).then((r) => r.json());
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
