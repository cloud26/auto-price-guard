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

// ─── 持久化存储 ───────────────────────────────────────────────
const STORE_PATH = path.join(app.getPath("userData"), "settings.json");

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
  } catch {
    return {
      intervalHours: 2,
      lastRunTime: null,
      lastRunResult: null,
    };
  }
}

function saveStore(data) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

let store = loadStore();

// ─── 全局状态 ─────────────────────────────────────────────────
const DEBUG = false;
let mainWindow = null;
let timer = null;
let isRunning = false;
let rendererReady = false;
let isQuitting = false;
const logs = [];

const TARGET_URL =
  "https://h5.m.jd.com/babelDiy/Zeus/2RePMzTqg6UoffvMwtwVeMcnPGeg/index.html?defaultViewTab=0&appId=cuser&type=25#/";
const LOGIN_URL = "https://plogin.m.jd.com/login/login";
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";

const JD_SESSION = "persist:jd";

// ─── 日志 ──────────────────────────────────────────────────────
function addLog(msg) {
  const entry = `[${new Date().toLocaleString("zh-CN")}] ${msg}`;
  logs.push(entry);
  if (logs.length > 200) logs.shift();
  // 只在渲染进程就绪后才发送实时日志，避免重复
  if (rendererReady && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("log", entry);
  }
}

function sendStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("status-update", {
      intervalHours: store.intervalHours,
      lastRunTime: store.lastRunTime,
      lastRunResult: store.lastRunResult,
      isRunning,
      nextRunTime: getNextRunTime(),
      totalSaved: store.totalSaved || 0,
      totalSuccessCount: store.totalSuccessCount || 0,
    });
  }
}

function getNextRunTime() {
  if (!store.lastRunTime) return null;
  return new Date(
    new Date(store.lastRunTime).getTime() + store.intervalHours * 3600000
  ).toISOString();
}

// ─── 登录检测（通过 cookie） ────────────────────────────────────
async function checkLoginStatus() {
  const ses = session.fromPartition(JD_SESSION);
  try {
    const cookies = await ses.cookies.get({ domain: ".jd.com" });
    const hasPtKey = cookies.some((c) => c.name === "pt_key" && c.value);
    const hasPtPin = cookies.some((c) => c.name === "pt_pin" && c.value);
    const loggedIn = hasPtKey && hasPtPin;
    addLog(
      loggedIn
        ? `登录状态有效 (pt_pin=${decodeURIComponent(cookies.find((c) => c.name === "pt_pin").value)})`
        : "未检测到有效登录 cookie"
    );
    return loggedIn;
  } catch (err) {
    addLog(`检测登录状态出错: ${err.message}`);
    return false;
  }
}

// ─── 登录窗口 ──────────────────────────────────────────────────
function openLoginWindow() {
  const loginWin = new BrowserWindow({
    width: 420,
    height: 750,
    title: "京东登录",
    webPreferences: {
      partition: JD_SESSION,
    },
  });

  loginWin.loadURL(LOGIN_URL, { userAgent: MOBILE_UA });
  addLog("已打开登录窗口，请完成登录");

  // 监听导航 —— 登录成功后会跳转离开登录页
  loginWin.webContents.on("did-navigate", async (_e, url) => {
    if (!url.includes("login") && !url.includes("passport")) {
      // 再通过 cookie 确认一下
      const loggedIn = await checkLoginStatus();
      if (loggedIn) {
        addLog("登录成功！");
        loginWin.close();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("login-status", true);
        }
        // 登录成功后自动启动定时任务
        startScheduler();
      }
    }
  });

  loginWin.on("closed", async () => {
    const loggedIn = await checkLoginStatus();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("login-status", loggedIn);
    }
    if (loggedIn) {
      startScheduler();
    }
  });
}

// ─── 注入 JS：hook fetch/XHR 捕获 API 响应 ───────────────────
const INTERCEPT_SCRIPT = `
(function() {
  if (window.__jdApiHooked) return;
  window.__jdApiHooked = true;
  window.__jdApiResponses = [];

  // Hook fetch
  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    const resp = await origFetch.apply(this, args);
    const url = (typeof args[0] === 'string') ? args[0] : (args[0]?.url || '');
    if (url.includes('api.m.jd.com') || url.includes('api.jd.com')) {
      try {
        const clone = resp.clone();
        const text = await clone.text();
        window.__jdApiResponses.push({ url, body: text, time: Date.now() });
      } catch(e) {}
    }
    return resp;
  };

  // Hook XMLHttpRequest
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__url = url;
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener('load', function() {
      const url = this.__url || '';
      if (url.includes('api.m.jd.com') || url.includes('api.jd.com')) {
        try {
          window.__jdApiResponses.push({ url, body: this.responseText, time: Date.now() });
        } catch(e) {}
      }
    });
    return origSend.apply(this, args);
  };
})();
`;

