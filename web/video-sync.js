// Pure safeguards for low-overhead presenter/audience media synchronization.
// Does not claim frame-perfect, projector or hardware-level synchronization.
export const DRIFT_LIMIT_SECONDS = 0.85;
export function validMediaTime(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
export function sameLecture(message, bundle) {
  return Boolean(message && typeof message === "object" &&
    typeof bundle === "string" && bundle.length > 0 &&
    typeof message.bundle === "string" && message.bundle === bundle);
}
export function validVideoPacket(message, bundle, slide, clipCount) {
  return sameLecture(message, bundle) && message.type === "video" &&
    Number.isInteger(message.index) && message.index === slide &&
    Number.isInteger(message.clip) && message.clip >= 0 && message.clip < clipCount &&
    ["play", "pause", "seek", "progress", "ended"].includes(message.action) &&
    validMediaTime(message.time);
}
export function needsMediaSeek(currentTime, desiredTime, limit = DRIFT_LIMIT_SECONDS) {
  return validMediaTime(currentTime) && validMediaTime(desiredTime) &&
    Number.isFinite(limit) && limit >= 0 && Math.abs(currentTime - desiredTime) > limit;
}
export function validSnapshot(message, bundle, clipCount) {
  return sameLecture(message, bundle) && message.type === "snapshot" &&
    Number.isInteger(message.index) && message.index >= 1 &&
    Number.isInteger(clipCount) && clipCount >= 0 &&
    Array.isArray(message.videos) && message.videos.length === clipCount &&
    message.videos.every(item => item && validMediaTime(item.time) &&
      typeof item.playing === "boolean");
}
