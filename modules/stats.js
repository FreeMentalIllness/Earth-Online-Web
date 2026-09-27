/* ===== 模块 stats.js（v16 模块化：window.EO 命名空间） ===== */
var state = null;
var currentAccount = null;
var backpackTab = 'all';
(function () {
  'use strict';
  var _g = (typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this));
  _g.EO = _g.EO || {};
  var E = _g.EO;

/**
 * stats.js —— PART2 数据可视化看板
 * 零依赖：折线图用 Canvas 2D 原生绘制（无图表库），时间线用纯 HTML/CSS。
 *
 * 聚合口径（设计文档 §3.5，验收依据）：
 * - 新增任务数：dayKeyOf(t.createdAt) 落在 [start, end]
 * - 完成任务数：t.doneAt 非空且 dayKeyOf(t.doneAt) 落在窗口内
 * - 新增灵感数：全部 memo（随笔+重要+灵感，同一个 memos 数组全量统计）
 * - 解锁成就数：a.unlocked === true && a.unlockedAt 非空且 dayKeyOf 落在窗口内
 * - 周报窗口：含今天的连续 7 个自然日 [today-6, today]
 * - 月报窗口：含今天的连续 30 个自然日 [today-29, today]
 * - 年度任务总数：今年新增的任务数（保证完成率 ∈[0,100]）
 */

/**
 * 图表配色：与 css/style.css 的 token 值逐一手抄。
 * Canvas 无法读取 CSS 变量，且 QA 环境无 getComputedStyle，故此处必须硬编码。
 * ⚠️ 改 CSS token 时需同步此处。
 */
const CHART_THEME = {
  line: '#d4a373',          // --amber
  area: 'rgba(212,163,115,0.12)',
  grid: '#e8e2da',          // --border
  axis: '#b0a89c',          // --caption
  label: '#7a7268',         // --muted
  point: '#c49a6c',         // --amber-level
  pointStroke: '#d4a373',   // --amber
  text: '#7a7268',          // --muted
};

/** 看板趋势区间（页面级临时状态，不持久化）：'7d' | '4w' */
/** 看板趋势区间：'7d' 近 7 天 / '4w' 近 4 周 */
let dashboardTrendRange = '7d';
/**
 * 数据页当前视图：'overview' 数据概览 / 'calendar' 日历视图。
 * v5：原独立「日历」页已并入本页作为子视图，导航不再单列入口。
 */
let dashboardView = 'overview';

/** 时间线容器一次最多渲染的条数（防止极端数据卡顿；实际按时间升序全量渲染） */
const TIMELINE_MAX = 500;

/* ==================== 聚合（纯函数，QA 可直测） ==================== */

/** 取数组字段，容错非数组 */
function dashArr(v) {
  return Array.isArray(v) ? v : [];
}

/** 窗口内完成的任务数（供趋势分桶复用） */
function countDoneInRange(startDay, endDay) {
  let n = 0;
  dashArr(state && state.tasks).forEach(function (t) {
    if (!t || !t.doneAt) return;
    if (inDayRange(dayKeyOf(t.doneAt), startDay, endDay)) n += 1;
  });
  return n;
}

/**
 * 区间汇总：新增任务 / 完成任务 / 新增灵感 / 解锁成就
 * @param {string} startDay 'YYYY-MM-DD'（含）
 * @param {string} endDay   'YYYY-MM-DD'（含）
 */
function buildRangeSummary(startDay, endDay) {
  let newTasks = 0;
  let doneTasks = 0;
  let newMemos = 0;
  let newAchievements = 0;
  dashArr(state && state.tasks).forEach(function (t) {
    if (!t) return;
    if (inDayRange(dayKeyOf(t.createdAt), startDay, endDay)) newTasks += 1;
    if (t.doneAt && inDayRange(dayKeyOf(t.doneAt), startDay, endDay)) doneTasks += 1;
  });
  dashArr(state && state.memos).forEach(function (m) {
    if (m && inDayRange(dayKeyOf(m.createdAt), startDay, endDay)) newMemos += 1;
  });
  dashArr(state && state.achievements).forEach(function (a) {
    if (!a || !a.unlocked) return;
    if (inDayRange(dayKeyOf(a.unlockedAt), startDay, endDay)) newAchievements += 1;
  });
  return {
    newTasks: newTasks,
    doneTasks: doneTasks,
    newMemos: newMemos,
    newAchievements: newAchievements,
  };
}

/**
 * 趋势序列：'7d' 按天分 7 桶；'4w' 按周分 4 桶 [D-27,D-21] [D-20,D-14] [D-13,D-7] [D-6,D]
 * @param {string} range '7d' | '4w'，非法值兜底为 '7d'
 */
function buildTrendSeries(range) {
  const mode = (range === '4w') ? '4w' : '7d';
  const today = todayStr();
  const labels = [];
  const values = [];

  if (mode === '7d') {
    for (let i = 6; i >= 0; i--) {
      const k = dayKeyAddDays(today, -i);
      labels.push(k.slice(5, 7) + '/' + k.slice(8, 10)); // MM/DD
      values.push(countDoneInRange(k, k));
    }
  } else {
    const buckets = [[-27, -21], [-20, -14], [-13, -7], [-6, 0]];
    const names = ['4周前', '3周前', '2周前', '本周'];
    buckets.forEach(function (b, i) {
      const start = dayKeyAddDays(today, b[0]);
      const end = dayKeyAddDays(today, b[1]);
      labels.push(names[i]);
      values.push(countDoneInRange(start, end));
    });
  }

  let total = 0;
  values.forEach(function (v) { total += v; });
  return { range: mode, labels: labels, values: values, total: total };
}

/** 成就解锁时间线：按解锁日期升序（同日保持原顺序） */
function buildAchievementTimeline() {
  const items = [];
  dashArr(state && state.achievements).forEach(function (a) {
    if (!a || !a.unlocked || !a.unlockedAt) return;
    const k = dayKeyOf(a.unlockedAt);
    if (!k) return;
    items.push({ date: k, title: String(a.title || '') });
  });
  items.sort(function (x, y) { return x.date.localeCompare(y.date); });
  return items.slice(0, TIMELINE_MAX);
}

/**
 * 年度统计。完成率分子分母同口径（都是「今年新增」），保证 ∈[0,100]。
 * @param {string|number} year 如 '2024'
 */
function buildYearSummary(year) {
  const y = String(year == null ? '' : year);
  const tasks = dashArr(state && state.tasks);
  const memos = dashArr(state && state.memos);
  const achs = dashArr(state && state.achievements);

  let totalTasks = 0;
  let doneTasks = 0;
  tasks.forEach(function (t) {
    if (!t || dayKeyOf(t.createdAt).slice(0, 4) !== y) return;
    totalTasks += 1;
    if (t.status === 'done') doneTasks += 1;
  });
  let yearMemos = 0;
  memos.forEach(function (m) {
    if (m && dayKeyOf(m.createdAt).slice(0, 4) === y) yearMemos += 1;
  });
  let unlockedAchievements = 0;
  achs.forEach(function (a) {
    if (a && a.unlocked) unlockedAchievements += 1;
  });

  return {
    totalTasks: totalTasks,
    doneTasks: doneTasks,
    doneRate: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0,
    unlockedAchievements: unlockedAchievements,
    totalAchievements: achs.length,
    yearMemos: yearMemos,
    totalMemos: memos.length,
  };
}

/** 看板全量数据（可 JSON 序列化，QA 可直接断言） */
function getDashboardData() {
  const today = todayStr();
  return {
    generatedAt: new Date().toISOString(),
    week: buildRangeSummary(dayKeyAddDays(today, -6), today),
    month: buildRangeSummary(dayKeyAddDays(today, -29), today),
    year: buildYearSummary(today.slice(0, 4)),
    trend: buildTrendSeries(dashboardTrendRange),
    timeline: buildAchievementTimeline(),
  };
}

/* ==================== Canvas 折线图 ==================== */

/**
 * 原生 Canvas 折线图。
 * 约定（设计文档 §6.3）：先能力检测 → DPR 缩放 → 全 0 返回 false（调用方已渲染占位）。
 * @param {HTMLCanvasElement} canvas
 * @param {{labels: string[], values: number[], height?: number}} cfg
 * @returns {boolean} 是否成功绘制
 */
function drawLineChart(canvas, cfg) {
  if (!canvas || typeof canvas.getContext !== 'function') return false; // QA stub 防线
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  const conf = cfg || {};
  const labels = Array.isArray(conf.labels) ? conf.labels : [];
  const rawValues = Array.isArray(conf.values) ? conf.values : [];
  if (!rawValues.length) return false;
  const values = rawValues.map(function (v) { return Number(v) || 0; });
  let total = 0;
  values.forEach(function (v) { total += v; });
  if (total <= 0) return false; // 调用方已改渲染 .dash-empty 占位

  const cssW = canvas.clientWidth || 640;
  const cssH = Number(conf.height) || 240;
  if (cssW <= 0 || cssH <= 0) return false;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;

  // 注意：改 canvas.width/height 会重置上下文状态，scale 必须在其之后
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  if (canvas.style) canvas.style.height = cssH + 'px';
  ctx.scale(dpr, dpr);

  const pad = { l: 40, r: 14, t: 18, b: 30 };
  const plotW = cssW - pad.l - pad.r;
  const plotH = cssH - pad.t - pad.b;
  if (plotW <= 0 || plotH <= 0) return false;

  const max = Math.max.apply(null, values);
  const niceMax = max <= 4 ? 4 : Math.ceil(max / 4) * 4; // 保证刻度是整数

  ctx.clearRect(0, 0, cssW, cssH);
  ctx.font = '11px -apple-system, "PingFang SC", sans-serif';

  // 1) 网格线 + y 轴整数刻度（4 等分）
  ctx.lineWidth = 1;
  const yOf = function (v) { return pad.t + plotH - (v / niceMax) * plotH; };
  for (let i = 0; i <= 4; i++) {
    const tick = Math.round((niceMax * i) / 4);
    const y = Math.round(yOf(tick)) + 0.5;
    ctx.strokeStyle = CHART_THEME.grid;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + plotW, y);
    ctx.stroke();
    ctx.fillStyle = CHART_THEME.label;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(tick), pad.l - 8, y);
  }

  // 2) 数据点几何
  const stepX = values.length > 1 ? plotW / (values.length - 1) : 0;
  const points = values.map(function (v, i) {
    const x = pad.l + (values.length > 1 ? stepX * i : plotW / 2);
    return { x: x, y: yOf(v) };
  });

  // 3) x 轴标签
  ctx.fillStyle = CHART_THEME.label;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  points.forEach(function (p, i) {
    const lb = labels[i];
    if (lb === undefined || lb === null) return;
    ctx.fillText(String(lb), p.x, pad.t + plotH + 9);
  });

  // 4) 面积填充
  ctx.beginPath();
  ctx.moveTo(points[0].x, pad.t + plotH);
  points.forEach(function (p) { ctx.lineTo(p.x, p.y); });
  ctx.lineTo(points[points.length - 1].x, pad.t + plotH);
  ctx.closePath();
  ctx.fillStyle = CHART_THEME.area;
  ctx.fill();

  // 5) 折线
  ctx.beginPath();
  points.forEach(function (p, i) {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.strokeStyle = CHART_THEME.line;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  // 6) 数据点（白填充 + 2px 琥珀描边）+ 点上方数值
  points.forEach(function (p, i) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = CHART_THEME.pointStroke;
    ctx.stroke();
    if (values[i] > 0) {
      ctx.fillStyle = CHART_THEME.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(String(values[i]), p.x, p.y - 8);
    }
  });

  return true;
}

