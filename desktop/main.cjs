// ALFA for Mac: a native host that owns the screens. It runs (or reuses) the local ALFA server,
// keeps the lecturer's console on the Mac's own screen, and puts the students' screen on the projector
// as a borderless window the size of that display. What the students see comes from the Presentation
// Engine in the server (versioned snapshots, never notes), so the console can also be Chrome (for voice).
"use strict";
const { app, BrowserWindow, ipcMain, screen, session, shell, dialog, Menu } = require("electron");
const { spawn, execFile } = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
const dm = require("./display-manager.cjs");

const isMac = process.platform === "darwin";
const state = {
  root: null, base: null, server: null, owned: false,
  consoleWin: null, audienceWin: null, notesWin: null,
  audienceDisplayId: null, showing: false, bundle: null, quitting: false, hostReq: null,
};
const log = (...a) => { if (process.env.ALFA_DESKTOP_LOG !== "0") console.log("[alfa-desktop]", ...a); };

// ---------- where ALFA lives ----------
function configFile() { return path.join(app.getPath("userData"), "alfa-desktop.json"); }
function readConfig() { try { return JSON.parse(fs.readFileSync(configFile(), "utf8")); } catch { return {}; } }
function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  try { fs.mkdirSync(path.dirname(configFile()), { recursive: true }); fs.writeFileSync(configFile(), JSON.stringify(next, null, 2)); } catch (e) { log("config not saved:", e.message); }
  return next;
}
const isAlfaRoot = (dir) => { try { return fs.statSync(path.join(dir, "server", "server.mjs")).isFile(); } catch { return false; } };
async function findRoot() {
  const candidates = [process.env.ALFA_ROOT, app.isPackaged ? null : path.resolve(__dirname, ".."), readConfig().root,
    path.join(app.getPath("downloads"), "ALFA-cognitive-stage"), path.join(app.getPath("home"), "ALFA-cognitive-stage")].filter(Boolean);
  for (const dir of candidates) if (isAlfaRoot(dir)) return dir;
  const pick = await dialog.showOpenDialog({ title: "اختر مجلد ALFA", message: "اختر المجلد الذي فيه Start ALFA.command", properties: ["openDirectory"] });
  const dir = pick.filePaths?.[0];
  if (dir && isAlfaRoot(dir)) { writeConfig({ root: dir }); return dir; }
  return null;
}

// ---------- the local server: reuse a running ALFA, or start our own on a free port ----------
function getJson(url, timeout = 1200) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout }, (res) => {
      let body = ""; res.setEncoding("utf8");
      res.on("data", (c) => { body += c; if (body.length > 65536) req.destroy(); });
      res.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on("timeout", () => req.destroy()); req.on("error", () => resolve(null));
  });
}
const portFree = (port) => new Promise((resolve) => {
  const s = net.createServer().once("error", () => resolve(false)).once("listening", () => s.close(() => resolve(true)));
  s.listen(port, "127.0.0.1");
});
// The same environment Start ALFA.command prepares: the import tools' Python and the usual tool folders
// (an app opened from Finder does not inherit the terminal's PATH).
function serverEnv(root, port) {
  const venv = path.join(root, ".venv", "bin", "python");
  return { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(port),
    PATH: ["/opt/homebrew/bin", "/usr/local/bin", "/Applications/LibreOffice.app/Contents/MacOS", process.env.PATH || "/usr/bin:/bin"].join(":"),
    ...(fs.existsSync(venv) && !process.env.ALFA_PYTHON ? { ALFA_PYTHON: venv } : {}) };
}
async function startServer(root) {
  const preferred = Number(process.env.ALFA_PORT) || 4173;
  for (let port = preferred; port < preferred + 20; port++) {
    const existing = await getJson(`http://127.0.0.1:${port}/api/show/status`);
    if (existing?.alfa) { log("reusing ALFA already running on", port); return { base: `http://127.0.0.1:${port}`, child: null }; }
    if (!(await portFree(port))) continue; // someone else's program: leave it alone
    const child = spawn(process.execPath, [path.join(root, "server", "server.mjs")], {
      cwd: root, env: serverEnv(root, port), stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr.on("data", (d) => log("server:", String(d).trim().slice(0, 300)));
    const ok = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 15000);
      child.stdout.on("data", (d) => { if (/localhost:\d+/.test(String(d))) { clearTimeout(timer); resolve(true); } });
      child.once("exit", () => { clearTimeout(timer); resolve(false); });
    });
    if (ok) { log("server started on", port); return { base: `http://127.0.0.1:${port}`, child }; }
    try { child.kill(); } catch {}
  }
  throw new Error("تعذر تشغيل خادم ALFA المحلي");
}

