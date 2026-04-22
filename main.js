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
    partition: "persist:jd",
    targetUrl:
      "https://h5.m.jd.com/babelDiy/Zeus/2RePMzTqg6UoffvMwtwVeMcnPGeg/index.html?defaultViewTab=0&appId=cuser&type=25#/",
    loginUrl: "https://plogin.m.jd.com/login/login",
    cookieDomain: ".jd.com",
    loginCookies: ["pt_key", "pt_pin"],
    idCookie: "pt_pin",
  },
  tb: {
    name: "淘宝",
    partition: "persist:tb",
    targetUrl:
      "https://pages-fast.m.taobao.com/wow/a/act/tmall/dailygroup/16261/16699/wupr?wh_pid=daily-541787&disableNav=YES",
    loginUrl: "https://main.m.taobao.com/?sprefer=sypc00",
    cookieDomain: ".taobao.com",
    loginCookies: ["cookie2", "_tb_token_"],
    idCookie: "unb",
    nickCookies: ["_nk_", "lgc", "tracknick"],
  },
};

// ─── 持久化存储（含旧版扁平结构迁移） ─────────────────────────
const STORE_PATH = path.join(app.getPath("userData"), "settings.json");

function emptyJd() {
  return {
    intervalHours: 2,
    lastRunTime: null,
    lastRunResult: null,
    totalSaved: 0,
    totalSuccessCount: 0,
  };
}
function emptyTb() {
  return {
    intervalHours: 2,
    lastRunTime: null,
    lastRunResult: null,
    totalSaved: 0,
    totalSuccessCount: 0,
  };
}

function loadStore() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
  } catch {
    return { jd: emptyJd(), tb: emptyTb() };
  }
  // 旧版：{ intervalHours, lastRunTime, ... } —— 迁移到 jd
  if (!raw.jd && !raw.tb) {
    return {
      jd: {
        intervalHours: raw.intervalHours || 2,
        lastRunTime: raw.lastRunTime || null,
        lastRunResult: raw.lastRunResult || null,
        totalSaved: raw.totalSaved || 0,
        totalSuccessCount: raw.totalSuccessCount || 0,
      },
      tb: emptyTb(),
    };
  }
  return {
    jd: { ...emptyJd(), ...(raw.jd || {}) },
    tb: { ...emptyTb(), ...(raw.tb || {}) },
  };
}

function saveStore() {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

let store = loadStore();

// ─── 全局状态 ─────────────────────────────────────────────────
let mainWindow = null;
let rendererReady = false;
let isQuitting = false;
const logs = [];

const runtime = {
  jd: { isRunning: false, timer: null },
  tb: { isRunning: false, timer: null },
};

// ─── 日志 ──────────────────────────────────────────────────────
function addLog(platform, msg) {
  const tag = platform ? `[${PLATFORMS[platform].name}] ` : "";
  const entry = `[${new Date().toLocaleString("zh-CN")}] ${tag}${msg}`;
  logs.push(entry);
  if (logs.length > 200) logs.shift();
  if (rendererReady && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("log", entry);
  }
}

// ─── 状态推送 ──────────────────────────────────────────────────
function getJdNextRun() {
  if (!store.jd.lastRunTime) return null;
  return new Date(
    new Date(store.jd.lastRunTime).getTime() + store.jd.intervalHours * 3600000
  ).toISOString();
}

function getTbNextRun() {
  if (!store.tb.lastRunTime) return null;
  return new Date(
    new Date(store.tb.lastRunTime).getTime() + store.tb.intervalHours * 3600000
  ).toISOString();
}

function buildStatus() {
  return {
    jd: {
      ...store.jd,
      isRunning: runtime.jd.isRunning,
      schedulerRunning: !!runtime.jd.timer,
      nextRunTime: getJdNextRun(),
    },
    tb: {
      ...store.tb,
      isRunning: runtime.tb.isRunning,
      schedulerRunning: !!runtime.tb.timer,
      nextRunTime: getTbNextRun(),
    },
    totals: {
      saved: (store.jd.totalSaved || 0) + (store.tb.totalSaved || 0),
      count:
        (store.jd.totalSuccessCount || 0) + (store.tb.totalSuccessCount || 0),
    },
    appVersion: app.getVersion(),
  };
}

function sendStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("status-update", buildStatus());
  }
}

