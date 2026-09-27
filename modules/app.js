/* ===== 模块 app.js（v16 模块化：window.EO 命名空间） ===== */
var state = null;
var currentAccount = null;
var backpackTab = 'all';
(function () {
  'use strict';
  var _g = (typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this));
  _g.EO = _g.EO || {};
  var E = _g.EO;

/**
 * app.js —— 应用入口与路由
 * 负责初始化数据、注册左侧导航与移动端底部 Tab、切换右侧内容区页面、离线运行能力注册。
 *
 * v4 增量：
 * - PAGES 新增 icon 字段（桌面侧栏与移动 Tab 共用一套数据）+ 第 8 个路由「数据」；
 * - 底部 Tab 栏与「更多」面板（≤768px），一律复用 data-page 范式，不引入新 data-action；
 * - 离线运行能力（manifest + sw）注册，file:// 下三重守卫静默跳过。
 */

/**
 * 页面注册表：key 即路由名。
 * ⚠️ 每项必须保持「花括号开头 + key 字段 + label + icon + render 字段」的字面量格式，
 *    QA 的路由计数与渲染函数提取正则依赖该写法，改动前请先看 qa/run_suite.js 的 reK / reR。
 */
const PAGES = [
  { key: 'home',        label: '主页',     icon: '🏠', render: renderHome },
  { key: 'profile',     label: '个人资料', icon: '🪪', render: renderProfile },
  { key: 'tasks',       label: '任务',     icon: '📋', render: renderTasks },
  { key: 'backpack',    label: '背包',     icon: '🎒', render: renderBackpack },
  // v5：原「日历」页已并入「数据」页作为「日历视图」子视图，导航不再单列入口
  { key: 'achievements', label: '成就',    icon: '🏆', render: renderAchievements },
  { key: 'data',        label: '数据',     icon: '📊', render: renderDashboard },
  { key: 'map',         label: '足迹',     icon: '🗺️', render: renderMapAuto },
  { key: 'ai',          label: '系统',     icon: '🤖', render: renderAI },
  { key: 'settings',    label: '设置',     icon: '⚙️', render: renderSettings },
];

/**
 * 移动端底部 Tab 显示的路由 key。
 * ⚠️ 必须是纯字符串数组，绝不能写成对象数组：QA 的路由计数正则会误捕获任何
 *    「花括号 + key 字段 + 单引号小写字母」形态的对象字面量，
 *    写成对象数组会让路由数从 8 暴涨到 12 且原因极难排查。
 *    图标与文案统一从 PAGES 里反查，一套数据两处用。
 */
const MOBILE_TABS = ['home', 'tasks', 'backpack', 'ai'];

/** 当前页面（路由状态，不持久化） */
let currentPage = 'home';
/** 返回键导航栈（弹窗入栈 / 出栈；Android backbutton 或浏览器 popstate 消费） */
var navStack = [];

/** 「已关闭过添加到主屏幕提示」的本地偏好键（设备本地 UI 偏好，不属于人生数据） */
const PWA_TIP_KEY = STORAGE_PREFIX + 'pwa_tip_v1';

/** 按 key 查页面定义 */
function findPage(key) {
  return PAGES.find(function (p) { return p.key === key; }) || null;
}

/**
 * 重新渲染当前页面。
 *
 * @param {{animate?: boolean}} [opts]
 *   animate 为 true 时播放入场动画（淡入上浮），**仅用于页面切换**。
 *   默认 false：页面内操作（增删改任务/物品/日志、勾选、切换筛选）一律无动画重绘。
 *
 * 为什么默认「无动画」而不是默认「有动画」：
 *   页面内的刷新调用点有 30+ 处，若默认有动画，每一处都得显式传 false，
 *   漏一处就会在用户点个复选框时整页上浮一次。反过来默认无动画是 fail-safe 的 ——
 *   新写的调用点忘了传参也只是瞬时刷新，不会晃眼。
 *
 * 为什么动画类由这里统一挂、而不是渲染函数自己加：
 *   渲染函数（renderHome/renderTasks/...）不知道自己是被页面切换还是被页面内操作触发的，
 *   把 animate 一路透传进去会让十几个函数都多一个参数，极易漏传。
 *   由调度层在渲染完成后统一给根元素挂类，只需一处判断。
 */
function refreshCurrentPage(opts) {
  const page = findPage(currentPage);
  if (!page) return;
  // 渲染守卫：任何一个页面渲染函数抛异常都会让「点导航没反应」且不留提示，
  // 这里兜住并给出轻提示 + 控制台留痕，避免静默失败。
  if (typeof page.render !== 'function') {
    try {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[地球Online] 页面缺少渲染函数：' + String(currentPage));
      }
    } catch (e) { /* 忽略 */ }
    try { if (typeof toast === 'function') toast('页面加载失败，请刷新重试'); } catch (e) { /* 忽略 */ }
    return;
  }
  try {
    page.render();
  } catch (err) {
    try {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[地球Online] 页面渲染失败：' + String(currentPage), err);
      }
    } catch (e) { /* 忽略 */ }
    try { if (typeof toast === 'function') toast('页面加载失败，请刷新重试'); } catch (e) { /* 忽略 */ }
    return;
  }
  if (opts && opts.animate) applyPageEnterAnimation();
}

