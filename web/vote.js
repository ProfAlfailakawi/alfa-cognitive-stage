// Student voting page. No account: each device gets a random token stored locally.
const app = document.getElementById("app");
const sessionCode = new URLSearchParams(location.search).get("s") || "";
const POLL_MS = 2000;

function deviceToken() {
  const key = "alfa-voter-token";
  try {
    let token = localStorage.getItem(key);
    if (!token) {
      token = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(key, token);
    }
    return token;
  } catch {
    // Private mode or blocked storage: keep one token for this page only.
    if (!window.__alfaToken) {
      window.__alfaToken = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    return window.__alfaToken;
  }
}

const token = deviceToken();
let shownKey = null;
let submitting = false;

async function api(path, options = {}) {
  const res = await fetch(`/api/sessions/${sessionCode}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", "X-Voter-Token": token, ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || "تعذّر الاتصال"), { status: res.status });
  return body;
}

function setStatus(text) {
  app.innerHTML = `<p class="status">${text}</p>`;
}

function renderPoll(active) {
  const counts = active.counts || null;
  const total = counts ? counts.reduce((a, b) => a + b, 0) : 0;
  const options = active.options.map((text, i) => {
    const mine = active.mine === i;
    if (counts) {
      const pct = total ? Math.round((counts[i] / total) * 100) : 0;
      return `<div class="row"><div>${escapeText(text)}${mine ? " ✓" : ""} — ${pct}%</div>
        <div class="bar"><span style="width:${pct}%"></span></div></div>`;
    }
    const disabled = active.answered && !active.allowChange ? "disabled" : "";
    return `<button class="opt${mine ? " selected" : ""}" data-i="${i}" ${disabled}>${escapeText(text)}</button>`;
  }).join("");
  const note = active.answered
    ? (active.allowChange ? "يمكنك تغيير إجابتك حتى يُغلق السؤال." : "تم تسجيل إجابتك. انتظر السؤال التالي.")
    : "اختر إجابتك:";
  app.innerHTML = `
    <h1 class="q">${escapeText(active.question)}</h1>
    <p class="status" id="note">${note}</p>
    <div class="result" id="options">${options}</div>`;
  app.querySelectorAll("button.opt").forEach((btn) => {
    btn.addEventListener("click", () => submit(Number(btn.dataset.i)));
  });
}

function escapeText(value) {
  const node = document.createElement("span");
  node.textContent = String(value);
  return node.innerHTML;
}

async function submit(option) {
  if (submitting) return;
  submitting = true;
  try {
    await api("/vote", { method: "POST", body: JSON.stringify({ option }) });
    await refresh(true);
  } catch (err) {
    const note = document.getElementById("note");
    if (note) note.textContent = err.message;
  } finally {
    submitting = false;
  }
}

async function refresh(force = false) {
  if (!sessionCode) return setStatus("الرابط غير مكتمل. امسح رمز QR من الشاشة.");
  try {
    const { active } = await api("/state");
    if (!active) {
      shownKey = null;
      return setStatus("انتظر السؤال التالي…");
    }
    // Re-render whenever something the student sees changes: new question, answer, or results.
    const key = JSON.stringify([active.pollId, active.answered, active.mine, active.counts || null]);
    if (force || key !== shownKey || !document.getElementById("options")) {
      shownKey = key;
      renderPoll(active);
    }
  } catch (err) {
    if (err.status === 404) return setStatus("هذه الجلسة غير موجودة.");
    setStatus("انقطع الاتصال، سنعيد المحاولة تلقائياً…");
  }
}

refresh();
setInterval(() => refresh(false), POLL_MS);
