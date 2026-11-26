// World transitions: each design-world family enters the stage in its own way (eclipse wipe, page laid down,
// roots growing, ink bleed, light sweep ...). Presentation only: the scene, its timing and every message stay the
// same; the layer just carries the family name and style.css picks the entrance (same .55s budget as the
// classic fade). Scenes outside the 64 worlds keep the classic entrance; reduced motion shows the scene still.
import { parseWorld, WORLD_BY_ID } from "./world-theme.js";

export const TRANSITION_FAMILIES = Object.freeze([
  "cosmic", "editorial", "organic", "architectural", "kuwait-gulf", "technology-data", "cinematic", "quiet-luxury",
  "typographic", "surreal", "human-emotional", "experimental", "academic-knowledge", "media-society",
  "education-childhood", "material-environment",
]);

/** The family whose entrance a scene uses, or "" for the classic fade. Never throws. */
export function transitionFamily(spec) {
  try {
    const world = parseWorld(spec?.theme);
    const family = world ? WORLD_BY_ID.get(world.id)?.family : "";
    return family && TRANSITION_FAMILIES.includes(family) ? family : "";
  } catch { return ""; }
}

/** Marks a freshly built scene layer so its entrance follows the scene's world. */
export function markTransition(layer, spec) {
  const family = transitionFamily(spec);
  if (family) layer.dataset.enter = family;
  else delete layer.dataset.enter;
  return family;
}
