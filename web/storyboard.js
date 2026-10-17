// Offline, non-generative visual story session.
// Symbols/sequence are generic; each detail shown originates in lecturer speech.
export function createStorySession(utterance, now = Date.now()) {
  const line = String(utterance || "").trim().slice(0, 110);
  if (!line) return null;
  return { lines: [line], startedAt: now, lastAt: now };
}

export function advanceStorySession(session, utterance, now = Date.now()) {
  if (!session || now - session.lastAt > 120000) return null;
  const line = String(utterance || "").trim().slice(0, 110);
  if (line.length < 12 || session.lines.at(-1) === line) return session;
  const lines = session.lines.length < 4 ? [...session.lines, line] : [...session.lines.slice(-3), line];
  return { ...session, lines, lastAt: now };
}

export function storySceneSpec(session) {
  if (!session?.lines?.length) return null;
  return { type: "story", title: "القصة الحية", lines: session.lines };
}
