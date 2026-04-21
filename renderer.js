const $ = (id) => document.getElementById(id);

const greetingHelloEl = $("greetingHello");
const loginPill = $("loginPill");
const loginDot = $("loginDot");
const loginText = $("loginText");
const loginSep = $("loginSep");
const loginAction = $("loginAction");

const heroIntEl = $("heroInt");
const heroDecEl = $("heroDec");
const heroCountEl = $("heroCount");

const runStateEl = $("runState");
const runStateDot = $("runStateDot");
const runStateText = $("runStateText");
const progressStrip = $("progressStrip");

const lastRunEl = $("lastRun");
const lastRunMetaEl = $("lastRunMeta");
const lastResultEl = $("lastResult");
const lastResultMetaEl = $("lastResultMeta");
const nextRunEl = $("nextRun");
const nextRunMetaEl = $("nextRunMeta");

const intervalSelect = $("intervalSelect");
const runBtn = $("runBtn");
const runBtnText = $("runBtnText");

const logBox = $("logBox");
const updateBar = $("updateBar");
const updateText = $("updateText");
const updateBtn = $("updateBtn");
const appVersionEl = $("appVersion");

let isLoggedIn = false;
let lastStatus = null;
let updateState = "idle";

const pad = (n) => String(n).padStart(2, "0");

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return "凌晨好";
  if (h < 12) return "上午好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}
greetingHelloEl.textContent = greeting();