/** 视口变化时重渲看板（debounce 200ms；无 addEventListener 时静默跳过） */
let __dashRedrawTimer = null;
function scheduleDashboardRedraw() {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  window.addEventListener('resize', function () {
    if (typeof clearTimeout === 'function' && __dashRedrawTimer) clearTimeout(__dashRedrawTimer);
    __dashRedrawTimer = setTimeout(function () {
      __dashRedrawTimer = null;
      if (typeof currentPage !== 'undefined' && currentPage === 'data') {
        if (typeof refreshCurrentPage === 'function') refreshCurrentPage();
      }
    }, 200);
  });
}

/* ==================== 页面渲染 ==================== */

/** 空数据占位块 */
function dashEmpty() {
  return '<div class="dash-empty">📭 暂无数据，继续记录吧~</div>';
}

/** 一组 4 张统计小卡 */
function dashMiniCards(defs) {
  return defs.map(function (d) {
    return '<div class="mini-card">' +
      '<div class="mini-icon">' + d.icon + '</div>' +
      '<div class="mini-num" data-count="' + d.value + '">0</div>' +
      '<div class="mini-label">' + d.label + '</div>' +
    '</div>';
  }).join('');
}

/** 一组 4 张统计大卡（月报，卡片比周报更大） */
function dashMonthCards(defs) {
  return defs.map(function (d) {
    return '<div class="month-card">' +
      '<div class="month-num" data-count="' + d.value + '">0</div>' +
      '<div class="month-label">' + d.icon + ' ' + d.label + '</div>' +
    '</div>';
  }).join('');
}