function sendLoginStatus(platform, loggedIn) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("login-status", { platform, loggedIn });
  }
}

// ─── 登录检测 ──────────────────────────────────────────────────
async function checkLogin(platform) {
  const cfg = PLATFORMS[platform];
  const ses = session.fromPartition(cfg.partition);
  try {
    const cookies = await ses.cookies.get({ domain: cfg.cookieDomain });
    const ok = cfg.loginCookies.every((name) =>
      cookies.some((c) => c.name === name && c.value)
    );
    let displayName = null;
    // Try nickname cookies first (TB), then fall back to idCookie
    if (cfg.nickCookies) {
      for (const name of cfg.nickCookies) {
        const val = cookies.find((c) => c.name === name)?.value;
        if (val) { displayName = decodeURIComponent(val); break; }
      }
    }
    if (!displayName) {
      const idVal = cookies.find((c) => c.name === cfg.idCookie)?.value;
      displayName = idVal ? decodeURIComponent(idVal) : "?";
    }
    addLog(
      platform,
      ok ? `登录状态有效 (${displayName})` : "未检测到有效登录 cookie"
    );
    return ok;
  } catch (err) {
    addLog(platform, `检测登录状态出错: ${err.message}`);
    return false;
  }
}

// ─── 登录窗口 ──────────────────────────────────────────────────
function openLoginWindow(platform) {
  const cfg = PLATFORMS[platform];
  const win = new BrowserWindow({
    width: 420,
    height: 750,
    title: `${cfg.name}登录`,
    webPreferences: { partition: cfg.partition },
  });
  win.loadURL(cfg.loginUrl, { userAgent: MOBILE_UA });
  addLog(platform, "已打开登录窗口，请完成登录");

  win.webContents.on("did-navigate", async (_e, url) => {
    if (!url.includes("login") && !url.includes("passport")) {
      const ok = await checkLogin(platform);
      if (ok) {
        addLog(platform, "登录成功！");
        win.close();
        sendLoginStatus(platform, true);
        startScheduler(platform);
      }
    }
  });

  win.on("closed", async () => {
    const ok = await checkLogin(platform);
    sendLoginStatus(platform, ok);
    if (ok) startScheduler(platform);
  });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

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
    try { data = JSON.parse(resp.body); } catch { continue; }
    if (data?.code === 0 && data.data?.totalPriceproSuccAmount != null) {
      historyTotal = parseFloat(data.data.totalPriceproSuccAmount) || 0;
      historyCount = parseInt(data.data.totalCount) || 0;
      break;
    }
  }

  if (DEBUG) addLog("jd", `[DEBUG] 解析结果: amount=${totalAmount}, history=${historyTotal}/${historyCount}`);

  return { totalAmount, successCount, details, hasApi: priceResponses.length > 0, historyTotal, historyCount };
}