function formatDateTime(isoStr) {
  if (!isoStr) return null;
  const d = new Date(isoStr);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatRelative(isoStr) {
  if (!isoStr) return null;
  const diff = new Date(isoStr) - Date.now();
  if (diff < 60000) return "即将执行";
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${mins} 分钟后`;
  const hours = Math.floor(mins / 60);
  const remain = mins % 60;
  return remain ? `${hours}h ${remain}m 后` : `${hours} 小时后`;
}

function formatPast(isoStr) {
  if (!isoStr) return null;
  const diff = Date.now() - new Date(isoStr);
  if (diff < 60000) return "刚刚";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

function setDot(el, kind, pulsing) {
  el.className = `dot ${kind}${pulsing ? " pulsing" : ""}`;
}

// ── Hero ──
function renderHero(status) {
  const amount = status.totalSaved || 0;
  const [intPart, decPart] = amount.toFixed(2).split(".");
  heroIntEl.textContent = Number(intPart).toLocaleString("en-US");
  heroDecEl.textContent = "." + decPart;
  heroCountEl.textContent = status.totalSuccessCount || 0;
}

// ── Run state card ──
function renderRunCard(status) {
  const running = !!status.isRunning;
  const scheduled = !!status.schedulerRunning;

  if (running) {
    setDot(runStateDot, "accent", true);
    runStateText.textContent = "运行中…";
    runStateEl.classList.add("active");
    progressStrip.classList.add("show");
  } else if (scheduled) {
    setDot(runStateDot, "success", false);
    runStateText.textContent = "定时运行中";
    runStateEl.classList.remove("active");
    progressStrip.classList.remove("show");
  } else {
    setDot(runStateDot, "muted", false);
    runStateText.textContent = "未启动";
    runStateEl.classList.remove("active");
    progressStrip.classList.remove("show");
  }

  const lastStr = formatDateTime(status.lastRunTime);
  lastRunEl.textContent = lastStr || "--";
  lastRunEl.classList.toggle("pending", !lastStr);
  lastRunMetaEl.textContent = status.lastRunTime ? formatPast(status.lastRunTime) : "";

  if (status.lastRunResult) {
    const raw = status.lastRunResult;
    const ok = raw.startsWith("成功");
    const err = raw.startsWith("出错");
    lastResultEl.textContent = raw.startsWith("成功 ") ? raw.slice(3) : raw;
    lastResultEl.classList.toggle("success", ok);
    lastResultEl.classList.toggle("danger", err);
    lastResultEl.classList.remove("pending");
    lastResultMetaEl.textContent = ok ? "价保退款" : err ? "执行失败" : "";
  } else {
    lastResultEl.textContent = "--";
    lastResultEl.className = "stat-value pending";
    lastResultMetaEl.textContent = "";
  }

  const nextRel = formatRelative(status.nextRunTime);
  nextRunEl.textContent = nextRel || "--";
  nextRunEl.classList.toggle("pending", !nextRel);
  nextRunMetaEl.textContent = status.nextRunTime ? formatDateTime(status.nextRunTime) : "";
}

// ── Run button ──
function renderRunBtn(status) {
  const running = !!status.isRunning;
  if (running) {
    runBtn.disabled = true;
    runBtn.classList.add("loading");
    runBtnText.textContent = "运行中…";
  } else {
    runBtn.disabled = !isLoggedIn;
    runBtn.classList.remove("loading");
    runBtnText.textContent = "立即执行";
  }
}

// ── Top-level status update ──
function updateStatus(status) {
  lastStatus = status;
  intervalSelect.value = String(status.intervalHours);
  renderHero(status);
  renderRunCard(status);
  renderRunBtn(status);
  if (status.appVersion) appVersionEl.textContent = `v${status.appVersion}`;
}

// ── Login pill ──
function setLoginStatus(loggedIn) {
  isLoggedIn = loggedIn;
  if (loggedIn) {
    setDot(loginDot, "success", true);
    loginText.textContent = "已登录京东";
    loginSep.style.display = "";
    loginAction.style.display = "";
    loginAction.textContent = "退出";
    loginAction.classList.remove("primary");
    loginAction.onclick = () => window.api.logout();
  } else {
    setDot(loginDot, "danger", false);
    loginText.textContent = "未登录";
    loginSep.style.display = "";
    loginAction.style.display = "";
    loginAction.textContent = "去登录";
    loginAction.classList.add("primary");
    loginAction.onclick = () => window.api.openLogin();
  }
  if (lastStatus) renderRunBtn(lastStatus);
}

// ── Log ──
function classifyLog(msg) {
  if (/出错|失败|过期/.test(msg)) return "danger";
  if (/成功|完成|已点击/.test(msg)) return "success";
  if (/命中|退款|价保|¥/.test(msg)) return "accent";
  return "";
}

// Split "[2025/4/21 12:02:05] msg" into ts + rest. Keep raw if no match.
function appendLog(raw) {
  const line = document.createElement("div");
  line.className = "log-line";
  const cls = classifyLog(raw);
  if (cls) line.classList.add(cls);

  const m = raw.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (m) {
    const ts = document.createElement("span");
    ts.className = "ts";
    ts.textContent = `[${m[1]}] `;
    line.appendChild(ts);
    line.appendChild(document.createTextNode(m[2]));
  } else {
    line.textContent = raw;
  }

  // Insert before the cursor element
  const cursor = logBox.querySelector(".log-cursor");
  logBox.insertBefore(line, cursor);
  logBox.scrollTop = logBox.scrollHeight;
}

// ── Events ──
runBtn.onclick = () => window.api.runNow();
intervalSelect.onchange = () => window.api.updateInterval(parseFloat(intervalSelect.value));
updateBtn.onclick = () => {
  if (updateState === "available") {
    updateState = "downloading";
    window.api.downloadUpdate();
  } else if (updateState === "downloaded") {
    window.api.installUpdate();
  }
};

window.api.onLog((msg) => appendLog(msg));
window.api.onStatusUpdate((status) => updateStatus({ ...lastStatus, ...status }));
window.api.onLoginStatus((loggedIn) => setLoginStatus(loggedIn));

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

// Refresh relative times every 30s.
setInterval(async () => {
  if (!lastStatus) return;
  const status = await window.api.getStatus();
  updateStatus(status);
}, 30000);

// ── Init ──
(async function init() {
  const status = await window.api.getStatus();
  updateStatus(status);
  (status.logs || []).forEach((l) => appendLog(l));

  window.api.rendererReady();
  appendLog(`[${new Date().toLocaleString("zh-CN")}] 应用启动完成`);

  appendLog(`[${new Date().toLocaleString("zh-CN")}] 正在检测登录状态...`);
  const loggedIn = await window.api.checkLogin();
  setLoginStatus(loggedIn);
  appendLog(
    `[${new Date().toLocaleString("zh-CN")}] ${
      loggedIn ? "已登录京东，可以点击「立即执行」或等待定时任务" : "未登录京东，请点击「去登录」完成登录"
    }`
  );
})();
