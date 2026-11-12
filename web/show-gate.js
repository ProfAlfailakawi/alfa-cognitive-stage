// Viewer side of the ALFA Presentation Engine protocol: decides what to do with each versioned update.
// A snapshot (sent on every connect) adopts the session; ordinary updates must follow it one by one.
// Duplicates and late packets are dropped so the projector never steps back; a missing version or a
// foreign session asks for a fresh snapshot instead of guessing.
export function createVersionGate() {
  let session = null, version = 0;
  return {
    accept(update) {
      if (!update || typeof update.session !== "string" || !Number.isSafeInteger(update.version) || update.version < 0) return "drop";
      if (update.snapshot) {
        if (update.session === session && update.version < version) return "drop";
        session = update.session; version = update.version;
        return "apply";
      }
      if (update.session !== session) return "resync";
      if (update.version <= version) return "drop";
      if (update.version > version + 1) return "resync";
      version = update.version;
      return "apply";
    },
    get state() { return { session, version }; },
  };
}
