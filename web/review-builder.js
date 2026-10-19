// Student review page content. Built ONLY from scenes the lecturer actually showed (their own words, as they
// were displayed) and slide titles from the lecture file. Nothing is added from outside the lecture.
const clip = (v, n) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

export function buildReview(report, manifest = {}) {
  const titles = new Map((manifest.slides || []).map((s) => [s.index, clip(s.title || s.text?.split("\n")[0] || "", 120)]));
  const seen = new Set();
  const bySlide = new Map();
  for (const sc of (report?.scenes?.list || [])) {
    const lines = (sc.lines || []).map((l) => clip(l, 140)).filter(Boolean);
    const heading = clip(sc.title, 120);
    if (!heading && !lines.length) continue;
    const key = [sc.slide, heading, lines.join("|")].join("::");
    if (seen.has(key)) continue;
    seen.add(key);
    (bySlide.get(sc.slide) || bySlide.set(sc.slide, []).get(sc.slide)).push({ heading, lines });
  }
  // A lecture remains reviewable even when no extra infographic was projected.
  // Use only slides actually visited; never publish private speaker notes.
  const visited = new Set((report?.slides || []).map((r) => Number(r.index)).filter((i) => Number.isInteger(i) && i > 0));
  const slideByIndex = new Map((manifest.slides || []).map((s) => [Number(s.index), s]));
  for (const index of visited) {
    if (bySlide.has(index)) continue;
    const source = slideByIndex.get(index);
    if (!source) continue;
    const heading = clip(source.title || String(source.text || "").split(/\r?\n/)[0] || "شريحة " + index, 120);
    const lines = String(source.text || "").split(/\r?\n/).map((part) => clip(part, 140))
      .filter((part) => part && part !== heading).slice(0, 3);
    if (heading || lines.length) bySlide.set(index, [{ heading: heading || "شريحة " + index, lines }]);
  }
  const items = [];
  for (const slide of [...bySlide.keys()].sort((a, b) => a - b)) {
    for (const sc of bySlide.get(slide)) items.push({ slide, heading: sc.heading || titles.get(slide) || "شريحة " + slide, lines: sc.lines });
  }
  return { title: clip(manifest.title || manifest.source || report?.lecture || "مراجعة المحاضرة", 120), items: items.slice(0, 40) };
}

export function reviewToMarkdown(review) {
  const out = ["# " + review.title, ""];
  for (const i of review.items) { out.push(`## شريحة ${i.slide}: ${i.heading}`); for (const l of i.lines) out.push("- " + l); out.push(""); }
  out.push("> هذه المراجعة مأخوذة مما عُرض أثناء المحاضرة فقط.");
  return out.join("\n");
}
