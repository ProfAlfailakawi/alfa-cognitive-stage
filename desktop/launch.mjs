// Start the ALFA Mac app from this folder: installs the pinned Electron once (no other new dependency),
// then runs desktop/main.cjs. Usage: node desktop/launch.mjs   (or: npm run desktop)
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { electron: version } = JSON.parse(readFileSync(join(root, "desktop/versions.json"), "utf8"));
const require = createRequire(join(root, "package.json"));
const installed = () => { try { return require("electron/package.json").version === version && require("electron"); } catch { return null; } };
let binary = installed();
if (!binary) {
  console.log(`تجهيز تطبيق ALFA للماك (Electron ${version}) — مرة واحدة فقط...`);
  const r = spawnSync("npm", ["install", "--no-save", "--no-audit", "--no-fund", `electron@${version}`], { cwd: root, stdio: "inherit" });
  if (r.status !== 0 || !(binary = installed())) { console.error("تعذر تثبيت Electron. تحقق من الإنترنت ثم أعد المحاولة."); process.exit(1); }
}
const child = spawn(binary, [join(root, "desktop/main.cjs")], { cwd: root, stdio: "inherit", env: { ...process.env, ALFA_ROOT: root } });
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill(s));
child.on("exit", (code) => process.exit(code ?? 0));
