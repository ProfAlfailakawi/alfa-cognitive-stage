// Lecturer tools for real-world use: resume banner, field-trial recorder with labelling, timed rehearsal audience,
// and the course map. Built with textContent only; calm closed drawer, one quiet banner when resuming.
import { analyzeTrial, trialToMarkdown } from "./field-recorder.js";
import { expectedQuestions } from "./audience-sim.js";
import { planRehearsal, summarizeRehearsal } from "./rehearsal-audience.js";
import { buildCourseMap } from "./course-map.js";

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
};
const ago = (ms) => (ms < 90000 ? "قبل أقل من دقيقتين" : "قبل " + Math.round(ms / 60000) + " دقيقة");

export function mountFieldTools(mount, { getToken, getBundle, getSlides, goToSlide, recorder, resume, restoreStage, noteFeature }) {
  const banner = el("div", { className: "resume-banner", id: "resume-banner", hidden: true });
  const drawer = el("details", { className: "library-drawer", id: "field-drawer" }, el("summary", { textContent: "المحاضرة التجريبية وخريطة المقرر وبروفة الجمهور" }));
  const body = el("div", { className: "library-body" });
  const status = el("p", { className: "meta", role: "status", id: "field-status" });
  drawer.append(body, status);
  mount.append(banner, drawer);
  const say = (t) => { status.textContent = t; };
  const call = async (path, init = {}) => {
    const token = getToken();
    if (!token) throw Error("أدخل رمز المحاضر أولاً.");
    const r = await fetch(path, { ...init, headers: { "X-Admin-Token": token, "Content-Type": "application/json", ...(init.headers || {}) } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(data.error || "تعذر تنفيذ الطلب");
    return data;
  };

  // ---- resume after a crash or power cut ----
  function offerResume() {
    const pending = resume.pending();
    if (!pending) return;
    banner.hidden = false;
    banner.replaceChildren(
      el("span", { textContent: `توقّف العرض عند الشريحة ${pending.index}${pending.step ? " (حركة " + pending.step + ")" : ""} ${ago(pending.ageMs)}. ` }),
      el("button", { type: "button", id: "resume-go", textContent: "استئناف من هناك", onclick: () => { restoreStage(resume.toStage(pending)); banner.hidden = true; noteFeature("resume"); } }),
      el("button", { type: "button", id: "resume-skip", textContent: "ابدأ من جديد", onclick: () => { resume.clear(); banner.hidden = true; } }),
      pending.videos.some((v) => v.time > 1) ? el("small", { textContent: " الفيديو يعود لموضعه متوقفاً؛ شغّله بنفسك." }) : null);
  }
  offerResume();

  let rehearsal = null; // { steps, results, i, timer, started }
  let renderSeq = 0;
  async function render() {
    const mine = ++renderSeq;
    body.replaceChildren();
    // 1. Field trial
    body.append(el("h4", { textContent: "المحاضرة التجريبية المسجّلة" }));
    const consent = el("input", { type: "checkbox", id: "trial-consent", checked: recorder.consented() });
    body.append(el("label", {}, consent, " أوافق على تسجيل ما يسمعه المخرج وقراراته على هذا الجهاز فقط"));
    const toggle = el("button", { type: "button", id: "trial-toggle", disabled: !recorder.consented(), textContent: recorder.recording() ? "إيقاف التسجيل" : "بدء تسجيل محاضرة" });
    consent.onchange = () => { recorder.setConsent(consent.checked); void render(); };
    toggle.onclick = () => { if (recorder.recording()) recorder.stop(); else recorder.start({ label: new Date().toISOString().slice(0, 10) }); void render(); };
    body.append(toggle, el("p", { className: "meta", textContent: "الجمل تُحفظ نصاً في متصفحك وحده، ولا يُسجَّل صوت، ويمكنك مسح كل شيء من الأسفل." }));
    const trial = recorder.last();
    if (trial && !recorder.recording()) {
      const report = analyzeTrial(trial);
      body.append(el("pre", { id: "trial-report", className: "trial-report", textContent: trialToMarkdown(report) }));
      const decisions = trial.events.filter((e) => e.type === "decision").slice(-25);
      if (decisions.length) {
        body.append(el("p", { className: "meta", textContent: "صنّف قرارات المخرج لتظهر دقته من تقييمك أنت:" }));
        const utter = new Map(trial.events.filter((e) => e.type === "utterance").map((e) => [e.id, e.text]));
        const list = el("ol", { id: "trial-decisions" });
        for (const d of decisions) {
          const row = el("li", {}, `${utter.get(d.utteranceId) || "—"} ⇒ ${d.action === "none" ? "فرصة بلا مشهد" : d.action} ${d.kind || ""} `);
          for (const [value, label] of (d.action === "none" ? [["ok", "صمته مناسب"], ["missed", "فاتته فرصة"]] : [["ok", "مناسب"], ["bad", "غير مناسب"], ["missed", "فاتته فرصة"]])) {
            row.append(el("button", { type: "button", className: "trial-label", textContent: label, ariaPressed: String(d.label === value),
              onclick: () => { recorder.label(d.id, d.label === value ? null : value); void render(); } }));
          }
          list.append(row);
        }
        body.append(list);
      }
      const save = el("button", { type: "button", id: "trial-export", textContent: "حفظ التقرير والبيانات" });
      save.onclick = () => {
        const blob = new Blob([recorder.exportJson()], { type: "application/json" });
        const a = el("a", { href: URL.createObjectURL(blob), download: "alfa-field-trial.json" });
        a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      };
      body.append(save);
    }
    body.append(el("button", { type: "button", id: "trial-clear", textContent: "مسح كل التسجيلات", onclick: () => { recorder.clear(); say("مُسحت التسجيلات."); void render(); } }));

    // 2. Timed rehearsal audience
    body.append(el("h4", { textContent: "بروفة الجمهور الموقّتة" }));
    let bank = [];
    try { bank = (await call(`/api/bank/${getBundle()}`)).questions; } catch {}
    if (mine !== renderSeq) return;
    const plan = planRehearsal(expectedQuestions(bank, getSlides()), { answerSec: Number(localStorageSafe("alfa-rehearsal-sec")) || undefined });
    const stage = el("div", { id: "rehearse-stage", className: "rehearse-stage", ariaLive: "polite" });
    body.append(el("p", { className: "meta", textContent: plan.length ? `${plan.length} سؤالاً حقيقياً سابقاً، موزعة على شرائحك.` : "لا أسئلة محفوظة بعد." }), stage);
    if (plan.length) {
      const start = el("button", { type: "button", id: "rehearse-start", textContent: "ابدأ البروفة" });
      const speak = el("input", { type: "checkbox", id: "rehearse-speak" });
      body.append(el("label", {}, speak, " اقرأ السؤال بصوت المتصفح (غير مجرَّب هنا)"), start);
      start.onclick = () => runRehearsal(plan, stage, speak.checked);
    }

    // 3. Course map
    body.append(el("h4", { textContent: "خريطة المقرر" }));
    let library = null;
    try { library = await call("/api/library"); } catch (e) { if (mine === renderSeq) body.append(el("p", { className: "meta", textContent: e.message })); }
    if (mine !== renderSeq) return;
    if (library) {
      const pick = el("select", { id: "map-course", ariaLabel: "اختيار مقرر" }, el("option", { value: "", textContent: "اختر مقرراً…" }),
        ...library.courses.map((c) => el("option", { value: c.id, textContent: c.name + (c.term ? " — " + c.term : "") })));
      const out = el("div", { id: "map-out" });
      pick.onchange = async () => {
        out.replaceChildren();
        if (!pick.value) return;
        try {
          const { lectures } = await call(`/api/coursemap/${pick.value}`);
          const texts = {};
          await Promise.all(lectures.map(async (l) => {
            const m = await fetch(`/bundles/${l.bundle}/manifest.json`).then((r) => r.json()).catch(() => null);
            texts[l.bundle] = Object.fromEntries((m?.slides || []).map((s) => [s.index, s.text || ""]));
          }));
          const map = buildCourseMap(lectures, texts);
          const list = el("ul", { id: "map-list" });
          for (const l of map.lectures) list.append(el("li", { textContent: `${l.title}: ${l.sessions} جلسات، ${l.questions} أسئلة، ` +
            (l.confusing.length ? "شرائح ضيّعت الطلاب: " + l.confusing.map((c) => `${c.slide} (${c.lost}/${c.devices})`).join("، ") : "لا شريحة بلغت حد الضياع") }));
          out.append(list);
          if (map.recurring.length) out.append(el("ul", { id: "map-recurring" }, ...map.recurring.map((r) => el("li", { textContent:
            `يتكرر المفهوم: «${r.a.lecture}» شريحة ${r.a.slide} ↔ «${r.b.lecture}» شريحة ${r.b.slide}` }))));
          out.append(el("p", { className: "meta", textContent: map.note }));
        } catch (e) { say(e.message); }
      };
      body.append(pick, out);
    }
  }
  const localStorageSafe = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

  function runRehearsal(plan, stage, spoken) {
    if (rehearsal?.timer) clearInterval(rehearsal.timer);
    rehearsal = { steps: plan, results: [], i: 0, timer: null, started: 0 };
    noteFeature("rehearsal");
    const next = () => {
      clearInterval(rehearsal.timer);
      const step = rehearsal.steps[rehearsal.i];
      if (!step) {
        const sum = summarizeRehearsal(rehearsal.steps, rehearsal.results);
        stage.replaceChildren(el("p", { id: "rehearse-summary", textContent: `انتهت: أجبتَ عن ${sum.answered} من ${sum.questions}` +
          (sum.medianSec !== null ? `، وسيط زمن الإجابة ${sum.medianSec} ث` : "") + `، وتجاوزت الوقت في ${sum.overLimit.length}` + (sum.skipped ? `، وتخطيت ${sum.skipped}` : "") + "." }),
          ...sum.overLimit.slice(0, 5).map((o) => el("p", { className: "meta", textContent: `تجاوزتَ الوقت — شريحة ${o.slide}: «${o.text}»` })));
        return;
      }
      goToSlide(step.slide);
      rehearsal.started = Date.now();
      const left = el("strong", { id: "rehearse-left", textContent: String(step.limitSec) });
      const finish = (extra) => { rehearsal.results.push({ step, ...extra }); rehearsal.i++; next(); };
      stage.replaceChildren(el("p", { id: "rehearse-q", textContent: `(${rehearsal.i + 1}/${rehearsal.steps.length}) شريحة ${step.slide}: «${step.text}»` }),
        el("p", {}, "الوقت المتبقي: ", left, " ث"),
        el("button", { type: "button", id: "rehearse-done", textContent: "أجبت", onclick: () => finish({ answeredSec: Math.round((Date.now() - rehearsal.started) / 1000) }) }),
        el("button", { type: "button", id: "rehearse-skip", textContent: "تخطَّ", onclick: () => finish({ skipped: true }) }));
      if (spoken && "speechSynthesis" in window) { try { const u = new SpeechSynthesisUtterance(step.text); u.lang = "ar"; speechSynthesis.speak(u); } catch {} }
      rehearsal.timer = setInterval(() => {
        const remaining = step.limitSec - Math.round((Date.now() - rehearsal.started) / 1000);
        left.textContent = String(Math.max(0, remaining));
        if (remaining <= 0) { clearInterval(rehearsal.timer); finish({ timedOut: true }); }
      }, 500);
    };
    next();
  }
  drawer.addEventListener("toggle", () => { if (drawer.open) void render(); });
  return { refresh: render };
}
