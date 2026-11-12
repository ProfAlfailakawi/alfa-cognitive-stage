// Build ALFA.app for macOS (unsigned). The app is a thin native host: it finds this ALFA folder
// (lectures, library, import tools stay here) and runs its server. Usage: npm run build:mac
// Output: dist/ALFA-darwin-<arch>/ALFA.app. Signing and notarization are NOT done here.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const v = JSON.parse(readFileSync(join(root, "desktop/versions.json"), "utf8"));
const arch = process.argv.includes("--x64") ? "x64" : process.argv.includes("--universal") ? "universal" : process.arch === "arm64" ? "arm64" : "x64";
const stage = join(root, "dist", ".stage");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const f of ["main.cjs", "preload.cjs", "display-manager.cjs"]) cpSync(join(root, "desktop", f), join(stage, f));
writeFileSync(join(stage, "package.json"), JSON.stringify({ name: "alfa", productName: "ALFA", version: JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version, main: "main.cjs" }, null, 2));
const args = ["--yes", `@electron/packager@${v.packager}`, stage, "ALFA", "--platform=darwin", `--arch=${arch}`,
  `--electron-version=${v.electron}`, "--out", join(root, "dist"), "--overwrite", "--app-bundle-id=edu.alfa.cognitive-stage",
  "--app-category-type=public.app-category.education", "--asar"];
const r = spawnSync("npx", args, { cwd: root, stdio: "inherit" });
rmSync(stage, { recursive: true, force: true });
if (r.status !== 0) process.exit(r.status || 1);
console.log(`\nALFA.app جاهز في dist/ALFA-darwin-${arch}/ (غير موقّع من Apple: أول تشغيل بالضغط بالزر الأيمن ← فتح).`);
