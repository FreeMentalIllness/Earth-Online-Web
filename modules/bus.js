/* ==================== 模块解耦：轻量事件总线（v15 持久化 / 解耦批） ==================== *
 * 设计目的：解除页面模块（pages.js）对应用核心模块（app.js）内部函数的硬耦合。
 *   - 此前 pages.js 直接调用 app.js 的 applyTheme / applyWallpaper / pushDueNotifications；
 *   - 现在改为 EarthBus.emit('ui:apply-theme') 等语义事件，由 app.js 自行订阅处理。
 * 各模块只依赖「事件契约」，不依赖彼此的函数名，便于后续单文件替换 / 测试。
 *
 * 零依赖、同步分发（emit 后立即同步触发订阅者，等价于原直调，不引入时序不确定性）。
 * 订阅回调内部抛错被吞掉并告警，避免单点故障阻断整条事件链。
 */
(function () {
  'use strict';
  var g = (typeof globalThis !== 'undefined') ? globalThis
    : (typeof window !== 'undefined') ? window
    : this;

  /** type -> 订阅者数组 */
  var listeners = {};

  /** 订阅某类型事件；fn 必须是函数。重复订阅同一 fn 会去重。 */
  function on(type, fn) {
    if (!type || typeof fn !== 'function') return;
    var arr = listeners[type] || (listeners[type] = []);
    if (arr.indexOf(fn) === -1) arr.push(fn);
  }

  /** 取消订阅：不传 fn 则清空该类型全部订阅。 */
  function off(type, fn) {
    if (!listeners[type]) return;
    if (!fn) { listeners[type] = []; return; }
    listeners[type] = listeners[type].filter(function (f) { return f !== fn; });
  }

  /** 广播事件；payload 透传给每个订阅者。回调异常被隔离。 */
  function emit(type, payload) {
    var arr = listeners[type];
    if (!arr || !arr.length) return;
    arr.slice().forEach(function (f) {
      try { f(payload); } catch (e) { console.warn('[EarthBus] 订阅执行出错（' + type + '）：', e); }
    });
  }

  var api = { on: on, off: off, emit: emit };
  g.EarthBus = api;
  g.EO = g.EO || {};
  g.EO.EarthBus = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
