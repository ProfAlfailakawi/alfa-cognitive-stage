// Voting race on the projected poll. Presentation only: the poll screen is still rebuilt from the same data on
// every pulse (app.js renderPollScreen); this module reads what was on screen just before and animates from it.
//  - option bars glide from their previous length to the new one (a "race") instead of jumping;
//  - the first time results appear, a stage light sweeps across them once and the leading option is lit;
//  - the word cloud is packed (spiral placement + a short relaxation towards the centre): settled words keep
//    their place, repeated words grow where they stand, new words grow in from the centre.
// Text is never animated: every label shows its exact final value. Reduced motion gets the final layout at once.

const LIGHT_MS = 1400;
const reduced = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const pollKey = (active) => JSON.stringify([active?.kind || "choice", active?.question || "", active?.options || []]);

/** What the poll screen shows right now (call before it is removed). Never throws. */
export function snapshotPollScreen(doc = document) {
  try { return snapshot(doc); } catch { return null; }
}
function snapshot(doc) {
  const overlay = doc.querySelector(".vote-projection");
  if (!overlay) return null;
  const bars = [...overlay.querySelectorAll(".vote-result-bar")].map((bar) => {
    const fill = bar.firstElementChild, track = bar.getBoundingClientRect().width;
    // The length actually drawn (mid-glide included), so a quick second pulse continues smoothly.
    return fill && track > 0 ? (100 * fill.getBoundingClientRect().width / track).toFixed(2) + "%" : fill?.style.width || "0%";
  });
  const words = new Map([...overlay.querySelectorAll(".vote-cloud-word")].map((el) =>
    [el.dataset.word, { x: Number(el.dataset.x) || 0, y: Number(el.dataset.y) || 0, size: el.style.fontSize }]));
  return { key: overlay.dataset.pollKey || "", bars, words, revealAt: Number(overlay.dataset.revealAt) || 0,
    revealed: Boolean(overlay.querySelector(".vote-live-results, .vote-wordcloud")) };
}

/** Animates a freshly built poll screen from the previous snapshot. Never throws, so callers carry on exactly as before. */
export function animatePollScreen(overlay, data, before) {
  try { animate(overlay, data, before); } catch { /* decoration only: the poll screen is already complete */ }
}
function animate(overlay, data, before) {
  const active = data?.active;
  if (!overlay || !active) return;
  const key = pollKey(active);
  overlay.dataset.pollKey = key;
  const same = Boolean(before && before.key === key);
  const calm = reduced();
  const results = overlay.querySelector(".vote-live-results, .vote-wordcloud");
  if (!results) return;

  // Stage light: once per reveal. If a pulse rebuilds the screen mid-sweep, the sweep carries on where it was.
  const now = Date.now();
  const revealAt = same && before.revealed ? before.revealAt : now;
  overlay.dataset.revealAt = String(revealAt);
  if (!calm && now - revealAt < LIGHT_MS) {
    overlay.style.setProperty("--light-delay", -(now - revealAt) + "ms");
    overlay.classList.add("is-revealing");
  }

  const fills = [...overlay.querySelectorAll(".vote-result-bar > span")];
  if (fills.length) {
    const counts = Array.isArray(active.counts) ? active.counts.map((n) => Number(n) || 0) : [];
    const top = Math.max(0, ...counts);
    fills.forEach((fill, i) => { if (top > 0 && counts[i] === top) fill.parentElement.classList.add("is-leading"); });
    if (!calm) {
      const targets = fills.map((fill) => fill.style.width);
      fills.forEach((fill, i) => { fill.style.width = same && before.bars[i] ? before.bars[i] : "0%"; });
      void overlay.offsetWidth; // commit the starting lengths so the change below is a transition
      fills.forEach((fill, i) => { fill.style.width = targets[i]; });
    }
  }
  const cloud = overlay.querySelector(".vote-wordcloud");
  if (cloud) packCloud(cloud, same ? before.words : new Map(), calm);
}

// ---- Word cloud packing ----
const overlaps = (a, b) => a.x - a.w / 2 < b.x + b.w / 2 && b.x - b.w / 2 < a.x + a.w / 2 && a.y - a.h / 2 < b.y + b.h / 2 && b.y - b.h / 2 < a.y + a.h / 2;

