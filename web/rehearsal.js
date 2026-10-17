// Pre-lecture rehearsal: verifies the real lecture files and the environment, and rehearses
// expected failures on SEPARATE simulated components so the live lecture is never touched.
import { summarizeLecture } from "./lecture-readiness.js";
import { createSpeechDirector } from "./speech-director.js";
import { createDirectorBrain } from "./director-brain.js";
import { buildSteps } from "./build-steps.js";

const ok = (id, text) => ({ id, level: "ok", text });
const warn = (id, text) => ({ id, level: "warn", text });
const fail = (id, text) => ({ id, level: "fail", text });

async function pool(items, limit, worker) {
  const queue = items.slice();
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  }));
}

export async function checkFiles({ slides, bundle, fetchImpl }) {
  const urls = [];
  for (const slide of slides) {
    urls.push({ slide: slide.index, url: `/bundles/${bundle}/${slide.image}` });
    for (const step of buildSteps(slide) || []) urls.push({ slide: slide.index, url: `/bundles/${bundle}/${step.image}` });
  }
  const missing = [];
  await pool(urls, 6, async ({ slide, url }) => {
    try { const r = await fetchImpl(url, { method: "HEAD" }); if (!r.ok) missing.push(slide); }
    catch { missing.push(slide); }
  });
  const unique = [...new Set(missing)].sort((a, b) => a - b);
  return unique.length ? fail("files", "ملفات صور ناقصة أو لا تُحمَّل في الشرائح: " + unique.slice(0, 20).join("، "))
    : ok("files", `صور ${urls.length} حالة عرض (${slides.length} شريحة) كلها تُحمَّل.`);
}

/** Simulated speech engines: each drill gets its own instance and virtual clock. */
function fakeRecognitionClass(script) {
  return class FakeRecognition {
    constructor() { this.started = 0; FakeRecognition.last = this; }
    start() { this.started++; FakeRecognition.starts++; queueMicrotask(() => script(this)); }
    stop() { this.stopped = true; queueMicrotask(() => this.onend?.()); }
  };
}

export async function speechDrills() {
  const out = [];
  // 1) Microphone permission denied: stop, explain, never retry.
  {
    const timers = [];
    const messages = [];
    const Fake = fakeRecognitionClass((r) => { r.onerror?.({ error: "not-allowed" }); r.onend?.(); });
    Fake.starts = 0;
    const speech = createSpeechDirector({ Recognition: Fake, onStatus: (m) => messages.push(m), onUtterance() {},
      setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer() {} });
    speech.start();
    await Promise.resolve(); await Promise.resolve();
    for (const t of timers.splice(0)) t.fn();
    await Promise.resolve();
    out.push(Fake.starts === 1 && messages.some((m) => m.includes("not-allowed"))
      ? ok("drill-permission", "رفض صلاحية الميكروفون: يتوقف الاستماع ولا يعيد المحاولة، والعرض يستمر.")
      : fail("drill-permission", "رفض الميكروفون لم يُعالَج كما ينبغي (محاولات: " + Fake.starts + ")."));
  }
  // 2) Network failure: bounded, growing back-off.
  {
    const delays = [];
    const Fake = fakeRecognitionClass((r) => { r.onerror?.({ error: "network" }); r.onend?.(); });
    Fake.starts = 0;
    const timers = [];
    const speech = createSpeechDirector({ Recognition: Fake, onStatus() {}, onUtterance() {},
      setTimer: (fn, ms) => { delays.push(ms); timers.push(fn); return timers.length; }, clearTimer() {} });
    speech.start();
    for (let i = 0; i < 4; i++) { await Promise.resolve(); await Promise.resolve(); timers.shift()?.(); }
    const grows = delays.length >= 3 && delays.every((d, i) => i === 0 || d >= delays[i - 1]) && Math.max(...delays) <= 7200;
    out.push(grows ? ok("drill-network", `انقطاع خدمة التعرف: إعادة محاولة متدرجة (${delays.join("، ")} ms) دون إغراق.`)
      : fail("drill-network", "إعادة المحاولة بعد الانقطاع غير متدرجة: " + delays.join(",")));
  }
  // 3) A playing video must silence recognition.
  {
    const Fake = fakeRecognitionClass(() => {});
    Fake.starts = 0;
    const speech = createSpeechDirector({ Recognition: Fake, onStatus() {}, onUtterance() {}, setTimer: () => 1, clearTimer() {} });
    speech.start(); await Promise.resolve();
    const before = Fake.starts;
    speech.setMediaPlaying(true); await Promise.resolve();
    out.push(Fake.last?.stopped && before === 1 ? ok("drill-video-silence", "تشغيل فيديو يوقف الاستماع (لا يُلتقط صوت الفيديو كأنه كلامك).")
      : fail("drill-video-silence", "الاستماع لم يتوقف أثناء الفيديو."));
  }
  return out;
}

