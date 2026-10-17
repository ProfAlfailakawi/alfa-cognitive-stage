// Browser microphone adapter. Voice is session-scoped; never records audio to disk.
// Diagnostics time browser interim-to-final events, NOT audio-onset-to-screen latency.
export function createSpeechDirector({
  onUtterance, onStatus, onInterim, onDiagnostics,
  Recognition = undefined, // injectable for rehearsal drills and tests
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
  let metrics = {
    finalSegments: 0, restarts: 0, errors: 0, lastError: null,
    interimToFinalMs: null, localHandlerMs: null,
  };
  const status = (message) => onStatus?.(message);
  const emit = () => onDiagnostics?.({ ...metrics });
  function initialize() {
    if (!Ctor) { status("المتصفح لا يدعم التعرف الصوتي؛ استخدم Chrome أو الوضع النصي التجريبي."); return false; }
    if (recognition) return true;
    recognition = new Ctor();
    recognition.lang = "ar-KW";
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
        if (text === lastFinal && finishedAt - lastTime < 3500) continue;
        lastFinal = text;
        lastTime = finishedAt;
        const handlerStart = now();
        try { onUtterance?.(text); }
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
      if (["not-allowed", "service-not-allowed", "audio-capture", "language-not-supported"].includes(error)) {
        enabled = false; // Never retry after a denied permission or unavailable microphone.
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
  function begin() {
    if (!enabled || mediaPlaying || active || !initialize()) return;
    try { recognition.start(); active = true; status("يستمع لشرحك — دون حفظ الصوت"); }
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
      emit();
    }
    enabled = true;
    begin();
  }
  function stop() {
    enabled = false;
    clearTimer(restart);
    restart = null;
    firstInterimAt = null;
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
  return { start, stop, setMediaPlaying, diagnostics: () => ({ ...metrics }), supported: Boolean(Ctor) };
}