/**
 * 给内容区根元素挂入场动画类。
 * 动画本身定义在 CSS 的 `.page-enter` 上（而非裸 `.page`），
 * 这样不带该类时整页重绘就是瞬时完成的。
 */
function applyPageEnterAnimation() {
  try {
    const root = document.querySelector('#content .page');
    if (root && root.classList && typeof root.classList.add === 'function') {
      root.classList.add('page-enter');
    }
  } catch (e) { /* 非浏览器 / QA 环境忽略 */ }
}

/** 同步侧栏 / 底部 Tab 两处的高亮（底部 Tab 为静态 HTML，仅切 .active 不重建节点） */
function syncNavActive(pageKey) {
  document.querySelectorAll('#nav .nav-item').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.page === pageKey);
  });
  document.querySelectorAll('#tabbar .tab-item').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.page === pageKey);
  });
}

/** 切换页面：更新导航高亮 + 渲染内容区 */
/**
 * 切换页面后把滚动位置复位到顶部。
 * 当前布局下滚动容器是 window（#content 没有 overflow），但这里对两者都做一次，
 * 万一以后 #content 变成独立滚动容器也能直接生效。
 * 已在顶部时不触发动画，避免无谓的滚动事件。
 */
function scrollToTopOnNavigate() {
  try {
    const y = (typeof window !== 'undefined' && typeof window.scrollY === 'number') ? window.scrollY : 0;
    if (y > 0 && typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  } catch (e) {
    // 部分环境不支持 smooth 选项，退回瞬间跳转
    try { window.scrollTo(0, 0); } catch (e2) { /* 忽略 */ }
  }
  try {
    const content = document.getElementById('content');
    if (content && content.scrollTop > 0) content.scrollTop = 0;
  } catch (e) { /* 忽略 */ }
}

/**
 * 切换页面。
 *
 * 铁律（v1.2.0 修复「从主页点入其他页面后，再点主页 Tab 无反应」）：
 *   页面切换必须**先清掉一切覆盖层**，否则目标页渲染了、用户却仍被压在遮罩下面，
 *   看起来就是「点了没反应」。覆盖层有三种，全部在这里收口：
 *     ① 弹窗（#modal-root 的 .modal-overlay 铺满视口，会吃掉所有点击）
 *     ② 「更多」下拉面板（移动端可能是底部抽屉，正好压在 Tab 栏上方）
 *     ③ 开屏遮罩（理论上早该淡出，兜底再关一次）
 *   另外 navStack（返回栈）也要一并清空 —— 否则残留的 modal 条目会让返回键
 *   第一次按下时去关一个已经不存在的弹窗。
 *
 * @param {string} pageKey
 * @param {{scrollTop?: boolean}} [opts] 传 { scrollTop: false } 可跳过回到顶部 ——
 *        「主页记录跳转到看板指定区块」紧接着会滚到目标区块，两次滚动并发会打架。
 */
function navigate(pageKey, opts) {
  const target = findPage(pageKey) ? pageKey : currentPage;
  dismissOverlays();
  currentPage = target;
  syncNavActive(target);
  // 页面切换 → 播入场动画。导入备份 / 重置数据走 location.reload() 后也会回到这里，
  // 因此「数据刷新后重新呈现」的场景天然带动画，无需额外处理。
  refreshCurrentPage({ animate: true });
  if (!opts || opts.scrollTop !== false) scrollToTopOnNavigate();
}

/**
 * 关闭全部覆盖层（弹窗 + 开屏兜底）。幂等、绝不抛异常。
 * 单测环境没有 #modal-root 时静默跳过。
 */
function dismissOverlays() {
  try {
    const root = document.getElementById('modal-root');
    if (root && root.innerHTML) root.innerHTML = '';
  } catch (e) { /* 非浏览器 / 无该节点，忽略 */ }
  try {
    if (typeof navStack !== 'undefined' && navStack && navStack.length) navStack.length = 0;
  } catch (e) { /* 忽略 */ }
  try {
    // 开屏遮罩的兜底：正常流程早已淡出（.splash-hidden），
    // 这里只是防止异常路径把它留成「透明但仍可点击」的盖子
    const sp = document.getElementById('splash');
    if (sp && sp.classList && !sp.classList.contains('splash-hidden')) sp.classList.add('splash-hidden');
  } catch (e) { /* 忽略 */ }
}

/* ==================== 移动端底部 Tab（T04） ==================== */

/**
 * 底部 Tab 栏为静态 HTML（index.html 内写死 4 个 .tab-item），
 * 此处不再动态渲染，仅由 syncNavActive 切换 .active 类名，避免切换页时重建 DOM 导致图标位移。
 */

/**
 * 绑定底部 Tab 点击（仅切换高亮 + 导航，DOM 静态不重建）。
 * ⚠️ 底部 Tab 为静态 HTML（index.html），此处只绑事件，绝不 innerHTML 重写，
 *    否则每次切换页面都会重建节点、图标跳位。
 */
function bindTabbar() {
  const tabbar = document.getElementById('tabbar');
  if (tabbar) {
    tabbar.addEventListener('click', function (e) {
      const navBtn = e.target.closest('[data-page]');
      if (navBtn) navigate(navBtn.dataset.page);
    });
  }

}

/* ==================== 返回键导航栈（F2） ==================== */
function handleBack() {
  // 1) 有弹窗 → 关弹窗（navStack.pop 由 closeModal 执行）
  if (navStack.length > 0) { closeModal(); return; }
  // 3) 不在主页 → 回主页（并再压一个历史态，便于下次返回退出）
  if (currentPage && currentPage !== 'home') {
    navigate('home');
    if (typeof window !== 'undefined' && window.history && typeof window.history.pushState === 'function') {
      try { window.history.pushState({ earth: 1 }, ''); } catch (e) { /* 忽略 */ }
    }
    return;
  }
  // 4) 主页 → 退出应用（仅 WebView/Cordova；纯浏览器无 exitApp 则静默）
  if (typeof navigator !== 'undefined' && navigator.app && typeof navigator.app.exitApp === 'function') {
    try { navigator.app.exitApp(); } catch (e) { /* 忽略 */ }
  }
}
function setupBackNav() {
  if (typeof window !== 'undefined' && window.history && typeof window.history.pushState === 'function' && typeof window.addEventListener === 'function') {
    try { window.history.pushState({ earth: 1 }, ''); } catch (e) { /* 忽略 */ }
    window.addEventListener('popstate', function () { handleBack(); });
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('backbutton', function (e) {
      if (e && typeof e.preventDefault === 'function') { try { e.preventDefault(); } catch (_) { /* 忽略 */ } }
      handleBack();
    }, false);
  }
}

/**
 * 滚动性能优化（主页上下滑动卡顿的主要来源是毛玻璃 backdrop-filter 每帧重算模糊）。
 * - 全局 window 滚动监听用 { passive: true }，不阻塞滚动线程；
 * - rAF 节流：滚动期间只在下一帧挂一次 .is-scrolling，避免高频 class 抖动；
 * - 停止滚动 300ms 后移除 .is-scrolling，毛玻璃自动恢复，视觉风格不变。
 * 具体「滚动时关闭毛玻璃」由 CSS（html.is-scrolling .xxx）承接。
 */
function setupScrollOptimizer() {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  if (typeof document === 'undefined' || !document.documentElement) return;
  var root = document.documentElement;
  var ticking = false;
  var timer = null;
  function onScroll() {
    if (!ticking) {
      ticking = true;
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(function () {
          root.classList.add('is-scrolling');
          ticking = false;
        });
      } else {
        root.classList.add('is-scrolling');
        ticking = false;
      }
    }
    if (timer) { try { clearTimeout(timer); } catch (_) { /* 忽略 */ } }
    timer = setTimeout(function () {
      root.classList.remove('is-scrolling');
      timer = null;
    }, 300);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
}

/* ==================== 外观：深色模式 + 自定义壁纸（v15 批 B · 16/18） ==================== */

/** 应用主题：经 EOStore 读取 earth_theme（light/dark），挂到 <html data-theme>。 */
function applyTheme() {
  var t = 'light';
  try {
    var saved = (typeof EOStore !== 'undefined' && EOStore && EOStore.getSync)
      ? EOStore.getSync('earth_theme')
      : (function () { try { return localStorage.getItem('earth_theme'); } catch (e) { return null; } })();
    if (saved === 'dark') t = 'dark';
  } catch (e) { /* 隐私模式读不到，默认亮色 */ }
  document.documentElement.setAttribute('data-theme', t);
}

/**
 * 字号缩放（v1.2.0 外观设置第三项）。
 * 实现方式：给 <html> 挂 data-font-scale，CSS 侧对 #content 施加 zoom。
 * 为什么用 zoom 而不是逐条改 font-size：
 *   项目里有 200+ 处硬编码 px 字号，逐条改要动整个样式表且极易漏；zoom 由浏览器
 *   统一放大「文字 + 间距 + 图标」，观感与浏览器缩放一致，且不改动任何既有规则。
 * 只在 #content 上生效 —— 侧栏与底栏保持原尺寸，避免导航被放大后挤成两行。
 * 取值：'std'（默认）/ 'lg' / 'xl'，非法值一律回落 std。
 */
const FONT_SCALES = ['std', 'lg', 'xl'];
const FONT_SCALE_KEY = 'earth_font_scale';

function readFontScale() {
  var v = '';
  try {
    v = (typeof EOStore !== 'undefined' && EOStore && EOStore.getSync)
      ? EOStore.getSync(FONT_SCALE_KEY)
      : (function () { try { return localStorage.getItem(FONT_SCALE_KEY); } catch (e) { return null; } })();
  } catch (e) { v = ''; }
  return (FONT_SCALES.indexOf(v) !== -1) ? v : 'std';
}

function setFontScale(v) {
  var val = (FONT_SCALES.indexOf(v) !== -1) ? v : 'std';
  try {
    if (typeof EOStore !== 'undefined' && EOStore && typeof EOStore.set === 'function') EOStore.set(FONT_SCALE_KEY, val);
    else localStorage.setItem(FONT_SCALE_KEY, val);
  } catch (e) { /* 隐私模式写不进去，仍先应用当前会话 */ }
  applyFontScale(val);
  return val;
}

function applyFontScale(forced) {
  var v = forced || readFontScale();
  try { document.documentElement.setAttribute('data-font-scale', v); } catch (e) { /* 忽略 */ }
}

/**
 * 应用壁纸：经 EOStore 读取 earth_wallpaper 配置。
 *   - type 'none'   → 清除自定义背景（纸纹生效）
 *   - type 'gradient' → 直接使用 CSS 渐变字符串
 *   - type 'image'  → 从 IndexedDB 取壁纸 Blob，生成 objectURL 铺底
 * 大图存 IDB（storage.js 的 EarthIDB 别名），不占 localStorage 配额；离线 / IDB 不可用时静默忽略。
 */
function applyWallpaper() {
  var root = document.documentElement;
  root.style.removeProperty('--wallpaper-url');
  var cfg = null;
  try {
    cfg = (typeof EOStore !== 'undefined' && EOStore && EOStore.getSync)
      ? EOStore.getSync('earth_wallpaper')
      : (function () { try { return JSON.parse(localStorage.getItem('earth_wallpaper') || 'null'); } catch (e) { return null; } })();
  } catch (e) { cfg = null; }
  if (!cfg || cfg.type === 'none' || !cfg.type) return;
  if (cfg.type === 'gradient') {
    if (cfg.value) root.style.setProperty('--wallpaper-url', cfg.value);
    return;
  }
  if (cfg.type === 'image') {
    if (typeof EarthIDB === 'undefined' || !EarthIDB) return;
    EarthIDB.idbGet('wallpaper_blob').then(function (blob) {
      if (blob && typeof URL !== 'undefined' && URL.createObjectURL) {
        root.style.setProperty('--wallpaper-url', 'url(' + URL.createObjectURL(blob) + ')');
      }
    }).catch(function () { /* 离线 / IDB 不可用，忽略 */ });
  }
}

/** 是否开启到期提醒（默认开；earth_notify === 'off' 时关闭）。 */
function notifyEnabled() {
  try {
    var v = (typeof EOStore !== 'undefined' && EOStore && EOStore.getSync)
      ? EOStore.getSync('earth_notify')
      : (function () { try { return localStorage.getItem('earth_notify'); } catch (e) { return null; } })();
    return v !== 'off';
  } catch (e) { return true; }
}

/**
 * v15 批 C · 第 17 项：任务到期提醒。
 * 找出「今天到期或已逾期且未完成的 To Do 任务」，已授权则推送 Web Notification。
 * 批次2 增强：
 *  - 覆盖逾期任务（dueDate < 今天）而不仅是当天到期；
 *  - 用 state.notifiedDue（taskId→最近提醒日）按日去重，避免 App 常开时反复弹窗；
 *  - 完成任务或任务不再到期时清理去重记录。
 * 说明：浏览器要求通知权限必须由用户手势触发，故「自动请求」只发生在设置页开关被点击时
 * （见 pages.js 的 notify-toggle）；此处仅在 permission==='granted' 时静默推送，避免无手势弹窗被拦截。
 */
function pushDueNotifications() {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    var today = (typeof todayStr === 'function') ? todayStr() : '';
    if (!today) return;
    var nd = state.notifiedDue || (state.notifiedDue = {});
    var due = (state.tasks || []).filter(function (t) {
      return t && t.category === 'todo' && t.dueDate && t.dueDate <= today && t.status !== 'done';
    });
    due.forEach(function (t) {
      try {
        if (nd[t.id] === today) return; // 当天已提醒，去重
        var overdue = t.dueDate < today;
        new Notification('地球Online · 任务到期', {
          body: '「' + (t.title || '未命名任务') + '」' +
            (overdue ? ('已于 ' + t.dueDate + ' 逾期') : '今天到期') + '，记得完成~'
        });
        nd[t.id] = today;
      } catch (e) { /* 个别浏览器构造 Notification 失败，忽略单条 */ }
    });
    // 清理：已完成 / 不再满足到期条件的任务，移出去重记录
    Object.keys(nd).forEach(function (id) {
      var t = (state.tasks || []).find(function (x) { return x.id === id; });
      if (!t || t.status === 'done' || !t.dueDate || t.dueDate > today) delete nd[id];
    });
  } catch (e) { /* 隐私模式 / 不支持，忽略 */ }
}

