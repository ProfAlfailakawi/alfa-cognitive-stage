// Lecturer-only panel: understanding pulse, next-session suggestion, student review, rehearsal audience.
// Calm by design: one quiet line while teaching; everything else lives in a closed drawer. textContent only.
import { summarizeSession } from "./session-log.js";
import { coachSuggestion, dwellBySlide } from "./lecture-coach.js";
import { buildReview } from "./review-builder.js";
import { expectedQuestions } from "./audience-sim.js";
import { checkSpoken, unmatchedNumber } from "./number-witness.js";

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
};

export function mountInsight(mount, { getToken, getBundle, getManifest, getSlide, getPollCode, sessionLog, getSlides }) {
  const pulseLine = el("p", { className: "pulse-line", id: "pulse-line", role: "status", hidden: true });
  const witnessLine = el("p", { className: "witness-line", id: "witness-line", role: "status", hidden: true });
  const drawer = el("details", { className: "library-drawer", id: "insight-drawer" }, el("summary", { textContent: "نبض الفهم والمراجعة والبروفة" }));
  const body = el("div", { className: "library-body" });
  const status = el("p", { className: "meta", role: "status", id: "insight-status" });
  drawer.append(body, status);
  mount.append(witnessLine, pulseLine, drawer);
  const say = (t) => { status.textContent = t; };
  const call = async (path, init = {}) => {
    const token = getToken();
    if (!token) throw Error("أدخل رمز المحاضر أولاً.");
    const r = await fetch(path, { ...init, headers: { "X-Admin-Token": token, "Content-Type": "application/json", ...(init.headers || {}) } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(data.error || "تعذر تنفيذ الطلب");
    return data;
  };

  // ---- pulse: tell the server which slide is on screen, and read the quiet aggregate back ----
  let lastSent = "";
  async function pushContext() {
    const code = getPollCode();
    if (!code || !/^[a-f0-9]{12}$/.test(String(getBundle()))) return; // the server only accepts hashed lecture ids; do not hammer it with ones it refuses
    const key = code + "#" + getBundle() + "#" + getSlide();
    if (key === lastSent) return;
    lastSent = key;
    try { await call(`/api/sessions/${code}/pulse/context`, { method: "POST", body: JSON.stringify({ lecture: getBundle(), slide: getSlide() }) }); }
    catch { lastSent = ""; }
  }
  async function pollPulse() {
    const code = getPollCode();
    pulseLine.hidden = false;
    pulseLine.dataset.level = "quiet";
    if (!getToken()) {
      pulseLine.textContent = "نبض الفهم غير مفعّل: أدخل رمز المحاضر لقراءة الإشارات.";
      return;
    }
    if (!code) {
      pulseLine.textContent = "نبض الفهم جاهز بعد فتح جلسة تصويت ومشاركة الطلبة.";
      return;
    }
    await pushContext();
    try {
      const { live } = await call(`/api/sessions/${code}/pulse`);
      if (!live.devices) { pulseLine.dataset.level = "quiet"; pulseLine.textContent = "نبض الفهم: بانتظار ضغط الطلبة «فاهم» أو «ضايع»."; return; }
      pulseLine.hidden = false;
      pulseLine.dataset.level = live.hidden ? "quiet" : live.level;
      pulseLine.textContent = live.hidden ? "نبض الفهم: إشارات قليلة بعد"
        : live.level === "watch" ? `نبض الفهم: ${live.lost} من ${live.devices} ضايعون هنا`
        : `نبض الفهم: هادئ (${live.got} فاهمون من ${live.devices})`;
    } catch { pulseLine.dataset.level = "quiet"; pulseLine.textContent = "تعذّر تحديث نبض الفهم؛ تحقق من جلسة التصويت والاتصال بالخادم."; }
  }
  const timer = setInterval(pollPulse, 4000);
  addEventListener("pagehide", () => clearInterval(timer));

  // ---- drawer content (rebuilt when opened) ----
  let renderSeq = 0; // a stale render (drawer toggled quickly) must not append after a newer one started
  async function render() {
    const mine = ++renderSeq;
    body.replaceChildren();
    const bundle = getBundle();
    const manifest = getManifest();
    // 1. Suggestion for the next session
    let history = [];
    try { history = (await call(`/api/coach/${bundle}`)).sessions; } catch (e) { say(e.message); }
    if (mine !== renderSeq) return;
    const local = (sessionLog.all?.() || []).map((s) => summarizeSession(s, { manifest }));
    const suggestion = coachSuggestion(history, dwellBySlide(local));
    body.append(el("h4", { textContent: "اقتراح قبل المحاضرة القادمة" }));
    if (suggestion) {
      body.append(el("p", { id: "coach-text", textContent: suggestion.text }),
        el("ul", { id: "coach-evidence" }, ...suggestion.evidence.map((x) => el("li", { textContent: x }))),
        el("p", { className: "meta", textContent: "مبني على أعداد مجمّعة وبلا أسماء، وهو تلميح لا حكم على الشرح." }));
    } else {
      const recent = local.at(-1);
      const omitted = recent?.unvisited?.length || 0;
      const text = recent?.slidesVisited
        ? (omitted ? `سجل البروفة: عُرضت ${recent.slidesVisited} شريحة، وبقيت ${omitted} دون عرض. راجع إن كان تجاوزها مقصوداً. لا توجد إشارات طلبة تكفي للحكم على الفهم بعد.`
          : `سجل العرض: مررت على ${recent.slidesVisited} شريحة. لتحصل على اقتراح تعليمي مبني على أدلة، اجمع إشارات فهم وأسئلة الطلاب أثناء الجلسات.`)
        : "لا تتوفر بيانات جلسات كافية بعد. اعرض الشرائح، وافتح جلسة تصويت للطلبة، ثم أعد فتح هذا القسم.";
      body.append(el("p", { className: "meta", id: "coach-none", textContent: text }));
    }

    // 2. Student review page
    body.append(el("h4", { textContent: "مراجعة للطلاب بعد المحاضرة" }));
    const code = getPollCode();
    const publish = el("button", { type: "button", id: "review-publish", textContent: "نشر المراجعة للطلاب", disabled: !code });
    const withdraw = el("button", { type: "button", id: "review-withdraw", textContent: "سحب المراجعة", disabled: !code });
    const preview = el("ul", { id: "review-preview" });
    const current = sessionLog.current?.();
    const reviewSource = { ...(manifest || {}), slides: (getSlides() || []).map((slide, i) => ({
      index: slide.index || i + 1, title: slide.title || manifest?.slides?.[i]?.title || "",
      text: slide.text || ""
    })) };
    const review = current ? buildReview(summarizeSession(current, { manifest }), reviewSource) : { title: "", items: [] };
    // Every item is the lecturer's to include. One whose numbers disagree with its own slide starts unticked.
    const boxes = review.items.map((item) => {
      const slideText = (getSlides()[item.slide - 1]?.text || "") + " " + (getSlides()[item.slide - 1]?.notes || "");
      const clash = checkSpoken(item.lines.join(" "), slideText) || unmatchedNumber(item.lines.join(" "), slideText);
      const box = el("input", { type: "checkbox", checked: !clash, ariaLabel: `تضمين شريحة ${item.slide}` });
      preview.append(el("li", {}, box, ` شريحة ${item.slide}: ${item.heading}` + (item.lines.length ? " — " + item.lines.join(" / ") : ""),
        clash ? el("strong", { className: "review-clash", textContent: ` ⚠ الرقم ${clash.said}${clash.unit} لا يطابق ${clash.printed}${clash.unit} المكتوب في الشريحة؛ راجعه قبل النشر` }) : null));
      return box;
    });
    body.append(el("p", { className: "meta", textContent: review.items.length
      ? `${review.items.length} عنصراً من الشرائح والمشاهد التي عرضتَها فعلاً. راجع المحتوى واختر ما يُنشر.` : "لا توجد شرائح أو مشاهد مسجلة في هذه الجلسة بعد. انتقل إلى شريحة أولاً." }), preview, publish, withdraw);
    publish.disabled = !code || !review.items.length;
    publish.onclick = async () => {
      const chosen = { title: review.title, items: review.items.filter((_, i) => boxes[i].checked) };
      if (!chosen.items.length) { say("اختر عنصراً واحداً على الأقل."); return; }
      try {
        await call(`/api/sessions/${code}/review`, { method: "POST", body: JSON.stringify(chosen) });
        const url = new URL("/review.html", location.href); url.searchParams.set("s", code);
        say("نُشرت المراجعة: " + url.href);
      } catch (e) { say(e.message); }
    };
    withdraw.onclick = async () => { try { await call(`/api/sessions/${code}/review`, { method: "DELETE" }); say("سُحبت المراجعة."); } catch (e) { say(e.message); } };

    // 3. Rehearsal audience
    body.append(el("h4", { textContent: "جمهور البروفة" }));
    let bank = [];
    try { bank = (await call(`/api/bank/${bundle}`)).questions; } catch {}
    if (mine !== renderSeq) return;
    const expected = expectedQuestions(bank, getSlides());
    const slides = Object.keys(expected).map(Number).sort((a, b) => a - b);
    if (!slides.length) {
      body.append(el("p", { className: "meta", id: "bank-none",
        textContent: "لا أسئلة طلاب محفوظة بعد. هذه بروفة أولية من عناوين الشرائح وليست أسئلة طلاب حقيقية. لحفظ أسئلة واقعية استخدم «احتفظ به للبروفة»." }));
      const samples = (getSlides() || []).filter((slide) => String(slide.text || slide.title || "").trim()).slice(0, 5);
      if (samples.length) {
        const practice = el("ol", { id: "practice-list", className: "rehearsal-list" });
        for (const [i, slide] of samples.entries()) {
          const heading = String(slide.title || slide.text.split(/\r?\n/)[0] || "").trim().slice(0, 75);
          practice.append(el("li", { textContent: `شريحة ${slide.index || i + 1}: كيف ستشرح «${heading}» بوضوح؟` }));
        }
        body.append(practice);
      }
    }
    else {
      const list = el("ol", { id: "bank-list", className: "rehearsal-list" });
      for (const slide of slides) for (const q of expected[slide]) {
        list.append(el("li", { textContent: `شريحة ${slide}: «${q.text}»` + (q.origin === "related" ? ` (سؤال من شريحة ${q.from} يتعلق بمحتواها)` : "") }));
      }
      body.append(list, el("p", { className: "meta", textContent: "هذه أسئلة حقيقية سُئلت سابقاً، وليست مولّدة." }));
    }
    const wipe = el("button", { type: "button", id: "bank-clear", textContent: "حذف كل الأسئلة المحفوظة" });
    wipe.onclick = async () => { try { const r = await call("/api/data/questions", { method: "DELETE" }); say(`حُذف ${r.removed} سؤالاً.`); await render(); } catch (e) { say(e.message); } };
    body.append(wipe);
  }
  drawer.addEventListener("toggle", () => { if (drawer.open) void render(); });
  let witnessTimer = null;
  function witness(message) { // private to the lecturer window; fades after a while
    witnessLine.textContent = message; witnessLine.hidden = false;
    clearTimeout(witnessTimer);
    witnessTimer = setTimeout(() => { witnessLine.hidden = true; }, 14000);
  }
  return { witness, slideChanged: () => void pollPulse(), refresh: render };
}
