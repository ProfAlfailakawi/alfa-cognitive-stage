import { compareRounds, exportAggregateCsv, summarizePollDistribution } from "./poll-analytics.js";
import { clusterQuestions, recurringTerms, reexplainSuggestions, groupByObjective, compareSections } from "./engagement-insights.js";
// Lecturer's voting console: create a session, add questions, open/close/reveal, see results.
const $ = (id) => document.getElementById(id);
const KEY = "alfa-admin-token";
const SESSION_KEY = "alfa-current-voting-session";
let adminToken = sessionStorage.getItem(KEY) || "";
let code = sessionStorage.getItem(SESSION_KEY) || "";
let refreshTimer = null;
let latestPollState = null;

async function call(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Admin-Token": adminToken },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "تعذّر تنفيذ الطلب");
  return data;
}

function esc(value) {
  const node = document.createElement("span");
  node.textContent = String(value);
  return node.innerHTML;
}

let joinUrl = "";
function publishPresenterState(state) {
  if (window.parent === window || !joinUrl) return;
  const active = state.polls.find((p) => p.status === "open") || null;
  window.parent.postMessage({
    alfaVoting: "status", url: joinUrl,
    active: active ? { question: active.question, options: active.options, kind: active.kind || "choice",
      counts: active.counts, reveal: active.reveal,
      words: active.kind === "words" ? active.words.filter((w) => !w.hidden).slice(0, 40).map(({ word, count }) => ({ word, count })) : undefined } : null
  }, location.origin);
}
function drawQr(url) {
  joinUrl = url;
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  $("qr").innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2 });
  $("join-url").textContent = url;
}

