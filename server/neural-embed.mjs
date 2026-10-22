// Optional local sentence embeddings (no API, no cloud). Off unless the lecturer ran `npm run fetch:embedder`, which
// installs the runtime and downloads one small multilingual model into data/embedder. At run time this module never
// touches the network: it loads only what is already on disk. If anything is missing, status() says why and the
// rest of ALFA keeps using its built-in lexical similarity.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
export const MAX_TEXTS = 80, MAX_TEXT_CHARS = 600;

export class EmbedError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

const clip = (t) => String(t ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS);

/** `loader` (tests) must resolve to { pipeline, env }; the default loads the runtime installed under `dir`. */
export function createNeuralEmbedder({ dir, model = DEFAULT_MODEL, loader } = {}) {
  const modelDir = join(dir, "models");
  let loading = null, extractor = null, chain = Promise.resolve();
  const installed = () => Boolean(loader) || existsSync(join(dir, "node_modules", "@huggingface", "transformers", "package.json"));
  const downloaded = () => Boolean(loader) || existsSync(join(modelDir, ...model.split("/"), "config.json"));

  async function load() {
    const lib = loader ? await loader()
      : await import(pathToFileURL(createRequire(join(dir, "package.json")).resolve("@huggingface/transformers")).href);
    lib.env.cacheDir = modelDir;
    lib.env.allowRemoteModels = false; // never download during a lecture
    lib.env.allowLocalModels = true;
    return lib.pipeline("feature-extraction", model, { dtype: "q8" });
  }
  return {
    model,
    status() {
      if (!installed()) return { available: false, model, reason: "لم يُثبَّت المحرك المحلي. شغّل: npm run fetch:embedder" };
      if (!downloaded()) return { available: false, model, reason: "النموذج غير منزَّل. شغّل: npm run fetch:embedder" };
      return { available: true, model };
    },
    /** Vectors for `texts`, unit length, rounded to 5 decimals. Calls are serialised: one model, one thread of work. */
    async embed(texts) {
      const st = this.status();
      if (!st.available) throw new EmbedError(st.reason, 503);
      if (!Array.isArray(texts) || !texts.length || texts.length > MAX_TEXTS) throw new EmbedError(`المطلوب من 1 إلى ${MAX_TEXTS} نصاً`);
      if (texts.some((t) => typeof t !== "string")) throw new EmbedError("النصوص يجب أن تكون سلاسل");
      const clean = texts.map(clip);
      const run = chain.then(async () => {
        extractor ||= await (loading ||= load().catch((e) => { loading = null; throw e; }));
        const out = await extractor(clean, { pooling: "mean", normalize: true });
        return out.tolist().map((v) => v.map((x) => Math.round(x * 1e5) / 1e5));
      });
      chain = run.catch(() => {});
      try { return await run; } catch (e) { if (e instanceof EmbedError) throw e; throw new EmbedError("تعذّر تشغيل النموذج المحلي: " + String(e.message).slice(0, 120), 503); }
    },
  };
}
