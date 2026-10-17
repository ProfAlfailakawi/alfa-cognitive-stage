import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVoteStore } from "../server/votes.mjs";

const dir = mkdtempSync(join(tmpdir(), "alfa-votes-privacy-"));
const file = join(dir, "votes.json");
const realNow = Date.now;
try {
  let t = 1_900_000_000_000;
  Date.now = () => t;
  const store = createVoteStore({ file });
  const code = store.createSession();
  const poll = store.createPoll(code, { question: "ما رأيك؟", options: ["أ", "ب"] });
  store.setStatus(code, poll.id, "open");
  const tokens = ["a".repeat(32), "b".repeat(32), "c".repeat(32)];
  store.vote(code, tokens[0], 0); t += 600; store.vote(code, tokens[1], 1); t += 600; store.vote(code, tokens[2], 1);
  assert.equal(store.summary().storedDeviceTokens, 3);
  // While the poll is open, tokens are needed to block double voting.
  assert.equal(store.maintain({ now: t + 48 * 3600e3 }).anonymized, 0, "open polls are never compacted");
  assert.throws(() => store.vote(code, tokens[0], 1), (e) => e.status === 409);
  store.setStatus(code, poll.id, "closed");
  assert.equal(store.maintain({ now: t + 3600e3 }).anonymized, 0, "recently closed polls keep tokens for corrections");
  const later = t + 25 * 3600e3;
  assert.equal(store.maintain({ now: later }).anonymized, 1);
  const state = store.presenterState(code).polls[0];
  assert.deepEqual([state.counts, state.total], [[1, 2], 3], "results survive anonymisation");
  assert.equal(store.summary().storedDeviceTokens, 0);
  const onDisk = readFileSync(file, "utf8");
  for (const token of tokens) assert.ok(!onDisk.includes(token), "device tokens are gone from the file");
  assert.equal(store.maintain({ now: later }).anonymized, 0, "idempotent");
  // Repeating a closed question still works and starts clean.
  const again = store.repeatPoll(code, poll.id);
  assert.equal(store.presenterState(code).polls.find((p) => p.id === again.id).total, 0);
  // Reloading from disk keeps archived counts.
  const reloaded = createVoteStore({ file });
  assert.deepEqual(reloaded.presenterState(code).polls[0].counts, [1, 2]);
  // Retention: old sessions disappear; fresh ones stay.
  t += 95 * 86400e3;
  const other = reloaded.createSession();
  assert.deepEqual(reloaded.maintain({ now: t + 86400e3, retentionDays: 90 }), { anonymized: 0, purged: 1 }, "only the older session is purged");
  assert.equal(reloaded.hasSession(code), false);
  assert.equal(reloaded.hasSession(other), true);
  // Lecturer-requested deletion.
  assert.deepEqual(reloaded.deleteSession(other), { ok: true });
  assert.throws(() => reloaded.deleteSession(other), (e) => e.status === 404);
  const third = reloaded.createSession(); reloaded.createSession();
  assert.equal(reloaded.deleteAll().removed, 2);
  assert.equal(reloaded.hasSession(third), false);
  assert.equal(JSON.parse(readFileSync(file, "utf8")) && Object.keys(JSON.parse(readFileSync(file, "utf8"))).length, 0);
  console.log("vote privacy: tokens dropped after close, counts kept, retention purge, lecturer deletion passed");
} finally { Date.now = realNow; rmSync(dir, { recursive: true, force: true }); }
