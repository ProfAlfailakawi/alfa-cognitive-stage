// Voting store: sessions, polls, votes. Votes are keyed by a random per-device
// token (not an identity). State is saved to a JSON file so a restart keeps results.
import { randomBytes, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const MAX_OPTIONS = 6;
const MAX_TEXT = 200;
const MAX_VOTERS = 1000;

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
      polls: s.polls, nextId: s.nextId,
    }]));
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, file);
  }

  if (file && existsSync(file)) {
    const data = JSON.parse(readFileSync(file, "utf8"));
    for (const [code, s] of Object.entries(data)) {
      sessions.set(code, { polls: s.polls, nextId: s.nextId, lastVoteAt: new Map() });
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
    sessions.set(code, { polls: [], nextId: 1, lastVoteAt: new Map() });
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
    const c = p.options.map(() => 0);
    for (const v of Object.values(p.votes)) c[v] += 1;
    return c;
  }

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
        reveal: p.reveal, allowChange: p.allowChange, total: Object.keys(p.votes).length, counts: counts(p),
      })),
    };
  }

  function hasSession(code) {
    return sessions.has(code);
  }

  return { createSession, createPoll, repeatPoll, setStatus, setReveal, vote, studentState, presenterState, hasSession };
}
