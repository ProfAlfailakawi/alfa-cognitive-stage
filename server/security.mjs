// Only the lecturer's Mac serves lecture media by default; students need just voting.
export function allowedLectureClient(address, allowRemote = false) {
  if (allowRemote) return true;
  const ip = String(address || "").trim().toLowerCase();
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}