// 从 URL 中提取 functionId
function getFunctionId(url) {
  try {
    // 处理 //api.m.jd.com 这种无协议 URL
    const fullUrl = url.startsWith("//") ? "https:" + url : url;
    const u = new URL(fullUrl);
    return u.searchParams.get("functionId") || "";
  } catch {
    return "";
  }
}

// 判断是否为一键价保结果 API
function isPriceProtectResultApi(resp) {
  return resp.body.includes("MOnceApplyResponse");
}

// 从一键价保结果中提取收益
function extractPriceProtectResults(responses) {
  let totalAmount = 0;
  let successCount = 0;
  const details = [];

  for (const resp of responses) {
    let data;
    try {
      data = JSON.parse(resp.body);
    } catch {
      const m = resp.body.match(/\w+\((.+)\)$/s);
      if (m) { try { data = JSON.parse(m[1]); } catch {} }
    }
    if (!data || data.code !== 0) continue;

    const root = data.data || data;
    const succNum = parseInt(root.succNum) || 0;
    const insuranceAmt = parseFloat(root.insuranceSuccAmount) || 0;
    const onceAmt = parseFloat(root.onceSucAmount) || 0;
    const amt = insuranceAmt + onceAmt;

    successCount += succNum;
    totalAmount += amt;

    if (amt > 0) {
      if (insuranceAmt > 0) details.push(`保险价保: ¥${insuranceAmt.toFixed(2)}`);
      if (onceAmt > 0) details.push(`一键价保: ¥${onceAmt.toFixed(2)}`);
    }

    // 优惠券价保
    const coupons = root.confirmCouponInfos;
    if (Array.isArray(coupons)) {
      for (const coupon of coupons) {
        const discount = parseFloat(coupon.discount) || 0;
        if (discount > 0) {
          totalAmount += discount;
          details.push(`优惠券价保: ¥${discount.toFixed(2)}`);
        }
      }
    }

    // 记录失败原因
    if (root.responseMessage && amt === 0) {
      details.push(root.responseMessage);
    }
  }

  return { totalAmount, successCount, details };
}