function place(sizes, W, H, prev) {
  const placed = [], inside = (r) => Math.abs(r.x) + r.w / 2 <= W / 2 && Math.abs(r.y) + r.h / 2 <= H / 2;
  const free = (r, skip = -1) => inside(r) && placed.every((p, j) => j === skip || !overlaps(r, p));
  const stretch = Math.max(1, W / Math.max(1, H));
  for (const s of sizes) {
    let spot = null;
    const old = prev.get(s.word);
    if (old && free({ ...s, x: old.x, y: old.y })) spot = { ...s, x: old.x, y: old.y, kept: true }; // settled words stay put
    for (let t = 0; !spot && t < 160; t += 0.22) {
      const r = { ...s, x: 3.2 * t * Math.cos(t) * stretch, y: 3.2 * t * Math.sin(t) };
      if (free(r)) spot = r;
    }
    if (!spot) return null;
    placed.push(spot);
  }
  // Relaxation: a few passes drawing each newly placed word towards the centre while it still fits; this is the
  // "settle". Words that kept their place are left alone, so a pulse with no new answers moves nothing.
  for (let pass = 0; pass < 6; pass++) {
    placed.forEach((p, i) => {
      if (p.kept) return;
      const r = { ...p, x: p.x * 0.88, y: p.y * 0.88 };
      if (free(r, i)) placed[i] = r;
    });
  }
  return placed;
}

function packCloud(cloud, prev, calm) {
  const words = [...cloud.children];
  if (!words.length) return;
  // Re-pack (without motion) if the stage changes size, e.g. the projector window is resized.
  if (typeof ResizeObserver === "function" && !cloud.__racePack) {
    // Watch the projection itself, not the cloud: packing changes the cloud's own box, which must not re-trigger.
    const stage = cloud.closest(".vote-projection") || cloud.parentElement || cloud;
    let last = `${stage.clientWidth}x${stage.clientHeight}`;
    cloud.__racePack = new ResizeObserver(() => {
      if (!cloud.isConnected) { cloud.__racePack.disconnect(); return; }
      const size = `${stage.clientWidth}x${stage.clientHeight}`;
      if (size === last) return;
      last = size;
      cloud.style.fontSize = "";
      const here = new Map([...cloud.children].map((el) => [el.dataset.word, { x: Number(el.dataset.x) || 0, y: Number(el.dataset.y) || 0, size: el.style.fontSize }]));
      packCloud(cloud, here, true);
    });
    cloud.__racePack.observe(stage);
  }
  cloud.classList.add("is-packed");
  let W = cloud.clientWidth, H = cloud.clientHeight;
  if (W < 60 || H < 30) { // not laid out (hidden preview): keep the flowing list
    cloud.classList.remove("is-packed");
    for (const el of words) { el.style.transform = ""; el.style.opacity = ""; el.classList.remove("vote-cloud-word"); }
    return;
  }
  const base = parseFloat(getComputedStyle(cloud).fontSize) || 16;
  let layout = null;
  for (let shrink = 1; shrink >= 0.3 && !layout; shrink -= 0.1) {
    cloud.style.fontSize = (base * shrink).toFixed(1) + "px";
    const sizes = words.map((el) => ({ el, word: el.textContent, w: el.offsetWidth + 10, h: el.offsetHeight * 0.92 }));
    layout = place(sizes, W, H, shrink === 1 ? prev : new Map());
  }
  if (!layout) { // too small to pack (a tiny preview): fall back to the original flowing list
    cloud.style.fontSize = ""; cloud.classList.remove("is-packed");
    for (const el of words) { el.style.transform = ""; el.style.opacity = ""; el.classList.remove("vote-cloud-word"); }
    return;
  }
  const at = (x, y, scale = 1) => `translate(calc(-50% + ${x.toFixed(1)}px), calc(-50% + ${y.toFixed(1)}px)) scale(${scale})`;
  for (const r of layout) {
    const el = r.el, old = prev.get(r.word), target = el.style.fontSize;
    el.classList.add("vote-cloud-word");
    el.dataset.word = r.word; el.dataset.x = r.x.toFixed(1); el.dataset.y = r.y.toFixed(1);
    if (!calm) {
      el.style.transform = old ? at(old.x, old.y) : at(0, 0, 0.2);
      if (old?.size) el.style.fontSize = old.size;
      if (!old) el.style.opacity = "0";
    }
    el.dataset.to = at(r.x, r.y);
    el.dataset.size = target;
  }
  if (!calm) void cloud.offsetWidth;
  for (const el of words) {
    el.style.transform = el.dataset.to; el.style.fontSize = el.dataset.size; el.style.opacity = "";
    delete el.dataset.to; delete el.dataset.size;
  }
}
