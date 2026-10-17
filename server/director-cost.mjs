// Dollar estimation for the optional cloud director. Prices come ONLY from server/pricing.json
// (dated, with its source) or from explicit environment overrides. There is no fallback price:
// an unpriced model yields `null`, and a dollar cap then refuses paid calls (fail closed).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TABLE_FILE = fileURLToPath(new URL("./pricing.json", import.meta.url));
let table = null;
function loadTable() {
  if (table) return table;
  try { table = JSON.parse(readFileSync(TABLE_FILE, "utf8")); } catch { table = { models: {}, invalid: true }; }
  return table;
}
const positive = (value) => Number.isFinite(value) && value >= 0 && value < 10000;
const normalizeModel = (name) => String(name || "").trim().toLowerCase().replace(/-\d{4}-\d{2}-\d{2}$/, "");

/** Price per million tokens for `model`, or null when no trustworthy price exists. */
export function priceFor(model, env = process.env) {
  const override = {
    inputPerMTok: Number(env.DIRECTOR_PRICE_INPUT_PER_MTOK),
    outputPerMTok: Number(env.DIRECTOR_PRICE_OUTPUT_PER_MTOK),
    cachedInputPerMTok: env.DIRECTOR_PRICE_CACHED_INPUT_PER_MTOK === undefined
      ? undefined : Number(env.DIRECTOR_PRICE_CACHED_INPUT_PER_MTOK),
  };
  if (env.DIRECTOR_PRICE_INPUT_PER_MTOK !== undefined || env.DIRECTOR_PRICE_OUTPUT_PER_MTOK !== undefined) {
    if (!positive(override.inputPerMTok) || !positive(override.outputPerMTok) ||
        (override.cachedInputPerMTok !== undefined && !positive(override.cachedInputPerMTok))) return null;
    return { ...override, cachedInputPerMTok: override.cachedInputPerMTok ?? override.inputPerMTok,
      source: "environment override", verifiedAt: null };
  }
  const entry = loadTable().models?.[normalizeModel(model)];
  if (!entry || ![entry.inputPerMTok, entry.outputPerMTok, entry.cachedInputPerMTok].every(positive)) return null;
  return { ...entry, source: table.source, verifiedAt: table.verifiedAt };
}

/** Micro-dollars (1e-6 USD) rounded UP, so estimates never understate. Tokens x ($/MTok) = micro-USD. */
export function microUsd(tokens, perMTok) { return Math.ceil(tokens * perMTok); }

/** Cost of a reported usage object, or null when it cannot be computed safely. */
export function costOfUsage(usage, price) {
  if (!price || !usage) return null;
  const input = usage.input_tokens, output = usage.output_tokens;
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  if (![input, output, cached].every((n) => Number.isSafeInteger(n) && n >= 0) || cached > input) return null;
  return microUsd(input - cached, price.inputPerMTok) + microUsd(cached, price.cachedInputPerMTok) +
    microUsd(output, price.outputPerMTok);
}

/**
 * Hard upper bound for one request: a token is at least one byte, so input tokens <= UTF-8 bytes
 * (plus padding for provider-side formatting); output is capped by max_output_tokens.
 */
export function worstCaseMicroUsd({ promptBytes, maxOutputTokens }, price) {
  if (!price || !Number.isSafeInteger(promptBytes) || !Number.isSafeInteger(maxOutputTokens)) return null;
  const paddedInput = promptBytes + 512;
  return microUsd(paddedInput, Math.max(price.inputPerMTok, price.cachedInputPerMTok)) +
    microUsd(maxOutputTokens, price.outputPerMTok);
}

export const formatUsd = (micros) => micros === null || micros === undefined ? null :
  "$" + (micros / 1e6).toFixed(micros < 10000 ? 5 : 4);

export function dailyCapMicroUsd(env = process.env) {
  const raw = env.DIRECTOR_DAILY_MAX_USD;
  if (raw === undefined || raw === "") return 250000; // $0.25 per UTC day unless configured
  const usd = Number(raw);
  return Number.isFinite(usd) && usd >= 0 && usd <= 1000 ? Math.floor(usd * 1e6) : 0;
}
