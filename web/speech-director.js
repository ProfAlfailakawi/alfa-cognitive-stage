// Browser microphone adapter. Voice is session-scoped; never records audio to disk.
// Engine: on-device recognition (Chrome processLocally) ONLY when the browser reports the language
// pack as available; otherwise the browser's cloud service. Whether Arabic/ar-KW is available
// on-device depends on the browser and OS and has not been verified on a real Mac.
// Diagnostics time browser events; end-to-end latency is measured in app.js with latency-meter.js.
export function createSpeechDirector({
  onUtterance, onStatus, onInterim, onDiagnostics,
  Recognition = undefined, // injectable for rehearsal drills and tests
  onStableInterim = undefined, // an interim transcript that stopped changing (for reversible commands only)
  isOnline = () => globalThis.navigator?.onLine !== false,
  listenOnline = (handler) => { globalThis.addEventListener?.("online", handler); return () => globalThis.removeEventListener?.("online", handler); },
  preferLocal = true,
  lang = "ar-KW",
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
}) {
  const Ctor = Recognition !== undefined ? Recognition : (globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition);
  let recognition = null;
  let enabled = false;
  let mediaPlaying = false;
  let active = false;
  let restart = null;
  let lastFinal = "";
  let lastTime = 0;
  let lastInterimTime = 0;
  let firstInterimAt = null;
  let consecutiveErrors = 0;
  let wanted = false;     // the lecturer asked for listening and has not stopped it
  let engine = "unknown"; // "local" | "cloud" once chosen
  // Some browsers reject ar-KW but support ar-SA or generic Arabic.
  // Retry only language errors, never microphone permission failures.
  const languageChoices = [lang, ...["ar-SA", "ar"].filter((item) => item !== lang)];
  let languageIndex = 0;
  let localStatus = null;  // what the browser said about the on-device language pack
  let stopOnline = null;
  let stableTimer = null;
  let lastInterimText = "";
  let metrics = {
    finalSegments: 0, restarts: 0, errors: 0, lastError: null,
    interimToFinalMs: null, localHandlerMs: null,
  };
  const status = (message) => onStatus?.(message);
  const emit = () => onDiagnostics?.({ ...metrics, engine, localStatus });
  function initialize() {
    if (!Ctor) { status("المتصفح لا يدعم التعرف الصوتي؛ استخدم Chrome أو الوضع النصي التجريبي."); return false; }
    if (recognition) return true;
    recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      if (!enabled || mediaPlaying) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result.isFinal) {
          const liveText = result[0]?.transcript?.trim();
          if (!liveText) continue;
          if (firstInterimAt === null) firstInterimAt = now();
          if (onStableInterim && liveText !== lastInterimText) {
            lastInterimText = liveText;
            clearTimer(stableTimer);
            stableTimer = setTimer(() => { stableTimer = null; if (enabled && !mediaPlaying) onStableInterim(liveText); }, 800);
          }
          if (now() - lastInterimTime > 350) {
            lastInterimTime = now();
            onInterim?.(liveText.slice(0, 180));
          }
          continue;
        }
        const text = result[0]?.transcript?.trim();
        if (!text) continue;
        const finishedAt = now();
        const observed = firstInterimAt === null ? null : finishedAt - firstInterimAt;
        const interimToFinalMs = observed !== null && observed >= 0 && observed < 120000 ? observed : null;
        firstInterimAt = null;
        // Drop one recognizer echo, without swallowing a lecturer's next genuine
        // "التالية" 1–2 seconds later (common during PowerPoint builds).
        if (text === lastFinal && finishedAt - lastTime < 700) continue;
        lastFinal = text;
        lastTime = finishedAt;
        const handlerStart = now();
        clearTimer(stableTimer); stableTimer = null; lastInterimText = "";
        try { onUtterance?.(text, { firstInterimAt: observed === null ? null : finishedAt - observed, finalAt: finishedAt, engine }); }
        finally {
          metrics.finalSegments++;
          metrics.interimToFinalMs = interimToFinalMs;
          metrics.localHandlerMs = Math.max(0, now() - handlerStart);
          consecutiveErrors = 0;
          emit();
        }
      }
    };
    recognition.onerror = (event) => {
      // Stopping for a video should not be mistaken for a microphone failure.
      if (!enabled || mediaPlaying) return;
      const error = String(event?.error || "unknown").slice(0, 50);
      metrics.errors++;
      metrics.lastError = error;
      if (error === "language-not-supported" && languageIndex < languageChoices.length - 1) {
        languageIndex++;
        recognition.lang = languageChoices[languageIndex];
        // The browser will end this recognition session; onend handles the retry.
        consecutiveErrors = 0;
        status("لهجة التعرف الصوتي غير مدعومة؛ أجرب العربية " + recognition.lang + " تلقائياً.");
      } else if (["not-allowed", "service-not-allowed", "audio-capture", "language-not-supported"].includes(error)) {
        enabled = false; // Never retry after a denied permission or exhausted language options.
      } else if (["network", "no-speech"].includes(error)) {
        consecutiveErrors = Math.min(3, consecutiveErrors + 1);
      }
      status("حالة المايك: " + error);
      emit();
    };
    recognition.onend = () => {
      active = false;
      firstInterimAt = null;
      if (enabled && !mediaPlaying) {
        clearTimer(restart);
        const wait = Math.min(7200, 900 * 2 ** consecutiveErrors);
        restart = setTimer(() => {
          restart = null;
          if (!enabled || mediaPlaying) return;
          metrics.restarts++;
          emit();
          begin();
        }, wait);
      }
    };
    return true;
  }
  async function chooseEngine() {
    engine = "cloud";
    if (!preferLocal || typeof Ctor.available !== "function") return;
    try {
      localStatus = await Ctor.available({ langs: [lang], processLocally: true });
      if (localStatus === "available") { recognition.processLocally = true; engine = "local"; }
    } catch { localStatus = "error"; }
  }
  function begin() {
    if (!enabled || mediaPlaying || active || !initialize()) return;
    if (engine === "unknown" && typeof Ctor.available === "function") {
      engine = "pending";
      chooseEngine().then(() => { if (engine === "pending") engine = "cloud"; begin(); });
      return;
    }
    if (engine === "unknown") engine = "cloud"; // no on-device API in this browser
    if (engine === "pending") return;
    if (engine !== "local" && !isOnline()) {
      status("لا يوجد إنترنت والتعرف الصوتي السحابي متوقف. استخدم الإدخال النصي في «أدوات متقدمة»؛ سيستأنف الاستماع تلقائياً عند عودة الاتصال.");
      metrics.lastError = "offline"; emit();
      stopOnline ||= listenOnline(() => { if (enabled) begin(); });
      return;
    }
    try { recognition.start(); active = true; status(engine === "local" ? "يستمع لشرحك على الجهاز — دون حفظ الصوت" : "يستمع لشرحك — دون حفظ الصوت (خدمة المتصفح)"); }
    catch (err) { status("تعذر بدء المايك: " + err.message); }
  }
  function start() {
    if (!enabled) {
      metrics = { finalSegments: 0, restarts: 0, errors: 0, lastError: null,
        interimToFinalMs: null, localHandlerMs: null };
      consecutiveErrors = 0;
      firstInterimAt = null;
      lastFinal = "";
      lastTime = 0;
      lastInterimTime = 0;
      languageIndex = 0;
      if (recognition) recognition.lang = languageChoices[languageIndex];
      emit();
    }
    enabled = true;
    wanted = true;
    begin();
  }
  // A microphone plugged in after "audio-capture" failed: try again once, without re-prompting loops.
  function deviceChanged() {
    if (wanted && !enabled && metrics.lastError === "audio-capture") { enabled = true; metrics.lastError = null; begin(); }
  }
  function stop() {
    enabled = false;
    wanted = false;
    clearTimer(restart);
    clearTimer(stableTimer);
    restart = null;
    firstInterimAt = null;
    stopOnline?.(); stopOnline = null;
    try { recognition?.stop(); } catch {}
    active = false;
    status("الاستماع متوقف");
  }
  function setMediaPlaying(playing) {
    mediaPlaying = Boolean(playing);
    if (mediaPlaying) {
      clearTimer(restart);
      restart = null;
      firstInterimAt = null;
      try { recognition?.stop(); } catch {}
      active = false;
      status("معلّق أثناء تشغيل الفيديو");
    } else if (enabled) begin();
  }
  return { start, stop, setMediaPlaying, deviceChanged, diagnostics: () => ({ ...metrics, engine, localStatus, language: languageChoices[languageIndex] }), engine: () => engine,
    supported: Boolean(Ctor) };
}