function renderPolls(state) {
  latestPollState = state;
  const changes = compareRounds(state.polls);
  const container = $("round-comparisons");
  if (container) {
    container.replaceChildren();
    for (const group of changes) {
      const item = document.createElement("div");
      item.className = "poll";
      const title = document.createElement("strong");
      title.textContent = "تغير التوزيع بين الجولتين " + group.firstId + " و" + group.lastId + ": " + group.question;
      item.append(title);
      for (const value of group.values) {
        const line = document.createElement("p");
        const change = (value.deltaPoints > 0 ? "+" : "") + value.deltaPoints + " نقطة مئوية";
        line.textContent = value.option + ": " + value.firstPercent + "% ← " + value.lastPercent + "% (" + change + ")";
        item.append(line);
      }
      const warning = document.createElement("p");
      warning.className = "meta";
      warning.textContent = "هذه مقارنة لتوزيع الإجابات، وليست إثباتاً لتحسّن التعلم أو مشاركة الطلاب أنفسهم.";
      item.append(warning);
      container.append(item);
    }
  }
  renderObjectives(state.polls);
  $("polls").innerHTML = state.polls.map((p) => {
    const total = p.total || 0;
    if (p.kind === "words") {
      const words = p.words.map((w) => `<span class="word-chip${w.hidden ? " hidden-word" : ""}">${esc(w.word)} × ${w.count}
        <button type="button" class="word-toggle" data-poll="${p.id}" data-key="${esc(w.key)}" data-hidden="${w.hidden ? 1 : 0}">${w.hidden ? "إظهار" : "إخفاء"}</button></span>`).join("") || `<span class="meta">لا كلمات بعد.</span>`;
      const st = p.status === "open" ? "مفتوح" : p.status === "closed" ? "مغلق" : "مسودة";
      return `<div class="poll"><strong>${esc(p.question)}</strong> <span class="meta">(سحابة كلمات)</span>
        <div class="meta">${st} — الكلمات المقبولة: ${p.submissions}${p.objective ? " — الهدف: " + esc(p.objective) : ""}</div>
        <div class="word-chips">${words}</div>
        <p class="meta">تُرفض تلقائياً الأرقام والروابط والإساءة؛ أخفِ أي كلمة لا تناسب قبل إظهار السحابة للطلبة.</p>
        <div class="actions">
          ${p.status !== "open" ? `<button data-act="open" data-id="${p.id}" class="primary">فتح</button>` : `<button data-act="close" data-id="${p.id}">إغلاق</button>`}
          ${p.reveal ? `<button data-act="hide" data-id="${p.id}">إخفاء السحابة</button>` : `<button data-act="reveal" data-id="${p.id}">إظهار السحابة</button>`}
          <button data-act="repeat" data-id="${p.id}">جولة جديدة</button>
        </div></div>`;
    }
    const rows = p.options.map((text, i) => {
      const pct = total ? Math.round((p.counts[i] / total) * 100) : 0;
      return `<div class="row"><div>${esc(text)} — ${p.counts[i]} (${pct}%)</div>
        <div class="bar"><span style="width:${pct}%"></span></div></div>`;
    }).join("");
    const state_ = p.status === "open" ? "مفتوح" : p.status === "closed" ? "مغلق" : "مسودة";
    const insight = summarizePollDistribution(p);
    return `<div class="poll">
      <strong>${esc(p.question)}</strong>
      <div class="meta">${state_} — الإجابات: ${total}${p.allowChange ? " — يسمح بالتغيير" : ""}</div>
      ${rows}
      ${p.objective ? `<div class="meta">الهدف: ${esc(p.objective)}</div>` : ""}
      ${insight ? `<p class="meta poll-insight">${esc(insight.text)}</p>` : ""}
      <div class="actions">
        ${p.status !== "open" ? `<button data-act="open" data-id="${p.id}" class="primary">فتح</button>` : `<button data-act="close" data-id="${p.id}">إغلاق</button>`}
        ${p.reveal ? `<button data-act="hide" data-id="${p.id}">إخفاء النتائج</button>` : `<button data-act="reveal" data-id="${p.id}">إظهار النتائج</button>`}
        <button data-act="repeat" data-id="${p.id}">جولة جديدة (نتائج منفصلة)</button>
      </div>
    </div>`;
  }).join("") || `<p class="meta">لا توجد أسئلة بعد.</p>`;
  $("polls").querySelectorAll("button.word-toggle").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await call("POST", `/sessions/${code}/polls/${btn.dataset.poll}/${btn.dataset.hidden === "1" ? "show-word" : "hide-word"}`, { key: btn.dataset.key });
        await refresh();
      } catch (err) { $("poll-msg").textContent = err.message; }
    });
  });
  $("polls").querySelectorAll("button[data-act]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await call("POST", `/sessions/${code}/polls/${btn.dataset.id}/${btn.dataset.act}`);
        await refresh();
      } catch (err) {
        $("poll-msg").textContent = err.message;
      }
    });
  });
}

function renderObjectives(polls) {
  const target = $("objective-groups");
  if (!target) return;
  target.replaceChildren();
  const groups = groupByObjective(polls);
  if (!groups.length) { target.append(Object.assign(document.createElement("p"), { className: "meta", textContent: "لم تُحدد أهداف تعلم للأسئلة بعد." })); return; }
  for (const g of groups) {
    const box = document.createElement("div");
    box.className = "poll";
    const title = document.createElement("strong");
    title.textContent = g.objective;
    const line = document.createElement("p");
    line.className = "meta";
    line.textContent = g.items.length + " سؤال/أسئلة، أكبر مشاركة " + g.participants + ". عرض للمشاركة والتوزيع فقط؛ لا يُستدل منه على إتقان الهدف.";
    box.append(title, line);
    for (const item of g.items) box.append(Object.assign(document.createElement("p"), { textContent: "• " + item.question + " (" + item.total + ")" }));
    target.append(box);
  }
}