function checkDueNotifications() {
  if (!notifyEnabled()) return;
  pushDueNotifications();
}

/* ==================== 离线运行能力 / PWA（T05） ==================== */

/**
 * 入口。三重守卫全部前置：
 * 1) navigator 不存在或没有离线运行容器（file:// 下浏览器根本不暴露该对象）→ 直接静默返回；
 * 2) 协议不是 http(s) → 返回；
 * 3) window 没有 addEventListener（测试 / 极老环境）→ 返回。
 * 全程不弹窗、不 console.error，不影响任何其它功能。
 */
function initPWA() {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
  if (typeof location === 'undefined' ||
      (location.protocol !== 'http:' && location.protocol !== 'https:')) return;
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;

  registerServiceWorker();

  if (isPwaStandalone()) return;         // 已独立窗口运行，不必再提示
  if (!canShowPwaTip()) return;          // 用户已关闭过
  setPwaTipVisible(true);

  const closeBtn = document.getElementById('pwaTipClose');
  if (closeBtn) closeBtn.addEventListener('click', function () { dismissPwaTip(); });
}

/** 注册 sw.js；注册失败一律静默（离线运行是增强项，失败不应打扰用户） */
function registerServiceWorker() {
  try {
    const p = navigator.serviceWorker.register('sw.js');
    if (p && typeof p.catch === 'function') p.catch(function () { /* 静默 */ });
  } catch (e) { /* 静默：file:// 等受限环境 */ }
}