async function runJd(manual) {
  const cfg = PLATFORMS.jd;
  addLog("jd", manual ? "手动触发：开始执行..." : "开始执行价格保护申请...");

  const win = new BrowserWindow({
    width: 375,
    height: 812,
    show: DEBUG,
    webPreferences: {
      partition: cfg.partition,
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
        addLog("jd", `页面加载失败: ${desc} (${code})`);
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
      addLog("jd", `已点击「${clicked}」按钮`);
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
      if (confirmed) addLog("jd", `已点击「${confirmed}」确认按钮`);
      await delay(8000);
    } else {
      addLog("jd", "未找到价格保护按钮，可能无可申请的订单");
    }

    const raw = await win.webContents.executeJavaScript(
      `JSON.stringify(window.__jdApiResponses || [])`
    );
    const responses = JSON.parse(raw);

    if (DEBUG) {
      addLog("jd", `[DEBUG] 共捕获 ${responses.length} 个 API 响应`);
      for (const r of responses) {
        addLog("jd", `[DEBUG] ${r.url.slice(0, 80)}: ${r.body.slice(0, 500)}`);
      }
    }

    const result = extractJdResults(responses);
    result.details.forEach((d) => addLog("jd", `  ${d}`));

    if (result.totalAmount > 0) {
      addLog(
        "jd",
        `价保成功！共 ${result.successCount} 件商品，退款 ¥${result.totalAmount.toFixed(2)}`
      );
      new Notification({
        title: "价保助手",
        body: `京东价保成功！退款 ¥${result.totalAmount.toFixed(2)}`,
      }).show();
      store.jd.lastRunResult = `成功 ¥${result.totalAmount.toFixed(2)}`;
    } else if (result.hasApi) {
      addLog("jd", "价保已申请，本次无退款");
      store.jd.lastRunResult = clicked ? "已申请(无退款)" : "无可申请订单";
    } else {
      store.jd.lastRunResult = clicked ? "已申请(无API)" : "无可申请订单";
    }
    // 用平台返回的历史累计数据
    if (result.historyTotal > 0) {
      store.jd.totalSaved = result.historyTotal;
      store.jd.totalSuccessCount = result.historyCount;
    }
    store.jd.lastRunTime = new Date().toISOString();
    saveStore();
    addLog("jd", "本次执行完成");
  } catch (err) {
    addLog("jd", "执行出错: " + err.message);
    store.jd.lastRunResult = "出错: " + err.message;
    store.jd.lastRunTime = new Date().toISOString();
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

function extractTbResults(responses) {
  let totalAmount = 0;
  let successCount = 0;
  const details = [];
  let coolingTime = 0;

  if (DEBUG) {
    addLog("tb", `[DEBUG] 共捕获 ${responses.length} 个 mtop 响应`);
    for (const r of responses) {
      addLog("tb", `[DEBUG] ${r.api} (${r.via}): ${JSON.stringify(r.data?.data?.model || r.data?.model || r.data).slice(0, 200)}`);
    }
  }

  const launch = findByApiSuffix(responses, "onceapply.launch");
  if (DEBUG && launch) {
    const m = (launch.data?.data?.model) || launch.data?.model;
    addLog("tb", `[DEBUG] launch: recordId=${m?.onceApplyRecordId}, waitSeconds=${m?.waitSeconds}`);
  }

  const query = findByApiSuffix(responses, "onceapply.query");
  if (query && query.data) {
    const model = (query.data.data && query.data.data.model) || query.data.model;
    if (DEBUG) addLog("tb", `[DEBUG] query model: ${JSON.stringify(model)}`);
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
    const model = (base.data.data && base.data.data.model) || base.data.model;
    if (DEBUG) addLog("tb", `[DEBUG] baseinfo model: ${JSON.stringify(model)}`);
    if (model) {
      if (model.coolingTime) {
        coolingTime = parseInt(model.coolingTime) || 0;
      }
      historyTotal = parseFloat(model.totalRefundFee) || 0;
      historyCount = parseInt(model.sucCount) || 0;
    }
  }

  if (DEBUG) addLog("tb", `[DEBUG] 解析结果: amount=${totalAmount}, count=${successCount}, coolingTime=${coolingTime}ms (${formatCooling(coolingTime)}), history=${historyTotal}/${historyCount}`);

  return { totalAmount, successCount, details, coolingTime, historyTotal, historyCount };
}

async function runTb(manual) {
  const cfg = PLATFORMS.tb;
  addLog("tb", manual ? "手动触发：开始执行..." : "开始执行价格保护申请...");

  const win = new BrowserWindow({
    width: 375,
    height: 812,
    show: DEBUG,
    webPreferences: {
      partition: cfg.partition,
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
        addLog("tb", `页面加载失败: ${desc} (${code})`);
        resolve("failed");
      });
      setTimeout(() => resolve("timeout-30s"), 30000);
    });
    win.loadURL(cfg.targetUrl, { userAgent: MOBILE_UA });
    await loaded;
    await delay(5000);

    // 定位一键价保按钮：排除弹窗，优先底部 fixed/sticky 按钮
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
      win.webContents.sendInputEvent({ type: "mouseDown", x: target.x, y: target.y, button: "left", clickCount: 1 });
      win.webContents.sendInputEvent({ type: "mouseUp", x: target.x, y: target.y, button: "left", clickCount: 1 });
      clicked = target.kw;
      addLog("tb", `已点击「${clicked}」按钮`);
      await delay(12000); // launch 会返回 waitSeconds，通常不超过 10s

      // 点「我知道了」关掉结果弹窗
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
        win.webContents.sendInputEvent({ type: "mouseDown", x: ack.x, y: ack.y, button: "left", clickCount: 1 });
        win.webContents.sendInputEvent({ type: "mouseUp", x: ack.x, y: ack.y, button: "left", clickCount: 1 });
      }
    } else {
      addLog("tb", "未找到一键价保按钮");
    }

    const raw = await win.webContents.executeJavaScript(
      `JSON.stringify(window.__tbMtopResponses || [])`
    );
    const responses = JSON.parse(raw);
    const result = extractTbResults(responses);
    result.details.forEach((d) => addLog("tb", `  ${d}`));

    if (result.totalAmount > 0) {
      addLog(
        "tb",
        `价保成功！共 ${result.successCount} 件商品，退款 ¥${result.totalAmount.toFixed(2)}`
      );
      new Notification({
        title: "价保助手",
        body: `淘宝价保成功！退款 ¥${result.totalAmount.toFixed(2)}`,
      }).show();
      store.tb.lastRunResult = `成功 ¥${result.totalAmount.toFixed(2)}`;
    } else {
      addLog("tb", "本次无退款");
      store.tb.lastRunResult = clicked ? "已申请(无退款)" : "无可申请订单";
    }
    // 用平台返回的历史累计数据
    if (result.historyTotal > 0) {
      store.tb.totalSaved = result.historyTotal;
      store.tb.totalSuccessCount = result.historyCount;
    }
    store.tb.lastRunTime = new Date().toISOString();
    saveStore();
    addLog("tb", "本次执行完成");
  } catch (err) {
    addLog("tb", "执行出错: " + err.message);
    store.tb.lastRunResult = "出错: " + err.message;
    store.tb.lastRunTime = new Date().toISOString();
    saveStore();
  } finally {
    if (!DEBUG) win.close();
  }
}

