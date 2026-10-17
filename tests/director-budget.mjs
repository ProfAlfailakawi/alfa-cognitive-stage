import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { priceFor, costOfUsage, worstCaseMicroUsd, dailyCapMicroUsd, microUsd, formatUsd } from "../server/director-cost.mjs";
import { createDirectorQuota, DirectorQuotaError } from "../server/director-quota.mjs";
import { analyzeWithAI, directorUsageStatus } from "../server/director-ai.mjs";

// ---- prices: only from the dated table or an explicit override; never invented ----
const known = priceFor("gpt-4.1-mini", {});
assert.deepEqual([known.inputPerMTok, known.cachedInputPerMTok, known.outputPerMTok], [0.4, 0.1, 1.6]);
assert.equal(known.verifiedAt, "2026-10-17");
assert.match(known.source, /openai\.com/);
assert.equal(priceFor("gpt-4.1-mini-2025-04-14", {}).outputPerMTok, 1.6, "dated aliases map to the same model");
assert.equal(priceFor("some-future-model", {}), null, "an unpriced model has NO default price");
assert.equal(priceFor("", {}), null);
const over = priceFor("some-future-model", { DIRECTOR_PRICE_INPUT_PER_MTOK: "2", DIRECTOR_PRICE_OUTPUT_PER_MTOK: "8" });
assert.deepEqual([over.inputPerMTok, over.cachedInputPerMTok, over.outputPerMTok], [2, 2, 8]);
assert.equal(over.verifiedAt, null);
assert.equal(priceFor("gpt-4.1-mini", { DIRECTOR_PRICE_INPUT_PER_MTOK: "abc", DIRECTOR_PRICE_OUTPUT_PER_MTOK: "8" }), null,
  "a malformed override disables pricing instead of falling back");
assert.equal(priceFor("gpt-4.1-mini", { DIRECTOR_PRICE_INPUT_PER_MTOK: "1" }), null, "half an override is rejected");

// ---- cost math rounds up and handles cached tokens ----
assert.equal(microUsd(120, 0.4), 48);
assert.equal(costOfUsage({ input_tokens: 120, output_tokens: 25 }, known), 48 + 40);
assert.equal(costOfUsage({ input_tokens: 1000, output_tokens: 200, input_tokens_details: { cached_tokens: 400 } }, known),
  Math.ceil(600 * 0.4) + Math.ceil(400 * 0.1) + Math.ceil(200 * 1.6));
assert.equal(costOfUsage({ input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 99 } }, known), null);
assert.equal(costOfUsage({ input_tokens: -1, output_tokens: 5 }, known), null);
assert.equal(costOfUsage(null, known), null);
assert.equal(costOfUsage({ input_tokens: 1, output_tokens: 1 }, null), null);
const worst = worstCaseMicroUsd({ promptBytes: 3000, maxOutputTokens: 350 }, known);
assert.ok(worst >= costOfUsage({ input_tokens: 3000, output_tokens: 350 }, known),
  "the bound must exceed even a one-token-per-byte prompt with maximal output");
assert.equal(worstCaseMicroUsd({ promptBytes: 3000, maxOutputTokens: 350 }, null), null);
assert.equal(formatUsd(88), "$0.00009");
assert.equal(dailyCapMicroUsd({}), 250000);
assert.equal(dailyCapMicroUsd({ DIRECTOR_DAILY_MAX_USD: "0.05" }), 50000);
assert.equal(dailyCapMicroUsd({ DIRECTOR_DAILY_MAX_USD: "-1" }), 0, "an invalid cap blocks paid calls");
assert.equal(dailyCapMicroUsd({ DIRECTOR_DAILY_MAX_USD: "x" }), 0);

// ---- ledger: dollar reservations, settlement, restart, v1 migration, history ----
const dir = mkdtempSync(join(tmpdir(), "alfa-budget-"));
try {
  let clock = Date.UTC(2026, 9, 17, 9);
  const file = join(dir, "ledger.json");
  const ledger = createDirectorQuota({ file, now: () => clock });
  const r1 = ledger.reserve(10, { capMicros: 5000, worstMicros: 3000 });
  assert.equal(ledger.status(10, 5000).heldMicros, 3000);
  assert.throws(() => ledger.reserve(10, { capMicros: 5000, worstMicros: 3000 }),
    (e) => e instanceof DirectorQuotaError && e.status === 429 && /الدولار/.test(e.message),
    "a second worst-case request that could exceed the cap is refused while the first is in flight");
  assert.equal(ledger.report(r1.day, { inputTokens: 100, outputTokens: 10 }, { heldMicros: 3000, costMicros: 56 }), true);
  let st = ledger.status(10, 5000);
  assert.deepEqual([st.heldMicros, st.spentMicros, st.capRemainingMicros], [0, 56, 4944]);
  const r2 = ledger.reserve(10, { capMicros: 5000, worstMicros: 3000 });
  ledger.report(r2.day, null, { heldMicros: 3000, costMicros: null });
  st = ledger.status(10, 5000);
  assert.equal(st.spentMicros, 3056, "unknown cost charges the whole worst case");
  assert.throws(() => ledger.reserve(10, { capMicros: 5000, worstMicros: 3000 }), (e) => e.status === 429);
  const r3 = ledger.reserve(10, { capMicros: 8000, worstMicros: 3000 });
  ledger.report(r3.day, null, { heldMicros: 3000, costMicros: 0 });
  assert.equal(ledger.status(10, 8000).spentMicros, 3056, "a provider-rejected call is charged zero");
  assert.throws(() => ledger.reserve(10, { capMicros: 8000, worstMicros: null }),
    (e) => e.status === 503, "no price means no guarantee, so no paid call");
  assert.equal(createDirectorQuota({ file, now: () => clock }).status(10, 8000).spentMicros, 3056, "survives restart");
  assert.ok(!readFileSync(file, "utf8").match(/utterance|OPENAI|sk-/), "the ledger holds numbers only");
  clock += 24 * 3600 * 1000;
  st = ledger.status(10, 8000);
  assert.equal(st.spentMicros, 0);
  assert.deepEqual(st.history.map((h) => [h.day, h.calls, h.estimatedMicros]), [["2026-10-17", 3, 3056]]);
  // A version-1 ledger written by the previous release is migrated, not rejected.
  writeFileSync(file, JSON.stringify({ version: 1, day: "2026-10-18", callsUsed: 2, reportedCalls: 2,
    inputTokens: 10, outputTokens: 5, unknownUsageCalls: 0 }));
  st = ledger.status(10, 8000);
  assert.equal(st.healthy, true);
  assert.equal(st.callsUsed, 2);
  assert.equal(st.spentMicros, 0);
} finally { rmSync(dir, { recursive: true, force: true }); }