function makeQuestionRow(item) {
  const row = document.createElement("div");
  row.className = "poll";
  const question = document.createElement("p");
  question.textContent = item.text; // Never treat student text as HTML.
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "إزالة السؤال من القائمة";
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await call("DELETE", "/sessions/" + code + "/questions/" + item.id);
      await refreshOpenQuestions();
    } catch (error) {
      button.disabled = false;
      $("poll-msg").textContent = error.message;
    }
  });
  const keep = document.createElement("button");
  keep.type = "button";
  keep.textContent = "احتفظ به للبروفة";
  keep.title = "يُحفظ نص السؤال فقط، دون أي هوية، لتتدرّب عليه قبل المحاضرة القادمة";
  keep.addEventListener("click", async () => {
    keep.disabled = true;
    try {
      const r = await call("POST", "/sessions/" + code + "/questions/" + item.id + "/keep", {});
      keep.textContent = r.duplicate ? "محفوظ سابقاً" : "حُفظ للبروفة";
    } catch (error) {
      keep.disabled = false;
      $("poll-msg").textContent = error.message;
    }
  });
  row.append(question, keep, button);
  return row;
}

async function refreshOpenQuestions() {
  if (!code || !$("student-questions-drawer")?.open) return;
  const inbox = $("student-questions"), insights = $("question-insights");
  try {
    const { questions } = await call("GET", "/sessions/" + code + "/questions");
    inbox.replaceChildren();
    insights.replaceChildren();
    if (!questions?.length) {
      inbox.append(Object.assign(document.createElement("p"), { className: "meta", textContent: "لا توجد أسئلة مفتوحة حالياً." }));
      return;
    }
    const clean = questions.filter((q) => !q.flagged), flagged = questions.filter((q) => q.flagged);
    const clusters = clusterQuestions(clean);
    const tips = reexplainSuggestions(clusters, clean.length);
    const summary = document.createElement("div");
    summary.className = "poll";
    const head = document.createElement("strong");
    head.textContent = "ملخص الأسئلة المتكررة (استخراجي من نصوص الطلبة)";
    summary.append(head);
    const terms = recurringTerms(clean);
    if (terms.length) summary.append(Object.assign(document.createElement("p"), { className: "meta",
      textContent: "كلمات تكررت: " + terms.map((t) => t.term + " (" + t.count + ")").join("، ") }));
    for (const c of clusters.filter((x) => x.size >= 2).slice(0, 4)) {
      summary.append(Object.assign(document.createElement("p"), { textContent: "• " + c.size + " أسئلة متقاربة" +
        (c.keywords.length ? " حول «" + c.keywords.join("، ") + "»" : "") + " — مثال: «" + c.representative + "»" }));
    }
    for (const tip of tips) summary.append(Object.assign(document.createElement("p"), { className: "poll-insight", textContent: "اقتراح: " + tip }));
    if (!terms.length && !clusters.some((x) => x.size >= 2)) summary.append(Object.assign(document.createElement("p"), { className: "meta", textContent: "لا نمط متكرر بعد." }));
    insights.append(summary);
    for (const item of clean) inbox.append(makeQuestionRow(item));
    if (flagged.length) {
      const details = document.createElement("details");
      details.append(Object.assign(document.createElement("summary"), { textContent: "أسئلة مُعلَّمة ومخفية (" + flagged.length + ") — راجعها بحذر" }));
      for (const item of flagged) details.append(makeQuestionRow(item));
      inbox.append(details);
    }
  } catch (err) {
    inbox.textContent = "تعذر تحميل أسئلة الطلبة: " + err.message;
  }
}

async function refresh() {
  if (!code) return;
  try {
    const state = await call("GET", `/sessions/${code}/presenter`);
    renderPolls(state);
    publishPresenterState(state);
    if ($("student-questions-drawer")?.open) void refreshOpenQuestions();
  } catch (err) {
    $("poll-msg").textContent = err.message;
  }
}

