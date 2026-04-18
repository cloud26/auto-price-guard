const logBox = document.getElementById("logBox");
const loginDot = document.getElementById("loginDot");
const loginText = document.getElementById("loginText");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const lastRunEl = document.getElementById("lastRun");
const lastResultEl = document.getElementById("lastResult");
const nextRunEl = document.getElementById("nextRun");
const currentStatusEl = document.getElementById("currentStatus");
const intervalSelect = document.getElementById("intervalSelect");
const runBtn = document.getElementById("runBtn");
const totalSavedEl = document.getElementById("totalSaved");
const totalCountEl = document.getElementById("totalCount");
const updateBar = document.getElementById("updateBar");
const updateText = document.getElementById("updateText");
const updateBtn = document.getElementById("updateBtn");
const appVersionEl = document.getElementById("appVersion");

let isLoggedIn = false;
let updateState = "idle"; // idle | available | downloading | downloaded

// ── 格式化时间 ──
function formatTime(isoStr) {
  if (!isoStr) return "--";
  const d = new Date(isoStr);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatRelativeTime(isoStr) {
  if (!isoStr) return "--";
  const diff = new Date(isoStr) - Date.now();
  if (diff < 0) return "即将执行";
  const mins = Math.ceil(diff / 60000);
  if (mins < 60) return `${mins} 分钟后`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m 后`;
}

// ── 更新 UI ──
function updateStatus(status) {
  intervalSelect.value = String(status.intervalHours);

  lastRunEl.textContent = formatTime(status.lastRunTime);
  lastRunEl.className = "value" + (status.lastRunTime ? "" : " pending");

  if (status.lastRunResult) {
    lastResultEl.textContent = status.lastRunResult;
    const isSuccess = status.lastRunResult.startsWith("成功");
    lastResultEl.className = "value " + (isSuccess ? "success" : "error");
  } else {
    lastResultEl.textContent = "--";
    lastResultEl.className = "value pending";
  }

  nextRunEl.textContent = formatRelativeTime(status.nextRunTime);
  nextRunEl.className = "value";

  // 累计数据
  totalSavedEl.textContent = `¥${(status.totalSaved || 0).toFixed(2)}`;
  totalSavedEl.className = "value" + (status.totalSaved > 0 ? " highlight" : " pending");
  totalCountEl.textContent = `${status.totalSuccessCount || 0} 件`;

  if (status.isRunning) {
    currentStatusEl.textContent = "运行中...";
    currentStatusEl.className = "value success running";
    runBtn.disabled = true;
    runBtn.textContent = "运行中...";
  } else if (status.schedulerRunning) {
    currentStatusEl.textContent = "定时运行中";
    currentStatusEl.className = "value success";
    runBtn.disabled = !isLoggedIn;
    runBtn.textContent = "立即执行";
  } else {
    currentStatusEl.textContent = "未启动";
    currentStatusEl.className = "value pending";
    runBtn.disabled = !isLoggedIn;
    runBtn.textContent = "立即执行";
  }
}

function setLoginStatus(loggedIn) {
  isLoggedIn = loggedIn;
  loginDot.className = "login-dot " + (loggedIn ? "online" : "offline");
  loginText.textContent = loggedIn ? "已登录京东" : "未登录，请先登录";
  loginBtn.style.display = loggedIn ? "none" : "block";
  logoutBtn.style.display = loggedIn ? "block" : "none";
  runBtn.disabled = !loggedIn;
}

function appendLog(msg) {
  const line = document.createElement("div");
  line.className = "log-line";
  if (msg.includes("出错") || msg.includes("失败") || msg.includes("过期")) {
    line.className += " error";
  } else if (msg.includes("成功") || msg.includes("完成") || msg.includes("已点击")) {
    line.className += " success";
  }
  line.textContent = msg;
  logBox.appendChild(line);
  logBox.scrollTop = logBox.scrollHeight;
}

// ── 事件处理 ──
function handleLogin() {
  window.api.openLogin();
}

async function handleLogout() {
  await window.api.logout();
}

function handleRunNow() {
  window.api.runNow();
}

function handleIntervalChange() {
  const hours = parseFloat(intervalSelect.value);
  window.api.updateInterval(hours);
}

// ── 监听主进程事件 ──
window.api.onLog((msg) => appendLog(msg));
window.api.onStatusUpdate((status) => updateStatus(status));
window.api.onLoginStatus((loggedIn) => setLoginStatus(loggedIn));

// ── 更新事件 ──
window.api.onUpdateAvailable((version) => {
  updateState = "available";
  updateBar.classList.add("show");
  updateText.textContent = `发现新版本 v${version}`;
  updateBtn.textContent = "下载更新";
  updateBtn.disabled = false;
});

window.api.onUpdateProgress((percent) => {
  updateText.textContent = `正在下载更新... ${percent}%`;
  updateBtn.disabled = true;
  updateBtn.textContent = "下载中";
});

window.api.onUpdateDownloaded(() => {
  updateState = "downloaded";
  updateText.textContent = "新版本已下载完成";
  updateBtn.textContent = "立即安装";
  updateBtn.disabled = false;
});

function handleUpdate() {
  if (updateState === "available") {
    updateState = "downloading";
    window.api.downloadUpdate();
  } else if (updateState === "downloaded") {
    window.api.installUpdate();
  }
}

// ── 定时刷新下次运行倒计时 ──
setInterval(async () => {
  const status = await window.api.getStatus();
  nextRunEl.textContent = formatRelativeTime(status.nextRunTime);
}, 30000);

// ── 初始化 ──
(async function init() {
  // 1. 先获取历史日志并显示
  const status = await window.api.getStatus();
  updateStatus(status);
  status.logs.forEach((l) => appendLog(l));
  if (status.appVersion) {
    appVersionEl.textContent = `v${status.appVersion}`;
  }

  // 2. 标记渲染进程已就绪，之后主进程的 addLog 会实时推送（不再重复）
  window.api.rendererReady();

  appendLog("应用启动完成");

  // 3. 检查登录状态
  appendLog("正在检测登录状态...");
  const loggedIn = await window.api.checkLogin();
  setLoginStatus(loggedIn);

  if (loggedIn) {
    appendLog("已登录京东，可以点击「立即执行」或等待定时任务");
  } else {
    appendLog("未登录京东，请点击「去登录」按钮完成登录");
  }
})();
