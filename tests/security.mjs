import assert from "node:assert/strict";
import { allowedLectureClient } from "../server/security.mjs";
for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
  assert.equal(allowedLectureClient(ip), true);
}
for (const ip of ["192.168.10.45", "::ffff:192.168.1.9", "8.8.8.8", ""]) {
  assert.equal(allowedLectureClient(ip), false);
  assert.equal(allowedLectureClient(ip, true), true);
}
console.log("private lecture media access checks passed");
