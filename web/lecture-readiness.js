// Honest readiness data: click builds are "reproduced" only when per-click images exist;
// the motion itself is always a simple cross-fade.
export function summarizeLecture(manifest) {
  const slides = Array.isArray(manifest?.slides) ? manifest.slides : [];
  const warnings = Array.isArray(manifest?.problems) ? manifest.problems : [];
  const animated = slides.filter((s) => Boolean(s.compatibility?.animationsDetected)).map((s) => s.index);
  const hasSteps = (s) => Array.isArray(s.build?.steps) && s.build.steps.length >= 2;
  const reproduced = slides.filter((s) => s.compatibility?.animationsDetected && hasSteps(s) &&
    s.compatibility?.animationFidelity === "order-and-state").map((s) => s.index);
  const partial = slides.filter((s) => s.compatibility?.animationsDetected && hasSteps(s) &&
    s.compatibility?.animationFidelity === "partial").map((s) => s.index);
  const notReproduced = animated.filter((i) => !reproduced.includes(i) && !partial.includes(i));
  const videos = slides.reduce((sum, s) => sum + (Array.isArray(s.videos) ? s.videos.length : 0), 0);
  const external = warnings.filter((p) => p.problem === "external video link");
  return {
    slideCount: slides.length,
    embeddedVideoCount: videos,
    animatedSlides: animated,
    reproducedBuildSlides: reproduced,
    partialBuildSlides: partial,
    unreproducedAnimationSlides: notReproduced,
    externalVideoLinks: external.length,
    warnings: warnings.slice(0, 100).map((w) => ({
      slide: Number.isInteger(w.slide) ? w.slide : null,
      problem: String(w.problem || "").slice(0, 150),
    })),
    readyForUnattendedLiveUse: false, // Real macOS/projector/phone acceptance is separate.
    summary: notReproduced.length || partial.length || external.length
      ? "هناك حركات أو روابط فيديو لا تُعاد بالكامل؛ راجع الشرائح المذكورة قبل دخول القاعة."
      : reproduced.length
        ? "حركات النقر تعمل خطوة بخطوة بنفس ترتيب PowerPoint وحالته؛ شكل الحركة تلاشٍ هادئ. قارنها مع PowerPoint قبل المحاضرة."
        : "تم استيراد محتوى الشرائح؛ اختبر الفيديو والصوت والتصويت على جهاز المحاضر.",
  };
}
