// One-time, opt-in setup for local semantic matching: installs the ONNX runtime + tokenizer into data/embedder and
// downloads one small multilingual model there (about 610 MB in total). Needs internet now, never again afterwards.
//   npm run fetch:embedder            # default model
//   ALFA_EMBED_MODEL=Xenova/multilingual-e5-small npm run fetch:embedder
import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_MODEL } from "../server/neural-embed.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = process.env.ALFA_EMBED_DIR || join(root, "data", "embedder");
const model = process.env.ALFA_EMBED_MODEL || DEFAULT_MODEL;
const RUNTIME = "@huggingface/transformers@4.3.1"; // the version this was measured with

mkdirSync(dir, { recursive: true });
if (!existsSync(join(dir, "package.json"))) writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "alfa-embedder", private: true, type: "module" }));
if (!existsSync(join(dir, "node_modules", "@huggingface", "transformers", "package.json"))) {
  console.log("تثبيت المحرك المحلي (قد يستغرق دقائق)…");
  // --ignore-scripts: the runtime ships its binaries; its install script only tries optional GPU downloads.
  const r = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts", RUNTIME], { cwd: dir, stdio: "inherit" });
  if (r.status !== 0) { console.error("فشل تثبيت المحرك. تحقق من الاتصال ثم أعد المحاولة."); process.exit(1); }
}
const lib = await import(pathToFileURL(createRequire(join(dir, "package.json")).resolve("@huggingface/transformers")).href);
lib.env.cacheDir = join(dir, "models");
lib.env.allowRemoteModels = true;
console.log("تنزيل النموذج:", model);
const extractor = await lib.pipeline("feature-extraction", model, { dtype: "q8" });
const probe = (await extractor(["اختبار"], { pooling: "mean", normalize: true })).tolist()[0];
console.log(`جاهز: ${model} (أبعاد ${probe.length}). أعد تشغيل ALFA ليظهر «المطابقة الدلالية: متاحة».`);
