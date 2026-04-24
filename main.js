const {
  app,
  BrowserWindow,
  Notification,
  ipcMain,
  session,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { autoUpdater } = require("electron-updater");

// ─── 常量 ─────────────────────────────────────────────────────
const DEBUG = false;
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";

const PLATFORMS = {
  jd: {
    name: "京东",
    targetUrl:
      "https://h5.m.jd.com/babelDiy/Zeus/2RePMzTqg6UoffvMwtwVeMcnPGeg/index.html?defaultViewTab=0&appId=cuser&type=25#/",
    loginUrl: "https://plogin.m.jd.com/login/login",
    cookieDomain: ".jd.com",
    loginCookies: ["pt_key", "pt_pin"],
    idCookie: "pt_pin",
  },
  tb: {
    name: "淘宝",
    targetUrl:
      "https://pages-fast.m.taobao.com/wow/a/act/tmall/dailygroup/16261/16699/wupr?wh_pid=daily-541787&disableNav=YES",
    loginUrl: "https://main.m.taobao.com/?sprefer=sypc00",
    cookieDomain: ".taobao.com",
    loginCookies: ["cookie2", "_tb_token_", "unb"],
    idCookie: "unb",
    nickCookies: ["_nk_", "lgc", "tracknick"],
  },
};

// ─── 持久化存储 ───────────────────────────────────────────────
const STORE_PATH = path.join(app.getPath("userData"), "settings.json");

function emptyAccount(type) {
  return {
    id: null,
    type,
    partition: null, // 为 null 时自动用 persist:{id}，迁移账号保留原始值
    nickname: null,
    intervalHours: 2,
    lastRunTime: null,
    lastRunResult: null,
    totalSaved: 0,
    totalSuccessCount: 0,
  };
}

function getPartition(account) {
  if (account.partition) return account.partition;
  // 兼容旧版迁移的首个账号，其 session 数据仍在 persist:jd / persist:tb
  if (account.id === `${account.type}_1`) return `persist:${account.type}`;
  return `persist:${account.id}`;
}

function generateId(type, accounts) {
  let max = 0;
  for (const a of accounts) {
    if (a.type === type) {
      const num = parseInt(a.id.split("_")[1]) || 0;
      if (num > max) max = num;
    }
  }
  return `${type}_${max + 1}`;
}

function loadStore() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
  } catch {
    // 首次启动：默认创建京东和淘宝各一个账号
    return {
      accounts: [
        { ...emptyAccount("jd"), id: "jd_1" },
        { ...emptyAccount("tb"), id: "tb_1" },
      ],
    };
  }

  // 新格式
  if (raw.accounts) {
    // 确保每个账号都有完整字段
    return {
      accounts: raw.accounts.map((a) => ({
        ...emptyAccount(a.type),
        ...a,
      })),
    };
  }

  // 旧版双平台格式: { jd: {...}, tb: {...} }
  if (raw.jd || raw.tb) {
    const accounts = [];
    if (raw.jd) {
      accounts.push({ ...emptyAccount("jd"), ...raw.jd, id: "jd_1", partition: "persist:jd" });
    }
    if (raw.tb) {
      accounts.push({ ...emptyAccount("tb"), ...raw.tb, id: "tb_1", partition: "persist:tb" });
    }
    return { accounts };
  }

  // 更旧的扁平格式（v1.0 之前）
  return {
    accounts: [
      {
        ...emptyAccount("jd"),
        id: "jd_1",
        partition: "persist:jd",
        intervalHours: raw.intervalHours || 2,
        lastRunTime: raw.lastRunTime || null,
        lastRunResult: raw.lastRunResult || null,
        totalSaved: raw.totalSaved || 0,
        totalSuccessCount: raw.totalSuccessCount || 0,
      },
      { ...emptyAccount("tb"), id: "tb_1", partition: "persist:tb" },
    ],
  };
}

