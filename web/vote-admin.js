import { compareRounds, exportAggregateCsv, summarizePollDistribution } from "./poll-analytics.js";
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
    active: active ? { question: active.question, options: active.options,
      counts: active.counts, reveal: active.reveal } : null
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
  $("polls").innerHTML = state.polls.map((p) => {
    const total = p.total || 0;
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
      ${insight ? `<p class="meta poll-insight">${esc(insight.text)}</p>` : ""}
      <div class="actions">
        ${p.status !== "open" ? `<button data-act="open" data-id="${p.id}" class="primary">فتح</button>` : `<button data-act="close" data-id="${p.id}">إغلاق</button>`}
        ${p.reveal ? `<button data-act="hide" data-id="${p.id}">إخفاء النتائج</button>` : `<button data-act="reveal" data-id="${p.id}">إظهار النتائج</button>`}
        <button data-act="repeat" data-id="${p.id}">جولة جديدة (نتائج منفصلة)</button>
      </div>
    </div>`;
  }).join("") || `<p class="meta">لا توجد أسئلة بعد.</p>`;
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

async function refreshOpenQuestions() {
  if (!code || !$("student-questions-drawer")?.open) return;
  const inbox = $("student-questions");
  try {
    const { questions } = await call("GET", "/sessions/" + code + "/questions");
    inbox.replaceChildren();
    if (!questions?.length) {
      const empty = document.createElement("p");
      empty.className = "meta";
      empty.textContent = "لا توجد أسئلة مفتوحة حالياً.";
      inbox.append(empty);
      return;
    }
    for (const item of questions) {
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
      row.append(question, button);
      inbox.append(row);
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
$("add-poll").addEventListener("click", async () => {
  const options = $("q-opts").value.split("\n").map((s) => s.trim()).filter(Boolean);
  try {
    await call("POST", `/sessions/${code}/polls`, {
      question: $("q-text").value, options, allowChange: $("q-change").checked,
    });
    $("q-text").value = "";
    $("q-opts").value = "";
    $("poll-msg").textContent = "تمت إضافة السؤال.";
    await refresh();
  } catch (err) {
    $("poll-msg").textContent = err.message;
  }
});

if (adminToken) {
  $("token").value = adminToken;
  enter();
}

window.addEventListener("message", (event) => {
  if (event.origin !== location.origin || event.source !== window.parent) return;
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