/** 是否已以独立窗口（添加到主屏幕后）运行 */
function isPwaStandalone() {
  try {
    if (typeof navigator !== 'undefined' && navigator.standalone === true) return true;
  } catch (e) { /* 忽略访问异常 */ }
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return !!window.matchMedia('(display-mode: standalone)').matches;
    }
  } catch (e) { /* 忽略不支持的媒体查询 */ }
  return false;
}

/** 是否应该显示「添加到主屏幕」提示（file:// 与已关闭过都返回 false） */
function canShowPwaTip() {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return false;
  if (typeof location === 'undefined' ||
      (location.protocol !== 'http:' && location.protocol !== 'https:')) return false;
  if (isPwaStandalone()) return false;
  try {
    const ls = (typeof localStorage !== 'undefined') ? localStorage : null;
    if (ls && typeof ls.getItem === 'function' && ls.getItem(PWA_TIP_KEY)) return false;
  } catch (e) { /* 读不到就当作未关闭过 */ }
  return true;
}

/** hidden 属性与 class 必须成对设置（作者样式 display 会覆盖 UA 的 [hidden]） */
function setPwaTipVisible(visible) {
  const tip = document.getElementById('pwaTip');
  if (!tip) return;
  tip.hidden = !visible;
  tip.classList.toggle('show', !!visible);
}