// ═══════════════════════════════════════════════════════════════
// 统一入口
// ═══════════════════════════════════════════════════════════════
async function runPlatform(platform, manual = false) {
  if (runtime[platform].isRunning) {
    addLog(platform, "任务正在运行中，跳过");
    return;
  }
  const ok = await checkLogin(platform);
  if (!ok) {
    addLog(platform, "登录已过期，请重新登录后再执行");
    sendLoginStatus(platform, false);
    stopScheduler(platform);
    return;
  }
  runtime[platform].isRunning = true;
  sendStatus();
  try {
    if (platform === "jd") await runJd(manual);
    else await runTb(manual);
  } finally {
    runtime[platform].isRunning = false;
    sendStatus();
  }
}

// ─── 调度 ──────────────────────────────────────────────────────
function startScheduler(platform) {
  stopScheduler(platform);
  const ms = store[platform].intervalHours * 3600000;
  runtime[platform].timer = setInterval(() => runPlatform(platform), ms);
  addLog(platform, `定时任务已启动，每 ${store[platform].intervalHours} 小时执行一次`);
  sendStatus();
}

function stopScheduler(platform) {
  const t = runtime[platform].timer;
  if (!t) return;
  clearInterval(t);
  runtime[platform].timer = null;
}

// ─── IPC ───────────────────────────────────────────────────────
ipcMain.on("renderer-ready", () => {
  rendererReady = true;
});

ipcMain.handle("check-login", async (_e, platform) => {
  const ok = await checkLogin(platform);
  if (ok && !runtime[platform].timer) startScheduler(platform);
  return ok;
});

ipcMain.on("open-login", (_e, platform) => openLoginWindow(platform));

ipcMain.on("run-now", (_e, platform) => runPlatform(platform, true));

ipcMain.handle("logout", async (_e, platform) => {
  stopScheduler(platform);
  const ses = session.fromPartition(PLATFORMS[platform].partition);
  await ses.clearStorageData();
  const preserved = store[platform].intervalHours;
  store[platform] = { ...(platform === "jd" ? emptyJd() : emptyTb()), intervalHours: preserved };
  saveStore();
  addLog(platform, "已清除登录信息");
  sendLoginStatus(platform, false);
  sendStatus();
});

ipcMain.on("update-config", (_e, platform, cfg) => {
  if (typeof cfg.hours === "number") {
    store[platform].intervalHours = cfg.hours;
    saveStore();
    if (runtime[platform].timer) startScheduler(platform);
    addLog(platform, `运行间隔已更新为 ${cfg.hours} 小时`);
  }
  sendStatus();
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
      mainWindow.webContents.send("update-progress", Math.round(progress.percent));
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

  app.on("activate", () => {
    if (mainWindow) mainWindow.show();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  stopScheduler("jd");
  stopScheduler("tb");
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