// ─── 价格保护自动化 ────────────────────────────────────────────
async function runPriceProtection() {
  if (isRunning) {
    addLog("任务正在运行中，跳过");
    return;
  }

  const loggedIn = await checkLoginStatus();
  if (!loggedIn) {
    addLog("登录已过期，请重新登录后再执行");
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("login-status", false);
    }
    stopScheduler();
    return;
  }

  isRunning = true;
  sendStatus();
  addLog("开始执行价格保护申请...");

  // 调试阶段先显示窗口，稳定后可改为 show: false
  const win = new BrowserWindow({
    width: 375,
    height: 812,
    show: false,
    webPreferences: {
      partition: JD_SESSION,
    },
  });

  // dom-ready 时注入 API hook（在页面 JS 执行之前）
  win.webContents.on("dom-ready", () => {
    if (DEBUG) addLog("DOM ready，注入 API 拦截器...");
    win.webContents.executeJavaScript(INTERCEPT_SCRIPT).catch(() => {});
  });

  try {
    // 加载页面，不 await（SPA 可能不触发 did-finish-load）
    addLog("开始加载页面...");
    const loaded = new Promise((resolve) => {
      win.webContents.on("did-finish-load", () => resolve("loaded"));
      win.webContents.on("did-fail-load", (_e, code, desc) => {
        addLog(`页面加载失败: ${desc} (${code})`);
        resolve("failed");
      });
      setTimeout(() => resolve("timeout-30s"), 30000);
    });
    win.loadURL(TARGET_URL, { userAgent: MOBILE_UA });

    const loadResult = await loaded;
    if (DEBUG) addLog(`页面加载结果: ${loadResult}`);

    // 再注入一次确保 hook 生效（SPA 可能重建了环境）
    await win.webContents.executeJavaScript(INTERCEPT_SCRIPT);

    // 等待 SPA 渲染
    await delay(5000);

    // 获取页面内容
    const pageText = await win.webContents.executeJavaScript(
      `document.body.innerText`
    );
    if (DEBUG) addLog(`页面文本(前300字): ${pageText.replace(/\\s+/g, " ").substring(0, 300)}`);

    // 点击价保按钮
    const clicked = await win.webContents.executeJavaScript(`
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
      addLog('已点击「' + clicked + '」按钮');
      await delay(5000);

      // 点击确认按钮
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

      if (confirmed) {
        addLog('已点击「' + confirmed + '」确认按钮');
      }

      await delay(8000);
    } else {
      addLog("未找到价格保护按钮，可能无可申请的订单");
    }

    // 收集所有拦截到的 API 响应
    const apiResponses = await win.webContents.executeJavaScript(
      `JSON.stringify(window.__jdApiResponses || [])`
    );
    const responses = JSON.parse(apiResponses);
    
    if (DEBUG) {
      addLog(`共拦截到 ${responses.length} 个 JD API 请求`);

      // 打印所有 API 调用（仅 DEBUG 模式）
      for (const r of responses) {
        const fid = getFunctionId(r.url);
        addLog(`[API] ${fid || r.url} => ${r.body}`);
      }
    }

    // 分析价保结果
    const priceResponses = responses.filter((r) => isPriceProtectResultApi(r));

    if (priceResponses.length > 0) {
      const result = extractPriceProtectResults(priceResponses);
      result.details.forEach((d) => addLog(`  ${d}`));
      if (result.totalAmount > 0) {
        addLog(`价保成功！共 ${result.successCount} 件商品，退款 ¥${result.totalAmount.toFixed(2)}`);
        new Notification({
          title: "价保助手",
          body: `价保成功！退款 ¥${result.totalAmount.toFixed(2)}`,
        }).show();
        store.lastRunResult = `成功 ¥${result.totalAmount.toFixed(2)}`;
        store.totalSaved = (store.totalSaved || 0) + result.totalAmount;
        store.totalSuccessCount = (store.totalSuccessCount || 0) + result.successCount;
      } else {
        addLog("价保已申请，本次无退款");
        store.lastRunResult = clicked ? "已申请(无退款)" : "无可申请订单";
      }
    } else {
      store.lastRunResult = clicked ? "已申请(无API)" : "无可申请订单";
    }

    store.lastRunTime = new Date().toISOString();
    saveStore(store);
    addLog("本次执行完成");
  } catch (err) {
    addLog("执行出错: " + err.message);
    store.lastRunResult = "出错: " + err.message;
    store.lastRunTime = new Date().toISOString();
    saveStore(store);
  } finally {
    win.close();
    isRunning = false;
    sendStatus();
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── 定时器 ────────────────────────────────────────────────────
function startScheduler() {
  stopScheduler();
  const ms = store.intervalHours * 3600000;
  addLog(`定时任务已启动，每 ${store.intervalHours} 小时执行一次`);
  timer = setInterval(() => {
    runPriceProtection();
  }, ms);
  sendStatus();
}

function stopScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// ─── IPC 处理 ──────────────────────────────────────────────────
// 渲染进程告知已就绪，之后才发送实时日志
ipcMain.on("renderer-ready", () => {
  rendererReady = true;
});

ipcMain.handle("check-login", async () => {
  const loggedIn = await checkLoginStatus();
  if (loggedIn && !timer) {
    startScheduler();
  }
  return loggedIn;
});

ipcMain.on("open-login", () => {
  openLoginWindow();
});

ipcMain.on("run-now", () => {
  runPriceProtection();
});

ipcMain.handle("logout", async () => {
  stopScheduler();
  const ses = session.fromPartition(JD_SESSION);
  await ses.clearStorageData();
  store.totalSaved = 0;
  store.totalSuccessCount = 0;
  store.lastRunTime = null;
  store.lastRunResult = null;
  saveStore(store);
  addLog("已清除登录信息");
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("login-status", false);
  }
  sendStatus();
});

ipcMain.on("update-interval", (_e, hours) => {
  store.intervalHours = hours;
  saveStore(store);
  if (timer) {
    // 只有已经在运行时才重启定时器
    startScheduler();
  }
  addLog(`运行间隔已更新为 ${hours} 小时`);
  sendStatus();
});

ipcMain.handle("get-status", () => {
  return {
    intervalHours: store.intervalHours,
    lastRunTime: store.lastRunTime,
    lastRunResult: store.lastRunResult,
    isRunning,
    nextRunTime: getNextRunTime(),
    logs: logs.slice(-50),
    schedulerRunning: timer !== null,
    totalSaved: store.totalSaved || 0,
    totalSuccessCount: store.totalSuccessCount || 0,
    appVersion: app.getVersion(),
  };
});

ipcMain.on("download-update", () => {
  autoUpdater.downloadUpdate().catch((err) => {
    addLog(`下载更新失败: ${err.message}`);
  });
});

ipcMain.on("install-update", () => {
  isQuitting = true;
  addLog("开始安装新版本...");
  autoUpdater.quitAndInstall(false, true);
});

// ─── 窗口创建 ──────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 656,
    height: 784,
    minWidth: 544,
    minHeight: 656,
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

// ─── 应用生命周期 ──────────────────────────────────────────────
app.whenReady().then(async () => {
  createMainWindow();

  // ─── 自动更新 ───────────────────────────────────────────────
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    addLog(`发现新版本: v${info.version}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-available", info.version);
    }
  });

  autoUpdater.on("update-not-available", () => {
    addLog("当前已是最新版本");
  });

  autoUpdater.on("download-progress", (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-progress", Math.round(progress.percent));
    }
  });

  autoUpdater.on("update-downloaded", () => {
    addLog("新版本下载完成，将在下次退出时自动安装");
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-downloaded");
    }
  });

  autoUpdater.on("error", (err) => {
    if (DEBUG) addLog(`更新检查失败: ${err.message}`);
  });

  autoUpdater.checkForUpdates().catch(() => {});

  app.on("activate", () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });

  // 不再启动时自动开始定时器，等登录确认后再启动
});

app.on("before-quit", () => {
  isQuitting = true;
  stopScheduler();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
