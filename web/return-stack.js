// Digression return context. When the lecturer leaves the original presentation state
// (a scene, a poll, a nested scene), the exact state is captured so one return restores
// slide, build click, video position/play state and overlays. Pure logic; no DOM.
export function createReturnStack(limit = 6) {
  let base = null;
  const layers = [];
  return {
    active: () => base !== null,
    depth: () => (base ? 1 : 0) + layers.length,
    // Call BEFORE showing an overlay. `capture` is only invoked when a new level starts.
    enter(capture) {
      const snapshot = capture();
      if (!base) { base = { ...snapshot, overlay: null, poll: false }; return 1; }
      layers.push(snapshot);
      if (layers.length > limit) layers.shift();
      return this.depth();
    },
    // One level back: previous overlay if nested, otherwise the original state.
    back() {
      if (layers.length) return layers.pop();
      const original = base;
      base = null;
      return original;
    },
    // Full return to the original state.
    home() {
      const original = base;
      base = null;
      layers.length = 0;
      return original;
    },
    // The lecturer resumed by navigating; the old anchor no longer applies.
    clear() { base = null; layers.length = 0; },
  };
}
