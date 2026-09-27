/* ===== 模块 achievements.js（v16 模块化：window.EO 命名空间） ===== */
var state = null;
var currentAccount = null;
var backpackTab = 'all';
(function () {
  'use strict';
  var _g = (typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this));
  _g.EO = _g.EO || {};
  var E = _g.EO;

/**
 * achievements.js —— 成就系统（v2 升级）
 * 自动成就规则：7 类别 + 16 条规则，双函数制（current/target 进度制）：
 *   - current() 实时计算分子（调用期才访问 state / collections，加载顺序无环）；
 *   - check() 一律由 current() >= target 派生，禁止手写独立判断；
 *   - 进度不持久化，每次渲染实时计算；仅 unlocked/unlockedAt 持久化。
 * 手动自定义成就的增删在 data.js 中；类别归属渲染时由规则定义反查（不入档）。
 */

/**
 * 成就类别（固定 7 类，tab 徽章色区分，设计文档 §3.5）。
 * cls 对应 css/style.css 中的徽章色类名。
 */
const ACHIEVEMENT_CATEGORY = {
  exploration: { label: '探索', cls: 'ach-cat-exploration' },
  social:      { label: '社交', cls: 'ach-cat-social' },
  creation:    { label: '创作', cls: 'ach-cat-creation' },
  challenge:   { label: '挑战', cls: 'ach-cat-challenge' },
  collection:  { label: '收藏', cls: 'ach-cat-collection' },
  life:        { label: '人生', cls: 'ach-cat-life' },
  task:        { label: '任务', cls: 'ach-cat-task' },
  // v1.2.0：隐藏彩蛋。未解锁时在成就页只显示「？？？」（条件保密），解锁后揭晓
  egg:         { label: '彩蛋', cls: 'ach-cat-egg' },
};

/** 彩蛋分类 id（渲染层据此做「未解锁 → 打码」处理） */
const EGG_CATEGORY = 'egg';

/* ---------- 计数辅助（供规则 current() 复用） ---------- */

/** done 状态的 To Do 数 */
function countDoneTodos() {
  return state.tasks.filter(function (t) {
    return t.category === 'todo' && t.status === 'done';
  }).length;
}

/** 全任务最大嵌套深度 */
function countMaxTaskDepth() {
  let max = 0;
  state.tasks.forEach(function (t) {
    const d = getTaskDepth(t);
    if (d > max) max = d;
  });
  return max;
}

/* ---------- 事件时间解析（批次2：基于真实事件发生时间而非解锁时当前时间戳） ---------- */

/** YYYY-MM-DD（本地日键）→ ISO UTC 午夜；非法返回 null */
function dayToIso(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  var p = day.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2], 0, 0, 0));
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** 出生日期 + N 年（周岁生日）→ ISO；无生日返回 null */
function birthPlusIso(birth, years) {
  if (typeof birth !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birth)) return null;
  var p = birth.split('-').map(Number);
  var d = new Date(Date.UTC(p[0] + years, p[1] - 1, p[2], 0, 0, 0));
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** 升序排好的 ISO 列表里取第 n 个（1-based）；不足返回 null */
function nthIso(arr, n) {
  var v = (arr || []).filter(function (x) { return typeof x === 'string' && x; }).slice().sort();
  return v[n - 1] || null;
}

/* ---------- v1.2.0：彩蛋成就的文本 / 时间统计工具 ---------- */
/* 设计原则：能实时从既有数据推导的一律不额外持久化（只在 state.eggs 里存"无法推导的事件计数"）。 */

/** ISO 时间的本地小时（0–23）；非法返回 -1 */
function localHourOf(iso) {
  try {
    if (typeof iso !== 'string' || !iso) return -1;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return -1;
    return d.getHours();
  } catch (e) { return -1; }
}

