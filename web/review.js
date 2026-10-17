// Student review page: read-only, built by the lecturer from what was shown in the lecture. textContent only.
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