/** 关闭提示并记住偏好（写入失败不影响） */
function dismissPwaTip() {
  setPwaTipVisible(false);
  try {
    const ls = (typeof localStorage !== 'undefined') ? localStorage : null;
    if (ls && typeof ls.setItem === 'function') ls.setItem(PWA_TIP_KEY, '1');
  } catch (e) { /* 忽略 */ }
}

/* ==================== 开屏遮罩（v9） ==================== */

/** 遮罩是否已收起（重复调用直接返回，避免定时器叠加时反复操作 DOM） */
let __splashHidden = false;
var __splashStart = Date.now();
var __windowLoaded = false;

/**
 * 收起开屏遮罩。
 *
 * 为什么加 class 而不是直接删节点：
 *   直接 remove 会「啪」地一下消失，观感突兀；加 class 让 CSS 走完 0.5s 淡出，
 *   等过渡结束再移除节点 —— 否则会有一个透明的全屏层留在 DOM 里继续参与命中测试。
 *
 * 为什么留了三重兜底（DOMContentLoaded / window.load / 3s 定时器，外加 CSS 6s 动画）：
 *   正常路径是 initApp 收尾时调用，但个别环境（老 WebView、file:// 下资源缓存异常）
 *   可能不派发 DOMContentLoaded。任一兜底先到都会收起，
 *   四重保障下不存在「遮罩永久挡死界面」的可能 —— 这类故障用户除了重装别无他法，宁可冗余。
 */