/** ISO 时间 → 本地日键 YYYY-MM-DD；非法返回 ''（严禁用 slice(0,10) —— 那是 UTC 日，会跨时区错一天） */
function localDayOf(iso) {
  try {
    if (typeof iso !== 'string' || !iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) {
      // 已经是 YYYY-MM-DD 日键的（如 locations.date）直接返回
      return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : '';
    }
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  } catch (e) { return ''; }
}

/**
 * emoji / 符号识别（v1.2.0）。
 * 刻意不用 Unicode 属性转义 `\p{...}`（ES2018，IE11 与老 WebView 不支持，
 * 且 Pakr 的 babel ie11 预设无法降级它），改用显式码位区间，兼容性最好。
 */
var EMOJI_RE = new RegExp(
  '[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]' +                     // 星平面（绝大多数 emoji 主体）
  '|[\\u2600-\\u27BF\\u2B00-\\u2BFF\\u2190-\\u21FF\\u2300-\\u23FF\\u25A0-\\u25FF]', // BMP 符号
  'g'
);

/** 字符串里的 emoji 个数 */
function countEmoji(s) {
  var m = String(s || '').match(EMOJI_RE);
  return m ? m.length : 0;
}

/** 剥掉 emoji / 变体选择符 / 零宽连接符 / 空白 / 标点，返回剩余「真正的文字」 */
function stripEmojiAndPunct(s) {
  return String(s || '')
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')                       // 星平面
    .replace(/[\u2000-\u206F\u2600-\u27BF\u2B00-\u2BFF\u2190-\u21FF\u2300-\u23FF\u25A0-\u25FF\uFE00-\uFE0F]/g, '')
    .replace(/[\s!-\/:-@\[-`{-~\u3000-\u303F\uFF00-\uFFEF]/g, '');
}

/** 是否「只由 emoji / 空白 / 标点组成」（无任何中英文字母或数字）→ 「只可意会」彩蛋 */
function isEmojiOnlyText(s) {
  var t = String(s || '').trim();
  if (!t) return false;
  if (countEmoji(t) < 2) return false;
  return stripEmojiAndPunct(t).length === 0;
}

/** 全部「有记录的日子」集合（世界日志 + 任务完成 + 足迹 + 收藏），用于连续记录天数 */
function allRecordedDays() {
  var seen = {};
  (state.memos || []).forEach(function (m) { var d = localDayOf(m && m.createdAt); if (d) seen[d] = 1; });
  (state.tasks || []).forEach(function (t) { var d = localDayOf(t && t.doneAt); if (d) seen[d] = 1; });
  (state.locations || []).forEach(function (l) { var d = l && l.date; if (d) seen[d] = 1; });
  (state.collections || []).forEach(function (c) { var d = localDayOf(c && c.createdAt); if (d) seen[d] = 1; });
  return Object.keys(seen).sort();
}

/** 最长「连续记录」天数（相邻自然日不中断的最长连击） */
function longestRecordStreak() {
  var days = allRecordedDays();
  if (!days.length) return 0;
  var best = 1, cur = 1;
  for (var i = 1; i < days.length; i++) {
    var prev = new Date(days[i - 1] + 'T00:00:00');
    var now = new Date(days[i] + 'T00:00:00');
    var diff = Math.round((now.getTime() - prev.getTime()) / 86400000);
    cur = (diff === 1) ? cur + 1 : 1;
    if (cur > best) best = cur;
  }
  return best;
}

/** 单日最多完成的任务数（按本地日聚合 doneAt） */
function maxDoneTasksInOneDay() {
  var byDay = {};
  (state.tasks || []).forEach(function (t) {
    if (!t || t.status !== 'done') return;
    var d = localDayOf(t.doneAt);
    if (!d) return;
    byDay[d] = (byDay[d] || 0) + 1;
  });
  var max = 0;
  Object.keys(byDay).forEach(function (k) { if (byDay[k] > max) max = byDay[k]; });
  return max;
}

/** 逾期未完成的 To Do 数量（有 dueDate 且早于今天且未 done） */
function countOverdueOpenTodos() {
  var today = (typeof todayStr === 'function') ? todayStr() : '';
  if (!today) return 0;
  return (state.tasks || []).filter(function (t) {
    return t && t.category === 'todo' && t.status !== 'done' && t.dueDate && t.dueDate < today;
  }).length;
}

/** 任务标题满足 predicate 的条数 */
function countTasksByTitle(pred) {
  return (state.tasks || []).filter(function (t) { return t && pred(String(t.title || '')); }).length;
}

/** 世界日志中本地小时命中 [from, to) 的条数 */
function countMemosInHourRange(from, to) {
  return (state.memos || []).filter(function (m) {
    var h = localHourOf(m && m.createdAt);
    return h >= from && h < to;
  }).length;
}

/** 任务完成时间（doneAt）本地小时命中 [from, to) 的条数 */
function countTasksDoneInHourRange(from, to) {
  return (state.tasks || []).filter(function (t) {
    if (!t || t.status !== 'done') return false;
    var h = localHourOf(t.doneAt);
    return h >= from && h < to;
  }).length;
}

/* 各类型事件时间源（已按时间收集，供 nthIso 取第 N 个） */
function _doneTodoTimes() {
  return state.tasks.filter(function (t) { return t.category === 'todo' && t.status === 'done' && t.doneAt; }).map(function (t) { return t.doneAt; });
}
function _doneSideTimes() {
  return state.tasks.filter(function (t) { return t.category === 'side' && t.status === 'done' && t.doneAt; }).map(function (t) { return t.doneAt; });
}
function _itemTimes() { return state.items.map(function (i) { return i.createdAt; }); }
function _physicalTimes() { return state.items.filter(function (i) { return i.type === 'physical'; }).map(function (i) { return i.createdAt; }); }
function _memoTimes() { return state.memos.map(function (m) { return m.createdAt; }); }
function _collectionTimes() { return state.collections.map(function (c) { return c.createdAt; }); }
function _collectionFileTimes() { return state.collections.filter(function (c) { return c.fileMeta != null; }).map(function (c) { return c.createdAt; }); }
function _locationTimes() { return (state.locations || []).map(function (l) { return l.date; }); }
function _mainTimes() { return state.tasks.filter(function (t) { return t.category === 'main'; }).map(function (t) { return t.createdAt; }); }
function _rootTimes() { return getRootTasks().map(function (t) { return t.createdAt; }); }
function _allTaskTimes() { return state.tasks.map(function (t) { return t.createdAt; }); }

/**
 * 每条自动成就对应的「事件时间」解析器。
 * 返回 ISO 字符串（真实事件发生时刻）或 null（无可用时间戳，如 ledger_first/cat_first/walmart_egg）。
 * 用于解锁瞬间写入 unlockedAt，并对历史已解锁成就做回溯回填。
 */
var EVENT_TIME_RESOLVERS = {
  age_18:        function () { return birthPlusIso(state.birthDate, 18); },
  age_30:        function () { return birthPlusIso(state.birthDate, 30); },
  age_60:        function () { return birthPlusIso(state.birthDate, 60); },
  first_todo_done: function () { return nthIso(_doneTodoTimes(), 1); },
  depth_5:       function () { return dayToIso(nthIso(_allTaskTimes(), 1)); },        // 近似：最早任务创建日
  first_main:    function () { return dayToIso(nthIso(_mainTimes(), 1)); },
  side_done_3:   function () { return nthIso(_doneSideTimes(), 3); },
  root_create_5: function () { return dayToIso(nthIso(_rootTimes(), 5)); },
  gear_10:       function () { return dayToIso(nthIso(_itemTimes(), 10)); },
  physical_5:    function () { return dayToIso(nthIso(_physicalTimes(), 5)); },
  memo_10:       function () { return nthIso(_memoTimes(), 10); },
  memo_30:       function () { return nthIso(_memoTimes(), 30); },
  todo_done_10:  function () { return nthIso(_doneTodoTimes(), 10); },
  todo_done_50:  function () { return nthIso(_doneTodoTimes(), 50); },
  collect_5:     function () { return dayToIso(nthIso(_collectionTimes(), 5)); },
  collect_20:    function () { return dayToIso(nthIso(_collectionTimes(), 20)); },
  collect_file_3: function () { return dayToIso(nthIso(_collectionFileTimes(), 3)); },
  footprint_1:   function () { return dayToIso(nthIso(_locationTimes(), 1)); },
  footprint_10:  function () { return dayToIso(nthIso(_locationTimes(), 10)); },
  footprint_50:  function () { return dayToIso(nthIso(_locationTimes(), 50)); }
  /* ledger_first / cat_first / walmart_egg：无事件时间戳，保持 null */
};

/**
 * 自动成就规则全量表（16 条，设计文档 §3.5）。
 * 现有 6 条（age_18/30/60、first_todo_done、depth_5、first_main）映射类别，
 * 新增 10 条覆盖探索/社交/创作/挑战/收藏 5 个新类别（阈值全部 ≥3，避免种子数据误触发）。
 */
const AUTO_ACHIEVEMENT_DEFS = [
  {
    key: 'age_18', title: '成年礼', desc: '年满 18 岁，正式开启地球服主线剧情。',
    category: 'life', target: 18,
    current: function () { return getAge(state.birthDate); },
  },
  {
    key: 'age_30', title: '三十而立', desc: '年满 30 岁，立于天地之间。',
    category: 'life', target: 30,
    current: function () { return getAge(state.birthDate); },
  },
  {
    key: 'age_60', title: '花甲之年', desc: '年满 60 岁，阅历满盈，返璞归真。',
    category: 'life', target: 60,
    current: function () { return getAge(state.birthDate); },
  },
  {
    key: 'first_todo_done', title: '首杀时刻', desc: '完成第一个 To Do 任务，万事开头难。',
    category: 'task', target: 1,
    current: function () { return countDoneTodos(); },
  },
  {
    key: 'depth_5', title: '千层套路', desc: '任务嵌套深度达到 5 层，规划大师。',
    category: 'task', target: 5,
    current: function () { return countMaxTaskDepth(); },
  },
  {
    key: 'first_main', title: '开创主线', desc: '创建了第一个主线任务，为自己的人生定下方向。',
    category: 'task', target: 1,
    current: function () {
      return state.tasks.filter(function (t) { return t.category === 'main'; }).length;
    },
  },
  {
    key: 'side_done_3', title: '支线大师', desc: '累计完成 3 条支线任务，支线也值得认真对待。',
    category: 'exploration', target: 3,
    current: function () {
      return state.tasks.filter(function (t) {
        return t.category === 'side' && t.status === 'done';
      }).length;
    },
  },
  {
    key: 'root_create_5', title: '独当一面', desc: '创建 5 个顶级任务，人生板块由自己搭建。',
    category: 'exploration', target: 5,
    current: function () { return getRootTasks().length; },
  },
  {
    key: 'gear_10', title: '装备大师', desc: '背包装备达到 10 件，行囊渐丰。',
    category: 'social', target: 10,
    current: function () { return state.items.length; },
  },
  {
    key: 'physical_5', title: '现实收藏家', desc: '拥有 5 件实体物品，现实世界同样在收集。',
    category: 'social', target: 5,
    current: function () {
      return state.items.filter(function (i) { return i.type === 'physical'; }).length;
    },
  },
  {
    key: 'memo_10', title: '灵感记录者', desc: '记录 10 条灵感闪念，留住大脑的火花。',
    category: 'creation', target: 10,
    current: function () { return state.memos.length; },
  },
  {
    key: 'memo_30', title: '灵感泉涌', desc: '记录 30 条灵感闪念，思考已成习惯。',
    category: 'creation', target: 30,
    current: function () { return state.memos.length; },
  },
  {
    key: 'todo_done_10', title: '挑战者', desc: '累计完成 10 个 To Do，行动力认证。',
    category: 'challenge', target: 10,
    current: function () { return countDoneTodos(); },
  },
  {
    key: 'todo_done_50', title: '挑战大师', desc: '累计完成 50 个 To Do，目标粉碎机。',
    category: 'challenge', target: 50,
    current: function () { return countDoneTodos(); },
  },
  {
    key: 'collect_5', title: '藏品五件', desc: '收藏 5 件数字藏品（含纯文字收藏）。',
    category: 'collection', target: 5,
    current: function () { return state.collections.length; },
  },
  {
    key: 'collect_file_3', title: '数字藏品', desc: '3 件收藏带本地文件附件，数字藏品柜成型。',
    category: 'collection', target: 3,
    current: function () {
      return state.collections.filter(function (c) { return c.fileMeta != null; }).length;
    },
  },
  {
    key: 'walmart_egg', title: '性别认同：沃尔玛购物袋', desc: '你选择了「🛍️ 沃尔玛购物袋」作为性别认同，这是对消费主义的温柔致敬。',
    category: 'egg', target: 1,
    current: function () { return (state.profile && state.profile.gender === 'walmart') ? 1 : 0; },
  },

  /* ---- v5：足迹地图 / 记账 / 收藏 三类新成就（自动触发） ---- */
  {
    key: 'footprint_1', title: '初出茅庐', desc: '记录第一个足迹坐标，你的人生地图就此展开。',
    category: 'exploration', target: 1,
    current: function () { return (state.locations || []).length; },
  },
  {
    key: 'footprint_10', title: '行者无疆', desc: '累计记录 10 个足迹，四方的土地都留下了你的脚印。',
    category: 'exploration', target: 10,
    current: function () { return (state.locations || []).length; },
  },
  {
    key: 'footprint_50', title: '世界公民', desc: '累计记录 50 个足迹，足迹已遍布地球各个角落。',
    category: 'exploration', target: 50,
    current: function () { return (state.locations || []).length; },
  },
  {
    key: 'ledger_first', title: '精打细算', desc: '首次打开记账（Verifin），理财从这一刻开始。',
    category: 'life', target: 1,
    current: function () { return (state.ledgerOpened === true) ? 1 : 0; },
  },
  {
    key: 'cat_first', title: '收藏家', desc: '创建第一个自定义收藏分类，开始整理你的数字人生。',
    category: 'creation', target: 1,
    current: function () { return ((state.collectionCategories || []).length >= 1) ? 1 : 0; },
  },
  {
    key: 'collect_20', title: '百宝箱', desc: '收藏达到 20 件，数字藏品柜已琳琅满目。',
    category: 'creation', target: 20,
    current: function () { return (state.collections || []).length; },
  },

  /* ==================== v1.2.0：隐藏彩蛋（category='egg'） ====================
   * 规则：未解锁时成就页只显示「？？？」，达成条件保密；解锁后才揭晓标题与描述。
   * 触发条件全部由既有数据实时推导（唯一例外是 egg_blank_title 依赖 state.eggs 计数器，
   * 因为「保存失败」这件事不会留下任何数据痕迹）。
   * 彩蛋不挂 eventTime：它们的解锁时刻就是「被发现的此刻」，符合语义。 */
  {
    key: 'egg_gender_fluid', title: '性别是流动的', category: 'egg', target: 1,
    desc: '你把性别选成了「🚁 武装直升机」或「🥔 一颗土豆」。地球服的捏脸系统显然拦不住你。',
    current: function () {
      var g = state.profile && state.profile.gender;
      return (g === 'helicopter' || g === 'potato') ? 1 : 0;
    },
  },
  {
    key: 'egg_3am', title: '凌晨三点俱乐部', category: 'egg', target: 1,
    desc: '你在凌晨 3 点写下了一条世界日志。这个点还醒着的人，都懂。',
    current: function () { return countMemosInHourRange(3, 4) > 0 ? 1 : 0; },
  },
  {
    key: 'egg_night_owl', title: '夜猫子', category: 'egg', target: 3,
    desc: '累计 3 条日志写于 0–5 点。月亮是你的时区。',
    current: function () { return countMemosInHourRange(0, 5); },
  },
  {
    key: 'egg_early_bird', title: '早起的鸟儿', category: 'egg', target: 3,
    desc: '累计 3 条日志写于 5–7 点。清晨的世界归你。',
    current: function () { return countMemosInHourRange(5, 7); },
  },
  {
    key: 'egg_midnight_task', title: '午夜任务侠', category: 'egg', target: 1,
    desc: '你在凌晨 3 点完成了一个任务。这个成就颁发给所有深夜还在推进人生主线的人。',
    current: function () { return countTasksDoneInHourRange(3, 4) > 0 ? 1 : 0; },
  },
  {
    key: 'egg_blank_title', title: '白卷英雄', category: 'egg', target: 3,
    desc: '你有 3 次试图用一个纯空白的标题创建任务。空即是色，色即是空。',
    current: function () { return (state.eggs && state.eggs.blankTitleTries) || 0; },
  },
  {
    key: 'egg_long_title', title: '起名鬼才', category: 'egg', target: 1,
    desc: '有一个任务的标题长达 30 个字符以上。取名这件事，你是认真的。',
    current: function () { return countTasksByTitle(function (t) { return t.length >= 30; }) > 0 ? 1 : 0; },
  },
  {
    key: 'egg_emoji_title', title: 'emoji 艺术家', category: 'egg', target: 1,
    desc: '有一个任务标题塞进了 5 个以上 emoji。文字不够，表情来凑。',
    current: function () { return countTasksByTitle(function (t) { return countEmoji(t) >= 5; }) > 0 ? 1 : 0; },
  },
  {
    key: 'egg_period_title', title: '句号强迫症', category: 'egg', target: 3,
    desc: '累计 3 个任务标题以「。」结尾。没有句号的人生，是不完整的。',
    current: function () { return countTasksByTitle(function (t) { return /。$/.test(t.trim()); }); },
  },
  {
    key: 'egg_test_title', title: '测试狂魔', category: 'egg', target: 3,
    desc: '累计 3 个任务标题里带着「测试」或「test」。严谨，是一种习惯。',
    current: function () { return countTasksByTitle(function (t) { return /测试|test/i.test(t); }); },
  },
  {
    key: 'egg_overdue', title: '拖延症晚期', category: 'egg', target: 5,
    desc: '同时挂着 5 个已逾期的 To Do。明天的你，一定会感谢现在的你（并不会）。',
    current: function () { return countOverdueOpenTodos(); },
  },
  {
    key: 'egg_marathon', title: '马拉松选手', category: 'egg', target: 10,
    desc: '单日完成 10 个任务。这一天，你没有虚度。',
    current: function () { return maxDoneTasksInOneDay(); },
  },
  {
    key: 'egg_streak_7', title: '七日之约', category: 'egg', target: 7,
    desc: '连续 7 天在游戏里留下记录。习惯的齿轮开始转动。',
    current: function () { return longestRecordStreak(); },
  },
  {
    key: 'egg_streak_30', title: '三十天不断更', category: 'egg', target: 30,
    desc: '连续 30 天记录人生。这个月，你一天都没缺席。',
    current: function () { return longestRecordStreak(); },
  },
  {
    key: 'egg_streak_365', title: '一年不缺席', category: 'egg', target: 365,
    desc: '连续 365 天记录人生。传说中的成就，达成者寥寥。',
    current: function () { return longestRecordStreak(); },
  },
  {
    key: 'egg_memo_emoji', title: '只可意会', category: 'egg', target: 1,
    desc: '你有一条世界日志完全由 emoji 组成。有些心情，确实无法用语言描述。',
    current: function () {
      return (state.memos || []).some(function (m) { return isEmojiOnlyText(m && m.text); }) ? 1 : 0;
    },
  },
  {
    key: 'egg_newyear', title: '元旦宝宝', category: 'egg', target: 1,
    desc: '你的生日正好是 1 月 1 日。全地球陪你一起过生日。',
    current: function () {
      return (typeof state.birthDate === 'string' && /^\d{4}-01-01$/.test(state.birthDate)) ? 1 : 0;
    },
  },
];

/* check() 一律由 current() >= target 派生（统一挂载，禁止手写独立判断）；
 * eventTime 由 EVENT_TIME_RESOLVERS 按 key 挂载（无对应解析器的规则保持无 eventTime） */
AUTO_ACHIEVEMENT_DEFS.forEach(function (def) {
  def.check = function () { return def.current() >= def.target; };
  if (EVENT_TIME_RESOLVERS[def.key]) def.eventTime = EVENT_TIME_RESOLVERS[def.key];
});

/** 按 autoKey 反查规则定义（渲染层取 category / target / current 用） */
function getAutoAchievementDef(key) {
  return AUTO_ACHIEVEMENT_DEFS.find(function (d) { return d.key === key; }) || null;
}

/**
 * 确保所有自动成就都在 state.achievements 中有条目（v2 三段式升级）：
 *   1. 清理 autoKey 不在规则表中的 auto 条目（沿用 v1）；
 *   2. 补齐缺失条目（新增 unlocked:false, unlockedAt:null）；
 *   3. 对既有条目同步规则表的 title/desc（文案演进不换档）；
 *   ★ 绝不触碰 unlocked/unlockedAt —— 旧存档已解锁成就保持已解锁。
 */
function ensureAutoAchievements() {
  let changed = false;
  const defKeys = AUTO_ACHIEVEMENT_DEFS.map(function (d) { return d.key; });

  // 1. 清理已不存在规则的自动成就
  const before = state.achievements.length;
  state.achievements = state.achievements.filter(function (a) {
    return a.type !== 'auto' || defKeys.indexOf(a.autoKey) !== -1;
  });
  if (state.achievements.length !== before) changed = true;

  // 2 + 3. 补齐缺失条目 / 同步既有条目文案（不动 unlocked/unlockedAt）
  AUTO_ACHIEVEMENT_DEFS.forEach(function (def) {
    const existing = state.achievements.find(function (a) { return a.autoKey === def.key; });
    if (!existing) {
      state.achievements.push({
        id: uid('ach'),
        title: def.title,
        desc: def.desc,
        type: 'auto',
        autoKey: def.key,
        unlocked: false,
        unlockedAt: null,
      });
      changed = true;
    } else if (existing.title !== def.title || existing.desc !== def.desc) {
      existing.title = def.title;
      existing.desc = def.desc;
      changed = true;
    }
  });

  if (changed) saveState();
}

/**
 * 检测所有自动成就规则并解锁达成的成就。
 * 调用点：应用启动、任务/备忘/物品变更、出生日期变更、收藏增删（v2 新增触发点）。
 * 批次2 改造：unlockedAt 一律取「真实事件时间」(eventTime)，而非解锁时的当前时间戳；
 * 对历史已解锁成就，若 eventTime 可用且与已存 unlockedAt 不一致，则回溯回填（历史修复）。
 * @returns {Array} 本次新解锁的成就列表
 */
function checkAutoAchievements() {
  const newly = [];
  // 与 newly 一一对应的「是否彩蛋」标记。不能把标记挂到 ach 对象上 ——
  // 那会被 saveState 一起持久化，污染存档。
  const newlyEgg = [];
  let backfilled = false;
  AUTO_ACHIEVEMENT_DEFS.forEach(function (def) {
    const ach = state.achievements.find(function (a) { return a.autoKey === def.key; });
    if (!ach || !def.check()) return;
    const et = (typeof def.eventTime === 'function') ? def.eventTime() : null;
    if (!ach.unlocked) {
      ach.unlocked = true;
      ach.unlockedAt = et || new Date().toISOString();
      newly.push(ach);
      newlyEgg.push(def.category === EGG_CATEGORY);
    } else if (et && ach.unlockedAt !== et) {
      // 历史回溯：用真实事件时间覆盖「今天」误标的解锁时间
      ach.unlockedAt = et;
      backfilled = true;
    }
  });
  if (newly.length || backfilled) {
    saveState();
    newly.forEach(function (a, i) {
      // v3：Steam 风格通知 + 合成音效 + 动态记录（浏览器环境才渲染）
      // 彩蛋解锁也弹卡片，换个图标与标题（成就名照常显示 —— 已经解锁了就不必再打码）
      if (typeof showAchievementNotification === 'function') {
        showAchievementNotification(a.title, newlyEgg[i]);
      }
      if (typeof playAchievementChime === 'function') playAchievementChime();
      addActivity('ach', a.title);
    });
  }
  return newly;
}

  /* ---- 导出公共 API 到 EO 命名空间并同步到全局（兼容旧引用 / 测试桩） ---- */
  E.ACHIEVEMENT_CATEGORY = ACHIEVEMENT_CATEGORY;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.ACHIEVEMENT_CATEGORY === "undefined") globalThis.ACHIEVEMENT_CATEGORY = ACHIEVEMENT_CATEGORY; } catch (e) {}
  E.EGG_CATEGORY = EGG_CATEGORY;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.EGG_CATEGORY === "undefined") globalThis.EGG_CATEGORY = EGG_CATEGORY; } catch (e) {}
  E.localDayOf = localDayOf;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.localDayOf === "undefined") globalThis.localDayOf = localDayOf; } catch (e) {}
  E.localHourOf = localHourOf;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.localHourOf === "undefined") globalThis.localHourOf = localHourOf; } catch (e) {}
  E.countEmoji = countEmoji;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.countEmoji === "undefined") globalThis.countEmoji = countEmoji; } catch (e) {}
  E.isEmojiOnlyText = isEmojiOnlyText;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.isEmojiOnlyText === "undefined") globalThis.isEmojiOnlyText = isEmojiOnlyText; } catch (e) {}
  E.longestRecordStreak = longestRecordStreak;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.longestRecordStreak === "undefined") globalThis.longestRecordStreak = longestRecordStreak; } catch (e) {}
  E.countDoneTodos = countDoneTodos;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.countDoneTodos === "undefined") globalThis.countDoneTodos = countDoneTodos; } catch (e) {}
  E.countMaxTaskDepth = countMaxTaskDepth;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.countMaxTaskDepth === "undefined") globalThis.countMaxTaskDepth = countMaxTaskDepth; } catch (e) {}
  E.AUTO_ACHIEVEMENT_DEFS = AUTO_ACHIEVEMENT_DEFS;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.AUTO_ACHIEVEMENT_DEFS === "undefined") globalThis.AUTO_ACHIEVEMENT_DEFS = AUTO_ACHIEVEMENT_DEFS; } catch (e) {}
  E.getAutoAchievementDef = getAutoAchievementDef;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.getAutoAchievementDef === "undefined") globalThis.getAutoAchievementDef = getAutoAchievementDef; } catch (e) {}
  E.ensureAutoAchievements = ensureAutoAchievements;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.ensureAutoAchievements === "undefined") globalThis.ensureAutoAchievements = ensureAutoAchievements; } catch (e) {}
  E.checkAutoAchievements = checkAutoAchievements;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.checkAutoAchievements === "undefined") globalThis.checkAutoAchievements = checkAutoAchievements; } catch (e) {}
})();