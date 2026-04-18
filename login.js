const { chromium } = require("playwright");
const path = require("path");

const USER_DATA_DIR = path.join(__dirname, "user-data");

async function login() {
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: 375, height: 812 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto("https://plogin.m.jd.com/login/login");

  console.log("请在浏览器中完成登录，登录成功后按 Ctrl+C 退出。");
  console.log("登录状态会保存在 user-data 目录中，之后运行脚本会自动使用。");

  // 等待用户登录完成（检测跳转到首页或其他页面）
  await page.waitForURL("**/*", { timeout: 0 });
  // 保持浏览器打开，让用户手动关闭
  await new Promise(() => {});
}

login().catch(console.error);