function saveStore() {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

let store = loadStore();

function getAccount(accountId) {
  return store.accounts.find((a) => a.id === accountId);
}

// ─── 全局状态 ─────────────────────────────────────────────────
let mainWindow = null;
let rendererReady = false;
let isQuitting = false;
const logs = [];

// Runtime state: per-account
const runtime = new Map();
for (const a of store.accounts) {
  runtime.set(a.id, { isRunning: false, timer: null });
}

// 串行执行队列
const taskQueue = [];
let isProcessingQueue = false;

function enqueueRun(accountId, manual = false) {
  // 如果已在队列中，跳过
  if (taskQueue.some((t) => t.accountId === accountId)) {
    addLog(accountId, "任务已在队列中，跳过");
    return;
  }
  taskQueue.push({ accountId, manual });
  processQueue();
}

async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;
  while (taskQueue.length > 0) {
    const { accountId, manual } = taskQueue.shift();
    await runPlatform(accountId, manual);
  }
  isProcessingQueue = false;
}

// ─── 日志 ──────────────────────────────────────────────────────
function addLog(accountId, msg) {
  let tag = "";
  if (accountId) {
    const account = getAccount(accountId);
    if (account) {
      const cfg = PLATFORMS[account.type];
      const name = account.nickname
        ? `${cfg.name}·${account.nickname}`
        : cfg.name;
      tag = `[${name}] `;
    }
  }
  const entry = `[${new Date().toLocaleString("zh-CN")}] ${tag}${msg}`;
  logs.push(entry);
  if (logs.length > 200) logs.shift();
  if (rendererReady && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("log", entry);
  }
}

// ─── 状态推送 ──────────────────────────────────────────────────
function getNextRun(account) {
  if (!account.lastRunTime) return null;
  return new Date(
    new Date(account.lastRunTime).getTime() +
      account.intervalHours * 3600000
  ).toISOString();
}

function buildStatus() {
  let totalSaved = 0;
  let totalCount = 0;
  const accountStatuses = store.accounts.map((a) => {
    totalSaved += a.totalSaved || 0;
    totalCount += a.totalSuccessCount || 0;
    const rt = runtime.get(a.id) || { isRunning: false, timer: null };
    return {
      ...a,
      isRunning: rt.isRunning,
      schedulerRunning: !!rt.timer,
      nextRunTime: getNextRun(a),
    };
  });
  return {
    accounts: accountStatuses,
    totals: { saved: totalSaved, count: totalCount },
    appVersion: app.getVersion(),
  };
}

function sendStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("status-update", buildStatus());
  }
}

function sendLoginStatus(accountId, loggedIn) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("login-status", { accountId, loggedIn });
  }
}

// ─── 登录检测 ──────────────────────────────────────────────────
async function checkLogin(accountId) {
  const account = getAccount(accountId);
  if (!account) return false;
  const cfg = PLATFORMS[account.type];
  const ses = session.fromPartition(getPartition(account));
  try {
    const cookies = await ses.cookies.get({ domain: cfg.cookieDomain });
    const ok = cfg.loginCookies.every((name) =>
      cookies.some((c) => c.name === name && c.value)
    );
    let displayName = null;
    if (cfg.nickCookies) {
      for (const name of cfg.nickCookies) {
        const val = cookies.find((c) => c.name === name)?.value;
        if (val) {
          displayName = decodeCookieValue(val);
          break;
        }
      }
    }
    if (!displayName) {
      const idVal = cookies.find((c) => c.name === cfg.idCookie)?.value;
      displayName = idVal ? decodeCookieValue(idVal) : null;
    }
    // 更新昵称
    if (displayName && displayName !== account.nickname) {
      account.nickname = displayName;
      saveStore();
    }
    addLog(
      accountId,
      ok
        ? `登录状态有效${displayName ? " (" + displayName + ")" : ""}`
        : "未检测到有效登录 cookie"
    );
    return ok;
  } catch (err) {
    addLog(accountId, `检测登录状态出错: ${err.message}`);
    return false;
  }
}

