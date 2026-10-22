// Slide matching and hybrid fusion. Mechanics are tested with fake backends; quality is measured on the hand-written
// gold set (tests/fixtures/slide-gold.mjs) and asserted only as a floor, never as a claim of general accuracy.
import assert from "node:assert/strict";
import { fuse, zscores, CONFIDENT_MARGIN } from "../web/hybrid-similarity.js";
import { createSlideMatcher, createRemoteEmbedder } from "../web/slide-matcher.js";
import { slides, queries } from "./fixtures/slide-gold.mjs";

// ---- fusion ----
assert.deepEqual(zscores([]), []); assert.deepEqual(zscores([1, 1, 1]), [0, 0, 0]);
{
  const lexical = fuse([0.1, 0.5, 0.2], null);
  assert.equal(lexical.mode, "lexical"); assert.equal(lexical.order[0], 1);
  const hybrid = fuse([0.1, 0.5, 0.2], [0.9, 0.2, 0.1]);
  assert.equal(hybrid.mode, "hybrid"); assert.equal(hybrid.order[0], 0, "the neural opinion outweighs the lexical one (70/30)");
  assert.equal(fuse([0.1, 0.5], [0.1]).mode, "lexical", "a malformed neural answer is ignored");
  assert.equal(fuse([0.4], [0.4]).margin, 0, "a single candidate has no margin");
}

const deck = slides.map((text) => ({ text, notes: "" }));
const goldCases = queries.map(([gold, text]) => ({ gold: gold + 1, text }));

// ---- lexical only: always available, never confident enough to act ----
{
  const matcher = createSlideMatcher({ getSlides: () => deck });
  let right = 0, confident = 0;
  for (const c of goldCases) {
    const m = await matcher.match(c.text);
    assert.equal(m.mode, "lexical");
    if (m.best === c.gold) right++;
    if (m.confident) confident++;
  }
  assert.ok(right >= 15, `lexical top-1 on the gold set must not regress below 15/30 (got ${right})`);
  assert.equal(confident, 0, "the lexical index alone is never trusted to suggest a jump");
  assert.equal(await matcher.match("قصيرة"), null, "too little to compare");
  assert.equal(await createSlideMatcher({ getSlides: () => deck.slice(0, 2) }).match(goldCases[0].text), null, "too few slides");
  assert.equal(await createSlideMatcher({ getSlides: () => [] }).match(goldCases[0].text), null);
}

// ---- with a neural backend: hybrid, confident only on a clear margin, graceful on failure ----
{
  // Fake backend: a one-hot "meaning" per slide topic, so the test is about the plumbing, not about a model.
  const topicOf = (text) => { const hit = goldCases.find((c) => c.text === text); if (hit) return hit.gold - 1; const s = slides.findIndex((x) => x === text); return s; };
  let calls = 0;
  const embedder = { async embed(texts) { calls++; return texts.map((t) => Array.from({ length: 10 }, (_, i) => (i === topicOf(t) ? 1 : 0))); } };
  const matcher = createSlideMatcher({ getSlides: () => deck, embedder });
  const m = await matcher.match(goldCases[3].text);
  assert.equal(m.mode, "hybrid"); assert.equal(m.best, goldCases[3].gold); assert.ok(m.confident && m.margin >= CONFIDENT_MARGIN);
  assert.equal(m.ranking.length, 3);
  await matcher.match(goldCases[4].text);
  assert.equal(calls, 3, "slide vectors are computed once, then one call per new sentence");
  await matcher.match(goldCases[4].text);
  assert.equal(calls, 3, "an identical sentence is answered from the cache");
  // editing a slide invalidates the cached vectors
  deck[0] = { text: deck[0].text + " إضافة", notes: "" };
  await matcher.match(goldCases[0].text);
  assert.equal(calls, 5);
  // a failing backend degrades to lexical, not to an error
  const broken = createSlideMatcher({ getSlides: () => deck, embedder: { embed: async () => { throw new Error("down"); } } });
  const fallback = await broken.match(goldCases[0].text);
  assert.equal(fallback.mode, "lexical"); assert.equal(fallback.confident, false);
}

// ---- remote client ----
{
  const seen = [];
  const fetchImpl = async (path, init) => { seen.push([path, init.headers["X-Admin-Token"]]); return { ok: path !== "/api/embed/status", json: async () => (path === "/api/embed" ? { vectors: [[1, 0]] } : { error: "لم يُثبَّت" }) }; };
  const client = createRemoteEmbedder({ getToken: () => "tok", fetchImpl });
  assert.deepEqual(await client.embed(["x"]), [[1, 0]]);
  assert.deepEqual(await client.status(), { available: false, reason: "لم يُثبَّت" }, "status() reports instead of throwing");
  assert.ok(seen.every(([, t]) => t === "tok"));
}
console.log("slide-matcher: all checks passed");
