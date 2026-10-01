'use strict';
const fs = require('fs');
const path = require('path');
const Babel = require('C:/Users/FMI/.workbuddy/binaries/node/workspace/node_modules/@babel/standalone');

const ROOT = "D:/AI/app/EarthOnline-Web";
const FILES = [
  'modules/bus.js',
  'vendor/localforage.min.js',
  'modules/storage.js',
  'modules/core.js', 'modules/achievements.js', 'modules/profile.js', 'modules/collections.js',
  'modules/backup.js', 'modules/webdav.js', 'modules/stats.js', 'modules/account.js', 'modules/pages.js', 'modules/app.js',
  'modules/map.js', 'modules/ai.js',
];

function transpile(src) {
  // 目标 ie11 = 纯 ES5；babel 只做语法降级（const/let/箭头/模板字符串/默认参数等），
  // 不注入 Promise/fetch 等运行时 polyfill（需浏览器自带，Pakr 核心功能不依赖）。
  return Babel.transform(src, {
    presets: [['env', { targets: { ie: '11' } }]],
    sourceType: 'script',
  }).code;
}

async function main() {
  let bundle = '';
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const out = transpile(src);
    bundle += '\n/* ===== ' + f + ' ===== */\n' + out;
  }

  // 运行时垫片：babel 不降级的内置方法（Set / padStart / repeat），按 ES5 手写。
  const shim = [
    'if (typeof Object.assign !== "function") { Object.assign = function (t) { for (var i = 1; i < arguments.length; i++) { var s = arguments[i]; if (s) { for (var k in s) { if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k]; } } } return t; }; }',
    'if (typeof String.prototype.padStart !== "function") { String.prototype.padStart = function (n, c) { var s = String(this); c = c || " "; while (s.length < n) s = c + s; return s; }; }',
    'if (typeof String.prototype.repeat !== "function") { String.prototype.repeat = function (n) { var s = "", t = String(this), i; for (i = 0; i < n; i++) s += t; return s; }; }',
    'if (typeof Array.prototype.find !== "function") { Array.prototype.find = function (fn) { for (var i = 0; i < this.length; i++) { if (fn(this[i], i, this)) return this[i]; } return undefined; }; }',
    'if (typeof Array.prototype.findIndex !== "function") { Array.prototype.findIndex = function (fn) { for (var i = 0; i < this.length; i++) { if (fn(this[i], i, this)) return i; } return -1; }; }',
    'if (typeof Array.from !== "function") { Array.from = function (src) { var out = []; if (!src) return out; if (typeof src.length === "number") { for (var i = 0; i < src.length; i++) out.push(src[i]); } else if (typeof src.forEach === "function") { src.forEach(function (x) { out.push(x); }); } else if (typeof src.next === "function") { var it = src; var v; while (!(v = it.next()).done) out.push(v.value); } return out; }; }',
    'if (typeof Set !== "function") { function SetPoly(items) { this._a = []; if (items) { var self = this; items.forEach(function (x) { self.add(x); }); } } SetPoly.prototype.add = function (v) { if (this._a.indexOf(v) === -1) { this._a.push(v); } return this; }; SetPoly.prototype.has = function (v) { return this._a.indexOf(v) !== -1; }; SetPoly.prototype.delete = function (v) { var i = this._a.indexOf(v); if (i !== -1) { this._a.splice(i, 1); return true; } return false; }; SetPoly.prototype.forEach = function (fn) { for (var i = 0; i < this._a.length; i++) fn(this._a[i], i, this); }; SetPoly.prototype.clear = function () { this._a = []; }; Object.defineProperty(SetPoly.prototype, "size", { get: function () { return this._a.length; } }); if (typeof global !== "undefined") global.Set = SetPoly; else if (typeof window !== "undefined") window.Set = SetPoly; }',
  ].join('\n');

  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  // v9：优先内联 PNG。Pakr 的 WebView 对 SVG 图标支持不稳定（常静默回落到系统默认图标，
  // 表现为「图标没生效」），PNG 是它明确支持的格式；SVG 仍作为兜底挂在后面一条 link 上。
  const iconPng = fs.readFileSync(path.join(ROOT, 'icons/icon.png'));
  const iconPngUri = 'data:image/png;base64,' + iconPng.toString('base64');
  const icon = fs.readFileSync(path.join(ROOT, 'icons/icon.svg'), 'utf8');
  const iconUri = 'data:image/svg+xml,' + encodeURIComponent(icon.replace(/\s+/g, ' '));

  const html =
    '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n' +
    '<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">\n' +
    '<meta name="theme-color" content="#f8f6f2">\n' +
    '<title>地球Online · 人生记录</title>\n' +
    '<link rel="icon" type="image/png" sizes="192x192" href="' + iconPngUri + '">\n' +
    '<link rel="apple-touch-icon" href="' + iconPngUri + '">\n' +
    '<link rel="icon" type="image/svg+xml" href="' + iconUri + '">\n' +
    '<style>\n' + css + '\n</style>\n' +
    // 高德地图 JS API（Key + 安全密钥硬编码）：安全密钥须在 SDK 加载前注入；AMap 2.0 读取带下划线的 _AMapSecurityConfig
    '<script>window._AMapSecurityConfig = { securityJsCode: "d4e92781da1ca5996c246d315af66031" };</script>\n' +
    '<script src="https://webapi.amap.com/maps?v=2.0&key=07672883965ec7a6f0948813c0a90915"></script>\n' +
    '</head>\n<body>\n' +
    // v9：开屏遮罩必须排在 #app 之前，才能在首帧就盖住尚未渲染完的页面
    '<div id="splash"><div class="splash-inner">' +
    '<div class="splash-logo">🌍</div>' +
    '<div class="splash-title">地球<span class="splash-title-sub">Online</span></div>' +
    '<div class="splash-sub">人生记录 · 加载中</div>' +
    '<div class="splash-bar"><i class="splash-bar-fill"></i></div>' +
    '</div></div>\n' +
    '<div id="app">\n' +
    '  <aside class="sidebar"><div class="logo"><span class="logo-orb"></span><span class="logo-text">地球<small>Online</small></span></div>\n' +
    '    <nav id="nav" class="nav"></nav>\n' +
    '    <div class="quick-memo"><div class="quick-memo-title">灵感闪念</div>' +
    '<input id="sidebarMemoInput" placeholder="回车即记录" maxlength="200"></div>\n' +
    '    <div class="sidebar-foot">地球Online · 本地存档</div></aside>\n' +
    '  <main id="content"></main>\n</div>\n' +
    // v19：首次引导页挂载点（原账号系统界面容器改造）。必须与 index.html 对齐，否则引导页无容器。
    '<div id="auth-root"></div>\n' +
    '<div id="modal-root"></div>\n' +
    '<input type="file" id="backupFileInput" accept="application/json,.json" hidden>\n' +
    // v8/v9：收藏附件选择框。此前 Pakr 模板漏了这个隐藏 input，导致「选择文件」按钮点了没反应
    '<input type="file" id="collectionFileInput" accept="image/*,audio/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.exe,.apk,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/zip,application/octet-stream" hidden>\n' +
    // v15：此前模板里 #tabbar 是空节点，导致 ES5 包首页没有底部 Tab。
    // 与 index.html 对齐写为静态 4 项（图标 / 文字 / 选中圆点三层结构）。
    '<nav id="tabbar" class="tabbar" aria-label="移动端导航">' +
    '<div class="tab-item active" data-page="home"><span class="tab-item-icon">🏠</span><span class="tab-item-label">主页</span><i class="tab-dot" aria-hidden="true"></i></div>' +
    '<div class="tab-item" data-page="tasks"><span class="tab-item-icon">📋</span><span class="tab-item-label">任务</span><i class="tab-dot" aria-hidden="true"></i></div>' +
    '<div class="tab-item" data-page="backpack"><span class="tab-item-icon">🎒</span><span class="tab-item-label">背包</span><i class="tab-dot" aria-hidden="true"></i></div>' +
    '<div class="tab-item" data-page="ai"><span class="tab-item-icon">🤖</span><span class="tab-item-label">系统</span><i class="tab-dot" aria-hidden="true"></i></div>' +
    '</nav>\n' +
    '<div id="tabMoreSheet" class="tab-sheet"></div>\n' +
    '<div id="pwaTip" class="pwa-tip" hidden><span class="pwa-tip-text">📱 添加到主屏幕，随时记录人生</span>' +
    '<button class="pwa-tip-close" id="pwaTipClose" aria-label="关闭">×</button></div>\n' +
    '<script>\n' + shim + '\n' + bundle + '\n</script>\n</body>\n</html>\n';

  fs.writeFileSync(path.join(ROOT, 'index_pakr.html'), html);
  console.log('OK: index_pakr.html written, bytes=' + html.length);

  stampVersion();
}

