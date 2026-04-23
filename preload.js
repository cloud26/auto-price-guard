const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  rendererReady: () => ipcRenderer.send("renderer-ready"),
  checkLogin: (accountId) => ipcRenderer.invoke("check-login", accountId),
  openLogin: (accountId) => ipcRenderer.send("open-login", accountId),
  runNow: (accountId) => ipcRenderer.send("run-now", accountId),
  logout: (accountId) => ipcRenderer.invoke("logout", accountId),
  updateConfig: (accountId, cfg) =>
    ipcRenderer.send("update-config", accountId, cfg),
  getStatus: () => ipcRenderer.invoke("get-status"),
  addAccount: (type) => ipcRenderer.invoke("add-account", type),
  removeAccount: (id) => ipcRenderer.invoke("remove-account", id),
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