// ---------- windows ----------
const secure = (extra = {}) => ({ contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false, ...extra });
const TEST = process.env.ALFA_DESKTOP_TEST === "1";
// Tests can describe a room (two or three screens, hot-plug) that the CI machine does not have.
function displays() { return (TEST && globalThis.__alfaFakeDisplays) || screen.getAllDisplays(); }
function consoleDisplay() {
  const fake = TEST && globalThis.__alfaFakeDisplays;
  return dm.chooseConsoleDisplay(displays(), fake ? fake[0]?.id : screen.getPrimaryDisplay().id);
}
function notifyConsole(payload) {
  for (const win of [state.consoleWin, state.notesWin]) if (win && !win.isDestroyed()) win.webContents.send("alfa:display-event", payload);
}
function displayList() { return dm.describeDisplays(displays(), { consoleId: consoleDisplay()?.id }); }

function createConsole() {
  const d = consoleDisplay();
  const wa = d.workArea || d.bounds;
  state.consoleWin = new BrowserWindow({
    x: wa.x, y: wa.y, width: wa.width, height: wa.height, minWidth: 900, minHeight: 600, show: false,
    title: "ALFA — لوحة المحاضر", backgroundColor: "#0c171b",
    webPreferences: secure({ preload: path.join(__dirname, "preload.cjs") }),
  });
  state.consoleWin.loadURL(`${state.base}/?desktop=1#presenter`);
  state.consoleWin.once("ready-to-show", () => { state.consoleWin.maximize(); state.consoleWin.show(); });
  state.consoleWin.on("closed", () => { state.consoleWin = null; if (!state.quitting) app.quit(); });
}

function placeAudience(display) {
  const win = state.audienceWin;
  if (!win || win.isDestroyed() || !display) return;
  if (isMac && win.isSimpleFullScreen()) win.setSimpleFullScreen(false);
  win.setBounds(display.bounds);
  // Borderless at the display's full size; on macOS "simple" full screen also hides the menu bar there
  // without creating a separate Space (native full screen would). ALFA_NATIVE_FULLSCREEN=1 tries the native one.
  if (TEST) return; // a test must not take over the developer's screen
  if (isMac && process.env.ALFA_NATIVE_FULLSCREEN === "1") win.setFullScreen(true);
  else if (isMac) win.setSimpleFullScreen(true);
}

function openAudience(display) {
  if (!state.audienceWin || state.audienceWin.isDestroyed()) {
    state.audienceWin = new BrowserWindow({
      ...display.bounds, show: false, frame: false, closable: false, minimizable: false, maximizable: false,
      fullscreenable: true, hasShadow: false, roundedCorners: false, enableLargerThanScreen: true, skipTaskbar: true,
      backgroundColor: "#000000", title: "ALFA — شاشة الطلبة",
      webPreferences: secure({ backgroundThrottling: false, autoplayPolicy: "no-user-gesture-required" }),
    });
    const q = state.bundle ? `bundle=${encodeURIComponent(state.bundle)}&relay=1` : "relay=1";
    state.audienceWin.loadURL(`${state.base}/?${q}#audience`);
    state.audienceWin.webContents.on("render-process-gone", () => { if (state.showing) setTimeout(() => state.audienceWin?.webContents.reload(), 500); });
    state.audienceWin.once("ready-to-show", () => {
      placeAudience(display);
      state.audienceWin.showInactive(); // the projector never takes the keyboard from the lecturer
      state.consoleWin?.focus();
    });
    state.audienceWin.on("closed", () => { state.audienceWin = null; });
  } else {
    placeAudience(display);
    if (!state.audienceWin.isVisible()) state.audienceWin.showInactive();
    state.consoleWin?.focus();
  }
  state.audienceDisplayId = display.id;
  state.showing = true;
}

function startShow(requestedId, bundle) {
  if (typeof bundle === "string" && /^[a-zA-Z0-9_-]{4,64}$/.test(bundle)) state.bundle = bundle;
  const consoleId = consoleDisplay()?.id;
  let display = Number.isSafeInteger(requestedId) ? dm.locate(displays(), requestedId) : null;
  if (display && display.id === consoleId) display = null;
  let pick = { display, needsChoice: false, reason: "requested" };
  if (!display) pick = dm.chooseAudienceDisplay(displays(), { consoleId, savedId: readConfig().audienceDisplayId });
  if (!pick.display) {
    notifyConsole({ kind: "no-projector", reason: pick.reason, displays: displayList() });
    return { ok: false, reason: pick.reason, displays: displayList() };
  }
  if (pick.needsChoice) {
    notifyConsole({ kind: "choose-display", displays: displayList(), proposed: pick.display.id });
    return { ok: false, reason: "several", proposed: pick.display.id, displays: displayList() };
  }
  writeConfig({ audienceDisplayId: pick.display.id });
  openAudience(pick.display);
  notifyConsole({ kind: "show-started", displayId: pick.display.id, displays: displayList() });
  return { ok: true, displayId: pick.display.id };
}