/** 自动版本指纹（v1.0.4 QA 建议）：构建时从 core.js 提取版本号，生成「版本-时间戳」，
 * 同步写入 index.html 本地资源 ?v= 与 sw.js 的 ASSET_VER/BUILD。
 * 每次构建必然变化 → 消除发布时人工递增版本参数/部署戳的环节。
 * 注意：只动本地资源引用（css/…css?v= 与 modules/…js?v=），高德 CDN 的 maps?v=2.0 是 API 版本，绝不触碰。 */
function stampVersion() {
  const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
  const now = new Date();
  const stamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' + pad(now.getHours()) + pad(now.getMinutes());

  // 1) 版本号取自 core.js 的 APP_INFO.version（单一事实来源）
  const coreSrc = fs.readFileSync(path.join(ROOT, 'modules/core.js'), 'utf8');
  const m = coreSrc.match(/version:\s*'(\d+\.\d+\.\d+)'/);
  if (!m) { console.error('WARN: 未能从 core.js 提取版本号，跳过版本戳'); return; }
  const ver = m[1];
  const fingerprint = ver + '-' + stamp;

  // 2) index.html：替换本地资源引用的 ?v= 指纹
  const idxPath = path.join(ROOT, 'index.html');
  let idx = fs.readFileSync(idxPath, 'utf8');
  const idxRe = /((?:css|modules|vendor)\/[A-Za-z0-9._-]+\.(?:css|js))\?v=[^"']*/g;
  let idxCount = 0;
  idx = idx.replace(idxRe, function (_, p1) { idxCount++; return p1 + '?v=' + fingerprint; });
  fs.writeFileSync(idxPath, idx);

  // 3) sw.js：ASSET_VER 对齐版本；BUILD 换成构建戳（改名即全量刷新 + 触发 SW 自动更新）
  const swPath = path.join(ROOT, 'sw.js');
  let sw = fs.readFileSync(swPath, 'utf8');
  const before = sw;
  sw = sw.replace(/var ASSET_VER = '[^']*';/, "var ASSET_VER = '" + ver + "';");
  sw = sw.replace(/var BUILD = '[^']*';/, "var BUILD = '" + stamp + "';");
  if (sw !== before) fs.writeFileSync(swPath, sw);

  console.log('OK: 版本指纹 ' + fingerprint + ' → index.html ' + idxCount + ' 处引用, sw.js ASSET_VER/BUILD 已同步');
}

main().catch(function (e) { console.error(e); process.exit(1); });
