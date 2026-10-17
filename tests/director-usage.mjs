import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeWithAI, directorUsageStatus } from "../server/director-ai.mjs";

// No real network or paid key is used. Everything stays in this isolated Node process.
const testDir = mkdtempSync(join(tmpdir(), "alfa-director-usage-"));
const orig = { key: process.env.OPENAI_API_KEY, max: process.env.DIRECTOR_MAX_CALLS,
  daily: process.env.DIRECTOR_DAILY_MAX_CALLS, file: process.env.DIRECTOR_USAGE_FILE,
  fetch: globalThis.fetch, now: Date.now };
try {
  process.env.OPENAI_API_KEY = "fake-test-only";
  process.env.DIRECTOR_MAX_CALLS = "2";
  process.env.DIRECTOR_DAILY_MAX_CALLS = "2";
  process.env.DIRECTOR_USAGE_FILE = join(testDir, "daily.json");
  let now = 1800000000000;
  Date.now = () => now;
  let requests = 0;
  globalThis.fetch = async (url, options) => {
    requests++;
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(options.headers.Authorization, "Bearer fake-test-only");
    const body = JSON.parse(options.body);
    assert.equal(body.store, false);
    assert.equal(body.max_output_tokens, 350);
    return { ok: true, json: async () => ({
      output: [{ content: [{ type: "output_text",
        text: JSON.stringify({ type: "none", title: "", lines: [], reason: "", confidence: 0 }) }] }],
      ...(requests === 1 ? { usage: { input_tokens: 120, output_tokens: 25 } } : {})
    }) };
  };
  const input = { utterance: "نشرح فكرة اللعب التعليمي في هذه المحاضرة" };
  assert.equal(directorUsageStatus().callsUsed, 0);
  assert.equal(directorUsageStatus().daily.callsUsed, 0);
  assert.equal((await analyzeWithAI(input)).proposal, null);
  assert.deepEqual([directorUsageStatus().callsUsed, directorUsageStatus().successfulCalls,
    directorUsageStatus().inputTokens, directorUsageStatus().outputTokens], [1, 1, 120, 25]);
  assert.equal(directorUsageStatus().daily.callsUsed, 1);
  assert.equal(directorUsageStatus().daily.inputTokens, 120);
  const repeated = await analyzeWithAI(input);
  assert.equal(repeated.cached, true, "An identical analysis is answered from the in-memory cache");
  assert.equal(requests, 1, "A cached answer never reaches the provider");
  assert.equal(directorUsageStatus().daily.callsUsed, 1, "A cached answer uses no quota");
  const second = { utterance: "نشرح فكرة ثانية عن التحفيز في الصف" };
  await assert.rejects(() => analyzeWithAI(second), err => err.status === 429);
  assert.equal(requests, 1, "Cooldown should block a second paid request");
  now += 13000;
  assert.equal((await analyzeWithAI(second)).proposal, null);
  assert.equal(directorUsageStatus().callsWithoutUsage, 1, "Unknown usage must be disclosed");
  assert.equal(directorUsageStatus().daily.callsUsed, 2);
  assert.equal(directorUsageStatus().daily.unknownUsageCalls, 1);
  assert.equal(directorUsageStatus().callsRemaining, 0);
  now += 13000;
  await assert.rejects(() => analyzeWithAI({ utterance: "جملة ثالثة مختلفة عن الدافعية" }), err => err.status === 429);
  assert.equal(requests, 2);
  const status = directorUsageStatus();
  assert.equal(status.costIsEstimate, true);
  assert.equal(status.pricing.verifiedAt, "2026-10-17");
  // 120 in x $0.40/M + 25 out x $1.60/M = 88 micro-USD for call 1; call 2 (unknown usage) is charged its worst case.
  assert.ok(status.daily.spentMicros > 88, "unknown usage is charged conservatively, never as zero");
  assert.equal(status.daily.heldMicros, 0, "all reservations are settled");
  assert.equal(directorUsageStatus().scope, "server-process");
  console.log("director API usage: call ceiling, cooldown, actual token totals, unknown-usage caveat passed");
} finally {
  globalThis.fetch = orig.fetch;
  Date.now = orig.now;
  if (orig.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = orig.key;
  if (orig.max === undefined) delete process.env.DIRECTOR_MAX_CALLS; else process.env.DIRECTOR_MAX_CALLS = orig.max;
  if (orig.daily === undefined) delete process.env.DIRECTOR_DAILY_MAX_CALLS; else process.env.DIRECTOR_DAILY_MAX_CALLS = orig.daily;
  if (orig.file === undefined) delete process.env.DIRECTOR_USAGE_FILE; else process.env.DIRECTOR_USAGE_FILE = orig.file;
  rmSync(testDir, { recursive: true, force: true });
}