// ---- end to end through analyzeWithAI with a fake provider (no network, no key) ----
const tmp = mkdtempSync(join(tmpdir(), "alfa-budget-e2e-"));
const saved = { ...process.env }, realFetch = globalThis.fetch, realNow = Date.now;
try {
  Object.assign(process.env, { OPENAI_API_KEY: "fake", DIRECTOR_MAX_CALLS: "20", DIRECTOR_DAILY_MAX_CALLS: "20",
    DIRECTOR_USAGE_FILE: join(tmp, "u.json") });
  delete process.env.OPENAI_MODEL; delete process.env.DIRECTOR_DAILY_MAX_USD;
  let now = 1_900_000_000_000, requests = 0, mode = "ok";
  Date.now = () => now;
  const reply = (usage) => ({ ok: true, json: async () => ({ ...(usage ? { usage } : {}), output: [{ content: [{ type: "output_text",
    text: JSON.stringify({ type: "none", title: "", lines: [], reason: "", confidence: 0 }) }] }] }) });
  globalThis.fetch = async () => {
    requests++;
    if (mode === "http-error") return { ok: false, status: 500, json: async () => ({}) };
    if (mode === "network") throw new Error("socket hang up");
    return reply({ input_tokens: 500, output_tokens: 40, input_tokens_details: { cached_tokens: 100 } });
  };
  const ask = (n) => analyzeWithAI({ utterance: "نشرح الفكرة رقم " + n + " في المحاضرة بالتفصيل" });
  await ask(1);
  let s = directorUsageStatus();
  assert.equal(s.daily.spentMicros, Math.ceil(400 * 0.4) + Math.ceil(100 * 0.1) + Math.ceil(40 * 1.6));
  assert.equal(s.costUsd, s.daily.estimatedMicros / 1e6);
  assert.equal(s.costIsEstimate, true);
  assert.equal(s.capUsd, 0.25);
  now += 13000; mode = "http-error";
  await assert.rejects(() => ask(2), (e) => e.status === 502);
  assert.equal(directorUsageStatus().daily.spentMicros, s.daily.spentMicros, "a provider error response is not charged");
  now += 13000; mode = "network";
  await assert.rejects(() => ask(3));
  const afterNetwork = directorUsageStatus().daily;
  assert.ok(afterNetwork.spentMicros > s.daily.spentMicros, "a dropped connection may have been billed, so it is charged conservatively");
  assert.equal(afterNetwork.heldMicros, 0);
  // Tiny cap: the request is refused BEFORE any provider call.
  process.env.DIRECTOR_DAILY_MAX_USD = "0.000001";
  now += 13000; const before = requests;
  await assert.rejects(() => ask(4), (e) => e.status === 429 && /الدولار/.test(e.message));
  assert.equal(requests, before, "no billable request when the dollar cap cannot be guaranteed");
  // Unknown model without prices: fail closed with an actionable message.
  delete process.env.DIRECTOR_DAILY_MAX_USD; process.env.OPENAI_MODEL = "brand-new-model";
  now += 13000;
  await assert.rejects(() => ask(5), (e) => e.status === 503 && /DIRECTOR_PRICE/.test(e.message));
  assert.equal(requests, before);
  assert.equal(directorUsageStatus().costUsd, null, "no invented price, so no dollar figure");
  // The same model works once the lecturer supplies its price.
  process.env.DIRECTOR_PRICE_INPUT_PER_MTOK = "1"; process.env.DIRECTOR_PRICE_OUTPUT_PER_MTOK = "4";
  mode = "ok"; now += 13000;
  await ask(6);
  assert.equal(requests, before + 1);
  assert.equal(directorUsageStatus().pricing.source, "environment override");
  console.log("director budget: verified prices, dollar cap reservation, conservative settlement, fail-closed unpriced models passed");
} finally {
  globalThis.fetch = realFetch; Date.now = realNow;
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  rmSync(tmp, { recursive: true, force: true });
}
