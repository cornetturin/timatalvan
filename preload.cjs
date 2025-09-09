// preload.cjs
const { contextBridge, ipcRenderer } = require("electron");

// Hard-disable geolocation
try {
  Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: false });
} catch {}

contextBridge.exposeInMainWorld("untis", {
  defaultName: "M5",

  // RPC-style calls
  resolveElementByName: (name) => ipcRenderer.invoke("untis:resolve", name),
  getToday: (id, type) => ipcRenderer.invoke("untis:getToday", id, type),
  getForDate: (id, type, dateStr) => ipcRenderer.invoke("untis:getForDate", id, type, dateStr),
  listElements: () => ipcRenderer.invoke("untis:listElements"),

  // Notifications
  scheduleToasts: (lessons) => ipcRenderer.send("schedule-toasts", lessons),

  // Refresh trigger from main
  onTriggerRefresh: (cb) => {
    if (typeof cb !== "function") return () => {};
    const handler = () => cb();
    ipcRenderer.on("trigger-refresh", handler);
    return () => ipcRenderer.off("trigger-refresh", handler);
  },

  // UI helpers
  openHelp: () => ipcRenderer.send("app:openHelp"),
  resizeTo: (h) => ipcRenderer.send("resize-window", Math.max(0, Math.floor(Number(h) || 0))),

  // Open WebUntis in browser
  openUntisWeek: (payload) => ipcRenderer.send("open-untis-week", payload),
});
