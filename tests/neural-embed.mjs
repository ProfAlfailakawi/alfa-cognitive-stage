// The optional local embedding service: module behaviour with a fake runtime, the admin-only HTTP surface, and — only
// when the lecturer installed the real model (`npm run fetch:embedder`) — the measured quality on the gold set.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createNeuralEmbedder, EmbedError, MAX_TEXTS, MAX_TEXT_CHARS } from "../server/neural-embed.mjs";
import { createSlideMatcher } from "../web/slide-matcher.js";
import { slides, queries } from "./fixtures/slide-gold.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "alfa-embed-"));

// ---- not installed: honest status, no throw at construction ----
{
  const e = createNeuralEmbedder({ dir: join(scratch, "none") });
  assert.equal(e.status().available, false); assert.match(e.status().reason, /fetch:embedder/);
  await assert.rejects(e.embed(["x"]), (err) => err instanceof EmbedError && err.status === 503);
}
// ---- fake runtime ----
{
  const seen = [];
  const loader = async () => ({ env: {}, pipeline: async () => async (texts, opts) => { seen.push({ texts, opts }); return { tolist: () => texts.map((t) => [t.length / 1000, 0.123456789, 0]) }; } });
  const e = createNeuralEmbedder({ dir: scratch, loader });
  assert.equal(e.status().available, true);
  const v = await e.embed(["  مرحبا   بك\u0000 ", "x".repeat(MAX_TEXT_CHARS + 50)]);
  assert.deepEqual(v[0], [0.008, 0.12346, 0], "vectors are rounded to 5 decimals");
  assert.equal(seen[0].texts[0], "مرحبا بك", "control characters and runs of spaces are removed");
  assert.equal(seen[0].texts[1].length, MAX_TEXT_CHARS, "long text is clipped");
  assert.deepEqual(seen[0].opts, { pooling: "mean", normalize: true });
  for (const bad of [[], "x", [1], Array(MAX_TEXTS + 1).fill("x"), null]) await assert.rejects(e.embed(bad), (err) => err instanceof EmbedError && err.status === 400);
  // concurrent calls are serialised, not interleaved
  let active = 0, peak = 0;
  const slow = createNeuralEmbedder({ dir: scratch, loader: async () => ({ env: {}, pipeline: async () => async (texts) => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 20)); active--; return { tolist: () => texts.map(() => [1]) }; } }) });
  await Promise.all([slow.embed(["a"]), slow.embed(["b"]), slow.embed(["c"])]);
  assert.equal(peak, 1, "one model, one request at a time");
  // a runtime that fails to load is reported as unavailable, and retried next time
  let attempts = 0;
  const flaky = createNeuralEmbedder({ dir: scratch, loader: async () => { if (attempts++ === 0) throw new Error("boom"); return { env: {}, pipeline: async () => async (t) => ({ tolist: () => t.map(() => [1]) }) }; } });
  await assert.rejects(flaky.embed(["a"]), (err) => err.status === 503);
  assert.deepEqual(await flaky.embed(["a"]), [[1]]);
}
// ---- HTTP surface: admin only, and unavailable without the install ----
{
  const ADMIN = "embed-test-token-0123456789abcdef", port = 4331;
  const server = spawn(process.execPath, [join(root, "server/server.mjs")], { env: { ...process.env, PORT: String(port), ADMIN_TOKEN: ADMIN, ALFA_EMBED_DIR: join(scratch, "empty"),
    VOTES_FILE: join(scratch, "v.json"), SCENES_FILE: join(scratch, "s.json"), LIBRARY_FILE: join(scratch, "l.json"), QUESTION_BANK_FILE: join(scratch, "b.json"), DIRECTOR_USAGE_FILE: join(scratch, "u.json") }, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise((r) => server.stdout.once("data", r));
    const base = `http://localhost:${port}/api/embed`;
    assert.equal((await fetch(base + "/status")).status, 401, "no token, no access");
    assert.equal((await fetch(base, { method: "POST", body: "{}" })).status, 401);
    const st = await (await fetch(base + "/status", { headers: { "X-Admin-Token": ADMIN } })).json();
    assert.equal(st.available, false); assert.match(st.reason, /fetch:embedder/);
    const post = await fetch(base, { method: "POST", headers: { "X-Admin-Token": ADMIN, "Content-Type": "application/json" }, body: JSON.stringify({ texts: ["x"] }) });
    assert.equal(post.status, 503);
  } finally { server.kill("SIGTERM"); }
}
rmSync(scratch, { recursive: true, force: true });

// ---- the real model, when installed ----
const real = createNeuralEmbedder({ dir: process.env.ALFA_EMBED_DIR || join(root, "data", "embedder") });
if (!real.status().available) {
  console.log("neural-embed: module and HTTP checks passed; real-model measurement SKIPPED (" + real.status().reason + ")");
} else {
  const deck = slides.map((text) => ({ text, notes: "" }));
  const run = async (embedder) => {
    const matcher = createSlideMatcher({ getSlides: () => deck, embedder });
    let right = 0, kept = 0, keptRight = 0;
    for (const [gold, text] of queries) {
      const m = await matcher.match(text);
      if (m.best === gold + 1) right++;
      if (m.confident) { kept++; if (m.best === gold + 1) keptRight++; }
    }
    return { right, kept, keptRight };
  };
  const lexical = await run(null), hybrid = await run(real);
  console.log(`neural-embed (${real.model}): lexical ${lexical.right}/30, hybrid ${hybrid.right}/30, confident ${hybrid.keptRight}/${hybrid.kept}`);
  assert.ok(hybrid.right > lexical.right, "the hybrid beats the lexical index on the gold set");
  assert.ok(hybrid.kept >= 5 && hybrid.keptRight / hybrid.kept >= 0.7, "when it is confident it is mostly right (small-sample floor, not a promise)");
  console.log("neural-embed: all checks passed (including the real model)");
}