async function enter() {
  try {
    await call("GET", "/admin/check");
    adminToken && sessionStorage.setItem(KEY, adminToken);
    $("auth-msg").textContent = "";
    $("auth").hidden = true;
    $("panel").hidden = false;
    if (!code) await newSession();
    else {
      try {
        await call("GET", "/sessions/" + code + "/presenter");
        await showSession();
      } catch {
        code = "";
        sessionStorage.removeItem(SESSION_KEY);
        await newSession();
      }
    }
    clearInterval(refreshTimer);
    refreshTimer = setInterval(refresh, 2000);
  } catch (err) {
    sessionStorage.removeItem(KEY);
    $("auth-msg").textContent = err.message === "غير مصرح" ? "الرمز غير صحيح." : err.message;
  }
}

async function showSession() {
  if (!code) return;
  $("session-line").textContent = "رمز الجلسة: " + code;
  const net = await fetch("/api/network").then((r) => r.json()).catch(() => ({}));
  const base = net.publicUrl || location.origin;
  drawQr(base + "/vote.html?s=" + encodeURIComponent(code));
  if (!net.publicUrl && ["localhost", "127.0.0.1"].includes(location.hostname)) {
    $("poll-msg").textContent = "تنبيه: رابط localhost لا يعمل على هاتف آخر. استخدم PUBLIC_URL أو عنوان شبكة الماك.";
  }
  await refresh();
}
async function newSession() {
  const result = await call("POST", "/sessions");
  code = result.code;
  sessionStorage.setItem(SESSION_KEY, code);
  await showSession();
}

$("student-questions-drawer")?.addEventListener("toggle", () => { if ($("student-questions-drawer").open) void refreshOpenQuestions(); });

$("save-token").addEventListener("click", () => {
  adminToken = $("token").value.trim();
  enter();
});
$("new-session").addEventListener("click", () => newSession().catch((e) => ($("poll-msg").textContent = e.message)));
// Adds the question typed (or drafted from the lecturer's speech) in the form. Returns the new poll, or null.
async function addPoll() {
  const options = $("q-opts").value.split("\n").map((s) => s.trim()).filter(Boolean);
  try {
    const { poll } = await call("POST", `/sessions/${code}/polls`, {
      question: $("q-text").value, options, allowChange: $("q-change").checked,
      kind: $("q-kind").value, objective: $("q-objective").value,
    });
    $("q-objective").value = "";
    $("q-text").value = "";
    $("q-opts").value = "";
    $("poll-msg").textContent = "تمت إضافة السؤال.";
    await refresh();
    return poll;
  } catch (err) {
    $("poll-msg").textContent = err.message;
    return null;
  }
}
$("add-poll").addEventListener("click", addPoll);

// Spoken poll commands from the lecturer's page (no typing): open the drafted question, close it, reveal results.
async function voicePoll(action) {
  const reply = (ok, note) => window.parent.postMessage({ alfaVoicePollResult: { action, ok, note } }, location.origin);
  try {
    if (!code) await newSession();
    const polls = (latestPollState?.polls || []);
    if (action === "poll-open") {
      const question = $("q-text").value.trim();
      if (question.length < 3) return reply(false, "ما سمعت سؤالاً بعد. اطرح سؤالك على الطلبة أولاً.");
      // A question without choices becomes a word cloud (one word per box), so nothing is invented as an option.
      if (!$("q-opts").value.trim()) { $("q-kind").value = "words"; $("q-opts").hidden = true; }
      const poll = await addPoll();
      if (!poll) return reply(false, $("poll-msg").textContent);
      await call("POST", `/sessions/${code}/polls/${poll.id}/open`);
      await refresh();
      return reply(true, poll.kind === "words" ? "فُتح السؤال كسحابة كلمات." : "فُتح السؤال للطلبة.");
    }
    const open = polls.find((p) => p.status === "open"), last = open || polls[polls.length - 1];
    if (!last) return reply(false, "لا يوجد سؤال.");
    if (action === "poll-close") {
      if (!open) return reply(false, "لا يوجد سؤال مفتوح.");
      await call("POST", `/sessions/${code}/polls/${open.id}/close`);
    } else if (action === "poll-reveal") await call("POST", `/sessions/${code}/polls/${last.id}/reveal`);
    await refresh();
    reply(true, action === "poll-close" ? "أُغلق السؤال." : "ظهرت النتائج.");
  } catch (err) { reply(false, err.message); }
}

