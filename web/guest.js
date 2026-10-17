// Guest mode (?guest=1): nothing is written to this browser's storage. A guest lecturer can present with the
// same files without reading or leaving behind the host's memory, taste, session logs or recordings.
// Loaded before the app. Server-side stores are separated by `npm run start:guest` (temporary data directory).
(() => {
  if (new URLSearchParams(location.search).get("guest") !== "1") return;
  const makeMemory = () => {
    const map = new Map();
    return {
      get length() { return map.size; }, key: (i) => [...map.keys()][i] ?? null,
      getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
      setItem: (k, v) => { map.set(String(k), String(v)); }, removeItem: (k) => { map.delete(String(k)); }, clear: () => map.clear(),
    };
  };
  for (const name of ["localStorage", "sessionStorage"]) {
    try { Object.defineProperty(window, name, { value: makeMemory(), configurable: true }); } catch {}
  }
  window.__alfaGuest = true;
})();
