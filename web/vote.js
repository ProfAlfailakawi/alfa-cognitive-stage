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
let wordMessage = ""; // survives the re-render that follows a submission

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

// Word cloud: up to three single words; the lecturer reviews what appears.
function renderWords(active) {
  const heading = document.createElement("h1");
  heading.className = "q"; heading.textContent = active.question;
  const note = document.createElement("p");
  note.className = "status"; note.id = "note";
  const box = document.createElement("div");
  box.className = "result"; box.id = "options";
  if (active.remaining > 0) {
    note.textContent = wordMessage || "اكتب كلمة واحدة في كل خانة (حتى " + active.remaining + ").";
    const form = document.createElement("form");
    form.id = "word-form"; form.style.display = "grid"; form.style.gap = ".5rem";
    for (let i = 0; i < active.remaining; i++) {
      const input = document.createElement("input");
      input.type = "text"; input.maxLength = 24; input.autocomplete = "off"; input.className = "word-input";
      input.setAttribute("aria-label", "الكلمة " + (i + 1));
      input.style.cssText = "font:inherit;padding:.7rem;border-radius:12px;border:1px solid var(--hair)";
      form.append(input);
    }
    const send = document.createElement("button");
    send.type = "submit"; send.className = "primary opt"; send.textContent = "إرسال";
    form.append(send);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (submitting) return;
      const words = [...form.querySelectorAll("input")].map((x) => x.value.trim()).filter(Boolean);
      if (!words.length) { note.textContent = "اكتب كلمة واحدة على الأقل."; return; }
      submitting = true;
      try {
        const result = await api("/words", { method: "POST", body: JSON.stringify({ words }) });
        wordMessage = result.rejected ? "وصلت " + result.accepted + " كلمة؛ لم تُقبل " + result.rejected + " (ممنوع الأرقام والروابط والإساءة)." : "";
        note.textContent = wordMessage || "شكراً، وصلت كلماتك.";
        await refresh(true);
      } catch (err) { note.textContent = err.message; }
      finally { submitting = false; }
    });
    box.append(form);
  } else note.textContent = wordMessage || "وصلت كلماتك. انتظر السؤال التالي.";
  app.replaceChildren(heading, note, box);
  if (Array.isArray(active.words) && active.words.length) {
    const max = Math.max(...active.words.map((w) => w.count));
    const cloud = document.createElement("div");
    cloud.style.cssText = "display:flex;flex-wrap:wrap;gap:.4rem .8rem;justify-content:center;align-items:baseline;margin-top:1rem";
    for (const w of active.words) {
      const span = document.createElement("span");
      span.textContent = w.word;
      span.style.fontSize = (0.95 + 1.6 * (w.count / max)).toFixed(2) + "rem";
      cloud.append(span);
    }
    app.append(cloud);
  }
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
    const key = JSON.stringify([active.pollId, active.answered, active.mine, active.counts || null, active.remaining ?? null, active.words || null]);
    // Do not rebuild a word form while the student is typing in it.
    const typing = active.kind === "words" && document.activeElement?.classList?.contains("word-input");
    if (typing && key !== shownKey && !force) return;
    if (force || key !== shownKey || !document.getElementById("options")) {
      shownKey = key;
      if (active.kind === "words") renderWords(active); else renderPoll(active);
    }
  } catch (err) {
    if (err.status === 404) return setStatus("هذه الجلسة غير موجودة.");
    setStatus("انقطع الاتصال، سنعيد المحاولة تلقائياً…");
  }
}

const questionForm = document.getElementById("question-form");
questionForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submitting || !sessionCode) return;
  const textarea = document.getElementById("question-text");
  const button = document.getElementById("question-submit");
  const message = document.getElementById("question-message");
  const text = textarea.value.trim();
  if (text.length < 3 || text.length > 280) {
    message.textContent = "السؤال يجب أن يكون بين 3 و280 حرفاً.";
    return;
  }
  button.disabled = true;
  try {
    await api("/questions", { method: "POST", body: JSON.stringify({ text }) });
    textarea.value = "";
    message.textContent = "وصل السؤال للمحاضر للمراجعة. لا يظهر تلقائياً للطلبة.";
  } catch (err) {
    message.textContent = err.message;
  } finally {
    button.disabled = false;
  }
});

refresh();
setInterval(() => refresh(false), POLL_MS);
