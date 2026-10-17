import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDirectorQuota, DirectorQuotaError } from "../server/director-quota.mjs";

const directory = mkdtempSync(join(tmpdir(), "alfa-api-quota-"));
const file = join(directory, "private", "daily.json");
let clock = Date.UTC(2026, 9, 17, 12);
try {
  const first = createDirectorQuota({ file, now: () => clock });
  assert.deepEqual([first.status(2).healthy, first.status(2).callsUsed], [true, 0]);
  const reservation = first.reserve(2);
  assert.equal(first.status(2).callsUsed, 1);
  assert.equal(first.status(2).callsRemaining, 1);
  assert.equal(statSync(file).mode & 0o777, 0o600, "Ledger must be private by default");
  assert.equal(first.report(reservation.day, { inputTokens: 120, outputTokens: 25 }), true);
  assert.equal(first.report(reservation.day, { inputTokens: 120, outputTokens: 25 }), false,
    "One reserved request cannot be counted twice");
  assert.equal(first.status(2).inputTokens, 120);
  assert.equal(first.status(2).outputTokens, 25);
  assert.equal(first.status(2).unreportedCalls, 0);
  const afterRestart = createDirectorQuota({ file, now: () => clock });
  assert.equal(afterRestart.status(2).callsUsed, 1, "Server restart must not reset call count");
  const second = afterRestart.reserve(2);
  assert.equal(afterRestart.report(second.day, null), true);
  assert.equal(afterRestart.status(2).callsUsed, 2);
  assert.equal(afterRestart.status(2).unknownUsageCalls, 1);
  assert.throws(() => createDirectorQuota({ file, now: () => clock }).reserve(2),
    error => error instanceof DirectorQuotaError && error.status === 429);
  assert.ok(!readFileSync(file, "utf8").includes("المحاضر"), "No speech is stored");
  clock += 24 * 60 * 60 * 1000;
  assert.equal(afterRestart.status(2).callsUsed, 0, "UTC day rollover has a fresh quota");
  assert.equal(afterRestart.report(second.day, null), false, "Late calls must not be charged to tomorrow");
  afterRestart.reserve(2);
  assert.equal(first.status(2).callsUsed, 1);
  writeFileSync(file, "{ damaged");
  assert.equal(first.status(2).healthy, false);
  assert.equal(first.status(2).callsRemaining, 0);
  assert.throws(() => first.reserve(2),
    error => error instanceof DirectorQuotaError && error.status === 503,
    "Corrupt accounting must fail closed, not reset the budget");
  rmSync(file);
  assert.throws(() => first.reserve(0), error => error.status === 429);
  console.log("director quota: private atomic reservations, restart safety, UTC reset, actual usage and fail-closed corruption passed");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
