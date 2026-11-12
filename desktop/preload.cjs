// The only bridge between ALFA's pages and the Mac app. The console gets a handful of display commands;
// nothing here exposes Node, files or the network. The projector and notes windows load no preload at all.
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

const CHANNELS = new Set(["display-event"]);
contextBridge.exposeInMainWorld("alfaDesktop", Object.freeze({
  version: 1,
  listDisplays: () => ipcRenderer.invoke("alfa:list-displays"),
  identifyDisplays: () => ipcRenderer.invoke("alfa:identify"),
  startShow: (displayId, bundle) => ipcRenderer.invoke("alfa:start-show", Number.isSafeInteger(displayId) ? displayId : null, typeof bundle === "string" ? bundle : null),
  endShow: () => ipcRenderer.invoke("alfa:end-show"),
  chooseDisplay: (displayId) => ipcRenderer.invoke("alfa:choose-display", displayId),
  openNotes: () => ipcRenderer.invoke("alfa:open-notes"),
  openInChrome: () => ipcRenderer.invoke("alfa:open-in-chrome"),
  onEvent(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload);
    for (const name of CHANNELS) ipcRenderer.on("alfa:" + name, listener);
    return () => { for (const name of CHANNELS) ipcRenderer.removeListener("alfa:" + name, listener); };
  },
}));
