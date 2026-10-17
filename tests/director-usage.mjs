import assert from "node:assert/strict";
import { analyzeWithAI, directorUsageStatus } from "../server/director-ai.mjs";

// No real network or paid key is used. Everything stays in this isolated Node process.
const orig = { key: process.env.OPENAI_API_KEY, max: process.env.DIRECTOR_MAX_CALLS,
  fetch: globalThis.fetch, now: Date.now };
try {
  process.env.OPENAI_API_KEY = "fake-test-only";
  process.env.DIRECTOR_MAX_CALLS = "2";
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
  assert.equal((await analyzeWithAI(input)).proposal, null);
  assert.deepEqual([directorUsageStatus().callsUsed, directorUsageStatus().successfulCalls,
    directorUsageStatus().inputTokens, directorUsageStatus().outputTokens], [1, 1, 120, 25]);
  await assert.rejects(() => analyzeWithAI(input), err => err.status === 429);
  assert.equal(requests, 1, "Cooldown should block a second paid request");
  now += 13000;
  assert.equal((await analyzeWithAI(input)).proposal, null);
  assert.equal(directorUsageStatus().callsWithoutUsage, 1, "Unknown usage must be disclosed");
  assert.equal(directorUsageStatus().callsRemaining, 0);
  now += 13000;
  await assert.rejects(() => analyzeWithAI(input), err => err.status === 429);
  assert.equal(requests, 2);
  assert.equal(directorUsageStatus().costUsd, null, "Never invent dollar amounts");
  assert.equal(directorUsageStatus().scope, "server-process");
  console.log("director API usage: call ceiling, cooldown, actual token totals, unknown-usage caveat passed");
} finally {
  globalThis.fetch = orig.fetch;
  Date.now = orig.now;
  if (orig.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = orig.key;
  if (orig.max === undefined) delete process.env.DIRECTOR_MAX_CALLS; else process.env.DIRECTOR_MAX_CALLS = orig.max;
}
