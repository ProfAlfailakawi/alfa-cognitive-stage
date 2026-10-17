// Voting store: sessions, polls, votes. Votes are keyed by a random per-device
// token (not an identity). State is saved to a JSON file so a restart keeps results.
import { randomBytes, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const MAX_OPTIONS = 6;
const MAX_TEXT = 200;
const MAX_VOTERS = 1000;
const MAX_PENDING_QUESTIONS = 100;
const OPEN_QUESTION_LIMIT = 280;
const QUESTION_COOLDOWN_MS = 30000;

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
      createdAt: s.createdAt,
    }]));
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, file);
  }

  if (file && existsSync(file)) {
    const data = JSON.parse(readFileSync(file, "utf8"));
    for (const [code, s] of Object.entries(data)) {
      const questions = Array.isArray(s.questions) ? s.questions.filter(q => q &&
        Number.isInteger(q.id) && typeof q.text === "string").slice(-MAX_PENDING_QUESTIONS) : [];
      sessions.set(code, { polls: s.polls, nextId: s.nextId, lastVoteAt: new Map(),
        createdAt: Number.isFinite(s.createdAt) ? s.createdAt : Date.now(), // legacy sessions start their retention clock now
        questions, nextQuestionId: Math.max(1, Number(s.nextQuestionId) || 1,
          ...questions.map(q => q.id + 1)), lastQuestionAt: new Map() });
    }
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
    sessions.set(code, { polls: [], nextId: 1, lastVoteAt: new Map(), createdAt: Date.now(),
      questions: [], nextQuestionId: 1, lastQuestionAt: new Map() });
    persist();
    return code;
  }

  function createPoll(code, { question, options, allowChange = false }) {
    const q = clean(question, MAX_TEXT);
    const opts = (Array.isArray(options) ? options : [])
      .map((o) => clean(o, MAX_TEXT)).filter(Boolean);
    if (!q) throw new VoteError("نص السؤال مطلوب");
    if (opts.length < 2 || opts.length > MAX_OPTIONS) throw new VoteError(`عدد الخيارات بين 2 و${MAX_OPTIONS}`);
    const s = session(code);
    const p = {
      id: s.nextId++, question: q, options: opts, allowChange: Boolean(allowChange),
      status: "draft", reveal: false, votes: {},
    };
    s.polls.push(p);
    persist();
    return p;
  }

  function repeatPoll(code, id) {
    const prior = poll(code, id);
    const fresh = createPoll(code, {
      question: prior.question, options: prior.options, allowChange: prior.allowChange,
    });
    setStatus(code, fresh.id, "open");
    return fresh; // New ID / votes; previous results remain independently available.
  }

  function setStatus(code, id, status) {
    const p = poll(code, id);
    if (status === "open") {
      // Only one question is open at a time, so students always see the active one.
      for (const other of session(code).polls) if (other.status === "open") other.status = "closed";
    }
    p.status = status;
    if (status === "closed") p.closedAt = Date.now();
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
    if (Array.isArray(p.archive)) return p.archive.slice(); // device tokens already dropped
    const c = p.options.map(() => 0);
    for (const v of Object.values(p.votes)) c[v] += 1;
    return c;
  }
  const total = (p) => counts(p).reduce((a, b) => a + b, 0);

  // What a student may see: the open question and only their own answer.
  function studentState(code, token) {
    const s = session(code);
    const p = s.polls.find((x) => x.status === "open");
    if (!p) return { active: null };
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
        id: p.id, question: p.question, options: p.options, status: p.status,
        reveal: p.reveal, allowChange: p.allowChange, total: total(p), counts: counts(p),
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
    if (s.questions.length >= MAX_PENDING_QUESTIONS) {
      throw new VoteError("قائمة الأسئلة ممتلئة؛ راجع المحاضر", 429);
    }
    const now = Date.now();
    if (now - (s.lastQuestionAt.get(token) || 0) < QUESTION_COOLDOWN_MS) {
      throw new VoteError("يمكن إرسال سؤال آخر بعد 30 ثانية", 429);
    }
    s.lastQuestionAt.set(token, now);
    const item = { id: s.nextQuestionId++, text: message, createdAt: now };
    s.questions.push(item);
    persist();
    return { id: item.id };
  }

  function listQuestions(code) {
    return session(code).questions.slice().reverse().map(({ id, text, createdAt }) => ({
      id, text, createdAt
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

  return { createSession, createPoll, repeatPoll, setStatus, setReveal, vote,
    studentState, presenterState, submitQuestion, listQuestions, dismissQuestion, hasSession,
    maintain, deleteSession, deleteAll, summary };
}
