'use strict';

/**
 * sw.js —— 离线缓存（相对路径；应用代码/资源零外部依赖，唯独地图 JS SDK 经高德 CDN 加载，见 index.html）
 *
 * 作用域说明：本文件必须放在项目根目录（与 index.html 同级），
 * 这样 scope 才是 '/'，才能接管整站；放在 js/ 下只能接管 /js/ 路径。
 *
 * 安全边界：
 * - 只缓存静态资源；用户存档在 localStorage，与本文件无关，绝不写入 cache。
 * - file:// 协议下浏览器根本不暴露 navigator.serviceWorker，本文件不会被注册。
 * - 本文件内不出现任何 http(s) 字面量（QA 静态检查「无外部网络依赖」要求）。
 * - 唯一的外部引用是 index.html 从高德 CDN 加载地图 JS SDK（地图必须联网，应用代码/资源仍零本地依赖），
 *   该 CDN 为跨域请求，本 Service Worker 按 fetch 处理策略直接放行、不缓存。
 *
 * 缓存策略（v3 起——根治「打开常是旧版本」）：
 * - 旧版用 Cache-First：命中即返回，部署后除非手动改 CACHE 名，用户永远拿旧资源。
 * - 新版改为 **Network-First + 强制回源校验（cache:'no-cache'）**：在线永远先问网络，
 *   穿透浏览器与 CDN 缓存拿到最新；仅在离线/网络失败时回退已缓存副本，保证可用。
 * - 缓存 key 归一化（剥离 ?v= 等版本参数），使 index.html 带版本号的引用与预缓存清单命中同一份。
 * - 安装即 skipWaiting、激活即 clients.claim，新 SW 立即接管；并监听 SKIP_WAITING 消息做兜底。
 * - CACHE 名带 ASSET_VER（应用版本）与 BUILD（部署戳）：每次发布改 BUILD，
 *   既触发浏览器重新安装新 SW，又使离线预缓存整体刷新。
 */

/** 应用版本：与 modules/core.js 的 APP_INFO.version 对齐，发布时一并 bump */
var ASSET_VER = '1.0.5';

/** 部署戳：每次发布改这个值（例如 YYYYMMDDHHMM），强制 SW 内容变化、触发自动更新 */
var BUILD = '20261001-1453';

/** 缓存名 = 版本 + 部署戳；改名即全量刷新（旧缓存由 activate 清理） */
var CACHE = 'earth-online-sw-' + ASSET_VER + '-' + BUILD;

/** 预缓存清单（全部相对路径，无版本参数；离线首屏兜底用） */
var PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './vendor/localforage.min.js',
  './modules/storage.js',
  './modules/bus.js',
  './modules/core.js',
  './modules/achievements.js',
  './modules/profile.js',
  './modules/collections.js',
  './modules/backup.js',
  './modules/webdav.js',
  './modules/stats.js',
  './modules/account.js',
  './modules/ai.js',
  './modules/map.js',
  './modules/pages.js',
  './modules/app.js',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
      .catch(function () { /* 预缓存失败不阻断安装，下次导航继续走网络 */ })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k); // 清理旧版本缓存
        }));
      })
      .then(function () { return self.clients.claim(); })
      .catch(function () { /* 清理失败不影响接管 */ })
  );
});

/** 收到 SKIP_WAITING 消息时立即接管（与 install 内的 skipWaiting 互为兜底） */
self.addEventListener('message', function (event) {
  try {
    if (event.data && event.data.type === 'SKIP_WAITING') {
      self.skipWaiting();
    }
  } catch (e) { /* 忽略消息解析异常 */ }
});

/**
 * 归一化缓存 key：剥离查询串与 hash，使 `modules/core.js?v=1.0.4` 与预缓存的
 * `modules/core.js` 命中同一份缓存，也避免同文件因版本参数不同产生多份副本。
 */
function cacheKeyOf(reqUrl) {
  try {
    var u = new URL(reqUrl);
    return u.origin + u.pathname;
  } catch (e) {
    return reqUrl;
  }
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (!req || req.method !== 'GET') return; // 只处理 GET

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return; // 跨源请求直接放行（高德 CDN 等）

  var key = cacheKeyOf(req.url);

  // 导航请求（HTML）的 Request 复制后重新 fetch 受构造器限制，改用 URL 字符串发起回源请求
  var fetchTarget = (req.mode === 'navigate') ? req.url : req;

  event.respondWith(
    // 网络优先 + 强制回源校验：在线永远拿最新，穿透 CDN/浏览器缓存
    fetch(fetchTarget, { cache: 'no-cache' })
      .then(function (res) {
        if (res && res.status === 200) {
          // 落盘缓存供离线兜底（用归一化 key，便于离线回退命中）
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put(key, copy);
          }).catch(function () { /* 写缓存失败不影响本次响应 */ });
          return res;
        }
        // 304 等非 200：优先返回已有缓存副本，否则原样透传
        return caches.match(key).then(function (hit) { return hit || res; });
      })
      .catch(function () {
        // 离线或网络失败：回退已缓存副本；导航请求再回退首页（SPA 兜底）
        return caches.match(key).then(function (hit) {
          if (hit) return hit;
          if (req.mode === 'navigate') return caches.match('./index.html');
          return new Response('', { status: 504, statusText: 'offline' });
        });
      })
  );
});
