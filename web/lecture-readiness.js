// Build honest readiness data without implying that PPTX animations have been preserved.
export function summarizeLecture(manifest) {
  const slides = Array.isArray(manifest?.slides) ? manifest.slides : [];
  const warnings = Array.isArray(manifest?.problems) ? manifest.problems : [];
  const animated = slides.filter((s) => Boolean(s.compatibility?.animationsDetected)).map((s) => s.index);
  const videos = slides.reduce((sum, s) => sum + (Array.isArray(s.videos) ? s.videos.length : 0), 0);
  const external = warnings.filter((p) => p.problem === "external video link");
  return {
    slideCount: slides.length,
    embeddedVideoCount: videos,
    animatedSlides: animated,
    externalVideoLinks: external.length,
    warnings: warnings.slice(0, 100).map((w) => ({
      slide: Number.isInteger(w.slide) ? w.slide : null,
      problem: String(w.problem || "").slice(0, 150),
    })),
    readyForUnattendedLiveUse: false, // Real macOS/projector/phone acceptance is separate.
    summary: animated.length || external.length
      ? "هناك حركات أو روابط فيديو تحتاج مراجعة قبل دخول القاعة."
      : "تم استيراد محتوى الشرائح؛ اختبر الفيديو والصوت والتصويت على جهاز المحاضرة.",
  };
}
