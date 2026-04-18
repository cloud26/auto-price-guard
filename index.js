const { chromium } = require("playwright");
const path = require("path");
const readline = require("readline");

const USER_DATA_DIR = path.join(__dirname, "user-data");
const TARGET_URL =
  "https://h5.m.jd.com/babelDiy/Zeus/2RePMzTqg6UoffvMwtwVeMcnPGeg/index.html?defaultViewTab=0&appId=cuser&type=25#/";

// 运行间隔（毫秒），默认每 2 小时执行一次
const INTERVAL_MS = 2 * 60 * 60 * 1000;

function waitForEnter(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

async function applyPriceProtection() {
  console.log(`\n[${new Date().toLocaleString()}] 开始执行价格保护申请...`);

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: 375, height: 812 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  });

  try {
    const page = context.pages()[0] || (await context.newPage());
    // 打开目标页面
    await page.goto(TARGET_URL, { waitUntil: "networkidle", timeout: 30000 });
    console.log("页面已加载");

    // 等待页面内容渲染
    await page.waitForTimeout(3000);

    // 截图记录当前页面状态
    await page.screenshot({
      path: path.join(__dirname, "screenshot-before.png"),
      fullPage: true,
    });
    console.log("已保存页面截图: screenshot-before.png");

    // 尝试点击「价格保护」按钮
    const clicked = await tryClick(page, [
      { method: "text", value: "价格保护" },
      { method: "text", value: "价保" },
      { method: "text", value: "一键价保" },
      { method: "text", value: "全部价保" },
      { method: "text", value: "申请价保" },
    ]);

    if (clicked) {
      console.log("已点击价格保护按钮");
      await page.waitForTimeout(10000);

      // 尝试点击确认/提交按钮（如果有二次确认）
      await tryClick(page, [
        { method: "text", value: "全部申请" },
        { method: "text", value: "一键申请" },
        { method: "text", value: "确认" },
        { method: "text", value: "提交" },
      ]);

      await page.waitForTimeout(2000);
    } else {
      console.log("未找到价格保护按钮，请检查页面是否正常加载或登录是否过期");
    }

    // 截图记录操作后的页面状态
    await page.screenshot({
      path: path.join(__dirname, "screenshot-after.png"),
      fullPage: true,
    });
    console.log("已保存操作后截图: screenshot-after.png");
  } catch (err) {
    console.error("执行出错:", err.message);
  } finally {
    await context.close();
    console.log(`[${new Date().toLocaleString()}] 浏览器已关闭，本次执行完成`);
  }
}

async function tryClick(page, selectors) {
  for (const sel of selectors) {
    try {
      const locator = page.getByText(sel.value, { exact: false }).first();
      if (await locator.isVisible({ timeout: 2000 })) {
        await locator.click();
        return true;
      }
    } catch {
      // 继续尝试下一个选择器
    }
  }
  return false;
}

async function ensureLogin() {
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: 375, height: 812 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  const currentUrl = page.url();
  if (currentUrl.includes("login") || currentUrl.includes("passport")) {
    console.log("检测到未登录，请在浏览器中完成登录。");
    await waitForEnter("登录完成后，请按回车继续...");
  } else {
    console.log("已检测到登录状态，跳过登录步骤。");
  }

  await context.close();
}

async function main() {
  await ensureLogin();

  // 首次立即执行
  await applyPriceProtection();

  // 定期执行
  console.log(
    `\n将每 ${INTERVAL_MS / 1000 / 60} 分钟自动执行一次价格保护申请`
  );
  setInterval(applyPriceProtection, INTERVAL_MS);
}

main().catch(console.error);
