// Student review page: read-only, built by the lecturer from what was shown in the lecture. textContent only.
/* duo-markers:start — علامات iPhone Duo على جذر الصفحة (النسخة المشتركة بين تطبيقات العائلة). نصٌّ واحد في
   web/duo-markers.js وأول web/vote.js وweb/review.js (صفحات الطلبة لا تحمّل ملفاتٍ غيرها)، ويحرس تطابقه tests/duo-book-guard.mjs.
   data-device «duo» على iPhone Duo وحده: iPhone أو غلاف iOS، والضلع القصير للشاشة ≤ 720 (كل iPad ≥ 744)، وشاشة شبه مربّعة
   (الضلع القصير 400–720 والنسبة ≤ 1.62؛ كل iPhone ≥ 1.78) أو نافذة ضلعها القصير بين 500 و720. وفي غيره «other»،
   فركن الودجت في style.css (تحت html[data-device="duo"]) لا يمسّ iPhone العادي ولا iPad ولا الحاسوب. */
(() => {
  const root = document.documentElement;
  const isApp = () => { try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) || navigator.standalone === true || matchMedia("(display-mode: standalone)").matches; } catch { return false; } };
  const isAppleHandheld = () => { try { return /iPhone|iPod/.test(navigator.userAgent) || !!(window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === "ios"); } catch { return false; } };
  const nearSquare = (a, b) => { const lo = Math.min(a, b), hi = Math.max(a, b); return lo >= 400 && lo <= 720 && hi / lo <= 1.62; };
  const markDevice = () => {
    const shortScreen = Math.min(screen.width, screen.height);
    const viewportShort = Math.min(innerWidth, innerHeight);
    const duo = isAppleHandheld() && shortScreen <= 720 && (nearSquare(screen.width, screen.height) || nearSquare(screen.availWidth, screen.availHeight) || (viewportShort > 500 && viewportShort <= 720));
    root.dataset.device = duo ? "duo" : "other";
    root.dataset.shell = isApp() ? "app" : "browser";
  };
  markDevice();
  addEventListener("resize", markDevice);
  addEventListener("orientationchange", () => setTimeout(markDevice, 400));
})();
/* duo-markers:end */
const app = document.getElementById("app");
const code = new URLSearchParams(location.search).get("s") || "";
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

async function main() {
  if (!/^[A-Za-z0-9]{6}$/.test(code)) return app.replaceChildren(el("p", { className: "tag", textContent: "الرابط غير مكتمل." }));
  const res = await fetch(`/api/sessions/${code.toUpperCase()}/review`).catch(() => null);
  if (!res || !res.ok) return app.replaceChildren(el("p", { className: "tag", textContent: res?.status === 404 ? "لم يُنشر المحاضر مراجعة بعد." : "تعذّر الاتصال." }));
  const review = await res.json();
  app.replaceChildren(el("h1", { textContent: review.title || "مراجعة المحاضرة" }));
  for (const item of review.items) {
    app.append(el("section", {}, el("h2", { textContent: item.heading }),
      el("p", { className: "tag", textContent: "شريحة " + item.slide }),
      el("ul", {}, ...item.lines.map((l) => el("li", { textContent: l })))));
  }
  app.append(el("p", { className: "tag", textContent: "هذه المراجعة مأخوذة مما عُرض أثناء المحاضرة فقط." }));
}
main();
