import assert from "node:assert/strict";
import {
  rememberRejectedProposal, wasProposalRejected, countRejectedProposals, clearRejectedProposals
} from "../web/director-preferences.js";

const map = new Map();
const storage = {
  getItem: key => map.get(key) ?? null,
  setItem: (key, value) => map.set(key, value),
  removeItem: key => map.delete(key)
};
const now = 1800000000000;
const first = { bundle: "lecture1", slide: 7, utterance: "في دراسة: نسبة ٦٨٪ من الطلبة" };
assert.equal(rememberRejectedProposal(first, storage, now), true);
assert.equal(wasProposalRejected(first, storage, now), true);
assert.equal(wasProposalRejected({ ...first, utterance: "في دراسة نسبة 68% من الطلبة" }, storage, now), true);
assert.equal(countRejectedProposals("lecture1", storage, now), 1);
assert.equal(wasProposalRejected({ ...first, utterance: "في دراسة نسبة 69% من الطلبة" }, storage, now), false,
  "Corrected percentages must never be suppressed");
assert.equal(wasProposalRejected({ ...first, slide: 8 }, storage, now), false,
  "Dismissal must not propagate to a different slide");
assert.equal(wasProposalRejected({ ...first, bundle: "lecture2" }, storage, now), false,
  "Dismissal must not propagate across lectures");
assert.equal([...map.values()][0].includes("دراسة"), false, "Do not persist raw voice transcripts");
assert.equal([...map.values()][0].includes("الطلبة"), false, "Do not persist raw voice transcripts");
assert.equal(rememberRejectedProposal(first, storage, now + 1), true);
assert.equal(countRejectedProposals("lecture1", storage, now + 1), 1, "Duplicate dismissal is refreshed");
const afterExpiry = now + 14 * 24 * 60 * 60 * 1000 + 2;
assert.equal(wasProposalRejected(first, storage, afterExpiry), false, "Dismissal expires after 14 days");

for (let i = 0; i < 85; i++) {
  assert.equal(rememberRejectedProposal({ bundle: "lecture1", slide: 1,
    utterance: "دراسة تعليمية نسبة " + i + "% من الطلبة" }, storage, now), true);
}
assert.equal(countRejectedProposals("lecture1", storage, now), 80, "Store is capped");
assert.equal(wasProposalRejected({ bundle: "lecture1", slide: 1,
  utterance: "دراسة تعليمية نسبة 0% من الطلبة" }, storage, now), false, "Evict oldest entries");
assert.equal(clearRejectedProposals("lecture1", storage), true);
assert.equal(countRejectedProposals("lecture1", storage, now), 0);
assert.equal(rememberRejectedProposal({ ...first, utterance: "" }, storage, now), false);
assert.equal(wasProposalRejected(null, storage, now), false);
const blockedStorage = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); },
  removeItem() { throw Error("blocked"); } };
assert.equal(rememberRejectedProposal(first, blockedStorage, now), false);
assert.equal(wasProposalRejected(first, blockedStorage, now), false);
assert.equal(clearRejectedProposals("lecture1", blockedStorage), false);
assert.equal(countRejectedProposals("lecture1", blockedStorage, now), 0);
const corruptStorage = { getItem() { return "[broken"; }, setItem() {}, removeItem() {} };
assert.equal(wasProposalRejected(first, corruptStorage, now), false);
console.log("director rejection preferences: normalized match, numeric guard, isolation, expiration, bounded privacy and clear passed");
