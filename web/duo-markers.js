// علامات iPhone Duo على <html>، تُقرأ في CSS (web/duo.css). تعمل قبل رسم الصفحة.
// - data-device="duo": شاشة شبه مربّعة (الخارجية 466×678، الداخلية 669×951؛ النسبة ≤1.48).
//   كل iPhone نسبته ≥1.7، وكل iPad أعرض من 700، فلا يتغيّر عليهما شيء.
// - data-shell: «app» داخل تطبيق مثبّت (Capacitor أو الشاشة الرئيسية)، وإلا «browser».
// - data-widget-side: جهة عمود ساعة النظام كما يبلغها iOS عبر safe-area (left/right/none).
//   في Safari الساعة في شريط Safari نفسه فالقيمة «none».
// Safari على الدوو لا يعطي مكان المفصل (لا viewport segments ولا device posture)، فالقرار من الاتجاه والمقاس.
(function () {
  var root = document.documentElement;
  var standalone = false;
  try { standalone = !!(window.Capacitor || navigator.standalone || (window.matchMedia && matchMedia("(display-mode: standalone)").matches)); } catch (e) { standalone = false; }
  root.setAttribute("data-shell", standalone ? "app" : "browser");
  function markDevice() {
    var lo = Math.min(screen.width, screen.height), hi = Math.max(screen.width, screen.height);
    root.setAttribute("data-device", lo >= 440 && lo <= 700 && hi / lo <= 1.48 ? "duo" : "other");
  }
  markDevice();
  window.addEventListener("resize", markDevice);
  var probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)";
  root.appendChild(probe);
  function markSide() {
    var cs = getComputedStyle(probe), l = parseFloat(cs.paddingLeft) || 0, r = parseFloat(cs.paddingRight) || 0;
    root.setAttribute("data-widget-side", l > 20 && l > r ? "left" : r > 20 ? "right" : "none");
  }
  markSide();
  // الحدود تتغيّر بعد حدث resize أحيانًا، فيُراقَب المسبار نفسه.
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(markSide).observe(probe);
  window.addEventListener("resize", function () { requestAnimationFrame(markSide); setTimeout(markSide, 400); });
  window.addEventListener("orientationchange", function () { setTimeout(markSide, 400); });
})();
