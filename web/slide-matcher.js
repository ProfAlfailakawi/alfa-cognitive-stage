// Which slide is the lecturer talking about? Lexical similarity is always computed; a neural backend, if the lecturer
// installed one (server/neural-embed.mjs), is blended in. Only the hybrid is trusted enough to suggest a jump.
import { embed, cosine } from "./semantic-index.js";
import { fuse, dot, CONFIDENT_MARGIN } from "./hybrid-similarity.js";

const clip = (t) => String(t || "").replace(/\s+/g, " ").trim().slice(0, 600);
const slideText = (s) => clip([s?.text, s?.notes].filter(Boolean).join(" "));

/**
 * @param getSlides  () => [{ text, notes }]  (index = position + 1); read lazily so a bundle swap is picked up
 * @param embedder   null | { embed(texts) => Promise<number[][]> }  failures degrade to lexical, never throw
 */
export function createSlideMatcher({ getSlides, embedder = null }) {
  let cacheKey = "", lexical = [], neural = null, neuralFor = "";
  const queryCache = new Map();
  async function prepare() {
    const slides = getSlides() || [];
    const texts = slides.map(slideText);
    const key = texts.join("\u0001");
    if (key !== cacheKey) {
      cacheKey = key; neural = null; neuralFor = ""; queryCache.clear();
      lexical = texts.map((t) => (t ? embed(t).vec : null));
    }
    if (embedder && neuralFor !== key) {
      neuralFor = key;
      const indexes = texts.map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
      try {
        const vectors = [];
        for (let i = 0; i < indexes.length; i += 64) vectors.push(...await embedder.embed(indexes.slice(i, i + 64).map((k) => texts[k])));
        neural = new Map(indexes.map((k, n) => [k, vectors[n]]));
      } catch { neural = null; }
    }
    return { texts };
  }
  return {
    /**
     * @returns { mode, best, margin, confident, ranking: [{ slide, score }] } or null when there is nothing to compare.
     * `best` is a 1-based slide number. `confident` requires the hybrid mode and a clear margin.
     */
    async match(utterance) {
      const query = clip(utterance);
      if (query.length < 12) return null;
      const { texts } = await prepare();
      const candidates = texts.map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
      if (candidates.length < 3) return null;
      const q = embed(query);
      const lex = candidates.map((i) => cosine(lexical[i], q.vec));
      let neu = null;
      if (neural) {
        try {
          let qv = queryCache.get(query);
          if (!qv) { qv = (await embedder.embed([query]))[0]; queryCache.set(query, qv); if (queryCache.size > 50) queryCache.delete(queryCache.keys().next().value); }
          neu = candidates.map((i) => dot(neural.get(i), qv));
        } catch { neu = null; }
      }
      const r = fuse(lex, neu);
      const ranking = r.order.slice(0, 3).map((o) => ({ slide: candidates[o] + 1, score: Number(r.scores[o].toFixed(2)) }));
      return { mode: r.mode, best: ranking[0].slide, margin: Number(r.margin.toFixed(2)), confident: r.mode === "hybrid" && r.margin >= CONFIDENT_MARGIN, ranking };
    },
  };
}

/** Browser-side client for the server's /api/embed. status() never throws. */
export function createRemoteEmbedder({ getToken, fetchImpl = (...a) => fetch(...a) }) {
  const call = async (path, init = {}) => {
    const r = await fetchImpl(path, { ...init, headers: { "X-Admin-Token": getToken(), "Content-Type": "application/json" } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(data.error || "تعذّر الاتصال بالمطابقة الدلالية");
    return data;
  };
  return {
    status: () => call("/api/embed/status").catch((e) => ({ available: false, reason: e.message })),
    embed: async (texts) => (await call("/api/embed", { method: "POST", body: JSON.stringify({ texts }) })).vectors,
  };
}
