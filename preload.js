const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  rendererReady: () => ipcRenderer.send("renderer-ready"),
  checkLogin: () => ipcRenderer.invoke("check-login"),
  openLogin: () => ipcRenderer.send("open-login"),
  runNow: () => ipcRenderer.send("run-now"),
  logout: () => ipcRenderer.invoke("logout"),
  updateInterval: (hours) => ipcRenderer.send("update-interval", hours),
  getStatus: () => ipcRenderer.invoke("get-status"),
  downloadUpdate: () => ipcRenderer.send("download-update"),
  installUpdate: () => ipcRenderer.send("install-update"),

  onLog: (callback) => {
    ipcRenderer.on("log", (_e, msg) => callback(msg));
  },
  onStatusUpdate: (callback) => {
    ipcRenderer.on("status-update", (_e, status) => callback(status));
  },
  onLoginStatus: (callback) => {
    ipcRenderer.on("login-status", (_e, loggedIn) => callback(loggedIn));
  },
  onUpdateAvailable: (callback) => {
    ipcRenderer.on("update-available", (_e, version) => callback(version));
  },
  onUpdateProgress: (callback) => {
    ipcRenderer.on("update-progress", (_e, percent) => callback(percent));
  },
  onUpdateDownloaded: (callback) => {
    ipcRenderer.on("update-downloaded", () => callback());
  },
});
