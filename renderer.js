const $ = (id) => document.getElementById(id);

const heroIntEl = $("heroInt");
const heroDecEl = $("heroDec");
const heroCountEl = $("heroCount");

const updateBar = $("updateBar");
const updateText = $("updateText");
const updateBtn = $("updateBtn");
const appVersionEl = $("appVersion");
const logBox = $("logBox");
const accountListEl = $("accountList");

const PLATFORM_NAMES = { jd: "京东", tb: "淘宝" };
const PLATFORM_COLORS = { jd: "jd", tb: "tb" };

// Per-account DOM refs (Map<accountId, {dot, loginPill, ...}>)
const ui = new Map();
let accounts = [];

const state = {
  loginStatus: new Map(), // accountId → boolean
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

// ── Dynamic card creation ──
function createIntervalSelect(accountId, currentHours) {
  const options = [
    { value: "0.5", label: "30 分钟" },
    { value: "1", label: "1 小时" },
    { value: "2", label: "2 小时" },
    { value: "4", label: "4 小时" },
    { value: "6", label: "6 小时" },
    { value: "8", label: "8 小时" },
    { value: "12", label: "12 小时" },
    { value: "24", label: "24 小时" },
  ];
  const select = document.createElement("select");
  for (const opt of options) {
    const el = document.createElement("option");
    el.value = opt.value;
    el.textContent = opt.label;
    if (String(currentHours) === opt.value) el.selected = true;
    select.appendChild(el);
  }
  select.onchange = () =>
    window.api.updateConfig(accountId, { hours: parseFloat(select.value) });
  return select;
}

function createAccountCard(account) {
  const type = account.type;
  const colorClass = PLATFORM_COLORS[type] || "jd";
  const platformName = PLATFORM_NAMES[type] || type;

  const card = document.createElement("div");
  card.className = "platform";
  card.dataset.accountId = account.id;

  card.innerHTML = `
    <div class="platform-head">
      <span class="dot muted"><span class="pulse"></span><span class="inner"></span></span>
      <span class="platform-name ${colorClass}">${platformName}</span>
      <span class="platform-nickname"></span>
      <span class="login-pill">
        <span class="pill-dot"></span>
        <span class="login-text">检测中…</span>
        <button class="action" style="display:none"></button>
      </span>
      <button class="btn-remove" title="删除账号">×</button>
    </div>
    <div class="platform-stats">
      <div>
        <div class="stat-label">累计</div>
        <div class="stat-value jd-num saved">¥0.00</div>
        <div class="stat-meta jd-num saved-meta">0 件</div>
      </div>
      <div>
        <div class="stat-label">上次运行</div>
        <div class="stat-value pending last-run">--</div>
        <div class="stat-meta last-result"></div>
      </div>
      <div>
        <div class="stat-label">下次运行</div>
        <div class="stat-value pending next-run">--</div>
        <div class="stat-meta next-run-meta"></div>
      </div>
    </div>
    <div class="platform-actions">
      <div class="interval">
        <span>每</span>
        <span class="interval-select-wrap"></span>
        <span>执行一次</span>
      </div>
      <button class="btn-run">
        <span class="run-btn-text">立即执行</span>
      </button>
    </div>
    <div class="progress-strip"></div>
  `;

  // Insert interval select
  const selectWrap = card.querySelector(".interval-select-wrap");
  const intervalSelect = createIntervalSelect(
    account.id,
    account.intervalHours || 2
  );
  selectWrap.appendChild(intervalSelect);

  // Gather refs
  const refs = {
    card,
    dot: card.querySelector(".dot"),
    platformNickname: card.querySelector(".platform-nickname"),
    loginPill: card.querySelector(".login-pill"),
    loginText: card.querySelector(".login-text"),
    loginAction: card.querySelector(".login-pill .action"),
    saved: card.querySelector(".saved"),
    savedMeta: card.querySelector(".saved-meta"),
    lastRun: card.querySelector(".last-run"),
    lastResult: card.querySelector(".last-result"),
    nextRun: card.querySelector(".next-run"),
    nextRunMeta: card.querySelector(".next-run-meta"),
    runBtn: card.querySelector(".btn-run"),
    runBtnText: card.querySelector(".run-btn-text"),
    progress: card.querySelector(".progress-strip"),
    intervalSelect,
    removeBtn: card.querySelector(".btn-remove"),
  };

  // Event bindings
  refs.runBtn.onclick = () => window.api.runNow(account.id);
  refs.removeBtn.onclick = () => {
    if (confirm(`确定删除此${platformName}账号吗？`)) {
      window.api.removeAccount(account.id);
    }
  };

  accountListEl.appendChild(card);
  ui.set(account.id, refs);
  state.loginStatus.set(account.id, false);

  return refs;
}

function removeAccountCard(accountId) {
  const refs = ui.get(accountId);
  if (refs) {
    refs.card.remove();
    ui.delete(accountId);
    state.loginStatus.delete(accountId);
  }
}

// ── Render ──
function renderHero(totals) {
  const amount = totals?.saved || 0;
  const [intPart, decPart] = amount.toFixed(2).split(".");
  heroIntEl.textContent = Number(intPart).toLocaleString("en-US");
  heroDecEl.textContent = "." + decPart;
  heroCountEl.textContent = totals?.count || 0;
}

function renderAccount(accountId, data) {
  const refs = ui.get(accountId);
  if (!refs) return;
  const running = !!data.isRunning;
  const scheduled = !!data.schedulerRunning;
  const loggedIn = state.loginStatus.get(accountId) || false;

  // Nickname
  refs.platformNickname.textContent = data.nickname ? `· ${data.nickname}` : "";

  // Dot status
  if (running) setDot(refs.dot, "accent", true);
  else if (loggedIn && scheduled) setDot(refs.dot, "success", false);
  else if (loggedIn) setDot(refs.dot, "warning", false);
  else setDot(refs.dot, "muted", false);

  // Progress strip
  refs.progress.classList.toggle("show", running);

  // Saved
  refs.saved.textContent = `¥${(data.totalSaved || 0).toFixed(2)}`;
  refs.savedMeta.textContent = `${data.totalSuccessCount || 0} 件`;

  // Last run
  const lastStr = formatDateTime(data.lastRunTime);
  refs.lastRun.textContent = lastStr || "--";
  refs.lastRun.classList.toggle("pending", !lastStr);
  if (data.lastRunResult) {
    const raw = data.lastRunResult;
    const ok = raw.startsWith("成功");
    const err = raw.startsWith("出错");
    refs.lastResult.textContent = ok
      ? raw.replace(/^成功\s*/, "")
      : raw.length > 14
      ? raw.slice(0, 14) + "…"
      : raw;
    refs.lastResult.className = "stat-meta";
    if (ok) refs.lastResult.style.color = "var(--success)";
    else if (err) refs.lastResult.style.color = "var(--danger)";
    else refs.lastResult.style.color = "";
  } else {
    refs.lastResult.textContent = data.lastRunTime
      ? formatPast(data.lastRunTime)
      : "";
    refs.lastResult.style.color = "";
  }

  // Next run
  const nextRel = formatRelative(data.nextRunTime);
  refs.nextRun.textContent = nextRel || "--";
  refs.nextRun.classList.toggle("pending", !nextRel);
  refs.nextRunMeta.textContent = data.nextRunTime
    ? formatDateTime(data.nextRunTime)
    : "";

  // Run button
  if (running) {
    refs.runBtn.disabled = true;
    refs.runBtn.classList.add("loading");
    refs.runBtnText.textContent = "运行中…";
  } else {
    refs.runBtn.disabled = !loggedIn;
    refs.runBtn.classList.remove("loading");
    refs.runBtnText.textContent = "立即执行";
  }

  // Interval select
  if (data.intervalHours != null) {
    refs.intervalSelect.value = String(data.intervalHours);
  }
}

function updateStatus(status) {
  state.last = status;
  renderHero(status.totals);

  const newIds = new Set(status.accounts.map((a) => a.id));
  const oldIds = new Set(accounts.map((a) => a.id));

  // Remove deleted accounts
  for (const id of oldIds) {
    if (!newIds.has(id)) removeAccountCard(id);
  }

  // Add new accounts
  for (const a of status.accounts) {
    if (!oldIds.has(a.id)) createAccountCard(a);
  }

  // Update all
  accounts = status.accounts;
  for (const a of accounts) {
    renderAccount(a.id, a);
  }

  if (status.appVersion) appVersionEl.textContent = `v${status.appVersion}`;
}

function setLoginStatus(accountId, loggedIn) {
  state.loginStatus.set(accountId, loggedIn);
  const refs = ui.get(accountId);
  if (!refs) return;
  const account = accounts.find((a) => a.id === accountId);
  const name = account
    ? PLATFORM_NAMES[account.type] || account.type
    : "";

  refs.loginPill.classList.toggle("logged-in", loggedIn);
  if (loggedIn) {
    refs.loginText.textContent = `已登录`;
    refs.loginAction.style.display = "";
    refs.loginAction.textContent = "退出";
    refs.loginAction.classList.remove("primary");
    refs.loginAction.onclick = () => window.api.logout(accountId);
  } else {
    refs.loginText.textContent = "未登录";
    refs.loginAction.style.display = "";
    refs.loginAction.textContent = "去登录";
    refs.loginAction.classList.add("primary");
    refs.loginAction.onclick = () => window.api.openLogin(accountId);
  }
  // Re-render to update button state
  const data = accounts.find((a) => a.id === accountId);
  if (data) renderAccount(accountId, data);
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

  const m = raw.match(/^\[([^\]]+)\]\s*(\[([^\]]+)\]\s*)?(.*)$/);
  if (m) {
    const ts = document.createElement("span");
    ts.className = "ts";
    ts.textContent = `[${m[1]}] `;
    line.appendChild(ts);
    if (m[3]) {
      const tag = document.createElement("span");
      // Determine color class from tag content
      if (m[3].includes("京东")) tag.className = "tag-jd";
      else if (m[3].includes("淘宝")) tag.className = "tag-tb";
      else tag.className = "tag-jd"; // fallback
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

// ── Add account modal ──
const platformModal = $("platformModal");
const addAccountBtn = $("addAccountBtn");
const modalCancelBtn = $("modalCancelBtn");

addAccountBtn.onclick = () => platformModal.classList.add("show");
modalCancelBtn.onclick = () => platformModal.classList.remove("show");
platformModal.onclick = (e) => {
  if (e.target === platformModal) platformModal.classList.remove("show");
};

for (const optBtn of document.querySelectorAll(".modal-option")) {
  optBtn.onclick = async () => {
    const type = optBtn.dataset.type;
    platformModal.classList.remove("show");
    await window.api.addAccount(type);
  };
}

// ── Update ──
updateBtn.onclick = () => {
  if (state.updateState === "available") {
    state.updateState = "downloading";
    window.api.downloadUpdate();
  } else if (state.updateState === "downloaded") {
    window.api.installUpdate();
  }
};

// ── Events ──
window.api.onLog(appendLog);
window.api.onStatusUpdate(updateStatus);
window.api.onLoginStatus(({ accountId, loggedIn }) =>
  setLoginStatus(accountId, loggedIn)
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

  for (const a of accounts) {
    const loggedIn = await window.api.checkLogin(a.id);
    setLoginStatus(a.id, loggedIn);
  }
})();
