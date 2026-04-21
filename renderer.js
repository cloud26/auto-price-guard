const $ = (id) => document.getElementById(id);

const heroIntEl = $("heroInt");
const heroDecEl = $("heroDec");
const heroCountEl = $("heroCount");

const updateBar = $("updateBar");
const updateText = $("updateText");
const updateBtn = $("updateBtn");
const appVersionEl = $("appVersion");
const logBox = $("logBox");

const PLATFORMS = ["jd", "tb"];
const PLATFORM_NAMES = { jd: "京东", tb: "淘宝" };

// Per-platform DOM refs
const ui = {};
for (const p of PLATFORMS) {
  ui[p] = {
    dot: $(`${p}-dot`),
    loginPill: $(`${p}-loginPill`),
    loginText: $(`${p}-loginText`),
    loginAction: $(`${p}-loginAction`),
    saved: $(`${p}-saved`),
    savedMeta: $(`${p}-savedMeta`),
    lastRun: $(`${p}-lastRun`),
    lastResult: $(`${p}-lastResult`),
    nextRun: $(`${p}-nextRun`),
    nextRunMeta: $(`${p}-nextRunMeta`),
    runBtn: $(`${p}-runBtn`),
    runBtnText: $(`${p}-runBtnText`),
    progress: $(`${p}-progress`),
  };
}

const jdIntervalSelect = $("jd-intervalSelect");
const tbIntervalSelect = $("tb-intervalSelect");

const state = {
  jd: { loggedIn: false },
  tb: { loggedIn: false },
  last: null,
  updateState: "idle",
};

const pad = (n) => String(n).padStart(2, "0");

function formatDateTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatRelative(iso) {
  if (!iso) return null;
  const diff = new Date(iso) - Date.now();
  if (diff < 60000) return "即将执行";
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${mins} 分钟后`;
  const hours = Math.floor(mins / 60);
  const remain = mins % 60;
  if (hours < 24) return remain ? `${hours}h ${remain}m 后` : `${hours} 小时后`;
  const days = Math.floor(hours / 24);
  return `${days} 天后`;
}

function formatPast(iso) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso);
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

function renderHero(totals) {
  const amount = totals?.saved || 0;
  const [intPart, decPart] = amount.toFixed(2).split(".");
  heroIntEl.textContent = Number(intPart).toLocaleString("en-US");
  heroDecEl.textContent = "." + decPart;
  heroCountEl.textContent = totals?.count || 0;
}

function renderPlatform(p, data) {
  const els = ui[p];
  const running = !!data.isRunning;
  const scheduled = !!data.schedulerRunning;
  const loggedIn = state[p].loggedIn;

  // Dot status
  if (running) setDot(els.dot, "accent", true);
  else if (loggedIn && scheduled) setDot(els.dot, "success", false);
  else if (loggedIn) setDot(els.dot, "warning", false);
  else setDot(els.dot, "muted", false);

  // Progress strip
  els.progress.classList.toggle("show", running);

  // Saved
  els.saved.textContent = `¥${(data.totalSaved || 0).toFixed(2)}`;
  els.savedMeta.textContent = `${data.totalSuccessCount || 0} 件`;

  // Last run
  const lastStr = formatDateTime(data.lastRunTime);
  els.lastRun.textContent = lastStr || "--";
  els.lastRun.classList.toggle("pending", !lastStr);
  if (data.lastRunResult) {
    const raw = data.lastRunResult;
    const ok = raw.startsWith("成功");
    const err = raw.startsWith("出错");
    els.lastResult.textContent = ok
      ? raw.replace(/^成功\s*/, "")
      : raw.length > 14
      ? raw.slice(0, 14) + "…"
      : raw;
    els.lastResult.className = "stat-meta";
    if (ok) els.lastResult.style.color = "var(--success)";
    else if (err) els.lastResult.style.color = "var(--danger)";
    else els.lastResult.style.color = "";
  } else {
    els.lastResult.textContent = data.lastRunTime ? formatPast(data.lastRunTime) : "";
    els.lastResult.style.color = "";
  }

  // Next run
  const nextRel = formatRelative(data.nextRunTime);
  els.nextRun.textContent = nextRel || "--";
  els.nextRun.classList.toggle("pending", !nextRel);
  els.nextRunMeta.textContent = data.nextRunTime ? formatDateTime(data.nextRunTime) : "";

  // Run button
  if (running) {
    els.runBtn.disabled = true;
    els.runBtn.classList.add("loading");
    els.runBtnText.textContent = "运行中…";
  } else {
    els.runBtn.disabled = !loggedIn;
    els.runBtn.classList.remove("loading");
    els.runBtnText.textContent = "立即执行";
  }
}

function updateStatus(status) {
  state.last = status;
  renderHero(status.totals);
  renderPlatform("jd", status.jd || {});
  renderPlatform("tb", status.tb || {});
  if (status.jd?.intervalHours != null) {
    jdIntervalSelect.value = String(status.jd.intervalHours);
  }
  if (status.tb?.intervalHours != null) {
    tbIntervalSelect.value = String(status.tb.intervalHours);
  }
  if (status.appVersion) appVersionEl.textContent = `v${status.appVersion}`;
}

function setLoginStatus(platform, loggedIn) {
  state[platform].loggedIn = loggedIn;
  const els = ui[platform];
  const name = PLATFORM_NAMES[platform];
  els.loginPill.classList.toggle("logged-in", loggedIn);
  if (loggedIn) {
    els.loginText.textContent = `已登录${name}`;
    els.loginAction.style.display = "";
    els.loginAction.textContent = "退出";
    els.loginAction.classList.remove("primary");
    els.loginAction.onclick = () => window.api.logout(platform);
  } else {
    els.loginText.textContent = "未登录";
    els.loginAction.style.display = "";
    els.loginAction.textContent = "去登录";
    els.loginAction.classList.add("primary");
    els.loginAction.onclick = () => window.api.openLogin(platform);
  }
  if (state.last) renderPlatform(platform, state.last[platform] || {});
}

// ── Log ──
function classifyLog(msg) {
  if (/出错|失败|过期/.test(msg)) return "danger";
  if (/成功|完成|已点击/.test(msg)) return "success";
  if (/命中|退款|价保|¥/.test(msg)) return "accent";
  return "";
}

function appendLog(raw) {
  const line = document.createElement("div");
  line.className = "log-line";
  const cls = classifyLog(raw);
  if (cls) line.classList.add(cls);

  // Parse "[ts] [平台] msg" — timestamp is ours, then optional platform tag
  const m = raw.match(/^\[([^\]]+)\]\s*(\[(京东|淘宝)\]\s*)?(.*)$/);
  if (m) {
    const ts = document.createElement("span");
    ts.className = "ts";
    ts.textContent = `[${m[1]}] `;
    line.appendChild(ts);
    if (m[3]) {
      const tag = document.createElement("span");
      tag.className = m[3] === "京东" ? "tag-jd" : "tag-tb";
      tag.textContent = `[${m[3]}] `;
      line.appendChild(tag);
    }
    line.appendChild(document.createTextNode(m[4]));
  } else {
    line.textContent = raw;
  }

  const cursor = logBox.querySelector(".log-cursor");
  logBox.insertBefore(line, cursor);
  logBox.scrollTop = logBox.scrollHeight;
}

// ── Events ──
ui.jd.runBtn.onclick = () => window.api.runNow("jd");
ui.tb.runBtn.onclick = () => window.api.runNow("tb");

jdIntervalSelect.onchange = () =>
  window.api.updateConfig("jd", { hours: parseFloat(jdIntervalSelect.value) });
tbIntervalSelect.onchange = () =>
  window.api.updateConfig("tb", { hours: parseFloat(tbIntervalSelect.value) });

updateBtn.onclick = () => {
  if (state.updateState === "available") {
    state.updateState = "downloading";
    window.api.downloadUpdate();
  } else if (state.updateState === "downloaded") {
    window.api.installUpdate();
  }
};

window.api.onLog(appendLog);
window.api.onStatusUpdate(updateStatus);
window.api.onLoginStatus(({ platform, loggedIn }) =>
  setLoginStatus(platform, loggedIn)
);

window.api.onUpdateAvailable((version) => {
  state.updateState = "available";
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
  state.updateState = "downloaded";
  updateText.textContent = "新版本已下载完成";
  updateBtn.textContent = "立即安装";
  updateBtn.disabled = false;
});

// Refresh relative times
setInterval(async () => {
  if (!state.last) return;
  const status = await window.api.getStatus();
  updateStatus(status);
}, 30000);

// ── Init ──
(async function init() {
  const status = await window.api.getStatus();
  updateStatus(status);
  (status.logs || []).forEach(appendLog);

  window.api.rendererReady();
  appendLog(`[${new Date().toLocaleString("zh-CN")}] 应用启动完成`);

  for (const p of PLATFORMS) {
    const loggedIn = await window.api.checkLogin(p);
    setLoginStatus(p, loggedIn);
  }
})();
