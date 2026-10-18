// Compact lecturer drawer: organise lectures into courses/sections, quick access to earlier
// lectures, session summary and data controls. Everything is built with textContent (no HTML injection).
import { summarizeSession, reportToMarkdown, clearAllSessionLogs } from "./session-log.js";

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
};
const option = (value, label, selected = false) => Object.assign(document.createElement("option"), { value, textContent: label, selected });

export function mountLibraryPanel(mount, { getToken, getBundle, getManifest, sessionLog, getPollCode, onOpen }) {
  const root = el("details", { className: "library-drawer", id: "library-drawer" }, el("summary", { textContent: "المقررات والجلسات والبيانات" }));
  const body = el("div", { className: "library-body" });
  const status = el("p", { className: "meta", role: "status", id: "library-status" });
  root.append(body, status);
  mount.append(root);
  const say = (text) => { status.textContent = text; };
  const call = async (path, init = {}) => {
    const token = getToken();
    if (!token) throw Error("أدخل رمز المحاضر أولاً.");
    const response = await fetch(path, { ...init, headers: { "X-Admin-Token": token, "Content-Type": "application/json", ...(init.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || "تعذر تنفيذ الطلب");
    return data;
  };

  async function render() {
    body.replaceChildren();
    let snap;
    try { snap = await call("/api/library"); } catch (error) { body.append(el("p", { className: "meta", textContent: error.message })); return; }
    const bundle = getBundle();
    const current = snap.lectures.find((l) => l.bundle === bundle);
    // 1. Quick access, grouped by course.
    const picker = el("select", { id: "library-open", ariaLabel: "فتح محاضرة سابقة" });
    picker.append(option("", "فتح محاضرة سابقة…"));
    const groups = new Map();
    for (const lecture of snap.lectures) {
      const course = snap.courses.find((c) => c.id === lecture.courseId);
      const key = course ? course.name + (course.term ? " — " + course.term : "") : "بدون مقرر";
      (groups.get(key) || groups.set(key, []).get(key)).push(lecture);
    }
    for (const [name, lectures] of groups) {
      const group = el("optgroup", { label: name });
      for (const l of lectures) {
        const section = snap.sections.find((s) => s.id === l.sectionId);
        group.append(option(l.bundle, l.title + (section ? " — " + section.name : "") + " (" + l.slideCount + ")" + (l.seriesId ? " ↔" : "")));
      }
      picker.append(group);
    }
    picker.onchange = async () => {
      if (!picker.value || picker.value === bundle) return;
      try { await call(`/api/library/lectures/${picker.value}/open`, { method: "POST", body: "{}" }); } catch {}
      onOpen(picker.value);
    };
    body.append(el("label", { textContent: "الوصول السريع (الأحدث فتحاً أولاً)" }), picker);

    // 2. Organise the current lecture.
    if (current) {
      const title = el("input", { type: "text", maxLength: 120, value: current.title, ariaLabel: "عنوان المحاضرة" });
      const course = el("select", { ariaLabel: "المقرر" }); course.append(option("", "بدون مقرر", !current.courseId));
      for (const c of snap.courses) course.append(option(c.id, c.name, c.id === current.courseId));
      const section = el("select", { ariaLabel: "الشعبة" }); section.append(option("", "بدون شعبة", !current.sectionId));
      for (const s of snap.sections.filter((x) => x.courseId === current.courseId)) section.append(option(s.id, s.name, s.id === current.sectionId));
      const version = el("select", { ariaLabel: "ربط كنسخة من محاضرة" }); version.append(option("", current.seriesId ? "نسخة مرتبطة بمحاضرة أخرى" : "ربط كنسخة من…"));
      for (const l of snap.lectures.filter((x) => x.bundle !== bundle)) version.append(option(l.bundle, l.title));
      const save = el("button", { type: "button", textContent: "حفظ التنظيم" });
      save.onclick = async () => {
        try {
          await call(`/api/library/lectures/${bundle}`, { method: "PUT", body: JSON.stringify({ title: title.value,
            courseId: course.value || null, sectionId: section.value || null, ...(version.value ? { versionOf: version.value } : {}) }) });
          say("حُفظ تنظيم المحاضرة. الملف الأصلي لم يُمس."); render();
        } catch (error) { say(error.message); }
      };
      course.onchange = () => { section.replaceChildren(option("", "بدون شعبة", true)); };
      const newCourse = el("input", { type: "text", maxLength: 80, placeholder: "مقرر جديد (مثل: تعلم الكبار)", ariaLabel: "اسم مقرر جديد" });
      const newSection = el("input", { type: "text", maxLength: 60, placeholder: "شعبة جديدة للمقرر المختار", ariaLabel: "اسم شعبة جديدة" });
      const add = el("button", { type: "button", textContent: "إضافة مقرر/شعبة" });
      add.onclick = async () => {
        try {
          if (newCourse.value.trim()) await call("/api/library/courses", { method: "POST", body: JSON.stringify({ name: newCourse.value }) });
          if (newSection.value.trim()) {
            if (!course.value) throw Error("اختر المقرر أولاً لإضافة شعبة.");
            await call("/api/library/sections", { method: "POST", body: JSON.stringify({ courseId: course.value, name: newSection.value }) });
          }
          say("تمت الإضافة."); render();
        } catch (error) { say(error.message); }
      };
      body.append(el("label", { textContent: "تنظيم هذه المحاضرة" }), title, course, section, version, el("div", { className: "director-actions" }, save), newCourse, newSection, el("div", { className: "director-actions" }, add));
    }

    // 3. Session summary.
    const summaryPre = el("pre", { className: "session-summary", id: "session-summary", textContent: "اضغط «ملخص الجلسة الحالية»." });
    const showSummary = el("button", { type: "button", id: "session-summary-run", textContent: "ملخص الجلسة الحالية" });
    const download = el("button", { type: "button", id: "session-summary-download", textContent: "تنزيل (Markdown)" });
    let lastMarkdown = "";
    showSummary.onclick = async () => {
      const session = sessionLog.current();
      if (!session) { summaryPre.textContent = "لا توجد جلسة مسجلة بعد."; return; }
      let polls = [], pending = null, usage = null;
      const code = getPollCode();
      try {
        if (code) {
          polls = (await call(`/api/sessions/${code}/presenter`)).polls.map((p) => ({ question: p.question, options: p.options, counts: p.counts, total: p.total }));
          pending = (await call(`/api/sessions/${code}/questions`)).questions.length;
        }
      } catch {}
      lastMarkdown = reportToMarkdown(summarizeSession(session, { manifest: getManifest(), polls, pendingQuestions: pending, usage, endAt: Date.now() }));
      summaryPre.textContent = lastMarkdown;
    };
    download.onclick = () => {
      if (!lastMarkdown) { say("أنشئ الملخص أولاً."); return; }
      const url = URL.createObjectURL(new Blob([lastMarkdown], { type: "text/markdown;charset=utf-8" }));
      const link = el("a", { href: url, download: "alfa-session-summary.md" });
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    };
    body.append(el("label", { textContent: "ملخص الجلسة (من السجل المحلي فعلياً)" }), el("div", { className: "director-actions" }, showSummary, download), summaryPre);

    // 4. Data controls.
    const dataLine = el("p", { className: "meta", id: "data-summary", textContent: "…" });
    call("/api/data/summary").then((d) => {
      dataLine.textContent = `مخزن محلياً: ${d.votes.sessions} جلسة تصويت، ${d.votes.polls} سؤال، ${d.votes.pendingQuestions} سؤال طلبة بانتظار المراجعة، ${d.votes.storedDeviceTokens} رمز جهاز، ${d.scenes} مشهد معتمد. تُحذف رموز الأجهزة تلقائياً بعد ${d.voterTokenHours} ساعة من إغلاق السؤال، وتُحذف الجلسات بعد ${d.retentionDays} يوماً.`;
    }).catch(() => { dataLine.textContent = ""; });
    const wipeLogs = el("button", { type: "button", id: "wipe-session-logs", textContent: "حذف سجلات جلساتي" });
    wipeLogs.onclick = () => { sessionLog.clear(); clearAllSessionLogs(); say("حُذفت سجلات الجلسات من هذا المتصفح."); };
    const wipeVotes = el("button", { type: "button", id: "wipe-votes", textContent: "حذف كل بيانات التصويت والأسئلة" });
    wipeVotes.onclick = async () => {
      if (!confirm("حذف كل جلسات التصويت وأسئلة الطلبة نهائياً؟")) return;
      try { const r = await call("/api/data/votes", { method: "DELETE" }); say("حُذفت " + r.removed + " جلسة تصويت."); render(); } catch (error) { say(error.message); }
    };
    const wipeLecture = el("button", { type: "button", id: "wipe-lecture", textContent: "حذف هذه المحاضرة وملفاتها" });
    wipeLecture.onclick = async () => {
      if (!confirm("حذف المحاضرة وصورها وفيديوهاتها ومشاهدها المحفوظة نهائياً؟ ملف PowerPoint الأصلي عندك لا يتأثر.")) return;
      try { await call("/api/lectures/" + bundle, { method: "DELETE" }); sessionLog.clear(); location.assign("/#presenter"); } catch (error) { say(error.message); }
    };
    body.append(el("label", { textContent: "الخصوصية والبيانات" }), dataLine, el("div", { className: "director-actions" }, wipeLogs, wipeVotes, wipeLecture));
  }
  root.addEventListener("toggle", () => { if (root.open) render(); });
  return { refresh: render };
}
