// Voting store: sessions, polls, votes. Votes are keyed by a random per-device
// token (not an identity). State is saved to a JSON file so a restart keeps results.
import { randomBytes, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { moderate, wordKey } from "../web/moderation.js";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const MAX_OPTIONS = 6;
const MAX_TEXT = 200;
const MAX_VOTERS = 1000;
const MAX_PENDING_QUESTIONS = 100;
const OPEN_QUESTION_LIMIT = 280;
const QUESTION_COOLDOWN_MS = 30000;
const MAX_WORDS_PER_DEVICE = 3;
const MAX_DISTINCT_WORDS = 200;
const PULSE_COOLDOWN_MS = 3000;
const PULSE_WINDOW_MS = 120000;
const MAX_PULSE_SLIDES = 600;
const MAX_REVIEW_ITEMS = 40;
const LECTURE_ID = /^[a-f0-9]{12}$/;

export class VoteError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const clean = (value, max) => String(value ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

export function createVoteStore({ file = null } = {}) {
  const sessions = new Map(); // code -> { polls: [], nextId, lastVoteAt: Map }

  function persist() {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    const data = Object.fromEntries([...sessions].map(([code, s]) => [code, {
      polls: s.polls, nextId: s.nextId, questions: s.questions, nextQuestionId: s.nextQuestionId,
      createdAt: s.createdAt, label: s.label || "",
      pulseSlides: s.pulseSlides, questionSlides: s.questionSlides, review: s.review || null,
    }]));
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, file);
  }

  let loaded = null;
  if (file && existsSync(file)) {
    try { loaded = JSON.parse(readFileSync(file, "utf8")); if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) throw new Error("shape"); }
    catch {
      // A damaged file must neither crash the lecture nor be silently overwritten: keep it aside and start clean.
      try { renameSync(file, file + ".damaged-" + Date.now()); } catch {}
      loaded = null;
    }
  }
  if (loaded) {
    const data = loaded;
    for (const [code, s] of Object.entries(data)) {
      if (!/^[A-Z2-9]{6}$/.test(code) || !s || !Array.isArray(s.polls) || !Number.isInteger(s.nextId)) continue; // never trust the file
      const questions = Array.isArray(s.questions) ? s.questions.filter(q => q &&
        Number.isInteger(q.id) && typeof q.text === "string").slice(-MAX_PENDING_QUESTIONS) : [];
      sessions.set(code, { polls: s.polls, nextId: s.nextId, lastVoteAt: new Map(),
        createdAt: Number.isFinite(s.createdAt) ? s.createdAt : Date.now(), // legacy sessions start their retention clock now
        label: typeof s.label === "string" ? s.label.slice(0, 60) : "", wordDevices: new Map(),
        ...pulseFields(s),
        questions, nextQuestionId: Math.max(1, Number(s.nextQuestionId) || 1,
          ...questions.map(q => q.id + 1)), lastQuestionAt: new Map() });
    }
  }

  // Pulse and review state. Only aggregate counts reach the disk; device tokens live in memory.
  function slideKey(c) { return `${c.lecture}#${c.slide}`; }
  function countMap(value) {
    const out = {};
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value).slice(0, MAX_PULSE_SLIDES)) {
        if (/^[a-f0-9]{12}#\d{1,4}$/.test(k) && v && typeof v === "object") {
          const got = Number.isSafeInteger(v.got) && v.got > 0 ? v.got : 0, lost = Number.isSafeInteger(v.lost) && v.lost > 0 ? v.lost : 0;
          out[k] = { got, lost };
        }
      }
    }
    return out;
  }
  function countOnly(value) {
    const out = {};
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value).slice(0, MAX_PULSE_SLIDES)) if (/^[a-f0-9]{12}#\d{1,4}$/.test(k) && Number.isSafeInteger(v) && v > 0) out[k] = v;
    }
    return out;
  }
  function pulseFields(s) {
    return { pulseSlides: countMap(s.pulseSlides), questionSlides: countOnly(s.questionSlides), review: validReview(s.review),
      context: null, pulseDevices: new Map(), pulseRecent: [], lastPulseAt: new Map() };
  }
  function validReview(r) {
    if (!r || typeof r !== "object" || !Array.isArray(r.items)) return null;
    return { title: clean(r.title, 120), publishedAt: Number.isFinite(r.publishedAt) ? r.publishedAt : Date.now(),
      items: r.items.slice(0, MAX_REVIEW_ITEMS).map((i) => ({ slide: Number.isInteger(i?.slide) && i.slide > 0 ? i.slide : 0,
        heading: clean(i?.heading, 120), lines: (Array.isArray(i?.lines) ? i.lines : []).slice(0, 4).map((l) => clean(l, 140)).filter(Boolean) }))
        .filter((i) => i.heading || i.lines.length) };
  }

  function session(code) {
    const s = sessions.get(code);
    if (!s) throw new VoteError("الجلسة غير موجودة", 404);
    return s;
  }

  function poll(code, id) {
    const p = session(code).polls.find((x) => x.id === id);
    if (!p) throw new VoteError("السؤال غير موجود", 404);
    return p;
  }

  function createSession() {
    let code;
    do {
      code = Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
    } while (sessions.has(code));
    sessions.set(code, { polls: [], nextId: 1, lastVoteAt: new Map(), createdAt: Date.now(), label: "", wordDevices: new Map(),
      ...pulseFields({}), questions: [], nextQuestionId: 1, lastQuestionAt: new Map() });
    persist();
    return code;
  }

  function createPoll(code, { question, options, allowChange = false, kind = "choice", objective = "", beforeAfter = false, correctIndex = null }) {
    const q = clean(question, MAX_TEXT);
    if (!q) throw new VoteError("نص السؤال مطلوب");
    const words = kind === "words";
    if (kind !== "choice" && !words) throw new VoteError("نوع السؤال غير معروف");
    const opts = words ? [] : (Array.isArray(options) ? options : []).map((o) => clean(o, MAX_TEXT)).filter(Boolean);
    if (!words && (opts.length < 2 || opts.length > MAX_OPTIONS)) throw new VoteError(`عدد الخيارات بين 2 و${MAX_OPTIONS}`);
    if (correctIndex !== null && (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= opts.length)) throw new VoteError("رقم الإجابة الصحيحة غير صالح");
    if (words && beforeAfter) throw new VoteError("المقارنة القبلية/البعدية لا تدعم سحابة الكلمات");
    const s = session(code);
    const p = {
      id: s.nextId++, question: q, options: opts, allowChange: Boolean(allowChange), createdAt: Date.now(),
      status: "draft", reveal: false, votes: {}, kind: words ? "words" : "choice",
      objective: clean(objective, 150), // an explicit learning objective typed by the lecturer, never inferred
      ...(beforeAfter ? { pulsePair: s.nextId - 1, pulsePhase: "before", correctIndex } : {}),
      ...(words ? { words: {}, hidden: [] } : {}),
    };
    s.polls.push(p);
    persist();
    return p;
  }

  function repeatBeforeAfterPoll(code, id) {
    const prior = poll(code, id);
    const s = session(code);
    if (prior.kind !== "choice" || prior.pulsePhase !== "before" || prior.status !== "closed")
      throw new VoteError("أغلق الجولة القبلية أولاً", 409);
    if (s.polls.some((p) => p.status === "open")) throw new VoteError("أغلق السؤال النشط أولاً", 409);
    if (s.polls.some((p) => p.pulsePair === prior.id && p.pulsePhase === "after"))
      throw new VoteError("الجولة البعدية موجودة بالفعل", 409);
    const fresh = createPoll(code, { question: prior.question, options: [...prior.options],
      allowChange: prior.allowChange, objective: prior.objective });
    fresh.pulsePair = prior.id;
    fresh.pulsePhase = "after";
    fresh.correctIndex = prior.correctIndex ?? null;
    setStatus(code, fresh.id, "open");
    return fresh;
  }

  function repeatPoll(code, id) {
    const prior = poll(code, id);
    const fresh = createPoll(code, {
      question: prior.question, options: prior.options, allowChange: prior.allowChange,
      kind: prior.kind || "choice", objective: prior.objective || "",
    });
    setStatus(code, fresh.id, "open");
    return fresh; // New ID / votes; previous results remain independently available.
  }

  function setStatus(code, id, status) {
    const p = poll(code, id);
    // Keep linked pulse data aggregate-only once the round closes: no cross-round device tokens.
    const seal = (item) => {
      if (item.pulsePhase && !Array.isArray(item.archive)) {
        item.archive = counts(item);
        item.votes = {};
      }
      item.status = "closed";
      item.closedAt = Date.now();
    };
    if (status === "open") {
      if (p.pulsePhase && Array.isArray(p.archive)) throw new VoteError("لا يمكن إعادة فتح جولة قياس مؤرشفة", 409);
      // Only one question is open at a time, so students always see the active one.
      for (const other of session(code).polls) if (other.status === "open" && other !== p) seal(other);
    }
    if (status === "closed") seal(p);
    else {
      p.status = status;
      if (status === "open") p.openedAt = Date.now();
    }
    persist();
    return p;
  }

  function setReveal(code, id, reveal) {
    const p = poll(code, id);
    p.reveal = Boolean(reveal);
    persist();
    return p;
  }

  function vote(code, token, optionIndex) {
    const s = session(code);
    if (typeof token !== "string" || !/^[a-f0-9]{24,64}$/.test(token)) throw new VoteError("رمز الجهاز غير صالح");
    const p = s.polls.find((x) => x.status === "open");
    if (!p) throw new VoteError("لا يوجد سؤال مفتوح الآن", 409);
    if (p.kind === "words") throw new VoteError("هذا السؤال يقبل كلمات لا اختياراً", 409);
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= p.options.length) {
      throw new VoteError("اختيار غير صالح");
    }
    const already = Object.prototype.hasOwnProperty.call(p.votes, token);
    if (already && !p.allowChange) throw new VoteError("تم تسجيل إجابتك مسبقاً", 409);
    if (!already && Object.keys(p.votes).length >= MAX_VOTERS) throw new VoteError("وصل التصويت إلى الحد الأقصى", 429);
    const last = s.lastVoteAt.get(token) || 0;
    if (Date.now() - last < 500) throw new VoteError("انتظر لحظة ثم أعد المحاولة", 429);
    s.lastVoteAt.set(token, Date.now());
    p.votes[token] = optionIndex;
    persist();
    return { pollId: p.id, option: optionIndex };
  }

  function counts(p) {
    if (p.kind === "words") return [];
    if (Array.isArray(p.archive)) return p.archive.slice(); // device tokens already dropped
    const c = p.options.map(() => 0);
    for (const v of Object.values(p.votes)) c[v] += 1;
    return c;
  }
  const total = (p) => (p.kind === "words" ? wordTotal(p) : counts(p).reduce((a, b) => a + b, 0));
  const wordTotal = (p) => Object.values(p.words || {}).reduce((a, w) => a + w.count, 0);
  const allWords = (p) => Object.entries(p.words || {}).map(([key, w]) => ({ key, word: w.word, count: w.count, hidden: p.hidden.includes(key) }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, "ar"));
  const visibleWords = (p) => allWords(p).filter((w) => !w.hidden).map(({ word, count }) => ({ word, count }));

  // What a student may see: the open question and only their own answer.
  function studentState(code, token) {
    const s = session(code);
    const p = s.polls.find((x) => x.status === "open");
    if (!p) return { active: null };
    if (p.kind === "words") {
      const submitted = s.wordDevices.get(p.id + ":" + token) || 0;
      const payload = { pollId: p.id, kind: "words", question: p.question, maxWords: MAX_WORDS_PER_DEVICE,
        remaining: Math.max(0, MAX_WORDS_PER_DEVICE - submitted) };
      if (p.reveal) payload.words = visibleWords(p).slice(0, 40);
      return { active: payload };
    }
    const mine = Object.prototype.hasOwnProperty.call(p.votes, token) ? p.votes[token] : null;
    const payload = { pollId: p.id, question: p.question, options: p.options, answered: mine !== null, mine, allowChange: p.allowChange };
    if (p.reveal) payload.counts = counts(p);
    return { active: payload };
  }

  // What the lecturer sees: every poll with counts.
  function presenterState(code) {
    const s = session(code);
    return {
      code,
      polls: s.polls.map((p) => ({
        id: p.id, question: p.question, options: p.options, status: p.status, kind: p.kind || "choice",
        objective: p.objective || "",
        pulsePair: p.pulsePair ?? null, pulsePhase: p.pulsePhase || null, correctIndex: p.correctIndex ?? null,
        createdAt: p.createdAt || null, openedAt: p.openedAt || null, closedAt: p.closedAt || null,
        reveal: p.reveal, allowChange: p.allowChange, total: total(p), counts: counts(p),
        ...(p.kind === "words" ? { words: allWords(p), submissions: wordTotal(p) } : {}),
      })),
    };
  }

  // Students can submit plain text, but only the authenticated lecturer can read it.
  // No identity, phone token or IP is persisted with the question.
  function submitQuestion(code, token, text) {
    const s = session(code);
    if (typeof token !== "string" || !/^[a-f0-9]{24,64}$/.test(token)) {
      throw new VoteError("رمز الجهاز غير صالح");
    }
    if (typeof text !== "string" || text.length > OPEN_QUESTION_LIMIT) {
      throw new VoteError("السؤال طويل جداً؛ الحد 280 حرفاً");
    }
    const message = clean(text, OPEN_QUESTION_LIMIT);
    if (message.length < 3) throw new VoteError("اكتب سؤالاً قصيراً وواضحاً");
    const screening = moderate(message);
    // Personal data is refused outright to protect the student; other flags only hide it for review.
    if (screening.privacy) throw new VoteError("لا تكتب أرقام هواتف أو أرقاماً مدنية أو بريداً أو روابط في السؤال", 422);
    if (s.questions.length >= MAX_PENDING_QUESTIONS) {
      throw new VoteError("قائمة الأسئلة ممتلئة؛ راجع المحاضر", 429);
    }
    const now = Date.now();
    if (now - (s.lastQuestionAt.get(token) || 0) < QUESTION_COOLDOWN_MS) {
      throw new VoteError("يمكن إرسال سؤال آخر بعد 30 ثانية", 429);
    }
    s.lastQuestionAt.set(token, now);
    const slide = s.context ? slideKey(s.context) : null;
    const item = { id: s.nextQuestionId++, text: message, createdAt: now, flagged: !screening.ok, ...(slide ? { slide } : {}) };
    s.questions.push(item);
    if (slide && screening.ok) s.questionSlides[slide] = (s.questionSlides[slide] || 0) + 1;
    persist();
    return { id: item.id };
  }

  function listQuestions(code) {
    return session(code).questions.slice().reverse().map(({ id, text, createdAt, flagged, slide }) => ({
      id, text, createdAt, flagged: Boolean(flagged), ...(slide ? { slide } : {})
    }));
  }

  function dismissQuestion(code, id) {
    const s = session(code);
    if (!Number.isInteger(id) || id < 1 || !s.questions.some(q => q.id === id)) {
      throw new VoteError("السؤال غير موجود", 404);
    }
    s.questions = s.questions.filter(q => q.id !== id);
    persist();
    return { ok: true };
  }

  function hasSession(code) {
    return sessions.has(code);
  }

  // Word cloud: students send up to three single words; only aggregate counts are kept.
  function submitWords(code, token, input) {
    const s = session(code);
    if (typeof token !== "string" || !/^[a-f0-9]{24,64}$/.test(token)) throw new VoteError("رمز الجهاز غير صالح");
    const p = s.polls.find((x) => x.status === "open");
    if (!p || p.kind !== "words") throw new VoteError("لا يوجد سؤال كلمات مفتوح الآن", 409);
    const list = (Array.isArray(input) ? input : []).slice(0, MAX_WORDS_PER_DEVICE);
    if (!list.length) throw new VoteError("اكتب كلمة واحدة على الأقل");
    const key = p.id + ":" + token;
    const used = s.wordDevices.get(key) || 0;
    if (used + list.length > MAX_WORDS_PER_DEVICE) throw new VoteError("بلغت الحد الأقصى من الكلمات (3)", 409);
    let accepted = 0, rejected = 0;
    for (const entry of list) {
      const display = clean(entry, 24);
      const k = wordKey(display);
      if (!k || !moderate(display).ok) { rejected++; continue; }
      // Own keys only: an English word such as "constructor" must count, not reach Object.prototype.
      const known = Object.hasOwn(p.words, k);
      if (!known && Object.keys(p.words).length >= MAX_DISTINCT_WORDS) { rejected++; continue; }
      if (!known) p.words[k] = { word: display, count: 0 };
      p.words[k].count++;
      accepted++;
    }
    s.wordDevices.set(key, used + list.length);
    persist();
    return { accepted, rejected };
  }
  function hideWord(code, id, key, hidden = true) {
    const p = poll(code, id);
    if (p.kind !== "words" || typeof key !== "string" || !Object.hasOwn(p.words, key)) throw new VoteError("الكلمة غير موجودة", 404);
    p.hidden = hidden ? [...new Set([...p.hidden, key])] : p.hidden.filter((k) => k !== key);
    persist();
    return { ok: true };
  }
  function setLabel(code, label) {
    session(code).label = clean(label, 60);
    persist();
    return { label: session(code).label };
  }
  function listSessions() {
    return [...sessions].map(([code, s]) => ({ code, label: s.label || "", createdAt: s.createdAt,
      polls: s.polls.length })).sort((a, b) => b.createdAt - a.createdAt);
  }

  // ---- Understanding pulse: two anonymous buttons on the phone, attributed to the slide the lecturer is on ----
  function setContext(code, { lecture, slide }) {
    const s = session(code);
    if (!LECTURE_ID.test(String(lecture)) || !Number.isInteger(slide) || slide < 1 || slide > 9999) throw new VoteError("سياق الشريحة غير صالح");
    s.context = { lecture, slide, since: Date.now() };
    return { ok: true };
  }
  function sendPulse(code, token, state) {
    const s = session(code);
    if (typeof token !== "string" || !/^[a-f0-9]{24,64}$/.test(token)) throw new VoteError("رمز الجهاز غير صالح");
    if (state !== "got" && state !== "lost") throw new VoteError("إشارة غير معروفة");
    if (!s.context) throw new VoteError("المحاضرة لم تبدأ بعد", 409);
    const now = Date.now();
    if (now - (s.lastPulseAt.get(token) || 0) < PULSE_COOLDOWN_MS) throw new VoteError("انتظر لحظة قبل إشارة جديدة", 429);
    s.lastPulseAt.set(token, now);
    const key = slideKey(s.context);
    if (!s.pulseSlides[key] && Object.keys(s.pulseSlides).length >= MAX_PULSE_SLIDES) throw new VoteError("امتلأ سجل الشرائح", 429);
    // One standing answer per device per slide: changing your mind moves your signal, it never doubles it.
    const mapKey = key + ":" + token;
    const before = s.pulseDevices.get(mapKey);
    const row = (s.pulseSlides[key] ||= { got: 0, lost: 0 });
    if (before === state) return { ok: true, state };
    if (before) row[before] = Math.max(0, row[before] - 1);
    row[state] += 1;
    s.pulseDevices.set(mapKey, state);
    s.pulseRecent = s.pulseRecent.filter((x) => now - x.at < PULSE_WINDOW_MS && !(x.token === token && x.key === key));
    s.pulseRecent.push({ at: now, token, key, state });
    persist();
    return { ok: true, state };
  }
  const MIN_PULSE_DEVICES = 3; // below this, a share could point at a person: show nothing but the count of signals
  const HOT_PULSE_DEVICES = 5, HOT_LOST_SHARE = 0.4; // lecturer-facing alert thresholds (design choices, not measured norms)
  function pulseLive(code) {
    const s = session(code);
    const now = Date.now();
    s.pulseRecent = s.pulseRecent.filter((x) => now - x.at < PULSE_WINDOW_MS);
    const key = s.context ? slideKey(s.context) : null;
    const rows = key ? s.pulseRecent.filter((x) => x.key === key) : [];
    const lost = rows.filter((x) => x.state === "lost").length;
    const out = { slide: s.context?.slide ?? null, devices: rows.length, windowSeconds: PULSE_WINDOW_MS / 1000, hidden: rows.length < MIN_PULSE_DEVICES };
    if (!out.hidden) {
      out.lost = lost; out.got = rows.length - lost; out.lostShare = Number((lost / rows.length).toFixed(2));
      out.level = rows.length >= HOT_PULSE_DEVICES && lost / rows.length >= HOT_LOST_SHARE ? "watch" : "calm";
    }
    return out;
  }
  function pulseReport(code) {
    const s = session(code);
    const keys = new Set([...Object.keys(s.pulseSlides), ...Object.keys(s.questionSlides)]);
    return [...keys].map((k) => { const [lecture, slide] = k.split("#"); const p = s.pulseSlides[k] || { got: 0, lost: 0 };
      return { lecture, slide: Number(slide), got: p.got, lost: p.lost, questions: s.questionSlides[k] || 0 }; })
      .sort((a, b) => a.lecture.localeCompare(b.lecture) || a.slide - b.slide);
  }
  /** Per-session slide aggregates for one lecture (counts only), newest session first. */
  function lectureHistory(lecture) {
    if (!LECTURE_ID.test(String(lecture))) throw new VoteError("معرّف المحاضرة غير صالح");
    return [...sessions].map(([code, s]) => ({ code, label: s.label || "", createdAt: s.createdAt,
      slides: pulseReport(code).filter((r) => r.lecture === lecture).map(({ slide, got, lost, questions }) => ({ slide, got, lost, questions })) }))
      .filter((x) => x.slides.length).sort((a, b) => b.createdAt - a.createdAt);
  }

  // ---- Student review page: published by the lecturer, built from the scenes the lecturer actually showed ----
  function publishReview(code, input) {
    const review = validReview({ ...input, publishedAt: Date.now() });
    if (!review || !review.items.length) throw new VoteError("لا توجد عناصر للمراجعة");
    session(code).review = review;
    persist();
    return { ok: true, items: review.items.length };
  }
  function unpublishReview(code) { session(code).review = null; persist(); return { ok: true }; }
  function studentReview(code) {
    const r = session(code).review;
    if (!r) throw new VoteError("لم تُنشر مراجعة لهذه الجلسة", 404);
    return r;
  }
  function keepQuestion(code, id) {
    const q = session(code).questions.find((x) => x.id === id);
    if (!q) throw new VoteError("السؤال غير موجود", 404);
    if (q.flagged) throw new VoteError("لا يُحفظ سؤال مُعلَّم للمراجعة", 422);
    return { text: q.text, slide: q.slide || null };
  }

  // Privacy maintenance. Device tokens exist only to stop double voting while a poll is open:
  // once a poll has been closed for a while they are dropped and only the counts remain.
  function maintain({ now = Date.now(), tokenHours = 24, retentionDays = 180 } = {}) {
    let anonymized = 0, purged = 0;
    const tokenAge = Math.max(0, tokenHours) * 3600 * 1000, keepFor = Math.max(1, retentionDays) * 86400 * 1000;
    for (const [code, s] of [...sessions]) {
      if (now - s.createdAt > keepFor) { sessions.delete(code); purged++; continue; }
      for (const p of s.polls) {
        const closedFor = p.status === "closed" && Number.isFinite(p.closedAt) ? now - p.closedAt : -1;
        if (!p.archive && p.status === "closed" && (closedFor >= tokenAge || !Number.isFinite(p.closedAt) && now - s.createdAt >= tokenAge)) {
          p.archive = counts(p); p.votes = {}; anonymized++;
        }
      }
    }
    if (anonymized || purged) persist();
    return { anonymized, purged };
  }
  function deleteSession(code) {
    session(code); sessions.delete(code); persist(); return { ok: true };
  }
  function deleteAll() {
    const removed = sessions.size; sessions.clear(); persist(); return { removed };
  }
  function summary() {
    let polls = 0, questions = 0, tokens = 0;
    for (const s of sessions.values()) {
      polls += s.polls.length; questions += s.questions.length;
      for (const p of s.polls) tokens += Object.keys(p.votes).length;
    }
    return { sessions: sessions.size, polls, pendingQuestions: questions, storedDeviceTokens: tokens };
  }

  return { createSession, createPoll, repeatPoll, repeatBeforeAfterPoll, setStatus, setReveal, vote,
    studentState, presenterState, submitQuestion, listQuestions, dismissQuestion, hasSession,
    maintain, deleteSession, deleteAll, summary, submitWords, hideWord, setLabel, listSessions,
    setContext, sendPulse, pulseLive, pulseReport, lectureHistory, publishReview, unpublishReview, studentReview, keepQuestion };
}
