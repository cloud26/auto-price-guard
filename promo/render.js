// 将 scene.html 逐帧渲染为 promo.mp4 / promo.webp
// 用法: node promo/render.js [--preview t1,t2,...]
// 依赖: playwright (chromium) + ffmpeg + python3 Pillow
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FPS = 30;
const OUT_DIR = __dirname;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(__dirname, 'scene.html'));
  await page.evaluate(() => window.ready);
  const duration = await page.evaluate(() => window.DURATION);

  const previewIdx = process.argv.indexOf('--preview');
  if (previewIdx !== -1) {
    for (const t of process.argv[previewIdx + 1].split(',').map(Number)) {
      await page.evaluate(t => window.render(t), t);
      await page.screenshot({ path: path.join(os.tmpdir(), `promo-preview-${t}.png`) });
    }
    await browser.close();
    return;
  }

  const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promo-frames-'));
  const total = Math.round(duration * FPS);
  for (let i = 0; i < total; i++) {
    await page.evaluate(t => window.render(t), i / FPS);
    await page.screenshot({ path: path.join(frameDir, `f${String(i).padStart(5, '0')}.png`) });
  }
  await browser.close();

  const input = ['-y', '-framerate', String(FPS), '-i', path.join(frameDir, 'f%05d.png')];
  execFileSync('ffmpeg', [...input, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20',
    '-preset', 'slow', '-movflags', '+faststart', path.join(OUT_DIR, 'promo.mp4')], { stdio: 'inherit' });
  // README 用的动图：animated WebP 比 GIF 小得多，GitHub 可直接内联播放
  const webpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promo-webp-'));
  execFileSync('ffmpeg', ['-loglevel', 'error', '-i', path.join(OUT_DIR, 'promo.mp4'),
    '-vf', 'fps=20,scale=960:-1:flags=lanczos', path.join(webpDir, '%04d.png')], { stdio: 'inherit' });
  execFileSync('python3', [path.join(__dirname, 'to_webp.py'), webpDir, path.join(OUT_DIR, 'promo.webp'), '50'],
    { stdio: 'inherit' });
  fs.rmSync(webpDir, { recursive: true, force: true });
  fs.rmSync(frameDir, { recursive: true, force: true });
})();
