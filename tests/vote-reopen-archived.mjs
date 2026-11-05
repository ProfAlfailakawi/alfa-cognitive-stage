import assert from "node:assert/strict";
import { createVoteStore } from "../server/votes.mjs";

// A closed poll that maintain() has already archived must not be reopened: votes cast afterwards
// would go to p.votes, which counts() ignores, and would be lost without any error.
const store = createVoteStore();
const code = store.createSession();
const poll = store.createPoll(code, { question: "اختبار", options: ["نعم", "لا"] });
store.setStatus(code, poll.id, "open");
store.vote(code, "a".repeat(32), 0);
store.setStatus(code, poll.id, "closed");
assert.equal(store.maintain({ now: Date.now() + 48 * 3600e3 }).anonymized, 1, "the closed poll is archived");
assert.throws(() => store.setStatus(code, poll.id, "open"), err => err.status === 409, "an archived poll cannot be reopened");
assert.equal(store.presenterState(code).polls[0].total, 1, "its archived counts are intact");

// A poll that was closed recently (not yet archived) can still be reopened and counts new votes.
const fresh = store.createPoll(code, { question: "ثانٍ", options: ["أ", "ب"] });
store.setStatus(code, fresh.id, "open");
store.vote(code, "b".repeat(32), 1);
store.setStatus(code, fresh.id, "closed");
store.setStatus(code, fresh.id, "open");
store.vote(code, "c".repeat(32), 0);
const row = store.presenterState(code).polls.find(x => x.id === fresh.id);
assert.equal(row.total, 2, "a recently closed poll still reopens and counts both votes");
console.log("vote reopen: archived polls are refused, fresh ones still reopen");
