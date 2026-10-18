// Guest server: every data file lives in a temporary directory that is deleted when the server stops,
// so a visiting lecturer neither sees nor leaves behind votes, scenes, question banks or usage records.
// The lecture files themselves are read from the normal bundles directory (read-only use).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "alfa-guest-"));
const env = { ...process.env, VOTES_FILE: join(dir, "votes.json"), SCENES_FILE: join(dir, "scenes.json"), LIBRARY_FILE: join(dir, "library.json"),
  QUESTION_BANK_FILE: join(dir, "question-bank.json"), DIRECTOR_USAGE_FILE: join(dir, "usage.json") };
delete env.ADMIN_TOKEN; // a fresh token for the guest
const child = spawn(process.execPath, [join(root, "server/server.mjs")], { env, stdio: "inherit" });
let cleaned = false;
const cleanup = () => { if (!cleaned) { cleaned = true; rmSync(dir, { recursive: true, force: true }); } };
child.on("exit", (code) => { cleanup(); process.exit(code ?? 0); });
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { child.kill(sig); });
process.on("exit", cleanup);
console.log("وضع الضيف: البيانات في مجلد مؤقت يُحذف عند الإغلاق. افتح الصفحة بـ ?guest=1 ليبقى المتصفح نظيفاً أيضاً.");
