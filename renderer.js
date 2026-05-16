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

// ── Chart ──
const chartCanvas = $("historyChart");
const chartEmpty = $("chartEmpty");
const chartLabelEl = $("chartLabel");
let historyChart = null;
let chartDays = 30;

const CHART_PALETTE = [
  { bg: "rgba(99, 152, 214, 0.5)",  border: "rgba(99, 152, 214, 0.8)" },
  { bg: "rgba(240, 170, 100, 0.5)", border: "rgba(240, 170, 100, 0.8)" },
  { bg: "rgba(130, 190, 140, 0.5)", border: "rgba(130, 190, 140, 0.8)" },
  { bg: "rgba(190, 130, 180, 0.5)", border: "rgba(190, 130, 180, 0.8)" },
  { bg: "rgba(220, 150, 130, 0.5)", border: "rgba(220, 150, 130, 0.8)" },
  { bg: "rgba(110, 190, 200, 0.5)", border: "rgba(110, 190, 200, 0.8)" },
  { bg: "rgba(180, 180, 120, 0.5)", border: "rgba(180, 180, 120, 0.8)" },
  { bg: "rgba(160, 140, 210, 0.5)", border: "rgba(160, 140, 210, 0.8)" },
];

function renderChart(dailyHistory, accountList) {
  const container = chartCanvas.parentElement;
  chartLabelEl.textContent = `${chartDays}天累计省钱`;

  const dates = [];
  const today = new Date();
  for (let i = chartDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(d.toLocaleDateString("sv-SE"));
  }

  const cutoff = dates[0];
  const filtered = (dailyHistory || []).filter((e) => e.date >= cutoff);

  // Update summary
  let rangeTotal = 0;
  let rangeCount = 0;
  for (const e of filtered) {
    rangeTotal += e.amount;
    rangeCount++;
  }
  const intPart = Math.floor(rangeTotal);
  const decPart = (rangeTotal - intPart).toFixed(2).slice(1);
  heroIntEl.textContent = intPart.toLocaleString();
  heroDecEl.textContent = decPart;
  heroCountEl.textContent = rangeCount;

  if (filtered.length === 0) {
    container.style.display = "none";
    chartEmpty.style.display = "";
    return;
  }
  container.style.display = "";
  chartEmpty.style.display = "none";

  const byAccount = {};
  for (const entry of filtered) {
    if (!byAccount[entry.accountId]) byAccount[entry.accountId] = {};
    const bucket = byAccount[entry.accountId];
    bucket[entry.date] = (bucket[entry.date] || 0) + entry.amount;
  }

  const datasets = Object.keys(byAccount).map((accountId, idx) => {
    const account = accountList.find((a) => a.id === accountId);
    const type = account?.type || (accountId.startsWith("tb") ? "tb" : "jd");
    const label = account
      ? `${PLATFORM_NAMES[type]}${account.nickname ? "·" + account.nickname : ""}`
      : accountId;
    const color = CHART_PALETTE[idx % CHART_PALETTE.length];

    return {
      label,
      data: dates.map((d) => byAccount[accountId][d] || 0),
      backgroundColor: color.bg,
      borderColor: color.border,
      borderWidth: 1,
      borderRadius: 3,
    };
  });

  const labels = dates.map((d) => d.slice(5));

  if (historyChart) {
    historyChart.data.labels = labels;
    historyChart.data.datasets = datasets;
    historyChart.update("none");
  } else {
    historyChart = new Chart(chartCanvas, {
      type: "bar",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: {
              font: { size: 10 },
              color: "rgba(29,29,31,0.38)",
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 10,
            },
            border: { display: false },
          },
          y: {
            stacked: true,
            grid: { color: "rgba(0,0,0,0.04)" },
            ticks: {
              font: { size: 10 },
              color: "rgba(29,29,31,0.38)",
              callback: (v) => "¥" + v,
            },
            border: { display: false },
            beginAtZero: true,
          },
        },
        plugins: {
          legend: {
            display: datasets.length > 1,
            position: "bottom",
            labels: {
              boxWidth: 8,
              boxHeight: 8,
              font: { size: 11 },
              color: "rgba(29,29,31,0.56)",
              padding: 12,
            },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ¥${ctx.raw.toFixed(2)}`,
            },
          },
        },
        interaction: { mode: "index", intersect: false },
      },
    });
  }
}

for (const btn of document.querySelectorAll(".chart-range-btn")) {
  btn.onclick = () => {
    document.querySelector(".chart-range-btn.active")?.classList.remove("active");
    btn.classList.add("active");
    chartDays = parseInt(btn.dataset.days);
    if (state.last) renderChart(state.last.dailyHistory, state.last.accounts);
  };
}

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

// ── Dynamic row creation ──
function createIntervalSelect(accountId, currentHours) {
  const options = [
    { value: "0.5", label: "30分钟" },
    { value: "1", label: "1小时" },
    { value: "2", label: "2小时" },
    { value: "4", label: "4小时" },
    { value: "6", label: "6小时" },
    { value: "8", label: "8小时" },
    { value: "12", label: "12小时" },
    { value: "24", label: "24小时" },
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

  const row = document.createElement("div");
  row.className = "account-row";
  row.dataset.accountId = account.id;

  row.innerHTML = `
    <div class="row-name">
      <span class="platform-tag ${colorClass}">${platformName}</span>
      <span class="row-nickname"></span>
    </div>
    <div class="row-cell status-cell"><button class="row-login">…</button></div>
    <div class="row-cell last-result-cell muted">--</div>
    <div class="row-cell next-run-cell muted">--</div>
    <div class="row-cell interval-cell"></div>
    <div class="row-actions">
      <button class="btn-row-run">执行</button>
      <button class="btn-row-remove" title="删除">×</button>
    </div>
  `;

  const intervalCell = row.querySelector(".interval-cell");
  const intervalSelect = createIntervalSelect(account.id, account.intervalHours || 2);
  intervalCell.appendChild(intervalSelect);

  const refs = {
    card: row,
    nickname: row.querySelector(".row-nickname"),
    loginBtn: row.querySelector(".row-login"),
    lastResultCell: row.querySelector(".last-result-cell"),
    nextRunCell: row.querySelector(".next-run-cell"),
    runBtn: row.querySelector(".btn-row-run"),
    removeBtn: row.querySelector(".btn-row-remove"),
    intervalSelect,
  };

  refs.runBtn.onclick = () => window.api.runNow(account.id);
  refs.removeBtn.onclick = () => {
    if (confirm(`确定删除此${platformName}账号吗？`)) {
      window.api.removeAccount(account.id);
    }
  };

  accountListEl.appendChild(row);
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
function renderAccount(accountId, data) {
  const refs = ui.get(accountId);
  if (!refs) return;
  const running = !!data.isRunning;
  const loggedIn = state.loginStatus.get(accountId) || false;

  refs.nickname.textContent = data.nickname || data.id;
  refs.card.classList.toggle("running", running);

  // Last result
  if (data.lastRunResult) {
    const raw = data.lastRunResult;
    const ok = raw.startsWith("成功");
    const err = raw.startsWith("出错");
    refs.lastResultCell.textContent = raw.length > 16 ? raw.slice(0, 16) + "…" : raw;
    refs.lastResultCell.className = "row-cell";
    if (ok) refs.lastResultCell.classList.add("success-text");
    else if (err) refs.lastResultCell.classList.add("danger-text");
  } else {
    refs.lastResultCell.textContent = "--";
    refs.lastResultCell.className = "row-cell muted";
  }

  // Next run
  const nextRel = formatRelative(data.nextRunTime);
  refs.nextRunCell.textContent = nextRel || "--";
  refs.nextRunCell.className = nextRel ? "row-cell" : "row-cell muted";

  // Run button
  if (running) {
    refs.runBtn.disabled = true;
    refs.runBtn.classList.add("loading");
    refs.runBtn.textContent = "运行中";
  } else {
    refs.runBtn.disabled = !loggedIn;
    refs.runBtn.classList.remove("loading");
    refs.runBtn.textContent = "执行";
  }

  if (data.intervalHours != null) {
    refs.intervalSelect.value = String(data.intervalHours);
  }
}

function updateStatus(status) {
  state.last = status;

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
  renderChart(status.dailyHistory, status.accounts);
}

function setLoginStatus(accountId, loggedIn) {
  state.loginStatus.set(accountId, loggedIn);
  const refs = ui.get(accountId);
  if (!refs) return;

  if (loggedIn) {
    refs.loginBtn.innerHTML = `<span class="login-dot"></span>退出`;
    refs.loginBtn.className = "row-login logged-in";
    refs.loginBtn.onclick = () => window.api.logout(accountId);
  } else {
    refs.loginBtn.innerHTML = `去登录`;
    refs.loginBtn.className = "row-login needs-login";
    refs.loginBtn.onclick = () => window.api.openLogin(accountId);
  }
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
