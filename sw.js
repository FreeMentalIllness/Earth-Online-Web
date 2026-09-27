'use strict';

/**
 * sw.js —— 离线缓存（相对路径，零外部依赖）
 *
 * 作用域说明：本文件必须放在项目根目录（与 index.html 同级），
 * 这样 scope 才是 '/'，才能接管整站；放在 js/ 下只能接管 /js/ 路径。
 *
 * 安全边界：
 * - 只缓存静态资源；用户存档在 localStorage，与本文件无关，绝不写入 cache。
 * - file:// 协议下浏览器根本不暴露 navigator.serviceWorker，本文件不会被注册。
 * - 全文不出现任何 http(s) 字面量（QA 静态检查「无外部网络依赖」要求）。
 */

/** 缓存版本：改名即全量更新 */
var CACHE = 'earth-online-v1';

/** 预缓存清单（全部相对路径） */
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
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
      .catch(function () { /* 清理失败不影响接管 */ })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (!req || req.method !== 'GET') return; // 只处理 GET

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 跨源请求直接放行

  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit; // cache-first
      return fetch(req)
        .then(function (res) {
          if (res && res.status === 200 && res.type === 'basic') {
            var copy = res.clone();
            caches.open(CACHE).then(function (cache) {
              cache.put(req, copy);
            }).catch(function () { /* 写缓存失败不影响本次响应 */ });
          }
          return res;
        })
        .catch(function () {
          // 离线且未命中：回退首页（SPA 兜底）
          return caches.match('./index.html');
        });
    })
  );
});