function hideSplash() {
  if (__splashHidden) return;
  __splashHidden = true;
  try {
    const el = document.getElementById('splash');
    if (!el) return;
    if (el.classList && typeof el.classList.add === 'function') el.classList.add('splash-hidden');
    if (typeof setTimeout === 'function') {
      setTimeout(function () {
        try { if (el && el.parentNode) el.parentNode.removeChild(el); } catch (e) { /* 已移除 */ }
      }, 600);
    }
  } catch (e) { /* 遮罩收不起来绝不该影响主流程 */ }
}

/** 调度开屏淡出：保证至少显示 1.5s，并在 window.load 后才淡出（淡出 0.5s 由 CSS transition 负责） */
function scheduleHideSplash() {
  if (__splashHidden) return;
  var wait = Math.max(0, 1500 - (Date.now() - __splashStart));
  setTimeout(hideSplash, wait);
}

/* ==================== 启动 ==================== */

/**
 * 启动入口（v19 async 分流）：
 * 先 await EOStore.init()（内存镜像就绪），再 resolveBootFlow() 决定进主程序还是引导页。
 *
 * 为什么必须先 await EOStore.init()：
 *   resolveBootFlow 读 getSync 依赖内存镜像；若在其完成前执行，
 *   老用户会被误判「全新安装」→ 卡在引导页（设计 §11.1 时序风险）。
 */
async function initApp() {
  if (typeof EOStore !== 'undefined' && EOStore && typeof EOStore.init === 'function') {
    try { await EOStore.init(); } catch (e) { /* 极端环境：EOStore 自带 localStorage/内存降级 */ }
  }

  const flow = resolveBootFlow();

  if (flow === 'app') { startMainApp(); return; }

  // 引导页（全新安装 / 迁移失败兜底）。此时还没加载业务数据，先把开屏收掉
  scheduleHideSplash();
  // 必须先绑事件再渲染 —— 引导页的按钮依赖全局 click 分发，
  // 而 bindGlobalEvents() 平时是在 startMainApp() 里调用的，这里还没走到。
  bindGlobalEvents();
  renderOnboardingScreen();
}

/**
 * 账号就绪后的全部初始化。
 * 由 initApp()（已有会话）或 account.js 的 enterMainApp()（刚创建/登录/游客）调用。
 */
async function startMainApp() {
  // 0. 初始化存储层（一次性迁移旧 localStorage → IndexedDB，载入内存镜像）。
  //    异步完成；await 保证 loadState 之前内存镜像已就绪，避免首帧读回旧键。
  if (typeof EOStore !== 'undefined' && EOStore && typeof EOStore.init === 'function') {
    try { await EOStore.init(); } catch (e) { /* 极端环境：EOStore 自带 localStorage/内存降级 */ }
  }

  // 1. 加载「当前账号」的存档（不存在则使用种子数据）
  state = loadState();

  // 1.5 外观：应用深色模式 + 自定义壁纸 + 字号（先于导航渲染，避免首帧闪烁）
  applyTheme();
  applyWallpaper();
  applyFontScale();

  // 1.6 到期提醒：已授权则推送今天到期的 To Do（权限交互在设置开关触发，避免无手势弹窗）
  checkDueNotifications();
  // 批次2：App 常开时周期性检查（每 30 分钟），捕捉跨过到期时刻 / 新逾期的任务
  if (typeof setInterval === 'function') {
    if (window.__eoDueTimer) { try { clearInterval(window.__eoDueTimer); } catch (e) {} }
    window.__eoDueTimer = setInterval(checkDueNotifications, 30 * 60 * 1000);
  }

  // 2. 成就系统：补齐自动成就条目，检测已达成的成就
  ensureAutoAchievements();
  checkAutoAchievements();

  // 3. 注册左侧导航（带 emoji 图标，与移动端共用一套数据）
  const nav = document.getElementById('nav');
  if (nav) {
    nav.innerHTML = PAGES.map(function (p) {
      return '<button class="nav-item" data-page="' + p.key + '">' +
        '<span class="nav-icon">' + p.icon + '</span>' +
        '<span class="nav-item-label">' + escapeHtml(p.label) + '</span>' +
      '</button>';
    }).join('');
    nav.addEventListener('click', function (e) {
      const btn = e.target.closest('.nav-item');
      if (!btn) return;
      try {
        navigate(btn.dataset.page);
      } catch (err) {
        try {
          if (typeof console !== 'undefined' && console.error) {
            console.error('[地球Online] 导航失败：' + String(btn.dataset.page), err);
          }
        } catch (e2) { /* 忽略 */ }
        try { if (typeof toast === 'function') toast('打开页面失败，请重试'); } catch (e2) { /* 忽略 */ }
      }
    });
  }

  // 4. 绑定全局事件（页面交互统一委托）
  bindGlobalEvents();

  // 5. 移动端底部 Tab（静态 HTML）+ 更多面板事件（桌面下由 CSS 隐藏）
  bindTabbar();

  // 6. 同步侧栏头像（profile.js 提供；测试环境无 .logo 时内部自动跳过）
  if (typeof syncSidebarAvatar === 'function') syncSidebarAvatar();

  // 7. 视口变化时重渲看板图表（内部已守卫 window.addEventListener）
  if (typeof scheduleDashboardRedraw === 'function') scheduleDashboardRedraw();

  // 8. 离线运行能力注册（file:// 下静默跳过，不提示、不报错）
  initPWA();

  // 9. WebDAV 自动同步（未开启 / file:// 跨域失败时内部静默，不打扰用户）
  if (typeof initWebdavAutoSync === 'function') initWebdavAutoSync();

  // 9.5 滚动性能优化：全局 passive 滚动监听（rAF 节流 + 300ms 恢复），
  //     滚动时给 <html> 挂 .is-scrolling，CSS 据此临时关闭毛玻璃模糊，停止后恢复。
  setupScrollOptimizer();

  // 10. 进入主页
  navigate('home');

  // 10.5 绑定返回键导航（Android backbutton / 浏览器 popstate）
  setupBackNav();

  // 11. 首帧已渲染完成 → 收起开屏遮罩
  scheduleHideSplash();
}