function endShow() {
  state.showing = false;
  if (state.audienceWin && !state.audienceWin.isDestroyed()) {
    if (isMac && state.audienceWin.isSimpleFullScreen()) state.audienceWin.setSimpleFullScreen(false);
    state.audienceWin.setClosable(true);
    state.audienceWin.close();
  }
  state.audienceWin = null;
  notifyConsole({ kind: "show-ended" });
  return { ok: true };
}

function identifyDisplays() {
  const list = displayList();
  for (const [i, d] of list.entries()) {
    const w = new BrowserWindow({
      x: Math.round(d.bounds.x + d.bounds.width / 2 - 260), y: Math.round(d.bounds.y + d.bounds.height / 2 - 150),
      width: 520, height: 300, frame: false, show: false, focusable: false, skipTaskbar: true, hasShadow: true,
      backgroundColor: "#0c171b", webPreferences: secure({ javascript: false }),
    });
    const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;height:100vh;background:#0c171b;color:#eef3f1;font:700 28px -apple-system,sans-serif;direction:rtl;text-align:center"><div><div style="font-size:120px;color:#5fd0b4">${i + 1}</div>${d.isConsole ? "شاشة المحاضر" : "شاشة رقم " + (i + 1)} · ${d.resolution}</div>`;
    w.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    w.once("ready-to-show", () => w.showInactive());
    setTimeout(() => { if (!w.isDestroyed()) w.destroy(); }, 3500);
  }
  return list;
}

function openNotes() {
  if (state.notesWin && !state.notesWin.isDestroyed()) { state.notesWin.focus(); return { ok: true }; }
  const d = consoleDisplay(); const wa = d.workArea || d.bounds;
  state.notesWin = new BrowserWindow({
    x: wa.x + Math.round(wa.width * 0.55), y: wa.y + 40, width: Math.round(wa.width * 0.42), height: Math.round(wa.height * 0.8),
    title: "ALFA — الملاحظات", backgroundColor: "#0c171b", webPreferences: secure(),
  });
  const q = state.bundle ? `bundle=${encodeURIComponent(state.bundle)}&relay=1` : "relay=1";
  state.notesWin.loadURL(`${state.base}/?${q}#notes`);
  state.notesWin.on("closed", () => { state.notesWin = null; });
  return { ok: true };
}

function openInChrome() {
  const url = `${state.base.replace("127.0.0.1", "localhost")}/#presenter`;
  if (isMac) execFile("open", ["-a", "Google Chrome", url], (err) => { if (err) shell.openExternal(url); });
  else shell.openExternal(url);
  return { ok: true };
}

// ---------- hot-plug: never show the students' screen on the lecturer's display ----------
function onDisplaysChanged(kind) {
  if (!state.showing) { notifyConsole({ kind: "displays", displays: displayList() }); return; }
  const target = dm.locate(displays(), state.audienceDisplayId);
  const consoleId = consoleDisplay()?.id;
  if (!target || target.id === consoleId) {
    if (state.audienceWin && !state.audienceWin.isDestroyed()) state.audienceWin.hide();
    notifyConsole({ kind: "projector-lost", displays: displayList() });
    return;
  }
  if (state.audienceWin && !state.audienceWin.isDestroyed()) {
    placeAudience(target);
    if (!state.audienceWin.isVisible()) { state.audienceWin.showInactive(); state.consoleWin?.focus(); }
    notifyConsole({ kind: kind === "added" ? "projector-back" : "displays", displays: displayList() });
  } else openAudience(target);
}

// ---------- control from a Chrome console (voice) through the local engine ----------
function listenForControl() {
  if (state.quitting) return;
  const req = http.get(`${state.base}/api/show/events?role=host`, (res) => {
    let buf = ""; res.setEncoding("utf8");
    res.on("data", (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        if (!/^event: control$/m.test(block)) continue;
        try {
          const c = JSON.parse((block.match(/^data: (.*)$/m) || [])[1] || "null");
          if (!c || Date.now() - c.at > 10000) continue; // a command from before this app started is not replayed
          if (c.action === "start") startShow(c.displayId);
          else if (c.action === "end") endShow();
          else if (c.action === "identify") identifyDisplays();
          else if (c.action === "notes") openNotes();
          else if (c.action === "choose-display" && Number.isSafeInteger(c.displayId)) { writeConfig({ audienceDisplayId: c.displayId }); if (state.showing) startShow(c.displayId); }
        } catch {}
      }
    });
    res.on("end", () => setTimeout(listenForControl, 1500));
  });
  req.on("error", () => setTimeout(listenForControl, 1500));
  state.hostReq = req;
}

