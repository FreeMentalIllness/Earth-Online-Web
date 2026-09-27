/* ==================== 数据持久化层（v16 · ① 全量 IndexedDB 迁移） ==================== *
 * 基于 localforage（已本地内置 vendor/localforage.min.js，零外链、离线可用）。
 * 数据库：EarthOnlineDB / store: kv，驱动优先顺序 [IndexedDB, WebSQL, localStorage]。
 *
 * 设计要点（与用户确认 + 守住 90 项测试）：
 *   - 内存镜像 + 异步落盘：对外接口 loadState()/saveState() 等保持「同步」契约，
 *     不破坏现有 ~54 处调用点与 90 项逻辑测试（启动后从内存镜像同步读取）。
 *   - 一次性迁移：启动扫描旧 localStorage 的 earth_* 键 → 写入 localforage → 清理旧键 → 标记 migrated。
 *   - 降级绳：IndexedDB/WebSQL 不可用时 localforage 自动退 localStorage 驱动并 console.warn；
 *     极端情况（localforage 未加载 / 全不可用）退纯内存，绝不抛异常。
 *   - 大文件（头像 / 壁纸 / 收藏附件）走 Blob 接口（EarthIDB 兼容别名），IndexedDB 原生支持 Blob。
 */
(function () {
  'use strict';

  // 挂到真正的全局对象（node 测试包里 this 不是 global，必须用 globalThis）
  var root = (typeof globalThis !== 'undefined') ? globalThis
    : (typeof window !== 'undefined') ? window
    : (typeof global !== 'undefined') ? global
    : this;

  var DB_NAME = 'EarthOnlineDB';
  var STORE = 'kv';
  var MIGRATED_KEY = 'earth_migrated';

  var lf = null;             // localforage 实例
  var ready = null;          // eoInit 的 promise（缓存，避免重复初始化）
  var usingFallback = false; // 非 IDB 驱动（localStorage / 纯内存）
  var mem = Object.create(null); // 启动后内存镜像，供同步读取

  /* ---------- 底层助手 ---------- */
  function hasLS() {
    try { return (typeof localStorage !== 'undefined') && localStorage && typeof localStorage.getItem === 'function'; }
    catch (e) { return false; }
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 配额 / 隐私模式忽略 */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* 忽略 */ } }
  function lsKeys() {
    try {
      if (typeof localStorage.key === 'function' && typeof localStorage.length === 'number') {
        var a = [], i;
        for (i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k) a.push(k); }
        return a;
      }
    } catch (e) { /* 忽略 */ }
    return [];
  }

  function getLF() {
    if (lf) return lf;
    if (typeof localforage === 'undefined' || !localforage) return null;
    try {
      lf = localforage.createInstance({
        name: DB_NAME,
        storeName: STORE,
        driver: [localforage.INDEXEDDB, localforage.WEBSQL, localforage.LOCALSTORAGE],
      });
    } catch (e) { lf = null; }
    return lf;
  }

  // 值编解码：localforage 自动结构化克隆；localStorage 降级需 JSON。
  // decode 对 localStorage 读到的原始字符串尝试 JSON.parse，失败则原样返回（兼容旧版主题 'dark' 这类原始值）。
  function encode(v) { return JSON.stringify(v); }
  function decode(raw) {
    if (raw == null) return null;
    if (typeof raw !== 'string') return raw; // localforage 直出对象 / Blob
    try { return JSON.parse(raw); } catch (e) { return raw; }
  }

  /* ---------- 启动：建实例 + 一次性迁移 + 载入内存镜像 ---------- */
  function eoInit() {
    if (ready) return ready;
    var inst = getLF();
    if (!inst) {
      // 无 localforage（如 node 测试桩 / 库未加载）→ localStorage 作后端；无 localStorage 则纯内存
      usingFallback = true;
      ready = Promise.resolve();
      return ready;
    }
    ready = inst.ready().then(function () {
      try {
        usingFallback = (inst.driver() !== localforage.INDEXEDDB && inst.driver() !== localforage.WEBSQL);
      } catch (e) { usingFallback = true; }
      if (usingFallback) {
        try { console.warn('[EOStore] IndexedDB/WebSQL 不可用，已降级使用 localStorage 存储'); } catch (e) {}
      }
      return migrateFromLocalStorage(inst);
    }).then(function () {
      return loadAllIntoMem(inst);
    }).catch(function (e) {
      // 极端：localforage 初始化失败 → 降级内存 + localStorage，绝不阻断应用
      usingFallback = true;
      ready = null;
      try { console.warn('[EOStore] 存储初始化失败，降级内存存储：', e); } catch (err) {}
      return Promise.resolve();
    });
    return ready;
  }

  // 一次性迁移：旧 localStorage 的 earth_* 键 → localforage，并清理旧键（标记 migrated）
  function migrateFromLocalStorage(inst) {
    if (!hasLS()) return Promise.resolve();
    var marker = null;
    try { marker = localStorage.getItem(MIGRATED_KEY); } catch (e) {}
    if (marker === '1') return Promise.resolve();
    var oldKeys = lsKeys().filter(function (k) {
      return /^earth_/.test(k) && k.indexOf(DB_NAME) !== 0; // 排除 localforage 自身命名空间（EarthOnlineDB/...）
    });
    if (!oldKeys.length) { try { localStorage.setItem(MIGRATED_KEY, '1'); } catch (e) {} return Promise.resolve(); }
    return Promise.all(oldKeys.map(function (k) {
      var raw = lsGet(k);
      var val = decode(raw);
      return inst.setItem(k, val).then(function () {
        lsDel(k); // 迁移成功后清理旧键，避免双份
      }).catch(function () { /* 单键失败跳过，不阻断整体迁移 */ });
    })).then(function () {
      try { localStorage.setItem(MIGRATED_KEY, '1'); } catch (e) {}
    });
  }

  function loadAllIntoMem(inst) {
    return inst.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return inst.getItem(k).then(function (v) { mem[k] = v; });
      }));
    });
  }

  /* ---------- 读写 API ---------- */
  // 同步读取：
  //   - 有 localforage 后端：内存镜像 mem 为权威同步来源（启动后由 eoInit 载入，eoSet 实时同步）。
  //   - 无 localforage 后端（node 测试桩 / 纯 localStorage 降级）：直读 localStorage，
  //     不再依赖 mem —— 否则 mem 会被前期 eoSet 污染，导致「先写旧数据到 localStorage、再读」的测试读到脏内存。
  function eoGetSync(key) {
    var inst = getLF();
    if (inst) {
      if (Object.prototype.hasOwnProperty.call(mem, key)) return mem[key];
      if (hasLS()) {
        var raw0 = lsGet(key);
        if (raw0 != null) return decode(raw0);
      }
      return null;
    }
    if (hasLS()) {
      var raw = lsGet(key);
      if (raw != null) return decode(raw);
    }
    return null;
  }

  // 写入：
  //   - 有 localforage 后端：同步更新内存镜像 + 异步落盘（mem 供 getSync 即时读）。
  //   - 无 localforage 后端：直接写 localStorage（同步即可，无需 mem）。
  function eoSet(key, val) {
    var inst = getLF();
    if (inst) {
      mem[key] = val;
      try { inst.setItem(key, val).catch(function () {}); } catch (e) {}
    } else if (hasLS()) {
      lsSet(key, encode(val));
    }
  }

  function eoRemove(key) {
    delete mem[key];
    var inst = getLF();
    if (inst) { try { inst.removeItem(key).catch(function () {}); } catch (e) {} }
    if (hasLS()) lsDel(key);
  }

  function eoGet(key) {
    var inst = getLF();
    if (inst) return inst.getItem(key).catch(function () { return eoGetSync(key); });
    return Promise.resolve(eoGetSync(key));
  }

  // 枚举全部键（启动后来自内存镜像；降级时来自 localStorage）
  function eoKeys() {
    if (getLF()) return Object.keys(mem);
    if (hasLS()) return lsKeys();
    return Object.keys(mem);
  }

  /* ---------- Blob 大文件接口（向后兼容原 EarthIDB.idbGet/Set/Del） ---------- */
  function blobGet(key) {
    var inst = getLF();
    if (inst) return inst.getItem(key).catch(function () { return null; });
    return Promise.resolve(null);
  }
  function blobSet(key, blob) {
    var inst = getLF();
    if (inst) { try { return inst.setItem(key, blob).catch(function () {}); } catch (e) {} }
    return Promise.resolve();
  }
  function blobDel(key) {
    var inst = getLF();
    if (inst) { try { inst.removeItem(key).catch(function () {}); } catch (e) {} }
    if (hasLS()) lsDel(key);
  }

  /* ---------- 导出 ---------- */
  root.EOStore = {
    init: eoInit,
    get: eoGet,
    getSync: eoGetSync,
    set: eoSet,
    remove: eoRemove,
    keys: eoKeys,
    isFallback: function () { return usingFallback; },
    driverName: function () { try { return getLF() ? getLF().driver() : 'memory'; } catch (e) { return 'memory'; } },
  };
  // 大文件 Blob 接口别名（头像 / 壁纸 / 收藏附件），IndexedDB 原生支持 Blob，无需 base64 二次膨胀
  root.EarthIDB = {
    idbGet: blobGet,
    idbSet: blobSet,
    idbDel: blobDel,
    openEarthDB: function () { return getLF() ? getLF().ready() : Promise.resolve(); },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.EOStore;
})();
