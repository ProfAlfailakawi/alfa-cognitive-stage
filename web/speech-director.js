// Browser microphone adapter. Voice is session-scoped; never records to disk.
export function createSpeechDirector({ onUtterance, onStatus }) {
  const Ctor = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  let recognition = null;
  let enabled = false;
  let mediaPlaying = false;
  let active = false;
  let restart = null;
  let lastFinal = "";
  let lastTime = 0;
  const status = (message) => onStatus?.(message);
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
        if (!result.isFinal) continue;
        const text = result[0]?.transcript?.trim();
        if (!text) continue;
        if (text === lastFinal && Date.now() - lastTime < 3500) continue;
        lastFinal = text;
        lastTime = Date.now();
        onUtterance?.(text);
      }
    };
    recognition.onerror = (event) => {
      const error = String(event.error || "unknown");
      status("حالة المايك: " + error);
      if (["not-allowed", "service-not-allowed", "audio-capture"].includes(error)) enabled = false;
    };
    recognition.onend = () => {
      active = false;
      if (enabled && !mediaPlaying) {
        clearTimeout(restart);
        restart = setTimeout(begin, 900);
      }
    };
    return true;
  }
  function begin() {
    if (!enabled || mediaPlaying || active || !initialize()) return;
    try { recognition.start(); active = true; status("يستمع لشرحك — دون حفظ الصوت"); }
    catch (err) { status("تعذر بدء المايك: " + err.message); }
  }
  function start() { enabled = true; begin(); }
  function stop() {
    enabled = false;
    clearTimeout(restart);
    try { recognition?.stop(); } catch {}
    active = false;
    status("الاستماع متوقف");
  }
  function setMediaPlaying(playing) {
    mediaPlaying = Boolean(playing);
    if (mediaPlaying) {
      clearTimeout(restart);
      try { recognition?.stop(); } catch {}
      active = false;
      status("معلّق أثناء تشغيل الفيديو");
    } else if (enabled) begin();
  }
  return { start, stop, setMediaPlaying, supported: Boolean(Ctor) };
}
