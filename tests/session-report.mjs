import assert from "node:assert/strict";
import { createSessionLog, summarizeSession, reportToMarkdown, clearAllSessionLogs } from "../web/session-log.js";
import { clockState } from "../web/lecture-clock.js";

const map = new Map();
const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k),
  key: (i) => [...map.keys()][i], get length() { return map.size; } };
let t = 1_900_000_000_000;
const log = createSessionLog({ bundle: "lecture_x", storage, now: () => t });
const tick = (ms) => { t += ms; };
log.slide(1); tick(60_000);
log.slide(2); tick(30_000);
log.scene({ slide: 2, type: "stat", title: "نسبة ذكرها المحاضر", lines: ["68%", "من حديث المحاضر"], source: "auto" }); tick(20_000);
log.digression("enter");
log.declined({ slide: 2, type: "story" }); tick(10_000);
log.slide(3); tick(5_000);
log.video({ slide: 3, clip: 0, action: "play", at: 0 }); tick(40_000);
log.video({ slide: 3, clip: 0, action: "pause", at: 40 });
log.slide(5, 2); tick(20_000);
log.scene({ slide: 5, type: "compare", title: "مقارنة", lines: ["أ | ب"], source: "approved" });
log.scene({ slide: 5, type: "<script>", title: "bad", lines: [] , source: "x" }); // ignored
log.slide(0); log.slide("x"); // ignored
const manifest = { source: "الألعاب.pptx", slideCount: 6 };
const polls = [{ question: "هل الألعاب مفيدة؟", options: ["نعم", "لا"], counts: [18, 7], total: 25 }];
const report = summarizeSession(log.current(), { manifest, polls, pendingQuestions: 3, usage: { callsUsed: 2, costUsd: 0.0031 }, endAt: t });
assert.equal(report.slidesVisited, 4);
assert.deepEqual(report.unvisited, [4, 6]);
assert.equal(report.slides.find((s) => s.index === 1).ms, 60_000);
assert.equal(report.slides.find((s) => s.index === 2).ms, 60_000, "scene time stays on its slide");
assert.equal(report.longest[0].ms, 60_000);
assert.equal(report.scenes.shown, 2);
assert.deepEqual([report.scenes.auto, report.scenes.approved, report.scenes.declined], [1, 1, 1]);
assert.equal(report.videos[0].playedMs, 40_000);
assert.equal(report.digressions, 1);
assert.equal(report.durationMs, 185_000);
assert.equal(report.polls[0].total, 25);
const markdown = reportToMarkdown(report);
for (const needle of ["الألعاب.pptx", "4 من 6", "لم تُعرض: 4، 6", "شريحة 2: stat", "18", "72%", "3", "ليس تقييماً"]) assert.ok(markdown.includes(needle), needle);
assert.ok(!/جيد|ممتاز|فهم الطلبة (جيد|ضعيف)/.test(markdown), "no invented pedagogical judgement");
// Persistence, bounds, idle split and deletion.
assert.equal(createSessionLog({ bundle: "lecture_x", storage, now: () => t }).all().length, 1, "survives reload");
t += 4 * 3600e3; log.slide(1);
assert.equal(log.all().length, 2, "a long idle gap starts a new session");
for (let i = 0; i < 900; i++) log.slide(1 + (i % 5));
assert.ok(log.current().events.length <= 800, "events are bounded");
log.end(); assert.ok(log.all().at(-1).endedAt);
// Only the lecturer's own actions are ever stored: no field can hold a student answer or identity.
assert.ok(!JSON.stringify(log.all()).match(/"token"|"ip"|"student|"answer"/));
log.clear(); assert.equal(log.all().length, 0); assert.equal(map.has("alfa-sessions-v1:lecture_x"), false);
createSessionLog({ bundle: "a1", storage, now: () => t }).slide(1); createSessionLog({ bundle: "b1", storage, now: () => t }).slide(1);
assert.equal(clearAllSessionLogs(storage), true); assert.equal([...map.keys()].filter((k) => k.startsWith("alfa-sessions")).length, 0);
// An empty session produces an honest empty report.
const empty = summarizeSession({ startedAt: t, events: [] }, { manifest: { slideCount: 3 }, endAt: t });
assert.deepEqual([empty.slidesVisited, empty.unvisited.length, empty.scenes.shown], [0, 3, 0]);
// ---- quiet clock ----
assert.deepEqual(clockState(65_000, 0), { label: "01:05", ratio: 0, phase: "none", hint: "" });
assert.equal(clockState(10 * 60e3, 50).phase, "normal");
assert.equal(clockState(41 * 60e3, 50).phase, "late");
assert.match(clockState(41 * 60e3, 50).hint, /9/);
assert.equal(clockState(55 * 60e3, 50).phase, "over");
assert.equal(clockState(55 * 60e3, 50).ratio, 1);
assert.equal(clockState(-5, 50).label, "00:00");
assert.equal(clockState(1000, 7).phase, "none", "unknown plan lengths are ignored");
console.log("session report: factual summary, bounds, privacy, deletion; quiet clock phases passed");
