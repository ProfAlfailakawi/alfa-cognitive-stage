// Classroom readiness preflight, never conflating file existence with successful playback.
import { access, readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { existsSync } from "node:fs";
import { delimiter } from "node:path";

export function toolFound(command, environment = process.env.PATH || "") {
  return environment.split(delimiter).some((folder) =>
    folder && (existsSync(join(folder, command)) || existsSync(join(folder, command + ".exe"))));
}

export async function checkReadiness({ bundlesRoot, bundle, cloudConfigured = false }) {
  if (!/^[a-f0-9]{12}$/.test(String(bundle))) {
    const error = new Error("معرّف المحاضرة غير صالح");
    error.status = 400; throw error;
  }
  const dir = resolve(bundlesRoot, bundle);
  if (!dir.startsWith(resolve(bundlesRoot) + sep)) throw new Error("Invalid bundle location");
  let manifest;
  try { manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")); }
  catch {
    const error = new Error("المحاضرة غير موجودة أو غير مكتملة");
    error.status = 404; throw error;
  }
  const missing = [];
  let videoCount = 0;
  for (const slide of manifest.slides || []) {
    const paths = [slide.image, ...(slide.videos || []).flatMap((clip) => [clip.src,clip.webm].filter(Boolean))];
    videoCount += (slide.videos || []).length;
    for (const relative of paths) {
      if (!relative || typeof relative !== "string") { missing.push("ملف مفقود في الشريحة " + slide.index); continue; }
      const path = resolve(dir, relative);
      if (!path.startsWith(dir + sep)) { missing.push("مسار غير آمن في الشريحة " + slide.index); continue; }
      try { await access(path); } catch { missing.push("الشريحة " + slide.index + ": " + relative); }
    }
  }
  const animations = (manifest.slides || []).filter((s) => s.hasAnimations).map((s) => s.index);
  const dependencies = ["python3","soffice","pdftoppm","ffmpeg","ffprobe"]
    .map((name) => ({name, installed:toolFound(name)}));
  const problems = (manifest.problems || []).map((entry) => ({
    slide: entry.slide, problem: String(entry.problem).slice(0,120)
  }));
  return {
    bundle, source: manifest.source, slideCount: manifest.slideCount, videoCount,
    animationSlides: animations, missingAssets: missing.slice(0, 80),
    problems, dependencies, cloudConfigured: Boolean(cloudConfigured),
    playableFilesPresent: missing.length === 0,
    requiresManualMediaTest: videoCount > 0,
    requiresAnimationReview: animations.length > 0,
    // "ready" only means locally verifiable assets exist. Physical tests still needed.
    status: missing.length ? "blocked" : (animations.length || problems.length || videoCount ? "review" : "files-ready"),
  };
}
