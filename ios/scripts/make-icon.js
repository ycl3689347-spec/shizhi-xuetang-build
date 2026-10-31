/* 生成 iOS 用的 1024×1024 方形应用图标。
 *
 * 和安卓那套图标不是一回事：安卓要圆角蒙版 + 各档 mipmap，iOS 只认一张
 * 1024×1024 的方图，圆角由系统在桌面自动裁（自己裁反而会出现双层圆角）。
 *
 * 源图是 android/shots/icon-src-shizhi-cream.png（1024×1024，已把方块外的白底
 * 泛洪填成奶油色）。奶油方块的实际范围是 x=22 y=12 w=972 h=990 —— 直接铺满
 * 会露出外围一圈白底，所以用 SVG 的 viewBox 把它裁出来再拉到 1024。
 * 用 viewBox 放大并居中，四边由底色（同一块奶油）自然填满。
 *
 * 用法：node ios/scripts/make-icon.js
 */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..');
const SRC = path.join(ROOT, 'android', 'shots', 'icon-src-shizhi-cream.png');
const OUT_DIR = path.join(ROOT, 'ios', 'Resources', 'Assets.xcassets', 'AppIcon.appiconset');
const OUT = path.join(OUT_DIR, 'icon-1024.png');
const TMP = path.join(HERE, '_icon.html');

/* 裁切框：源图整幅就是满幅奶油（四角采样都是 254,251,242），所以不用再处理白边。
   这里只是把图案放大——原先按整幅出图时书本只占中间 40%，放在 iOS 桌面上偏空。
   720×760 让图案占到约 55%，接近 iOS 图标常见的内容比例。 */
const BBOX = { x: 152, y: 132, w: 720, h: 760 };

const BROWSERS = [
  process.env.CHROME,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].filter(Boolean);

const browser = BROWSERS.find((p) => fs.existsSync(p));
if (!browser) {
  console.error('找不到 Edge / Chrome。');
  process.exit(1);
}
if (!fs.existsSync(SRC)) {
  console.error('找不到源图：' + SRC);
  process.exit(1);
}

/* SVG 的 viewBox 就是现成的裁切框，preserveAspectRatio="none" 允许非等比拉伸 */
const html = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:#fefbf2;overflow:hidden}svg{display:block}</style>
<svg width="1024" height="1024" viewBox="${BBOX.x} ${BBOX.y} ${BBOX.w} ${BBOX.h}" preserveAspectRatio="none">
  <image href="${path.basename(SRC)}" x="0" y="0" width="1024" height="1024"/>
</svg>`;

/* 图片必须和 html 同目录，data: 页面读不到 file:// 的图 */
fs.copyFileSync(SRC, path.join(HERE, path.basename(SRC)));
fs.writeFileSync(TMP, html, 'utf8');

fs.mkdirSync(OUT_DIR, { recursive: true });
const r = spawnSync(browser, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--force-color-profile=srgb', '--allow-file-access-from-files',
  '--window-size=1024,1024',
  '--screenshot=' + OUT.replace(/\\/g, '/'),
  'file:///' + TMP.replace(/\\/g, '/')
], { encoding: 'utf8', timeout: 120000 });

fs.unlinkSync(TMP);
fs.unlinkSync(path.join(HERE, path.basename(SRC)));

if (!fs.existsSync(OUT)) {
  console.error('渲染失败：', (r.stderr || '').slice(-500));
  process.exit(1);
}

/* 校验尺寸：iOS 对非 1024 的图标会直接报错，不静默缩放 */
const buf = fs.readFileSync(OUT);
if (buf.slice(1, 4).toString() !== 'PNG') { console.error('产物不是 PNG'); process.exit(1); }
const w = buf.readUInt32BE(16);
const h = buf.readUInt32BE(20);
console.log('图标已生成：' + OUT);
console.log('  尺寸 ' + w + '×' + h + '，' + Math.round(buf.length / 1024) + ' KB');
if (w !== 1024 || h !== 1024) {
  console.error('尺寸不对，iOS 要求 1024×1024。');
  process.exit(1);
}