// ─── 登录窗口 ──────────────────────────────────────────────────
function openLoginWindow(accountId) {
  const account = getAccount(accountId);
  if (!account) return;
  const cfg = PLATFORMS[account.type];
  const win = new BrowserWindow({
    width: 420,
    height: 750,
    title: `${cfg.name}登录`,
    webPreferences: { partition: getPartition(account) },
  });
  win.loadURL(cfg.loginUrl, { userAgent: MOBILE_UA });
  addLog(accountId, "已打开登录窗口，请完成登录");

  win.webContents.on("did-navigate", async (_e, url) => {
    if (!url.includes("login") && !url.includes("passport")) {
      const ok = await checkLogin(accountId);
      if (ok) {
        account.isNew = false;
        saveStore();
        addLog(accountId, "登录成功！");
        win.close();
        sendLoginStatus(accountId, true);
        startScheduler(accountId);
      }
    }
  });

  win.on("closed", async () => {
    const ok = await checkLogin(accountId);
    if (!ok && account.isNew) {
      // 新增账号未完成登录，自动删除
      stopScheduler(accountId);
      const ses = session.fromPartition(getPartition(account));
      await ses.clearStorageData();
      const idx = store.accounts.findIndex((a) => a.id === accountId);
      if (idx !== -1) store.accounts.splice(idx, 1);
      runtime.delete(accountId);
      saveStore();
      addLog(null, `${cfg.name}账号未登录，已自动移除`);
      sendStatus();
      return;
    }
    sendLoginStatus(accountId, ok);
    if (ok) startScheduler(accountId);
  });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeCookieValue(val) {
  const decoded = decodeURIComponent(val);
  try {
    return JSON.parse(`"${decoded}"`);
  } catch {
    return decoded;
  }
}

function formatCooling(ms) {
  const totalSec = Math.ceil(ms / 1000);
  if (totalSec < 60) return `${totalSec} 秒`;
  const min = Math.ceil(totalSec / 60);
  if (min < 60) return `${min} 分钟`;
  const hrs = Math.ceil(min / 60);
  return `${hrs} 小时`;
}

// ═══════════════════════════════════════════════════════════════
// JD 专属：一键价保解析
// ═══════════════════════════════════════════════════════════════

function extractJdResults(responses) {
  let totalAmount = 0;
  let successCount = 0;
  const details = [];

  const priceResponses = responses.filter((r) =>
    r.body.includes("MOnceApplyResponse")
  );

  for (const resp of priceResponses) {
    let data;
    try {
      data = JSON.parse(resp.body);
    } catch {
      const m = resp.body.match(/\w+\((.+)\)$/s);
      if (m) {
        try {
          data = JSON.parse(m[1]);
        } catch {}
      }
    }
    if (!data || data.code !== 0) continue;

    const root = data.data || data;
    const succNum = parseInt(root.succNum) || 0;
    const insuranceAmt = parseFloat(root.insuranceSuccAmount) || 0;
    const onceAmt = parseFloat(root.onceSucAmount) || 0;
    const amt = insuranceAmt + onceAmt;

    successCount += succNum;
    totalAmount += amt;

    if (insuranceAmt > 0)
      details.push(`保险价保: ¥${insuranceAmt.toFixed(2)}`);
    if (onceAmt > 0) details.push(`一键价保: ¥${onceAmt.toFixed(2)}`);

    const coupons = root.confirmCouponInfos;
    if (Array.isArray(coupons)) {
      for (const c of coupons) {
        const d = parseFloat(c.discount) || 0;
        if (d > 0) {
          totalAmount += d;
          details.push(`优惠券价保: ¥${d.toFixed(2)}`);
        }
      }
    }

    if (root.responseMessage && amt === 0) details.push(root.responseMessage);
  }

  // 从首个统计 API 提取历史累计
  let historyTotal = 0;
  let historyCount = 0;
  for (const resp of responses) {
    let data;
    try {
      data = JSON.parse(resp.body);
    } catch {
      continue;
    }
    if (data?.code === 0 && data.data?.totalPriceproSuccAmount != null) {
      historyTotal = parseFloat(data.data.totalPriceproSuccAmount) || 0;
      historyCount = parseInt(data.data.totalCount) || 0;
      break;
    }
  }

  if (DEBUG)
    addLog(
      null,
      `[DEBUG-JD] 解析结果: amount=${totalAmount}, history=${historyTotal}/${historyCount}`
    );

  return {
    totalAmount,
    successCount,
    details,
    hasApi: priceResponses.length > 0,
    historyTotal,
    historyCount,
  };
}

async function runJd(account, manual) {
  const cfg = PLATFORMS.jd;
  addLog(
    account.id,
    manual ? "手动触发：开始执行..." : "开始执行价格保护申请..."
  );

  const win = new BrowserWindow({
    width: 375,
    height: 812,
    show: DEBUG,
    webPreferences: {
      partition: getPartition(account),
      preload: path.join(__dirname, "jd-preload.js"),
      contextIsolation: false,
      sandbox: false,
      nodeIntegration: false,
    },
  });
  if (DEBUG) win.webContents.openDevTools({ mode: "right" });

  let clicked = null;
  try {
    const loaded = new Promise((resolve) => {
      win.webContents.on("did-finish-load", () => resolve("loaded"));
      win.webContents.on("did-fail-load", (_e, code, desc) => {
        addLog(account.id, `页面加载失败: ${desc} (${code})`);
        resolve("failed");
      });
      setTimeout(() => resolve("timeout-30s"), 30000);
    });
    win.loadURL(cfg.targetUrl, { userAgent: MOBILE_UA });
    await loaded;
    await delay(5000);

    clicked = await win.webContents.executeJavaScript(`
      (function() {
        const keywords = ['一键价保', '全部价保', '价格保护', '申请价保', '价保'];
        for (const kw of keywords) {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node;
          while (node = walker.nextNode()) {
            if (node.textContent.includes(kw)) {
              const el = node.parentElement;
              if (el) { el.click(); return kw; }
            }
          }
        }
        return null;
      })()
    `);

    if (clicked) {
      addLog(account.id, `已点击「${clicked}」按钮`);
      await delay(5000);
      const confirmed = await win.webContents.executeJavaScript(`
        (function() {
          const keywords = ['全部申请', '一键申请', '确认申请', '确认', '提交'];
          for (const kw of keywords) {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            let node;
            while (node = walker.nextNode()) {
              if (node.textContent.includes(kw)) {
                const el = node.parentElement;
                if (el) { el.click(); return kw; }
              }
            }
          }
          return null;
        })()
      `);
      if (confirmed) addLog(account.id, `已点击「${confirmed}」确认按钮`);
      await delay(8000);
    } else {
      addLog(account.id, "未找到价格保护按钮，可能无可申请的订单");
    }

    const raw = await win.webContents.executeJavaScript(
      `JSON.stringify(window.__jdApiResponses || [])`
    );
    const responses = JSON.parse(raw);

    if (DEBUG) {
      addLog(account.id, `[DEBUG] 共捕获 ${responses.length} 个 API 响应`);
      for (const r of responses) {
        addLog(
          account.id,
          `[DEBUG] ${r.url.slice(0, 80)}: ${r.body.slice(0, 500)}`
        );
      }
    }

    const result = extractJdResults(responses);
    result.details.forEach((d) => addLog(account.id, `  ${d}`));

    if (result.totalAmount > 0) {
      addLog(
        account.id,
        `价保成功！共 ${result.successCount} 件商品，退款 ¥${result.totalAmount.toFixed(2)}`
      );
      const displayName = account.nickname || PLATFORMS[account.type].name;
      new Notification({
        title: "价保助手",
        body: `${displayName} 价保成功！退款 ¥${result.totalAmount.toFixed(2)}`,
      }).show();
      account.lastRunResult = `成功 ¥${result.totalAmount.toFixed(2)}`;
    } else if (result.hasApi) {
      addLog(account.id, "价保已申请，本次无退款");
      account.lastRunResult = clicked ? "已申请(无退款)" : "无可申请订单";
    } else {
      account.lastRunResult = clicked ? "已申请(无API)" : "无可申请订单";
    }
    if (result.historyTotal > 0) {
      account.totalSaved = result.historyTotal;
      account.totalSuccessCount = result.historyCount;
    }
    account.lastRunTime = new Date().toISOString();
    saveStore();
    addLog(account.id, "本次执行完成");
  } catch (err) {
    addLog(account.id, "执行出错: " + err.message);
    account.lastRunResult = "出错: " + err.message;
    account.lastRunTime = new Date().toISOString();
    saveStore();
  } finally {
    if (!DEBUG) win.close();
  }
}

// ═══════════════════════════════════════════════════════════════
// 淘宝专属：JSONP hook (tb-preload.js) + 坐标点击
// ═══════════════════════════════════════════════════════════════
function findByApiSuffix(responses, suffix) {
  const s = suffix.toLowerCase();
  for (let i = responses.length - 1; i >= 0; i--) {
    const r = responses[i];
    if (r.api && r.api.toLowerCase().endsWith(s)) return r;
  }
  return null;
}

function extractTbResults(responses, accountId) {
  let totalAmount = 0;
  let successCount = 0;
  const details = [];
  let coolingTime = 0;

  if (DEBUG) {
    addLog(accountId, `[DEBUG] 共捕获 ${responses.length} 个 mtop 响应`);
    for (const r of responses) {
      addLog(
        accountId,
        `[DEBUG] ${r.api} (${r.via}): ${JSON.stringify(r.data?.data?.model || r.data?.model || r.data).slice(0, 200)}`
      );
    }
  }

  const launch = findByApiSuffix(responses, "onceapply.launch");
  if (DEBUG && launch) {
    const m = launch.data?.data?.model || launch.data?.model;
    addLog(
      accountId,
      `[DEBUG] launch: recordId=${m?.onceApplyRecordId}, waitSeconds=${m?.waitSeconds}`
    );
  }

  const query = findByApiSuffix(responses, "onceapply.query");
  if (query && query.data) {
    const model =
      (query.data.data && query.data.data.model) || query.data.model;
    if (DEBUG) addLog(accountId, `[DEBUG] query model: ${JSON.stringify(model)}`);
    if (model) {
      const fee = parseFloat(model.totalRefundFee) || 0;
      const num = parseInt(model.succNum || model.successNum || 0) || 0;
      if (fee > 0) {
        totalAmount = fee;
        successCount = num || 1;
        details.push(`退款金额: ¥${fee.toFixed(2)}`);
      }
    }
  }

  const base = findByApiSuffix(responses, "baseinfo.get");
  let historyTotal = 0;
  let historyCount = 0;
  if (base && base.data) {
    const model =
      (base.data.data && base.data.data.model) || base.data.model;
    if (DEBUG) addLog(accountId, `[DEBUG] baseinfo model: ${JSON.stringify(model)}`);
    if (model) {
      if (model.coolingTime) {
        coolingTime = parseInt(model.coolingTime) || 0;
      }
      historyTotal = parseFloat(model.totalRefundFee) || 0;
      historyCount = parseInt(model.sucCount) || 0;
    }
  }

  if (DEBUG)
    addLog(
      accountId,
      `[DEBUG] 解析结果: amount=${totalAmount}, count=${successCount}, coolingTime=${coolingTime}ms (${formatCooling(coolingTime)}), history=${historyTotal}/${historyCount}`
    );

  return {
    totalAmount,
    successCount,
    details,
    coolingTime,
    historyTotal,
    historyCount,
  };
}

async function runTb(account, manual) {
  const cfg = PLATFORMS.tb;
  addLog(
    account.id,
    manual ? "手动触发：开始执行..." : "开始执行价格保护申请..."
  );

  const win = new BrowserWindow({
    width: 375,
    height: 812,
    show: DEBUG,
    webPreferences: {
      partition: getPartition(account),
      preload: path.join(__dirname, "tb-preload.js"),
      contextIsolation: false,
      sandbox: false,
      nodeIntegration: false,
    },
  });
  if (DEBUG) win.webContents.openDevTools({ mode: "right" });

  let clicked = null;
  try {
    const loaded = new Promise((resolve) => {
      win.webContents.on("did-finish-load", () => resolve("loaded"));
      win.webContents.on("did-fail-load", (_e, code, desc) => {
        addLog(account.id, `页面加载失败: ${desc} (${code})`);
        resolve("failed");
      });
      setTimeout(() => resolve("timeout-30s"), 30000);
    });
    win.loadURL(cfg.targetUrl, { userAgent: MOBILE_UA });
    await loaded;
    await delay(5000);

    const target = await win.webContents.executeJavaScript(`
      (function() {
        const BLOCK = /modal|affirm|dialog|popup|drawer|mask|tooltip/i;
        function inBlockedCtx(el) {
          for (let n = el; n; n = n.parentElement) {
            if (BLOCK.test((n.className || '').toString())) return true;
          }
          return false;
        }
        function findClickable(node) {
          let el = node.parentElement;
          for (let i = 0; i < 10 && el; i++, el = el.parentElement) {
            const cs = getComputedStyle(el);
            if (
              el.onclick ||
              el.getAttribute('role') === 'button' ||
              /button|btn/i.test((el.className || '').toString()) ||
              cs.cursor === 'pointer'
            ) return el;
          }
          return node.parentElement;
        }
        const keywords = ['一键价保', '全部价保', '申请价保', '立即价保'];
        const candidates = [];
        for (const kw of keywords) {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node;
          while (node = walker.nextNode()) {
            if (!node.textContent.includes(kw)) continue;
            const el = findClickable(node);
            if (!el || inBlockedCtx(el)) continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            let score = 0;
            for (let n = el; n; n = n.parentElement) {
              const p = getComputedStyle(n).position;
              if (p === 'fixed' || p === 'sticky') { score += 100; break; }
            }
            score += r.top;
            score -= (el.innerText || '').length;
            candidates.push({ score, kw, el });
          }
          if (candidates.length) break;
        }
        if (!candidates.length) return null;
        candidates.sort((a, b) => b.score - a.score);
        const top = candidates[0];
        top.el.scrollIntoView({ block: 'center' });
        const r = top.el.getBoundingClientRect();
        return { kw: top.kw, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()
    `);

    if (target) {
      win.webContents.sendInputEvent({
        type: "mouseDown",
        x: target.x,
        y: target.y,
        button: "left",
        clickCount: 1,
      });
      win.webContents.sendInputEvent({
        type: "mouseUp",
        x: target.x,
        y: target.y,
        button: "left",
        clickCount: 1,
      });
      clicked = target.kw;
      addLog(account.id, `已点击「${clicked}」按钮`);
      await delay(12000);

      const ack = await win.webContents.executeJavaScript(`
        (function() {
          const keywords = ['我知道了', '知道了', '好的', '确定'];
          for (const kw of keywords) {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            let node;
            while (node = walker.nextNode()) {
              if (node.textContent.trim() !== kw) continue;
              let el = node.parentElement;
              for (let i = 0; i < 10 && el; i++, el = el.parentElement) {
                const cs = getComputedStyle(el);
                if (el.onclick || /button|btn/i.test((el.className || '').toString()) || cs.cursor === 'pointer') break;
              }
              if (!el) continue;
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) continue;
              return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
            }
          }
          return null;
        })()
      `);
      if (ack) {
        win.webContents.sendInputEvent({
          type: "mouseDown",
          x: ack.x,
          y: ack.y,
          button: "left",
          clickCount: 1,
        });
        win.webContents.sendInputEvent({
          type: "mouseUp",
          x: ack.x,
          y: ack.y,
          button: "left",
          clickCount: 1,
        });
      }
    } else {
      addLog(account.id, "未找到一键价保按钮");
    }

    const raw = await win.webContents.executeJavaScript(
      `JSON.stringify(window.__tbMtopResponses || [])`
    );
    const responses = JSON.parse(raw);
    const result = extractTbResults(responses, account.id);
    result.details.forEach((d) => addLog(account.id, `  ${d}`));

    if (result.totalAmount > 0) {
      addLog(
        account.id,
        `价保成功！共 ${result.successCount} 件商品，退款 ¥${result.totalAmount.toFixed(2)}`
      );
      const displayName = account.nickname || PLATFORMS[account.type].name;
      new Notification({
        title: "价保助手",
        body: `${displayName} 价保成功！退款 ¥${result.totalAmount.toFixed(2)}`,
      }).show();
      account.lastRunResult = `成功 ¥${result.totalAmount.toFixed(2)}`;
    } else {
      addLog(account.id, "本次无退款");
      account.lastRunResult = clicked ? "已申请(无退款)" : "无可申请订单";
    }
    if (result.historyTotal > 0) {
      account.totalSaved = result.historyTotal;
      account.totalSuccessCount = result.historyCount;
    }
    account.lastRunTime = new Date().toISOString();
    saveStore();
    addLog(account.id, "本次执行完成");
  } catch (err) {
    addLog(account.id, "执行出错: " + err.message);
    account.lastRunResult = "出错: " + err.message;
    account.lastRunTime = new Date().toISOString();
    saveStore();
  } finally {
    if (!DEBUG) win.close();
  }
}

// ═══════════════════════════════════════════════════════════════
// 统一入口
// ═══════════════════════════════════════════════════════════════
async function runPlatform(accountId, manual = false) {
  const rt = runtime.get(accountId);
  if (!rt) return;
  if (rt.isRunning) {
    addLog(accountId, "任务正在运行中，跳过");
    return;
  }
  const account = getAccount(accountId);
  if (!account) return;

  const ok = await checkLogin(accountId);
  if (!ok) {
    addLog(accountId, "登录已过期，请重新登录后再执行");
    sendLoginStatus(accountId, false);
    stopScheduler(accountId);
    return;
  }
  rt.isRunning = true;
  sendStatus();
  try {
    if (account.type === "jd") await runJd(account, manual);
    else await runTb(account, manual);
  } finally {
    rt.isRunning = false;
    sendStatus();
  }
}

// ─── 调度 ──────────────────────────────────────────────────────
function startScheduler(accountId) {
  stopScheduler(accountId);
  const account = getAccount(accountId);
  if (!account) return;
  const ms = account.intervalHours * 3600000;
  const rt = runtime.get(accountId);
  if (!rt) return;
  rt.timer = setInterval(() => enqueueRun(accountId), ms);
  addLog(
    accountId,
    `定时任务已启动，每 ${account.intervalHours} 小时执行一次`
  );
  sendStatus();
}

function stopScheduler(accountId) {
  const rt = runtime.get(accountId);
  if (!rt || !rt.timer) return;
  clearInterval(rt.timer);
  rt.timer = null;
}

// ─── IPC ───────────────────────────────────────────────────────
ipcMain.on("renderer-ready", () => {
  rendererReady = true;
});

ipcMain.handle("check-login", async (_e, accountId) => {
  const ok = await checkLogin(accountId);
  const rt = runtime.get(accountId);
  if (ok && rt && !rt.timer) startScheduler(accountId);
  return ok;
});

ipcMain.on("open-login", (_e, accountId) => openLoginWindow(accountId));

ipcMain.on("run-now", (_e, accountId) => enqueueRun(accountId, true));

ipcMain.handle("logout", async (_e, accountId) => {
  stopScheduler(accountId);
  const account = getAccount(accountId);
  if (!account) return;
  const ses = session.fromPartition(getPartition(account));
  await ses.clearStorageData();
  const preserved = account.intervalHours;
  Object.assign(account, emptyAccount(account.type), {
    id: account.id,
    intervalHours: preserved,
  });
  saveStore();
  addLog(accountId, "已清除登录信息");
  sendLoginStatus(accountId, false);
  sendStatus();
});

ipcMain.on("update-config", (_e, accountId, cfg) => {
  const account = getAccount(accountId);
  if (!account) return;
  if (typeof cfg.hours === "number") {
    account.intervalHours = cfg.hours;
    saveStore();
    const rt = runtime.get(accountId);
    if (rt && rt.timer) startScheduler(accountId);
    addLog(accountId, `运行间隔已更新为 ${cfg.hours} 小时`);
  }
  sendStatus();
});

ipcMain.handle("add-account", async (_e, type) => {
  if (!PLATFORMS[type]) return null;
  const id = generateId(type, store.accounts);
  const account = { ...emptyAccount(type), id, isNew: true };
  store.accounts.push(account);
  runtime.set(id, { isRunning: false, timer: null });
  saveStore();
  sendStatus();
  addLog(id, "账号已创建");
  // 自动打开登录窗口
  openLoginWindow(id);
  return account;
});

ipcMain.handle("remove-account", async (_e, accountId) => {
  const idx = store.accounts.findIndex((a) => a.id === accountId);
  if (idx === -1) return false;
  stopScheduler(accountId);
  const account = store.accounts[idx];
  const ses = session.fromPartition(getPartition(account));
  await ses.clearStorageData();
  store.accounts.splice(idx, 1);
  runtime.delete(accountId);
  saveStore();
  addLog(null, `已删除账号 ${account.nickname || PLATFORMS[account.type].name}`);
  sendStatus();
  return true;
});

ipcMain.handle("get-status", () => ({
  ...buildStatus(),
  logs: logs.slice(-50),
}));

ipcMain.on("download-update", () => {
  autoUpdater.downloadUpdate().catch((err) => {
    addLog(null, `下载更新失败: ${err.message}`);
  });
});

ipcMain.on("install-update", () => {
  isQuitting = true;
  addLog(null, "开始安装新版本...");
  autoUpdater.quitAndInstall(false, true);
});

// ─── 窗口 ──────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 656,
    height: 860,
    minWidth: 544,
    minHeight: 720,
    title: "价保助手",
    resizable: true,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#F5F5F7",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile("index.html");
  mainWindow.on("close", (e) => {
    if (isQuitting) return;
    e.preventDefault();
    mainWindow.hide();
  });
}

// ─── 生命周期 ──────────────────────────────────────────────────
app.whenReady().then(async () => {
  createMainWindow();

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", (info) => {
    addLog(null, `发现新版本: v${info.version}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-available", info.version);
    }
  });
  autoUpdater.on("update-not-available", () =>
    addLog(null, "当前已是最新版本")
  );
  autoUpdater.on("download-progress", (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(
        "update-progress",
        Math.round(progress.percent)
      );
    }
  });
  autoUpdater.on("update-downloaded", () => {
    addLog(null, "新版本下载完成，将在下次退出时自动安装");
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-downloaded");
    }
  });
  autoUpdater.on("error", (err) => {
    if (DEBUG) addLog(null, `更新检查失败: ${err.message}`);
  });
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 2 * 3600000);

  app.on("activate", () => {
    if (mainWindow) mainWindow.show();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  for (const a of store.accounts) {
    stopScheduler(a.id);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