// ---------- security: our pages only ----------
function harden() {
  app.on("web-contents-created", (_e, contents) => {
    contents.on("will-navigate", (event, url) => { if (!url.startsWith(state.base + "/")) event.preventDefault(); });
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => url.startsWith(state.base + "/")
      ? { action: "allow", overrideBrowserWindowOptions: { webPreferences: secure() } }
      : { action: "deny" });
  });
  const ses = session.defaultSession;
  const consoleOnly = (wc) => wc && state.consoleWin && wc.id === state.consoleWin.webContents.id;
  ses.setPermissionRequestHandler((wc, permission, callback) => {
    if (permission === "media" || permission === "speech") return callback(consoleOnly(wc)); // the microphone is the lecturer's
    if (permission === "fullscreen") return callback(true);
    callback(false);
  });
  ses.setPermissionCheckHandler((wc, permission) => (permission === "media" ? consoleOnly(wc) : permission === "fullscreen"));
}

function fromConsole(event) {
  return state.consoleWin && event.sender.id === state.consoleWin.webContents.id && String(event.senderFrame?.url || "").startsWith(state.base + "/");
}
function registerIpc() {
  const guard = (fn) => (event, ...args) => (fromConsole(event) ? fn(...args) : { ok: false, reason: "denied" });
  ipcMain.handle("alfa:list-displays", guard(() => ({ displays: displayList(), showing: state.showing, audienceDisplayId: state.audienceDisplayId })));
  ipcMain.handle("alfa:identify", guard(() => identifyDisplays()));
  ipcMain.handle("alfa:start-show", guard((id, bundle) => startShow(id, bundle)));
  ipcMain.handle("alfa:end-show", guard(() => endShow()));
  ipcMain.handle("alfa:choose-display", guard((id) => {
    if (!Number.isSafeInteger(id) || !dm.locate(displays(), id)) return { ok: false };
    writeConfig({ audienceDisplayId: id });
    return state.showing ? startShow(id) : { ok: true };
  }));
  ipcMain.handle("alfa:open-notes", guard(() => openNotes()));
  ipcMain.handle("alfa:open-in-chrome", guard(() => openInChrome()));
}

function buildMenu() {
  const template = [
    ...(isMac ? [{ label: "ALFA", submenu: [{ role: "about", label: "عن ALFA" }, { type: "separator" }, { role: "hide", label: "إخفاء" }, { role: "quit", label: "إنهاء ALFA" }] }] : []),
    { label: "العرض", submenu: [
      { label: "ابدأ العرض", accelerator: "CmdOrCtrl+Enter", click: () => startShow() },
      { label: "إنهاء العرض", accelerator: "CmdOrCtrl+.", click: () => endShow() },
      { label: "تعرّف على الشاشات", click: () => identifyDisplays() },
      { label: "نافذة الملاحظات", accelerator: "CmdOrCtrl+Shift+N", click: () => openNotes() },
      { type: "separator" },
      { label: "افتح لوحة المحاضر في Chrome (للأوامر الصوتية)", click: () => openInChrome() },
    ] },
    { label: "تحرير", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "عرض", submenu: [{ role: "reload", label: "إعادة تحميل اللوحة" }, { role: "togglefullscreen", label: "ملء الشاشة" }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- lifecycle ----------
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => { if (state.consoleWin) { if (state.consoleWin.isMinimized()) state.consoleWin.restore(); state.consoleWin.focus(); } });
app.whenReady().then(async () => {
  try {
    state.root = await findRoot();
    if (!state.root) { dialog.showErrorBox("ALFA", "لم أجد مجلد ALFA."); return app.quit(); }
    const srv = await startServer(state.root);
    state.base = srv.base; state.server = srv.child; state.owned = Boolean(srv.child);
    harden(); registerIpc(); buildMenu(); createConsole(); listenForControl();
    screen.on("display-added", () => onDisplaysChanged("added"));
    screen.on("display-removed", () => onDisplaysChanged("removed"));
    screen.on("display-metrics-changed", () => onDisplaysChanged("metrics"));
    if (process.env.ALFA_DESKTOP_TEST === "1") globalThis.__alfaDesktop = { state, startShow, endShow, openNotes, onDisplaysChanged, identifyDisplays, openAudience };
  } catch (err) {
    dialog.showErrorBox("ALFA", String(err?.message || err));
    app.quit();
  }
});
app.on("before-quit", () => {
  state.quitting = true;
  try { state.hostReq?.destroy(); } catch {}
  if (state.audienceWin && !state.audienceWin.isDestroyed()) state.audienceWin.setClosable(true);
  if (state.owned && state.server) { try { state.server.kill(); } catch {} } // only the server we started
});
app.on("window-all-closed", () => app.quit());
// A terminal Ctrl-C or a test runner's stop must not leave our server running without us.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => app.quit());
process.on("exit", () => { if (state.owned && state.server) { try { state.server.kill(); } catch {} } });
