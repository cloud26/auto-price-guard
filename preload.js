const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  rendererReady: () => ipcRenderer.send("renderer-ready"),
  checkLogin: (platform) => ipcRenderer.invoke("check-login", platform),
  openLogin: (platform) => ipcRenderer.send("open-login", platform),
  runNow: (platform) => ipcRenderer.send("run-now", platform),
  logout: (platform) => ipcRenderer.invoke("logout", platform),
  updateConfig: (platform, cfg) =>
    ipcRenderer.send("update-config", platform, cfg),
  getStatus: () => ipcRenderer.invoke("get-status"),
  downloadUpdate: () => ipcRenderer.send("download-update"),
  installUpdate: () => ipcRenderer.send("install-update"),

  onLog: (cb) => ipcRenderer.on("log", (_e, msg) => cb(msg)),
  onStatusUpdate: (cb) =>
    ipcRenderer.on("status-update", (_e, status) => cb(status)),
  onLoginStatus: (cb) =>
    ipcRenderer.on("login-status", (_e, payload) => cb(payload)),
  onUpdateAvailable: (cb) =>
    ipcRenderer.on("update-available", (_e, version) => cb(version)),
  onUpdateProgress: (cb) =>
    ipcRenderer.on("update-progress", (_e, percent) => cb(percent)),
  onUpdateDownloaded: (cb) => ipcRenderer.on("update-downloaded", () => cb()),
});