if (adminToken) {
  $("token").value = adminToken;
  enter();
} else if (!new URLSearchParams(location.search).has("dev")) {
  // No typing: this machine's own page receives the token from the local server (the typed-token box stays for ?dev=1).
  fetch("/api/local-token", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (d?.token) { adminToken = d.token; $("token").value = adminToken; enter(); }
  }).catch(() => {});
}

window.addEventListener("message", (event) => {
  if (event.origin !== location.origin || event.source !== window.parent) return;
  const voice = event.data?.alfaVoicePoll;
  if (typeof voice === "string" && /^poll-(?:open|close|reveal)$/.test(voice)) { void voicePoll(voice); return; }
  const text = event.data?.alfaQuestionDraft;
  if (typeof text !== "string" || !text.trim()) return;
  const question = text.trim().slice(0, 200);
  if (!$("q-text").value.trim()) $("q-text").value = question;
  if (!$("q-opts").value.trim() && /^(هل |تتوقعون |تعتقدون )/.test(question)) {
    // Opinion-only answers; no fabricated correct choice.
    $("q-opts").value = "نعم\nلا\nغير متأكد";
  }
  $("poll-msg").textContent = "جهّز المخرج سؤالاً من حديثك. راجعه ثم أضفه وافتحه بنفسك.";
});

$("q-kind")?.addEventListener("change", () => { $("q-opts").hidden = $("q-kind").value === "words"; });
$("save-label")?.addEventListener("click", async () => {
  try { await call("PUT", `/sessions/${code}`, { label: $("session-label").value }); $("poll-msg").textContent = "حُفظ اسم الشعبة."; }
  catch (err) { $("poll-msg").textContent = err.message; }
});
$("load-section-compare")?.addEventListener("click", async () => {
  const out = $("section-compare-results");
  out.replaceChildren();
  try {
    const { sessions } = await call("GET", "/sessions");
    const states = [];
    for (const s of sessions.slice(0, 12)) {
      try { states.push({ code: s.code, label: s.label, polls: (await call("GET", `/sessions/${s.code}/presenter`)).polls }); } catch {}
    }
    const compared = compareSections(states);
    if (!compared.length) { out.append(Object.assign(document.createElement("p"), { className: "meta", textContent: "لا يوجد سؤال بالنص والخيارات نفسها في شعبتين أو أكثر بعد. سمِّ الشعب ثم أعد المحاولة." })); return; }
    for (const c of compared) {
      const box = document.createElement("div");
      box.className = "poll";
      box.append(Object.assign(document.createElement("strong"), { textContent: c.question }));
      for (const section of c.sections) {
        box.append(Object.assign(document.createElement("p"), { textContent: section.label + " (ن=" + section.total + "): " +
          c.options.map((o, i) => o + " " + section.percents[i] + "%").join(" — ") }));
      }
      box.append(Object.assign(document.createElement("p"), { className: "meta", textContent: c.caveat }));
      out.append(box);
    }
  } catch (err) { out.textContent = err.message; }
});

$("export-poll-aggregates")?.addEventListener("click", () => {
  if (!latestPollState?.polls?.length) {
    $("poll-msg").textContent = "لا توجد نتائج للتصدير بعد.";
    return;
  }
  const csv=exportAggregateCsv(latestPollState.polls);
  const link=document.createElement("a");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));
  link.href=url;
  link.download="alfa-voting-"+(code||"session")+".csv";
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),500);
});