document.addEventListener('DOMContentLoaded', initApp);

// v15 解耦批：订阅事件总线，解除 pages.js 对 app.js 内部函数的硬耦合。
// pages.js 只发「ui:apply-theme / ui:apply-wallpaper / notify:changed / state:idb-restored」语义事件，
// 具体如何应用外观 / 推送通知 / 重渲染由本模块自行决定。事件同步分发，等价于原直调，不引入时序不确定性。
if (typeof EarthBus !== 'undefined' && EarthBus) {
  EarthBus.on('ui:apply-theme', applyTheme);
  EarthBus.on('ui:apply-wallpaper', applyWallpaper);
  EarthBus.on('notify:changed', pushDueNotifications); // 内部已对 permission!=='granted' 早退
  EarthBus.on('state:idb-restored', function () { if (typeof refreshCurrentPage === 'function') refreshCurrentPage(); });
}

// 开屏兜底：initApp 没跑到收尾、或环境不派发 DOMContentLoaded 时，也要把遮罩收起来
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('load', function () { __windowLoaded = true; scheduleHideSplash(); });
}
if (typeof setTimeout === 'function') setTimeout(scheduleHideSplash, 6000);

  /* ---- 导出公共 API 到 EO 命名空间并同步到全局（兼容旧引用 / 测试桩） ---- */
  E.PAGES = PAGES;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.PAGES === "undefined") globalThis.PAGES = PAGES; } catch (e) {}
  E.MOBILE_TABS = MOBILE_TABS;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.MOBILE_TABS === "undefined") globalThis.MOBILE_TABS = MOBILE_TABS; } catch (e) {}
  E.currentPage = currentPage;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.currentPage === "undefined") globalThis.currentPage = currentPage; } catch (e) {}
  E.navStack = navStack;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.navStack === "undefined") globalThis.navStack = navStack; } catch (e) {}
  E.PWA_TIP_KEY = PWA_TIP_KEY;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.PWA_TIP_KEY === "undefined") globalThis.PWA_TIP_KEY = PWA_TIP_KEY; } catch (e) {}
  E.findPage = findPage;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.findPage === "undefined") globalThis.findPage = findPage; } catch (e) {}
  E.refreshCurrentPage = refreshCurrentPage;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.refreshCurrentPage === "undefined") globalThis.refreshCurrentPage = refreshCurrentPage; } catch (e) {}
  E.applyPageEnterAnimation = applyPageEnterAnimation;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.applyPageEnterAnimation === "undefined") globalThis.applyPageEnterAnimation = applyPageEnterAnimation; } catch (e) {}
  E.syncNavActive = syncNavActive;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.syncNavActive === "undefined") globalThis.syncNavActive = syncNavActive; } catch (e) {}
  E.scrollToTopOnNavigate = scrollToTopOnNavigate;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.scrollToTopOnNavigate === "undefined") globalThis.scrollToTopOnNavigate = scrollToTopOnNavigate; } catch (e) {}
  E.navigate = navigate;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.navigate === "undefined") globalThis.navigate = navigate; } catch (e) {}
  E.dismissOverlays = dismissOverlays;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.dismissOverlays === "undefined") globalThis.dismissOverlays = dismissOverlays; } catch (e) {}
  E.applyFontScale = applyFontScale;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.applyFontScale === "undefined") globalThis.applyFontScale = applyFontScale; } catch (e) {}
  E.setFontScale = setFontScale;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.setFontScale === "undefined") globalThis.setFontScale = setFontScale; } catch (e) {}
  E.readFontScale = readFontScale;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.readFontScale === "undefined") globalThis.readFontScale = readFontScale; } catch (e) {}
  E.FONT_SCALES = FONT_SCALES;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.FONT_SCALES === "undefined") globalThis.FONT_SCALES = FONT_SCALES; } catch (e) {}
  E.FONT_SCALE_KEY = FONT_SCALE_KEY;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.FONT_SCALE_KEY === "undefined") globalThis.FONT_SCALE_KEY = FONT_SCALE_KEY; } catch (e) {}
  E.bindTabbar = bindTabbar;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.bindTabbar === "undefined") globalThis.bindTabbar = bindTabbar; } catch (e) {}
  E.handleBack = handleBack;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.handleBack === "undefined") globalThis.handleBack = handleBack; } catch (e) {}
  E.setupBackNav = setupBackNav;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.setupBackNav === "undefined") globalThis.setupBackNav = setupBackNav; } catch (e) {}
  E.setupScrollOptimizer = setupScrollOptimizer;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.setupScrollOptimizer === "undefined") globalThis.setupScrollOptimizer = setupScrollOptimizer; } catch (e) {}
  E.applyTheme = applyTheme;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.applyTheme === "undefined") globalThis.applyTheme = applyTheme; } catch (e) {}
  E.applyWallpaper = applyWallpaper;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.applyWallpaper === "undefined") globalThis.applyWallpaper = applyWallpaper; } catch (e) {}
  E.notifyEnabled = notifyEnabled;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.notifyEnabled === "undefined") globalThis.notifyEnabled = notifyEnabled; } catch (e) {}
  E.pushDueNotifications = pushDueNotifications;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.pushDueNotifications === "undefined") globalThis.pushDueNotifications = pushDueNotifications; } catch (e) {}
  E.checkDueNotifications = checkDueNotifications;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.checkDueNotifications === "undefined") globalThis.checkDueNotifications = checkDueNotifications; } catch (e) {}
  E.initPWA = initPWA;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.initPWA === "undefined") globalThis.initPWA = initPWA; } catch (e) {}
  E.registerServiceWorker = registerServiceWorker;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.registerServiceWorker === "undefined") globalThis.registerServiceWorker = registerServiceWorker; } catch (e) {}
  E.isPwaStandalone = isPwaStandalone;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.isPwaStandalone === "undefined") globalThis.isPwaStandalone = isPwaStandalone; } catch (e) {}
  E.canShowPwaTip = canShowPwaTip;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.canShowPwaTip === "undefined") globalThis.canShowPwaTip = canShowPwaTip; } catch (e) {}
  E.setPwaTipVisible = setPwaTipVisible;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.setPwaTipVisible === "undefined") globalThis.setPwaTipVisible = setPwaTipVisible; } catch (e) {}
  E.dismissPwaTip = dismissPwaTip;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.dismissPwaTip === "undefined") globalThis.dismissPwaTip = dismissPwaTip; } catch (e) {}
  E.__splashHidden = __splashHidden;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.__splashHidden === "undefined") globalThis.__splashHidden = __splashHidden; } catch (e) {}
  E.__splashStart = __splashStart;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.__splashStart === "undefined") globalThis.__splashStart = __splashStart; } catch (e) {}
  E.__windowLoaded = __windowLoaded;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.__windowLoaded === "undefined") globalThis.__windowLoaded = __windowLoaded; } catch (e) {}
  E.hideSplash = hideSplash;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.hideSplash === "undefined") globalThis.hideSplash = hideSplash; } catch (e) {}
  E.scheduleHideSplash = scheduleHideSplash;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.scheduleHideSplash === "undefined") globalThis.scheduleHideSplash = scheduleHideSplash; } catch (e) {}
  E.initApp = initApp;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.initApp === "undefined") globalThis.initApp = initApp; } catch (e) {}
  // v16 修复：startMainApp 是 async function，原拆分脚本的导出正则漏掉了 async 声明，
  // 导致 account.js 的 enterMainApp 跨模块裸调 startMainApp 时解析到 undefined（浏览器抛 ReferenceError，
  // 登录后主应用不渲染、点不动）。必须显式导出到 EO 与 globalThis。
  E.startMainApp = startMainApp;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.startMainApp === "undefined") globalThis.startMainApp = startMainApp; } catch (e) {}
})();