export function brainSelfTest() {
  let t = 1_000_000;
  const brain = createDirectorBrain({ now: () => t });
  const ask = (text, extra = {}) => { t += 20000; return brain.observe(text, { slide: { index: 1, text: "", notes: "" }, mode: "balanced", ...extra }); };
  const stat = ask("في دراسة طلعت إن ستين بالمية من الطلبة استفادوا");
  const quiet = ask("يلا نبدأ المحاضرة اليوم");
  const media = ask("في دراسة طلعت إن ٧٠ بالمية من الطلبة استفادوا", { mediaPlaying: true });
  const returned = ask("خلونا نرجع للعرض");
  const pass = stat.action === "auto" && stat.spec?.lines[0] === "60%" && quiet.action === "none" && media.action === "none" && returned.action === "return";
  return pass ? ok("drill-director", "فحص المخرج الذاتي: إحصائية واضحة تُلتقط بدقة، والكلام العادي والفيديو بلا تدخل، والعودة تُفهم.")
    : fail("drill-director", "فحص المخرج الذاتي فشل: " + JSON.stringify({ stat: stat.action, quiet: quiet.action, media: media.action, returned: returned.action }));
}

/**
 * env: { manifest, slides, bundle, fetchImpl, testMedia(slides,bundle,opts), probeBroken(), nav: {onLine, hasRecognition, audioInputs},
 *        audienceOpen(): Promise<boolean>, adminCheck(): Promise<boolean|null>, onProgress(result) }
 */
export async function runRehearsal(env) {
  const results = [];
  const push = (r) => { results.push(r); env.onProgress?.(r); };
  const summary = summarizeLecture(env.manifest);
  push(await checkFiles({ slides: env.slides, bundle: env.bundle, fetchImpl: env.fetchImpl }));
  const noText = env.slides.filter((s) => !String(s.text || "").trim()).length;
  push(noText === 0 ? ok("text", "كل الشرائح لها نص يفهمه المخرج.")
    : warn("text", `${noText} شريحة بلا نص (صور/مسح ضوئي)؛ المخرج لن يستفيد من سياقها.`));
  if (!summary.animatedSlides.length) push(ok("builds", "لا حركات نقر في هذه المحاضرة."));
  else if (summary.unreproducedAnimationSlides.length || summary.partialBuildSlides.length) {
    push(warn("builds", "حركات لا تُعاد بالكامل في الشرائح: " +
      [...summary.unreproducedAnimationSlides, ...summary.partialBuildSlides].join("، ") + " — قارنها مع PowerPoint."));
  } else push(ok("builds", `حركات النقر في ${summary.reproducedBuildSlides.length} شريحة تعمل خطوة بخطوة (شكل الحركة تلاشٍ).`));
  const ext = summary.warnings.filter((w) => /external|video could not|no audio|converted/i.test(w.problem));
  if (summary.embeddedVideoCount) {
    const media = await env.testMedia(env.slides, env.bundle, { timeoutMs: 7000 });
    push(media.failed ? fail("media", `${media.failed} من ${media.total} فيديو لم يُفك ترميزه في هذا المتصفح.`)
      : ok("media", `${media.passed} من ${media.total} فيديو فُك ترميز أول إطار منه (اختبر الصوت يدوياً).`));
  }
  if (ext.length) push(warn("media-notes", "تنبيهات الوسائط: " + ext.slice(0, 5).map((w) => (w.slide ? `ش${w.slide}: ` : "") + w.problem).join(" | ")));
  const nav = env.nav || {};
  push(nav.onLine === false ? warn("online", "الجهاز غير متصل بالإنترنت: التعرف الصوتي السحابي والـ API لن يعملا؛ العرض والتصويت المحلي يعملان.")
    : ok("online", "الاتصال بالإنترنت متاح."));
  push(nav.hasRecognition ? ok("speech", "المتصفح يدعم التعرف الصوتي.") : warn("speech", "المتصفح لا يدعم التعرف الصوتي: استخدم Chrome أو الإدخال النصي."));
  push(nav.audioInputs === 0 ? warn("mic", "لا يظهر ميكروفون متصل.") : ok("mic", nav.audioInputs ? `ميكروفونات ظاهرة: ${nav.audioInputs}.` : "تعذر عدّ الميكروفونات (قد يلزم السماح)."));
  const audience = await env.audienceOpen?.();
  push(audience ? ok("audience", "نافذة الطلبة مفتوحة وتستجيب.") : warn("audience", "نافذة الطلبة غير مفتوحة (افتحها على شاشة البروجكتر)."));
  const admin = await env.adminCheck?.();
  push(admin === true ? ok("admin", "رمز المحاضر صحيح.") : admin === false ? fail("admin", "رمز المحاضر غير صحيح.") : warn("admin", "لم يُدخل رمز المحاضر: الذاكرة والتصويت وAPI غير متاحة."));
  for (const r of await speechDrills()) push(r);
  push(brainSelfTest());
  if (env.probeBroken) {
    const broken = await env.probeBroken();
    push(broken ? ok("drill-broken-video", "فيديو تالف مُحاكى: اكتُشف الفشل بسرعة ولم يعلق العرض.")
      : fail("drill-broken-video", "فيديو تالف مُحاكى لم يُكتشف فشله."));
  }
  const level = results.some((r) => r.level === "fail") ? "fail" : results.some((r) => r.level === "warn") ? "warn" : "ok";
  return { level, results };
}
