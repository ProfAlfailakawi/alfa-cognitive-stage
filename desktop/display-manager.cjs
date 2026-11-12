// Display decisions for the ALFA Mac app. Pure functions over Electron's Display objects
// ({ id, bounds, workArea, scaleFactor, internal, label }), so every case is testable without hardware.
"use strict";

const valid = (d) => d && Number.isSafeInteger(d.id) && d.bounds && d.bounds.width > 0 && d.bounds.height > 0;

/** The lecturer's console belongs on the Mac's own screen; otherwise on the system's main display. */
function chooseConsoleDisplay(displays, primaryId) {
  const list = (displays || []).filter(valid);
  return list.find((d) => d.internal) || list.find((d) => d.id === primaryId) || list[0] || null;
}

/** Two displays at the same origin and size are one picture (mirroring): they cannot separate content. */
function independentOf(a, b) {
  return !(a.bounds.x === b.bounds.x && a.bounds.y === b.bounds.y && a.bounds.width === b.bounds.width && a.bounds.height === b.bounds.height);
}

/**
 * Where the students' screen goes. Never the console's display. A display the lecturer confirmed before is
 * reused while it is connected; otherwise an external display is proposed, and with several the lecturer chooses.
 * Returns { display, needsChoice, reason }.
 */
function chooseAudienceDisplay(displays, { consoleId, savedId } = {}) {
  const list = (displays || []).filter(valid);
  const consoleDisplay = list.find((d) => d.id === consoleId) || null;
  const candidates = list.filter((d) => d.id !== consoleId && (!consoleDisplay || independentOf(d, consoleDisplay)));
  if (!candidates.length) return { display: null, needsChoice: false, reason: list.length > 1 ? "mirrored" : "single" };
  const saved = candidates.find((d) => d.id === savedId);
  if (saved) return { display: saved, needsChoice: false, reason: "saved" };
  const external = candidates.filter((d) => !d.internal);
  const pool = external.length ? external : candidates;
  // Several projectors/monitors: propose the largest, but the lecturer confirms.
  const best = [...pool].sort((a, b) => b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height || a.bounds.x - b.bounds.x)[0];
  return { display: best, needsChoice: pool.length > 1, reason: pool.length > 1 ? "several" : "external" };
}

/** Human labels for the chooser: name, resolution in real pixels, position words. */
function describeDisplays(displays, { consoleId } = {}) {
  return (displays || []).filter(valid).map((d, i) => ({
    id: d.id,
    label: d.label || (d.internal ? "شاشة الماك" : "شاشة " + (i + 1)),
    internal: Boolean(d.internal),
    isConsole: d.id === consoleId,
    resolution: `${Math.round(d.bounds.width * (d.scaleFactor || 1))}×${Math.round(d.bounds.height * (d.scaleFactor || 1))}`,
    bounds: { ...d.bounds },
  }));
}

/** After a hot-plug: is the chosen audience display still there, and where is it now? */
function locate(displays, id) {
  return (displays || []).filter(valid).find((d) => d.id === id) || null;
}

module.exports = { chooseConsoleDisplay, chooseAudienceDisplay, describeDisplays, locate, independentOf };