/** 区间四项之和（用于判断该区块是否为空） */
function dashSum(r) {
  return r.newTasks + r.doneTasks + r.newMemos + r.newAchievements;
}

/** 数据看板页面 */
function renderDashboard() {
  const data = getDashboardData();
  const caliber = '完成任务数以任务的完成时间戳统计，升级前的历史任务无该时间戳，不计入趋势。';

  const weekDefs = [
    { icon: '📋', label: '新增任务', value: data.week.newTasks },
    { icon: '✅', label: '完成任务', value: data.week.doneTasks },
    { icon: '💭', label: '新增灵感', value: data.week.newMemos },
    { icon: '🏆', label: '解锁成就', value: data.week.newAchievements },
  ];
  const monthDefs = [
    { icon: '📋', label: '新增任务', value: data.month.newTasks },
    { icon: '✅', label: '完成任务', value: data.month.doneTasks },
    { icon: '💭', label: '新增灵感', value: data.month.newMemos },
    { icon: '🏆', label: '解锁成就', value: data.month.newAchievements },
  ];

  // ① 周报
  const weekBody = dashSum(data.week) === 0
    ? dashEmpty()
    : '<div class="mini-grid">' + dashMiniCards(weekDefs) + '</div>';
  const weekSec =
    '<section class="dash-section d0" id="dashWeek">' +
      '<div class="dash-section-title">🗓️ 周报摘要<span class="dash-hint">近 7 天（含今天）</span></div>' +
      weekBody +
    '</section>';

  // ② 月报
  const monthBody = dashSum(data.month) === 0
    ? dashEmpty()
    : '<div class="month-grid">' + dashMonthCards(monthDefs) + '</div>';
  const monthSec =
    '<section class="dash-section d1" id="dashMonth">' +
      '<div class="dash-section-title">📆 月报摘要<span class="dash-hint">近 30 天（含今天）</span></div>' +
      monthBody +
    '</section>';

  // ③ 趋势图
  const chip = function (key, text) {
    return '<button class="range-chip' + (data.trend.range === key ? ' active' : '') +
      '" data-action="dash-range" data-range="' + key + '">' + text + '</button>';
  };
  const trendBody = data.trend.total === 0
    ? dashEmpty()
    : '<div class="dash-chart-wrap"><canvas id="dashTrendCanvas" class="dash-canvas"></canvas></div>';
  const trendSec =
    '<section class="dash-section d2" id="dashTrend">' +
      '<div class="dash-section-title">📈 任务完成趋势</div>' +
      '<div class="dash-range-switch">' + chip('7d', '近 7 天') + chip('4w', '近 4 周') + '</div>' +
      trendBody +
    '</section>';

  // ④ 成就解锁时间线
  const timelineBody = data.timeline.length === 0
    ? dashEmpty()
    : '<div class="dash-timeline">' + data.timeline.map(function (it) {
        return '<div class="tl-item">' +
          '<span class="tl-date">' + escapeHtml(it.date) + '</span>' +
          '<span class="tl-dot"></span>' +
          '<span class="tl-title">' + escapeHtml(it.title) + '</span>' +
        '</div>';
      }).join('') + '</div>';
  const timelineSec =
    '<section class="dash-section d3" id="dashTimeline">' +
      '<div class="dash-section-title">🏆 成就解锁时间线<span class="dash-hint">共 ' +
        data.timeline.length + ' 条</span></div>' +
      timelineBody +
    '</section>';

  // ⑤ 年度统计（永远有数，最多显示 0）
  const yearCards = [
    { num: data.year.totalTasks, label: '今年新增任务', sub: '完成 ' + data.year.doneTasks + ' 个' },
    { num: data.year.doneRate, label: '任务完成率', sub: data.year.doneRate + '%' },
    { num: data.year.unlockedAchievements, label: '已解锁成就', sub: '共 ' + data.year.totalAchievements + ' 项' },
    { num: data.year.yearMemos, label: '今年灵感记录', sub: '累计 ' + data.year.totalMemos + ' 条' },
  ].map(function (c) {
    return '<div class="year-card">' +
      '<div class="year-num" data-count="' + c.num + '">0</div>' +
      '<div class="year-label">' + c.label + '</div>' +
      '<div class="year-sub">' + c.sub + '</div>' +
    '</div>';
  }).join('');
  const yearSec =
    '<section class="dash-section d4" id="dashYear">' +
      '<div class="dash-section-title">🎯 ' + todayStr().slice(0, 4) + ' 年度统计</div>' +
      '<div class="year-grid">' + yearCards + '</div>' +
    '</section>';

  // 视图切换（v5：日历并入数据页作为子视图）
  const viewChip = function (key, text) {
    return '<button class="range-chip' + (dashboardView === key ? ' active' : '') +
      '" data-action="dash-view" data-view="' + key + '">' + text + '</button>';
  };
  const viewSwitch =
    '<div class="dash-range-switch dash-view-switch">' +
      viewChip('overview', '📊 数据概览') + viewChip('calendar', '📅 日历视图') +
    '</div>';

  // 日历视图：直接复用 pages.js 的日历区块，避免两份渲染逻辑
  const isCal = (dashboardView === 'calendar');
  const calSec = (isCal && typeof buildCalendarBlockHtml === 'function')
    ? '<section class="dash-section d0">' + buildCalendarBlockHtml() + '</section>'
    : (isCal ? dashEmpty() : '');
  const calHint = isCal
    ? '<p class="dash-hint dash-caliber">点任意日期可查看当天的 To Do、灵感记录与任务备注更新。</p>'
    : '';

  const container = document.getElementById('content');
  if (container) {
    container.innerHTML =
      '<section class="page">' +
        '<div class="page-head">' +
          '<h2 class="page-title">数据</h2>' +
        '</div>' +
        viewSwitch +
        (isCal ? calHint : '<p class="dash-hint dash-caliber">' + escapeHtml(caliber) + '</p>') +
        (isCal
          ? calSec
          : weekSec + monthSec + trendSec + timelineSec + yearSec) +
      '</section>';
  }

  if (typeof animateCounters === 'function') animateCounters();

  // 图表必须在 innerHTML 之后再取（canvas 才有布局宽度）；日历视图下没有该 canvas
  if (!isCal && data.trend.total > 0) {
    const canvas = document.getElementById('dashTrendCanvas');
    if (canvas) drawLineChart(canvas, { labels: data.trend.labels, values: data.trend.values });
  }
}

  /* ---- 导出公共 API 到 EO 命名空间并同步到全局（兼容旧引用 / 测试桩） ---- */
  E.CHART_THEME = CHART_THEME;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.CHART_THEME === "undefined") globalThis.CHART_THEME = CHART_THEME; } catch (e) {}
  E.dashboardTrendRange = dashboardTrendRange;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.dashboardTrendRange === "undefined") globalThis.dashboardTrendRange = dashboardTrendRange; } catch (e) {}
  E.dashboardView = dashboardView;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.dashboardView === "undefined") globalThis.dashboardView = dashboardView; } catch (e) {}
  E.TIMELINE_MAX = TIMELINE_MAX;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.TIMELINE_MAX === "undefined") globalThis.TIMELINE_MAX = TIMELINE_MAX; } catch (e) {}
  E.dashArr = dashArr;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.dashArr === "undefined") globalThis.dashArr = dashArr; } catch (e) {}
  E.countDoneInRange = countDoneInRange;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.countDoneInRange === "undefined") globalThis.countDoneInRange = countDoneInRange; } catch (e) {}
  E.buildRangeSummary = buildRangeSummary;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.buildRangeSummary === "undefined") globalThis.buildRangeSummary = buildRangeSummary; } catch (e) {}
  E.buildTrendSeries = buildTrendSeries;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.buildTrendSeries === "undefined") globalThis.buildTrendSeries = buildTrendSeries; } catch (e) {}
  E.buildAchievementTimeline = buildAchievementTimeline;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.buildAchievementTimeline === "undefined") globalThis.buildAchievementTimeline = buildAchievementTimeline; } catch (e) {}
  E.buildYearSummary = buildYearSummary;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.buildYearSummary === "undefined") globalThis.buildYearSummary = buildYearSummary; } catch (e) {}
  E.getDashboardData = getDashboardData;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.getDashboardData === "undefined") globalThis.getDashboardData = getDashboardData; } catch (e) {}
  E.drawLineChart = drawLineChart;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.drawLineChart === "undefined") globalThis.drawLineChart = drawLineChart; } catch (e) {}
  E.__dashRedrawTimer = __dashRedrawTimer;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.__dashRedrawTimer === "undefined") globalThis.__dashRedrawTimer = __dashRedrawTimer; } catch (e) {}
  E.scheduleDashboardRedraw = scheduleDashboardRedraw;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.scheduleDashboardRedraw === "undefined") globalThis.scheduleDashboardRedraw = scheduleDashboardRedraw; } catch (e) {}
  E.dashEmpty = dashEmpty;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.dashEmpty === "undefined") globalThis.dashEmpty = dashEmpty; } catch (e) {}
  E.dashMiniCards = dashMiniCards;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.dashMiniCards === "undefined") globalThis.dashMiniCards = dashMiniCards; } catch (e) {}
  E.dashMonthCards = dashMonthCards;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.dashMonthCards === "undefined") globalThis.dashMonthCards = dashMonthCards; } catch (e) {}
  E.dashSum = dashSum;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.dashSum === "undefined") globalThis.dashSum = dashSum; } catch (e) {}
  E.renderDashboard = renderDashboard;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.renderDashboard === "undefined") globalThis.renderDashboard = renderDashboard; } catch (e) {}
})();