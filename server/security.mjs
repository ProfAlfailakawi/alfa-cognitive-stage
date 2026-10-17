// Request classification. Lecture files, lecturer notes, memory and admin routes belong to the
// lecturer's own machine; classroom phones get a deliberately tiny "student surface".
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;
// Headers added by tunnels and reverse proxies. A proxy running on the lecturer's Mac connects
// from 127.0.0.1, so the socket address alone would wrongly look local.
const FORWARDING = ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "forwarded",
  "x-real-ip", "cf-connecting-ip", "cf-ray", "true-client-ip", "x-original-host", "via"];

export function allowedLectureClient(address, allowRemote = false) {
  if (allowRemote) return true;
  return LOOPBACK.has(String(address || "").trim().toLowerCase());
}

/**
 * "local" = the lecturer sitting at this machine. Anything arriving through a proxy/tunnel, or with a
 * Host header that is not localhost (also blocks DNS-rebinding against the local server), is "remote".
 */
export function requestOrigin(address, headers = {}) {
  if (!allowedLectureClient(address)) return "remote";
  if (FORWARDING.some((name) => headers[name] !== undefined)) return "remote";
  const host = headers.host;
  if (host !== undefined && !LOCAL_HOST.test(String(host))) return "remote";
  return "local";
}

const STUDENT_FILES = new Set(["/vote.html", "/vote.js", "/review.html", "/review.js", "/style.css", "/favicon.ico"]);
/** Is this request part of what a student phone may use? Called only for "remote" requests. */
export function studentSurfaceAllows(method, pathname) {
  if (method === "GET" || method === "HEAD") {
    if (STUDENT_FILES.has(pathname)) return true;
    if (/^\/fonts\/[A-Za-z0-9_.-]+\.woff2$/.test(pathname)) return true;
  }
  const api = pathname.match(/^\/api\/sessions\/([A-Za-z0-9]{6})\/(state|vote|questions|words|pulse|review)$/);
  if (!api) return false;
  if (api[2] === "state" || api[2] === "review") return method === "GET";
  return method === "POST"; // pulse included: the lecturer-only reads and context writes use other paths or the admin token
}
