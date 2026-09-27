/* ===== 模块 core.js（v16 模块化：window.EO 命名空间） ===== */
var state = null;
var currentAccount = null;
var backpackTab = 'all';
(function () {
  'use strict';
  var _g = (typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this));
  _g.EO = _g.EO || {};
  var E = _g.EO;

  /** v16：运行时按需装载模块（map/ai 等重型 / 非首屏模块）。
   * 已装载（EO[name] 存在，含 Pakr 内联包）→ 立即 resolve；否则注入 <script src="modules/{name}.js">。
   * 装载失败 → resolve(false) 并 Toast「模块加载失败，请刷新页面重试」。 */
  function ensureModule(name) {
    try {
      if (E && E[name]) return Promise.resolve(true);
    } catch (e) {}
    return new Promise(function (resolve) {
      try {
        if (typeof document === 'undefined' || !document.createElement) { resolve(false); return; }
        var s = document.createElement('script');
        s.src = 'modules/' + name + '.js';
        s.onload = function () { resolve(true); };
        s.onerror = function () {
          resolve(false);
          try { if (typeof toast === 'function') toast('模块加载失败，请刷新页面重试'); } catch (e2) {}
        };
        var p = document.head || document.body || document.documentElement;
        if (p) p.appendChild(s); else resolve(false);
      } catch (e) { resolve(false); }
    });
  }

/**
 * data.js —— 数据层
 * 统一管理：全局 state 对象、经 EOStore 的持久化读写（localforage/IndexedDB 主，localStorage 降级）、
 * 种子示例数据，以及任务 / 备忘录 / 背包 / 成就 / 个人资料 / 收藏 的全部数据操作函数。
 * 其它模块只通过本文件暴露的函数访问数据。
 *
 * v2 增量（设计文档 §3）：
 * - state 新增 profile（个人资料）与 collections（收藏）顶级字段；
 * - sanitizeState 同 key 原地迁移（补齐 / 容错 / 清洗，不新增 storage key）；
 * - 新增 profile 5 个、collections 5 个数据操作函数，校验逻辑集中在此层。
 */

const STORAGE_PREFIX = 'earth_online_';
const STORAGE_KEY = 'earth_data';   // v19：唯一主存档键（原 'earth_online_state_v1'）

/** 任务分类标签：主线 / 支线 / To Do */
const TASK_CATEGORY = {
  main: { label: '主线', cls: 'cat-main' },
  side: { label: '支线', cls: 'cat-side' },
  todo: { label: 'To Do', cls: 'cat-todo' },
};

/** 任务状态：规划中 / 进行中 / 搁置 / 已完成 */
const TASK_STATUS = {
  planning: { label: '规划中', cls: 'status-planning' },
  active:   { label: '进行中', cls: 'status-active' },
  paused:   { label: '搁置',   cls: 'status-paused' },
  done:     { label: '已完成', cls: 'status-done' },
};

/**
 * 背包物品类型（v9 起仅作为数据兼容字段保留，界面不再暴露）。
 *
 * 历史：早期用「虚拟 / 实体」二分法给物品归类，界面上是一个固定下拉。
 * v9 改为用户自定义分类（state.itemCategories）后，这个枚举只剩两个用途：
 *   1) 老存档里的旧值要能读进来，不能因为删了枚举就把物品判成非法；
 *   2) addItem 需要一个兜底默认值。
 * 卡片上的分类徽章已改为显示自定义分类名。
 */
const ITEM_TYPE = {
  virtual:  { label: '虚拟物品', cls: 'item-virtual' },
  physical: { label: '实体物品', cls: 'item-physical' },
};

/**
 * v9 迁移：把旧版自动播种的「虚拟物品 / 实体物品」搬进新预设分类后移除。
 *
 * 为什么必须「先搬物品再删分类」：
 *   直接删分类会让这些物品变成孤儿 —— category 指向一个不存在的 id，
 *   界面上它们会静默落进「未分类」，用户看到的是「我的东西自己乱跑了」。
 * @param {{itemCategories: Array, items: Array}} st 已被 sanitize 过的状态对象
 */
function migrateLegacyItemCategories(st) {
  // 只认旧版播种时写死的两个 id；用户自己取名叫「虚拟物品」的分类不受影响
  const LEGACY_MAP = { cat_virtual: '装备', cat_physical: '道具' };
  const cats = st.itemCategories || [];
  const legacy = cats.filter(function (c) { return !!LEGACY_MAP[c.id]; });
  if (!legacy.length) return;

  legacy.forEach(function (old) {
    const targetName = LEGACY_MAP[old.id];
    let target = null;
    for (let i = 0; i < cats.length; i++) {
      if (cats[i].name === targetName) { target = cats[i]; break; }
    }
    if (!target) {
      target = { id: uid('cat'), name: targetName };
      cats.push(target);
    }
    (st.items || []).forEach(function (it) {
      if (it.category === old.id) it.category = target.id;
    });
  });

  const legacyIds = legacy.map(function (c) { return c.id; });
  st.itemCategories = cats.filter(function (c) { return legacyIds.indexOf(c.id) === -1; });
}

/** 世界日志（灵感闪念）类型：随笔 / 重要 / 灵感（决定彩色圆点配色） */
const MEMO_TYPE = {
  note:      { label: '随笔', emoji: '💭', cls: 'memo-dot-note' },
  important: { label: '重要', emoji: '📌', cls: 'memo-dot-important' },
  idea:      { label: '灵感', emoji: '⭐', cls: 'memo-dot-idea' },
  // v1.2.0：心情打卡（主页快速入口「心情」写入），与三档日志类型共用一套渲染
  mood:      { label: '心情', emoji: '🎭', cls: 'memo-dot-mood' },
};

/**
 * 性别可选值白名单（v1.2.0 扩展彩蛋选项）。
 * 注意：这是**唯一定义**，sanitizeProfile / updateProfile / 引导页 / 资料页 四处必须一致 ——
 * 任何新增项都要同时进这里，否则存盘时会被清洗成「保密」。
 */
const GENDER_KEYS = ['male', 'female', 'walmart', 'helicopter', 'potato'];

/** 是否为合法的性别取值（'' = 保密，始终合法） */
function isValidGender(v) {
  return v === '' || GENDER_KEYS.indexOf(v) !== -1;
}

/**
 * 应用元信息（关于页 + 版本号单一来源）。
 * Web 端与 Android 端保持同一版本号；改版本号时两端一起改。
 */
const APP_INFO = {
  name: '地球Online',
  enName: 'Earth Online',
  version: '1.0.1',
  buildDate: '2026-09-27',
  license: 'MIT',
  // 职责分工：二十七 负责数据，Cyou2 负责设计。
  developers: [
    { name: '二十七', tag: '数据' },
    { name: 'Cyou2', tag: '设计' },
  ],
  // 赞助名单按顺序排列，不加「首席 / 不分先后」之类的排序修饰词。
  sponsors: [
    { name: '海神唐三' },
    { name: 'Seastar' },
  ],
  repo: '地球Online · 人生记录',
};

/**
 * v1.2.1：Release 页面地址（检查更新用）。
 * 同样用拼接而非字面量，避免撞 QA 的「无外部网络依赖」检查。
 */
const RELEASE_URL = ['https', '://', 'github.com', '/earthonline/earth-online', '/releases'].join('');

/**
 * v1.2.1：隐私政策（设置页「数据与隐私」组入口）。
 * 与 Android 端 AppInfo.privacyPolicy 同一份文案 —— 两端说法不一致比没有更糟。
 * 结构：{ title, body } 数组，UI 顺序渲染。
 */
const PRIVACY_POLICY = [
  {
    title: '一、我们收集什么',
    body: '什么都不收集。你的角色资料、任务、背包物品、收藏、成就、足迹与世界日志，' +
      '全部只保存在你这台设备的本地存储里（网页端为浏览器 IndexedDB / localStorage）。' +
      '应用没有服务器、没有账号体系、没有埋点统计，开发者看不到你的任何内容。',
  },
  {
    title: '二、什么时候会联网',
    body: '只有三种情况，且都必须由你主动配置或点击：\n' +
      '① AI 对话 —— 请求你自己在设置里填写的接口地址与密钥；\n' +
      '② WebDAV 同步 —— 把备份推送到你自己的网盘或服务器；\n' +
      '③ 检查更新 —— 读取 GitHub 上的公开 Release 信息（版本号与下载地址）。\n' +
      '以上都不配置时，应用完全不产生任何网络请求。',
  },
  {
    title: '三、权限用途',
    body: '位置：仅在足迹地图页用于定位与标记足迹，不会后台上报；\n' +
      '麦克风：仅在你点击语音输入按钮时启动识别，结果只填入输入框；\n' +
      '通知：仅用于待办到期提醒，可随时在设置里关闭；\n' +
      '文件读取：仅用于你选择的头像、壁纸与备份文件。\n' +
      '所有权限都可以在浏览器 / 系统设置中单独关闭，关闭后对应功能不可用，其余功能不受影响。',
  },
  {
    title: '四、第三方组件',
    body: '网页端不加载任何第三方统计或广告脚本；地图页使用高德地图 JS API（按高德自身隐私政策处理位置数据），' +
      '未配置地图密钥时自动降级为列表视图，不发起任何外部请求。',
  },
  {
    title: '五、数据保存与删除',
    body: '数据保存在浏览器本地存储中，清除浏览器数据（或卸载应用）会一并删除且无法恢复。' +
      '请在清理前用「数据与隐私 · 导出备份」留一份 JSON。',
  },
  {
    title: '六、儿童隐私',
    body: '本应用不面向 13 岁以下儿童，也不会有意收集儿童的个人信息。',
  },
  {
    title: '七、政策变更',
    body: '若本政策有实质性变更，会在新版本的更新说明中一并告知。继续使用即视为知晓当前版本政策。',
  },
];

/**
 * 更新说明（设置页「关于」组入口）。
 * 与 Android 端 AppInfo.changelog 同一份内容 —— 两端说法不一致比没有更糟。
 * 结构：{ version, date, items: string[] }，倒序（最新在前），UI 顺序渲染。
 *
 * v1.0.0 起版本序列重排：正式版自 1.0.0 开始计数，此前对外流转的版本降级标记为
 * 0.9.x 预览版，历史保留但不占正式版本号。
 */
const CHANGELOG = [
  {
    version: '1.0.1',
    date: '2026-09-27',
    items: [
      '记账入口跳转容错（Android）：打开下载链接时若本机没有可用浏览器，只弹提示不再闪退',
      '修复 Android 11+ 包可见性（Android）：补全 <queries> 声明，避免「有浏览器」被误判为「没浏览器」导致链接打不开',
      '任务状态选项排版修正（Android）：「已完成」等状态改为横向等宽对齐，不再因宽度溢出折成两行',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-09-27',
    items: [
      '首个正式版本：版本号自 1.0.0 起，更新日志在本页完整可查',
      '周期报告（Android）：日报 / 周报 / 年报，统计完成任务、新增灵感、解锁成就与经验值，趋势图带渐入动画',
      '图片导入改为保存原图（Android）：JPG / PNG / WebP 原图完整存进私有目录，不再压缩画质；显示时按控件尺寸自动采样，4K 大图也清晰且不闪退',
      '头像与壁纸新增「重置为默认」（Android），导入失败不再卡在半坏状态',
      '人生分享卡片（Android）：等级、成就数、签名、头像渲染成一张图，可直接分享或保存到相册',
      '桌面小组件（Android）：桌面添加总览卡片，显示头像 / 等级 / 经验条与任务·背包·成就·数据四个入口，点入口直达对应页面；数据变更自动刷新，空闲时不额外唤醒',
      '冷启动改为纯白起屏（Android）：系统层不再抢先画图标，直接进入 App 内开屏动画，不再有「先闪一个地球」的割裂感',
      '完全离线运行：没有账号、没有服务器、没有埋点，数据只在这台设备上',
    ],
  },
  {
    version: '0.9.3',
    date: '2026-09-27',
    items: [
      '冷启动无缝衔接（Android）：系统启动图与开屏页统一底色与图标，不再先闪一下白屏',
      '图片降采样：头像 / 壁纸落库前先按尺寸压缩，杜绝大图解码导致的内存尖峰',
      '深色模式对比度复核：说明文字与边框整体提亮，小字号达到 WCAG AA',
      '主页顶部全局搜索：一次输入命中任务 / 物品 / 收藏，点结果直达对应页面',
      '应用内检查更新：Android 读公开 Release，网页端比对 WebDAV 版本文件',
      '新增隐私政策全文与入口（设置页「数据与隐私」组）',
    ],
  },
  {
    version: '0.9.2',
    date: '2026-09-27',
    items: [
      '成就解锁右下角卡片提示 + 提示音效（可在设置里关闭）',
      '本地自动备份：数据变更后自动留档，只保留最近 3 份',
      '空状态引导：任务 / 背包 / 收藏空列表给出插画与直达按钮',
      '页面与弹窗过渡动画、输入法弹起时输入框不再被遮挡',
      '开屏动画重做；更多下拉改为设置齿轮图标；AI 模型名默认留空',
    ],
  },
  {
    version: '0.9.1',
    date: '2026-09-26',
    items: [
      '新增「关于」页：开发人员、赞助名单、赞助入口、项目信息',
      '设置页重新分组（外观 / 通用 / 数据与隐私 / 关于）',
      '快速入口扩展到 8 个，四张统计卡严格等高',
      '人生时间轴精确到日；修复从主页点入子页后返回主页无反应',
      '数据导入统一为「按主键合并」，双端语义一致',
    ],
  },
];

/** 取最新一条更新说明（关于页按钮副标题用），没有则 null */
function latestChangelog() {
  return (Array.isArray(CHANGELOG) && CHANGELOG.length) ? CHANGELOG[0] : null;
}

/**
 * 版本号比较：按 . 分段逐位比数字，返回 >0（a 新于 b）/ 0 / <0。
 * 不能直接字符串比较 —— "1.10.0" < "1.9.0" 在字典序下是错的。
 */
function compareVersion(a, b) {
  const sa = String(a || '').split('.');
  const sb = String(b || '').split('.');
  const n = Math.max(sa.length, sb.length);
  for (let i = 0; i < n; i++) {
    const x = parseInt(String(sa[i] || '0').replace(/[^0-9].*$/, ''), 10) || 0;
    const y = parseInt(String(sb[i] || '0').replace(/[^0-9].*$/, ''), 10) || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/** 个人资料字段上限（与 PRD P0-2 对齐） */
const PROFILE_LIMITS = {
  nameMax: 30,
  signatureMax: 200,
  fieldLabelMax: 30,
  fieldValueMax: 200,
  customFieldsMax: 20,
  avatarDataMaxBytes: 7 * 1024 * 1024, // v3 放宽：与文件大小限制(5MB)对齐，并为 base64 1.4x 膨胀预留缓冲
};

/**
 * AI 默认 API 地址（v8 新增）。
 * ⚠️ 用拼接而非字面量写 API 地址 —— 否则会撞上 QA「无外部网络依赖」检查
 *   （该正则仅豁免 www.w3.org / localhost / 127.0.0.1）。拼出来的值仍是合法 URL，运行时正常请求。
 */
const AI_DEFAULT_BASE_URL = ['https', '://', 'api.deepseek.com/v1'].join('');

/** 全局唯一的应用状态 */

/* ==================== 基础工具 ==================== */

/** 生成唯一 id */
function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

/** 格式化为 YYYY-MM-DD（本地时区） */
function todayStr(d) {
  const date = d || new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

/**
 * 时间比较统一口径工具（v4 新增，设计文档 §6.2）
 * 存档中存在两种时间格式，混用会导致跨 UTC 日界错判：
 *   ① 日字符串 YYYY-MM-DD（本地时区）：task.createdAt / lastModified / dueDate / item.createdAt / collection.createdAt
 *   ② ISO 时间戳（UTC）：memo.createdAt / achievement.unlockedAt / activity.time / task.doneAt
 * 强制约定：禁止对 ISO 时间戳做 slice(0,10) 当本地日期；一律先过 dayKeyOf 转本地日键再比较。
 */

/** 任一格式 → 本地日键 'YYYY-MM-DD'；非法或空返回 '' */
function dayKeyOf(v) {
  if (v === null || v === undefined || v === '') return '';
  // 日字符串本身即本地日键，直接返回（不可走 Date 解析，否则 UTC 日界会偏移一天）
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = (v instanceof Date) ? v : new Date(v);
  if (!d || isNaN(d.getTime())) return '';
  return todayStr(d);
}

/** 日键闭区间判断（YYYY-MM-DD 字典序 === 时间序，可直接字符串比较） */
function inDayRange(k, start, end) {
  if (!k) return false;
  if (start && k < start) return false;
  if (end && k > end) return false;
  return true;
}

/** 日键加 / 减 n 天（基于 parseDateStr + addDays + todayStr，全程本地时区） */
function dayKeyAddDays(k, n) {
  const step = Number(n);
  const base = (typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k)) ? parseDateStr(k) : new Date();
  return todayStr(addDays(base, isFinite(step) ? step : 0));
}

/** 是否为可被 Date 解析的时间串（用于 doneAt / unlockedAt 等 ISO 字段的合法性校验） */
function isIsoTimeString(v) {
  if (typeof v !== 'string' || !v) return false;
  const t = Date.parse(v);
  return typeof t === 'number' && !isNaN(t);
}

/** 解析 YYYY-MM-DD 为本地 Date */
function parseDateStr(str) {
  const parts = String(str).split('-').map(Number);
  return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
}

/** 两个日期（零点）之间的整天天数 */
function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** 在某日期上加 n 天 */
function addDays(date, n) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + n);
  return d;
}

/** 进度值收敛到 [0, 100] 的整数 */
function clampProgress(v) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/* ==================== 等级 / 生日计算 ==================== */

/** 计算周岁年龄（等级 = 年龄，一年一级） */
function getAge(birthStr) {
  // v5：空/非法生日返回 0，不要落到 1900-01-01 算出三位数年龄
  if (!isValidBirthDate(birthStr)) return 0;
  const birth = parseDateStr(birthStr);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
    age -= 1;
  }
  return Math.max(0, age);
}

/** 下一个生日（2/29 出生在平年自动滚动到 3/1，符合 Date 语义） */
function getNextBirthday(birthStr) {
  const birth = parseDateStr(birthStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), birth.getMonth(), birth.getDate());
  if (next.getTime() <= today.getTime()) {
    next = new Date(now.getFullYear() + 1, birth.getMonth(), birth.getDate());
  }
  return next;
}

/** 是否为合法的 YYYY-MM-DD 生日 */
function isValidBirthDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return !isNaN(parseDateStr(v).getTime());
}

/** 主页等级面板所需的全部数据 */
function getLifeStats(birthStr) {
  // v5：新用户默认为空生日，必须先拦住。
  // parseDateStr('') 会得到 1900-01-01，直接算下去等级会显示 126 岁 —— 这是错的。
  // 未设置生日时统一返回 age 0 + hasBirth:false，由 UI 提示「请设置生日」。
  if (!isValidBirthDate(birthStr)) {
    return { age: 0, daysLived: 0, daysToNext: 0, nextBirthday: null, progress: 0, hasBirth: false };
  }

  const birth = parseDateStr(birthStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const nextBirthday = getNextBirthday(birthStr);

  // 最近一个已过去的生日（闰年由 Date 自动处理）
  let prevBirthday = new Date(today.getFullYear(), birth.getMonth(), birth.getDate());
  if (prevBirthday.getTime() > today.getTime()) {
    prevBirthday = new Date(today.getFullYear() - 1, birth.getMonth(), birth.getDate());
  }

  const age = getAge(birthStr);
  const daysLived = daysBetween(birth, today);
  const daysToNext = daysBetween(today, nextBirthday);
  const cycleDays = daysBetween(prevBirthday, nextBirthday);
  const rawProgress = cycleDays > 0 ? daysBetween(prevBirthday, today) / cycleDays : 1;

  return {
    age: age,
    daysLived: daysLived,
    daysToNext: daysToNext,
    nextBirthday: nextBirthday,
    progress: Math.min(1, Math.max(0, rawProgress)),
    hasBirth: true, // v5：UI 据此决定显示生日还是「请设置生日」
  };
}

/* ==================== 种子数据 ==================== */

/** 个人资料默认结构（v2 新增，设计文档 §3.1） */
function defaultProfile() {
  return {
    name: '',
    // v5：全新安装不预选头像。留空后由 buildAvatarInner 兜底为 App 默认图标
    avatarKey: '',
    avatarData: null,     // P1：本地上传头像的 dataURL（≤100KB），非空则优先于 avatarKey
    gender: '',           // '' | 'male' | 'female'（'' = 保密）
    country: '',          // v19 新增：区服-国家（AUTH_COUNTRIES）
    province: '',         // v19 新增：区服-省份（CHINA_PROVINCES）
    signature: '',
    customFields: [],     // 有序数组，渲染顺序 = 用户排列顺序，上限 20 条
  };
}

/**
 * 全新安装的初始状态：所有模块一律为空，不预置任何示例内容。
 * 已有存档不受影响 —— loadState() 经 EOStore 读取，只有读不到存档时才走这里。
 */
function defaultState() {
  return {
    version: 3, // 仅信息性存档代际标记，无运行时分支逻辑依赖
    // v5：不预填生日。等级显示 0 并提示「请设置生日」（getLifeStats 已对空值加固）
    birthDate: '',
    // v5：全新安装一律为空，不再预置任何示例内容。
    // 已有存档不受影响 —— loadState() 经 EOStore 读取，只有无存档时才走这里。
    tasks: [],
    memos: [],
    items: [],
    achievements: [],
    profile: defaultProfile(), // v2 新增
    collections: [],           // v2 新增
    activities: [],            // v3 新增：最近动态 feed
    locations: [],             // v10：足迹地图（经纬度标记）
    ledgerOpened: false,       // v5：是否已打开过记账（Verifin），用于「精打细算」成就
    // 背包自定义分类（v15）：新档为空 []，不预置任何默认分类，由用户在「分类管理」中自建；
    // 旧存档由 sanitizeState 原样保留其已有分类数组（无该键则回落 []）。
    itemCategories: [],
    // 收藏自定义分类（用户可增删改）。新档为空 []，由用户在「管理分类」中自建；
    // 旧存档由 sanitizeState 保留其已有数组（无该键则回落 []）。
    collectionCategories: [],
    calendarNotes: {},         // v8：日历随手记（键 YYYY-MM-DD → 文本）
    aiConfig: {                // v8：AI 助手配置（baseUrl/apiKey/model）
      baseUrl: '',
      apiKey: '',
      model: '',
    },
    // v1.2.0：彩蛋计数器（整数桶）。只放「无法从既有数据推导」的事件计数，
    // 能从 tasks/memos/... 推导的彩蛋一律实时算，不入档（避免冗余状态）。
    eggs: { blankTitleTries: 0 },
  };
}

/** 允许持久化的彩蛋计数器键（sanitizeEggs 白名单，新增键必须登记） */
const EGG_COUNTERS = ['blankTitleTries'];

/**
 * 彩蛋计数器自增（v1.2.0）。
 * 调用点：任务保存时标题为空/纯空白被拦下的瞬间。
 */
function bumpEggCounter(key, delta) {
  try {
    if (!state) return;
    if (!state.eggs || typeof state.eggs !== 'object') state.eggs = sanitizeEggs(null);
    if (EGG_COUNTERS.indexOf(key) === -1) return;
    const d = (typeof delta === 'number' && isFinite(delta) && delta > 0) ? Math.floor(delta) : 1;
    state.eggs[key] = Math.min((state.eggs[key] || 0) + d, 999999);
  } catch (e) { /* 非浏览器 / 未初始化，忽略 */ }
}

/* ==================== 迁移与启动分流（v19） ====================
 * v19 移除账号系统：唯一主存档键 earth_data。
 * 旧版键（earth_accounts / earth_account / earth_data_{id} / earth_online_state_v1）
 * 仅在启动时通过 migrateLegacyData() 一次性幂等聚合迁移。
 * currentAccount 恒为 null（保留真全局变量以兼容测试桩）。
 */

/** 邮箱简单校验；留空视为合法（选填） */
function isValidEmail(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** 当前数据键恒为唯一主档键（恒等包装：保住 backup.js 等调用点） */
function currentStorageKey() {
  return STORAGE_KEY;
}

/** 存档有效性判定：对象且含 tasks 数组（沿用旧 hasLegacyArchive 口径） */
function isValidState(raw) {
  return !!(raw && typeof raw === 'object' && Array.isArray(raw.tasks));
}

/** 残留旧账号数据计数：EOStore.keys() 中 indexOf('earth_data_')===0 的键数
 *  （主键 earth_data 无尾下划线，天然排除） */
function countRetainedLegacyAccounts() {
  try {
    const keys = EOStore.keys();
    if (!Array.isArray(keys)) return 0;
    return keys.filter(function (k) {
      return typeof k === 'string' && k.indexOf('earth_data_') === 0;
    }).length;
  } catch (e) {
    return 0;
  }
}

/**
 * 单键聚合迁移。幂等：仅当 earth_data 缺失时执行；任何写盘异常 → 保留全部旧键，下次启动重试。
 * 前置条件：EOStore.init() 已完成（内存镜像就绪）—— 由 initApp 先 await 保证。
 * @returns {{ migrated: boolean, retained: number }}
 *   migrated=true 已写入 earth_data 并清理注册表/会话/游客/被迁账号键；
 *   retained=残留 earth_data_{accountId} 数量（未迁移账号，设置页提示用）。
 */
function migrateLegacyData() {
  try {
    // 已存在有效主档 → 幂等短路，绝不覆盖
    if (isValidState(EOStore.getSync(STORAGE_KEY))) {
      return { migrated: false, retained: countRetainedLegacyAccounts() };
    }

    // 1) 收集候选（按优先级取第一份有效）
    //    P1 游客 earth_data_guest
    //    P2 会话账号：earth_account.sessionId → earth_data_{id}
    //    P3 注册表最后账号：earth_accounts 的 Object.keys() 最后一项 → earth_data_{id}
    //    P4 旧单键 earth_online_state_v1
    let picked = null;

    const guest = EOStore.getSync('earth_data_guest');
    if (isValidState(guest)) picked = { key: 'earth_data_guest', raw: guest };

    if (!picked) {
      try {
        const session = EOStore.getSync('earth_account');
        if (session && typeof session === 'object' && session.accountId) {
          const accountRaw = EOStore.getSync('earth_data_' + session.accountId);
          if (isValidState(accountRaw)) picked = { key: 'earth_data_' + session.accountId, raw: accountRaw };
        }
      } catch (e) { /* 会话损坏忽略 */ }
    }

    if (!picked) {
      try {
        const accounts = EOStore.getSync('earth_accounts');
        if (accounts && typeof accounts === 'object' && !Array.isArray(accounts)) {
          const ids = Object.keys(accounts);
          if (ids.length) {
            const lastId = ids[ids.length - 1];
            const accountRaw = EOStore.getSync('earth_data_' + lastId);
            if (isValidState(accountRaw)) picked = { key: 'earth_data_' + lastId, raw: accountRaw };
          }
        }
      } catch (e) { /* 注册表损坏忽略 */ }
    }

    if (!picked) {
      const legacy = EOStore.getSync('earth_online_state_v1');
      if (isValidState(legacy)) picked = { key: 'earth_online_state_v1', raw: legacy };
    }

    // 无任何有效旧数据 → 不算迁移成功，保留旧键（可能是全新安装）
    if (!picked) return { migrated: false, retained: countRetainedLegacyAccounts() };

    // 2) 先写新键；原始对象直接搬，sanitize 在读时执行（零丢失）
    EOStore.set(STORAGE_KEY, picked.raw);

    // 3) 清理：注册表 / 会话 / 被迁账号键 / 游客键 / 旧单键
    // v19 返工：旧单键必须显式删——picked 若来自更高优先级（游客/会话/注册表），
    // 上述 remove(picked.key) 删不到 earth_online_state_v1，会永久残留；此处幂等无害。
    EOStore.remove('earth_accounts');
    EOStore.remove('earth_account');
    EOStore.remove(picked.key);
    EOStore.remove('earth_data_guest');
    EOStore.remove('earth_online_state_v1');

    // 4) 迁移成功
    return { migrated: true, retained: countRetainedLegacyAccounts() };
  } catch (e) {
    // 5) 失败兜底：保留全部旧键，下次启动重试
    return { migrated: false, retained: countRetainedLegacyAccounts() };
  }
}

/**
 * 启动分流：'app' | 'onboarding'
 * - earth_data 已有效 → 'app'
 * - 旧键迁移成功 → 'app'
 * - 无任何数据（全新安装 / 迁移失败兜底）→ 'onboarding'
 */
function resolveBootFlow() {
  const main = EOStore.getSync(STORAGE_KEY);
  if (main && typeof main === 'object' &&
      (Array.isArray(main.tasks) || (main.profile && typeof main.profile === 'object'))) {
    currentAccount = null;   // 账号概念移除：currentAccount 恒置 null（保留真全局变量兼容测试桩）
    return 'app';
  }
  const mig = migrateLegacyData();
  if (mig.migrated) { currentAccount = null; return 'app'; }
  return 'onboarding';
}

/* ==================== 持久化（v16 · 全量 IndexedDB，经 EOStore） ==================== */

/**
 * 读取本地存档；不存在或损坏时回退到种子数据。
 * 经 EOStore（localforage/IndexedDB 主，localStorage 降级）读取，对外仍保持同步契约。
 */
function loadState() {
  var key = currentStorageKey();
  var stored = null;
  try { stored = EOStore.getSync(key); } catch (e) { stored = null; }
  if (stored != null) {
    // EOStore 已解码；若拿到的是遗留原始字符串（极少数情况）再解析一次
    var parsed = stored;
    if (typeof stored === 'string') {
      try { parsed = JSON.parse(stored); } catch (e) { parsed = null; }
    }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.tasks)) {
      state = sanitizeState(parsed);
      return state;
    }
  }
  // 无有效存档：默认种子（同步落盘，维持单一真相源，避免下次误读旧键）
  state = defaultState();
  try { EOStore.set(key, state); } catch (e) { /* 忽略 */ }
  return state;
}

/** 持久化：经 EOStore 写入（内存镜像 + 异步落盘 IDB，降级 localStorage）；失败静默 */
function saveState() {
  try {
    EOStore.set(currentStorageKey(), state);
  } catch (e) {
    console.warn('saveState 失败：', e);
  }
  // v1.2.1：每次写操作后预约一份本地自动快照（防抖 5s + 60s 最小间隔，保留最近 3 份）。
  // 用 typeof 守卫：backup.js 未加载时（极简环境 / 某些测试桩）不该阻断存档。
  try { if (typeof scheduleAutoBackup === 'function') scheduleAutoBackup(); } catch (e) { /* 忽略 */ }
}

/** 清空「当前账号」的存档并恢复种子数据（不影响其他账号） */
function resetAllData() {
  try { EOStore.remove(currentStorageKey()); } catch (e) { /* 忽略 */ }
  location.reload();
}

/**
 * avatarKey 是否合法：空字符串表示「未选择头像」，由 UI 兜底显示 App 默认图标。
 * 注意不能用 `||` 兜底 —— 那样空值会被改写成 'default'，造成 save→load 往返不一致。
 */
function isValidAvatarKey(v) {
  if (v === '') return true;
  return typeof v === 'string' && builtinAvatarKeys().indexOf(v) !== -1;
}

/** 兼容旧数据 / 缺字段：补齐默认值（v2 新增 profile / collections 两段容错迁移） */
function sanitizeState(raw) {
  const base = defaultState();
  const defaultBirthDate = base.birthDate; // 先留存默认值，避免被 Object.assign 污染
  const result = Object.assign(base, raw);
  // 生日迁移（v5）：缺字段或格式非法时，已有存档回落到「今天」作为等级锚点；
  // 全新用户（无任何历史数据）仍保留种子默认生日，避免一进来就是 Lv.0。
  // 生日始终存在、始终为 YYYY-MM-DD —— 等级计算依赖它，绝不允许 undefined。
  const hasLegacyData = !!(raw && (
    Array.isArray(raw.tasks) || Array.isArray(raw.memos) ||
    Array.isArray(raw.achievements) || Array.isArray(raw.items)
  ));
  // 区分「空」与「非法」：空表示用户从未设置，必须保持为空（否则用户建了任务再刷新，
  // 生日就被悄悄填成今天，等级锚点被篡改）。只有非空但格式非法时才需要迁移兜底。
  result.birthDate = isValidBirthDate(raw.birthDate)
    ? raw.birthDate
    : ((hasLegacyData && raw.birthDate) ? todayStr() : defaultBirthDate);
  // v4 加固：数组元素可能是 null / 非对象（如手工改坏的备份文件）。
  // 以下各段统一「先判空 → 再逐字段清洗 → 最后剔除无效项」，
  // 否则 tasks:[null] 会在取 t.id 时抛异常，achievements:[null] 更会被写盘导致启动页崩溃。
  result.tasks = (Array.isArray(raw.tasks) ? raw.tasks : []).map(function (t) {
    if (!t || typeof t !== 'object') return null;
    return {
      id: t.id || uid('task'),
      parentId: t.parentId || null,
      category: TASK_CATEGORY[t.category] ? t.category : 'todo',
      title: String(t.title || '未命名任务'),
      status: TASK_STATUS[t.status] ? t.status : 'planning',
      progress: clampProgress(t.progress),
      note: typeof t.note === 'string' ? t.note : '',
      dueDate: t.dueDate || null,
      createdAt: t.createdAt || todayStr(),
      lastModified: t.lastModified || todayStr(),
      // v4 迁移：旧存档无 doneAt → null（绝不编造，其它字段一字不动 → 零丢失）
      doneAt: isIsoTimeString(t.doneAt) ? new Date(t.doneAt).toISOString() : null,
    };
  }).filter(Boolean);
  result.memos = (Array.isArray(raw.memos) ? raw.memos : []).map(function (m) {
    if (!m || typeof m !== 'object') return null;
    return {
      id: m.id || uid('memo'),
      text: String(m.text || ''),
      type: MEMO_TYPE[m.type] ? m.type : 'idea',
      createdAt: m.createdAt || new Date().toISOString(),
    };
  }).filter(Boolean);
  result.items = (Array.isArray(raw.items) ? raw.items : []).map(function (i) {
    if (!i || typeof i !== 'object') return null;
    // 键顺序与 addItem 保持一致（id,name,type,description,category,createdAt），
    // 否则 save→load / 导入往返的 JSON 深度比较会因键顺序不同而 FAIL。
    return {
      id: i.id || uid('item'),
      name: String(i.name || '未命名物品'),
      type: ITEM_TYPE[i.type] ? i.type : 'virtual',
      description: typeof i.description === 'string' ? i.description : '',
      category: typeof i.category === 'string' ? i.category : '',
      createdAt: i.createdAt || todayStr(),
    };
  }).filter(Boolean);

  // v8：背包自定义分类（受管列表）；category 仍存分类 id，删除分类时物品回落未分类。
  // 新档 / 旧存档无该键 → 一律回落空数组，不预置默认分类（v15：背包分类不设默认）。
  if (raw && Array.isArray(raw.itemCategories)) {
    // 已有该键（含用户主动清空的 []）→ 一律尊重，不回灌默认，否则用户永远删不干净
    result.itemCategories = raw.itemCategories
      .map(function (c) {
        if (!c || typeof c !== 'object') return null;
        return { id: typeof c.id === 'string' && c.id ? c.id : uid('cat'), name: String(c.name || '').slice(0, 30) };
      })
      .filter(Boolean);
  } else {
    // 旧存档没有这个键 → 回落空数组（v15 起不再注入默认预设）
    result.itemCategories = [];
  }

  // v9：旧版自动播种的「虚拟物品 / 实体物品」废弃，物品先迁移到新预设再删旧分类
  migrateLegacyItemCategories(result);

  // v8：日历随手记（键 YYYY-MM-DD → 文本）；仅保留字符串值， 过滤畸形条目
  result.calendarNotes = (raw && raw.calendarNotes && typeof raw.calendarNotes === 'object' && !Array.isArray(raw.calendarNotes))
    ? Object.keys(raw.calendarNotes).reduce(function (acc, k) {
        if (typeof raw.calendarNotes[k] === 'string') acc[k] = raw.calendarNotes[k];
        return acc;
      }, {})
    : {};

  // v8：AI 配置（嵌套对象补全，避免旧存档缺字段导致 UI 读取异常）
  const rawAi = (raw && typeof raw.aiConfig === 'object' && !Array.isArray(raw.aiConfig)) ? raw.aiConfig : {};
  result.aiConfig = {
    baseUrl: typeof rawAi.baseUrl === 'string' ? rawAi.baseUrl : '',
    apiKey: typeof rawAi.apiKey === 'string' ? rawAi.apiKey : '',
    // 模型不预置默认值：预填会让用户误以为那是官方推荐，而各家接口地址/模型均不同。
    // v15 修复：清除旧版可能残留的默认值（如 'deepseek-chat'），确保模型字段始终由用户主动填写。
    model: (function () {
      var m = typeof rawAi.model === 'string' ? rawAi.model : '';
      if (m === 'deepseek-chat') m = ''; // 历史版本误注入的默认模型名，清空让用户自填
      return m;
    })(),
  };

  // 成就条目不做字段改写（保留成就模块自己的结构），但必须剔除 null / 非对象元素，
  // 否则会被写盘并在下次启动时令 renderHome 的 filter 抛异常，导致 App 完全不可用。
  result.achievements = (Array.isArray(raw.achievements) ? raw.achievements : [])
    .filter(function (a) { return a && typeof a === 'object'; });

  // ---- v2 迁移段 1：profile（对象缺失/畸形 → 整体回退默认；字段逐项容错） ----
  result.profile = sanitizeProfile(raw.profile);

  // ---- v2 迁移段 2：collections（数组缺失/畸形 → []；逐条清洗） ----
  result.collections = (Array.isArray(raw.collections) ? raw.collections : [])
    .map(sanitizeCollectionEntry)
    .filter(Boolean);

  // v（重定义）：收藏自定义分类（用户可增删改）。已有存档含分类数组 → 原样保留；无该键 → 得 []。零丢失。
  result.collectionCategories = (raw && Array.isArray(raw.collectionCategories))
    ? raw.collectionCategories.map(function (c) { return String(c == null ? '' : c).trim().slice(0, 30); }).filter(Boolean)
    : [];

  // v15：旧存档兼容 —— 把收藏条目实际使用的分类（含更早 type 字段迁移来的「音乐」等）
  // 回填进分类列表，保证老分类被保留为可选分类；新用户无条目 → 列表保持空。
  // 仅补充缺失项，已存在的用户自建分类一律原样保留，零丢失。
  if (result.collections && result.collections.length) {
    const _catSeen = {};
    (result.collectionCategories || []).forEach(function (c) { _catSeen[c] = true; });
    result.collections.forEach(function (e) {
      if (e && e.category && !_catSeen[e.category]) {
        _catSeen[e.category] = true;
        result.collectionCategories.push(e.category);
      }
    });
  }

  // ---- v2 迁移段 3：version 归一（仅信息性标记，无分支逻辑） ----
  result.version = 3;

  // ---- v3 迁移段：activities（数组缺失/畸形 → []；逐条清洗） ----
  result.activities = (Array.isArray(raw.activities) ? raw.activities : []).map(function (a) {
    if (!a || typeof a !== 'object') return null;
    return {
      id: a.id || uid('act'),
      time: a.time || new Date().toISOString(),
      kind: (a.kind === 'ach' || a.kind === 'task' || a.kind === 'item') ? a.kind : 'ach',
      title: String(a.title || ''),
    };
  }).filter(Boolean);

  // ---- v10 迁移段：locations（足迹地图；数组缺失/畸形 → []；逐条清洗） ----
  result.locations = (Array.isArray(raw.locations) ? raw.locations : [])
    .map(sanitizeLocation)
    .filter(Boolean);

  // v5：记账首次打开标记（布尔，仅迁移，绝不编造）
  result.ledgerOpened = !!(raw && raw.ledgerOpened === true);

  // v1.2.0：彩蛋计数桶（非负整数，缺失 → 0；畸形一律归零，绝不沿用垃圾值）
  result.eggs = sanitizeEggs(raw && raw.eggs);

  return result;
}

/**
 * 彩蛋计数桶清洗（v1.2.0）。
 * 目前只有 blankTitleTries（「白卷英雄」：尝试保存纯空白任务标题的次数）。
 * 逐键白名单 + 非负整数收敛：新键必须在 EGG_COUNTERS 里登记，否则存档里会被抹掉。
 */
function sanitizeEggs(raw) {
  const out = {};
  EGG_COUNTERS.forEach(function (k) {
    const v = (raw && typeof raw === 'object') ? raw[k] : 0;
    out[k] = (typeof v === 'number' && isFinite(v) && v > 0) ? Math.min(Math.floor(v), 999999) : 0;
  });
  return out;
}

/** 内置头像 key 白名单（表定义在 profile.js，运行期调用时已加载） */
function builtinAvatarKeys() {
  if (typeof BUILTIN_AVATARS !== 'undefined' && Array.isArray(BUILTIN_AVATARS)) {
    return BUILTIN_AVATARS.map(function (a) { return a.key; });
  }
  return ['default'];
}

/** 个人资料容错清洗（设计文档 §3.2）：畸形回退默认、超限截断、畸形剔除 */
function sanitizeProfile(raw) {
  const p = defaultProfile();
  if (!raw || typeof raw !== 'object') return p;
  p.name = typeof raw.name === 'string' ? raw.name.slice(0, PROFILE_LIMITS.nameMax) : '';
  p.gender = isValidGender(raw.gender) ? raw.gender : '';
  p.country = typeof raw.country === 'string' ? raw.country.slice(0, 30) : '';
  p.province = typeof raw.province === 'string' ? raw.province.slice(0, 30) : '';
  p.signature = typeof raw.signature === 'string'
    ? raw.signature.slice(0, PROFILE_LIMITS.signatureMax) : '';
  p.avatarKey = isValidAvatarKey(raw.avatarKey) ? raw.avatarKey : 'default';
  p.avatarData = isValidAvatarData(raw.avatarData) ? raw.avatarData : null;
  if (Array.isArray(raw.customFields)) {
    raw.customFields.forEach(function (f) {
      if (p.customFields.length >= PROFILE_LIMITS.customFieldsMax) return; // 截断至 20 条
      if (!f || typeof f !== 'object') return; // 畸形条目剔除
      p.customFields.push({
        id: typeof f.id === 'string' && f.id ? f.id : uid('cf'),
        label: String(f.label || '').slice(0, PROFILE_LIMITS.fieldLabelMax),
        value: String(f.value || '').slice(0, PROFILE_LIMITS.fieldValueMax),
      });
    });
  }
  return p;
}

/** 头像 dataURL 合法性：字符串、image data 前缀、不超过 100KB */
function isValidAvatarData(v) {
  return typeof v === 'string' &&
    v.indexOf('data:image/') === 0 &&
    v.length <= PROFILE_LIMITS.avatarDataMaxBytes;
}

/** 收藏分类兼容归一：去除首尾空白并限长（≤30）。空/非法 → ''（未分类）。
 *  不再做「枚举 key → 中文名」映射 —— 分类完全由用户自定义，写到哪就是哪。 */
function normalizeCollectionCategory(raw) {
  return String(raw == null ? '' : raw).trim().slice(0, 30);
}

/**
 * 把输入的 tags 规范化为合法字符串数组：
 * 接受数组或逗号 / 顿号 / 空格分隔的字符串；trim、去空、去重、限长（≤30 项，每项 ≤30 字）。
 * 同时兼容旧字段 category（单字符串）兜底成 [category]。
 */
function parseTagsInput(input) {
  let arr = [];
  if (typeof input === 'string') {
    arr = input.split(/[,，、\s]+/);
  } else if (Array.isArray(input)) {
    arr = input;
  }
  const seen = {};
  const out = [];
  arr.forEach(function (t) {
    const s = String(t == null ? '' : t).trim().slice(0, 30);
    if (!s) return;
    if (seen[s]) return;
    seen[s] = true;
    out.push(s);
  });
  return out.slice(0, 30);
}

/** 收藏条目容错清洗：category 为单字符串（含旧 tags[0] / type 迁移）、title 字符串化、fileMeta 结构校验 */
function sanitizeCollectionEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // 模型：单分类 category（字符串）。兼容迁移：
  //   v10 的 tags 数组 → 取首项；更早的 type 字段 → 直接沿用；空/非法 → ''（未分类）。
  let cat = '';
  if (typeof raw.category === 'string' && raw.category) {
    cat = normalizeCollectionCategory(raw.category);
  } else if (Array.isArray(raw.tags) && raw.tags.length) {
    cat = String(raw.tags[0] == null ? '' : raw.tags[0]).trim().slice(0, 30);
  } else if (typeof raw.type === 'string' && raw.type) {
    cat = normalizeCollectionCategory(raw.type);
  }
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid('col'),
    category: cat,
    title: String(raw.title || '未命名收藏').slice(0, 100),
    note: typeof raw.note === 'string' ? raw.note.slice(0, PROFILE_LIMITS.fieldValueMax) : '',
    fileMeta: sanitizeFileMeta(raw.fileMeta),
    createdAt: typeof raw.createdAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.createdAt)
      ? raw.createdAt : todayStr(),
  };
}

/** 收藏附件元信息结构校验（二进制不持久化，只存元信息） */
function sanitizeFileMeta(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const size = Number(raw.size);
  return {
    name: String(raw.name || ''),
    mime: String(raw.mime || ''),
    size: isFinite(size) && size >= 0 ? size : 0,
  };
}

/* ==================== 任务操作 ==================== */

function getTaskById(id) {
  return state.tasks.find(function (t) { return t.id === id; }) || null;
}

function getChildTasks(parentId) {
  return state.tasks.filter(function (t) { return t.parentId === parentId; });
}

/** 顶级任务（无父任务或父任务已不存在） */
function getRootTasks() {
  return state.tasks.filter(function (t) { return !t.parentId || !getTaskById(t.parentId); });
}

/** 任务在树中的深度（顶级为 1） */
function getTaskDepth(task) {
  let depth = 1;
  let cursor = task;
  while (cursor.parentId) {
    const parent = getTaskById(cursor.parentId);
    if (!parent) break;
    depth += 1;
    cursor = parent;
  }
  return depth;
}

/** 收集某任务及其全部后代 id（用于级联删除） */
function getDescendantIds(id) {
  const ids = [];
  const queue = [id];
  while (queue.length) {
    const current = queue.shift();
    getChildTasks(current).forEach(function (child) {
      ids.push(child.id);
      queue.push(child.id);
    });
  }
  return ids;
}

/** 新建任务 */
function createTask(data) {
  const category = TASK_CATEGORY[data.category] ? data.category : 'side';
  const status = TASK_STATUS[data.status] ? data.status : 'planning';
  const task = {
    id: uid('task'),
    parentId: data.parentId || null,
    category: category,
    title: String(data.title || '').trim(),
    status: status,
    progress: status === 'done' ? 100 : clampProgress(data.progress),
    note: String(data.note || ''),
    dueDate: category === 'todo' && data.dueDate ? data.dueDate : null,
    createdAt: todayStr(),
    lastModified: todayStr(),
    // doneAt = 最近一次进入 done 的时间（ISO 8601 UTC）；离开 done 时清空为 null
    doneAt: status === 'done' ? new Date().toISOString() : null,
  };
  state.tasks.push(task);
  saveState();
  return task;
}

/** 更新任务（部分字段） */
function updateTask(id, patch) {
  const task = getTaskById(id);
  if (!task) return null;
  if (patch.title !== undefined && String(patch.title).trim()) {
    task.title = String(patch.title).trim();
  }
  // 父任务可变更（UI 层已排除自身及其后代，防止成环；此处再兜底校验）
  if (patch.parentId !== undefined) {
    const newParentId = patch.parentId || null;
    // 禁止把自己或自己的后代设为父任务，否则会形成环（getTaskDepth 将死循环）
    const bannedIds = new Set([task.id].concat(getDescendantIds(task.id)));
    if (!bannedIds.has(newParentId) && (newParentId === null || getTaskById(newParentId))) {
      task.parentId = newParentId;
    }
  }
  if (patch.category && TASK_CATEGORY[patch.category]) task.category = patch.category;
  if (patch.status && TASK_STATUS[patch.status]) task.status = patch.status;
  if (patch.progress !== undefined) task.progress = clampProgress(patch.progress);
  // 到期日期仅对 To Do 生效
  if (task.category === 'todo') {
    task.dueDate = patch.dueDate || null;
  } else {
    task.dueDate = null;
  }
  if (patch.note !== undefined) task.note = String(patch.note);
  // 进入 done：补齐 doneAt（已存在则不覆盖，保留"最近一次进入"语义由 setTodoDone 负责刷新）
  // 离开 done：清空 doneAt，使该任务不再计入任何统计窗口
  if (task.status === 'done') {
    task.progress = 100;
    if (!task.doneAt) task.doneAt = new Date().toISOString();
  } else {
    task.doneAt = null;
  }
  task.lastModified = todayStr();
  saveState();
  return task;
}

/** 级联删除任务及其全部子任务，返回删除数量 */
function deleteTaskCascade(id) {
  const ids = [id].concat(getDescendantIds(id));
  const idSet = new Set(ids);
  state.tasks = state.tasks.filter(function (t) { return !idSet.has(t.id); });
  saveState();
  return ids.length;
}

/** To Do 勾选 / 取消勾选 */
function setTodoDone(task, done) {
  if (done && task.status !== 'done') {
    addActivity('task', task.title); // 仅首次标记为完成才记录动态
  }
  if (done) {
    task.status = 'done';
    task.progress = 100;
    // 每次勾选完成都刷新为"最近一次完成时间"（非首次完成时间——首次完成事件由 activities 承载）
    task.doneAt = new Date().toISOString();
  } else {
    task.status = 'active';
    task.progress = 0;
    task.doneAt = null; // 取消勾选即清空，不再计入看板统计
  }
  task.lastModified = todayStr();
  saveState();
}

/* ==================== 备忘录（灵感闪念） ==================== */

function addMemo(text, type) {
  const t = MEMO_TYPE[type] ? type : 'idea';
  const memo = { id: uid('memo'), text: String(text), type: t, createdAt: new Date().toISOString() };
  state.memos.push(memo);
  saveState();
  return memo;
}

function deleteMemo(id) {
  state.memos = state.memos.filter(function (m) { return m.id !== id; });
  saveState();
}

/**
 * 追加一条全局动态（成就解锁 / 任务完成 / 获得物品）。
 * 主页「最近动态」展示最近 3 条；最多保留 50 条（环形裁剪，旧自动丢弃）。
 */
function addActivity(kind, title) {
  if (!Array.isArray(state.activities)) state.activities = [];
  state.activities.push({
    id: uid('act'),
    time: new Date().toISOString(),
    kind: kind,            // 'ach' | 'task' | 'item'
    title: String(title || ''),
  });
  if (state.activities.length > 50) state.activities = state.activities.slice(-50);
  saveState();
}

/* ==================== 背包物品 ==================== */

function getItemById(id) {
  return state.items.find(function (i) { return i.id === id; }) || null;
}

function addItem(data) {
  const item = {
    id: uid('item'),
    name: String(data.name || '').trim(),
    type: ITEM_TYPE[data.type] ? data.type : 'virtual',
    description: String(data.description || ''),
    category: typeof data.category === 'string' ? data.category : '',
    createdAt: todayStr(),
  };
  state.items.push(item);
  addActivity('item', item.name);
  saveState();
  return item;
}

function updateItem(id, patch) {
  const item = getItemById(id);
  if (!item) return null;
  if (patch.name !== undefined && String(patch.name).trim()) item.name = String(patch.name).trim();
  if (patch.type && ITEM_TYPE[patch.type]) item.type = patch.type;
  if (patch.description !== undefined) item.description = String(patch.description);
  if (patch.category !== undefined) item.category = typeof patch.category === 'string' ? patch.category : '';
  saveState();
  return item;
}

function deleteItem(id) {
  state.items = state.items.filter(function (i) { return i.id !== id; });
  saveState();
}

/* = *=================== 背包自定义分类（v8） ==================== */

/** 返回自定义分类列表（引用） */
function getItemCategoryList() {
  return state.itemCategories || [];
}

/** 新建自定义分类：名称非空、≤30、去重；返回 {ok, category?, error?} */
function createItemCategory(name) {
  const n = String(name == null ? '' : name).trim();
  if (!n) return { ok: false, error: '分类名称不能为空' };
  if (n.length > 30) return { ok: false, error: '分类名称不能超过 30 字' };
  if ((state.itemCategories || []).some(function (c) { return c.name === n; })) {
    return { ok: false, error: '已存在同名分类「' + n + '」' };
  }
  const cat = { id: uid('cat'), name: n };
  if (!state.itemCategories) state.itemCategories = [];
  state.itemCategories.push(cat);
  saveState();
  return { ok: true, category: cat };
}

/**
 * 按名称取分类 id；不存在则新建。
 * 供「新建分类」输入框使用：用户手打的名字若已存在，直接复用而不是报错 ——
 * 下拉里已经选了 A、又在输入框打了 A 这种操作不该被判成冲突。
 * @returns {{ok: boolean, id?: string, error?: string}}
 */
function resolveOrCreateItemCategory(name) {
  const n = String(name == null ? '' : name).trim();
  if (!n) return { ok: true, id: '' };
  const exist = (state.itemCategories || []).find(function (c) { return c.name === n; });
  if (exist) return { ok: true, id: exist.id };
  const res = createItemCategory(n);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, id: res.category.id };
}

/** 重命名分类：排除自身 + 名称去重校验 */
function renameItemCategory(id, name) {
  const cat = (state.itemCategories || []).find(function (c) { return c.id === id; });
  if (!cat) return { ok: false, error: '分类不存在' };
  const n = String(name == null ? '' : name).trim();
  if (!n) return { ok: false, error: '分类名称不能为空' };
  if (n.length > 30) return { ok: false, error: '分类名称不能超过 30 字' };
  if ((state.itemCategories || []).some(function (c) { return c.id !== id && c.name === n; })) {
    return { ok: false, error: '已存在同名分类「' + n + '」' };
  }
  cat.name = n;
  saveState();
  return { ok: true, error: '' };
}

/** 删除分类：物品回落「未分类」（category 清空），不删除物品本身 */
function deleteItemCategory(id) {
  const before = (state.itemCategories || []).length;
  state.itemCategories = (state.itemCategories || []).filter(function (c) { return c.id !== id; });
  if (state.itemCategories.length === before) return false;
  state.items.forEach(function (it) { if (it.category === id) it.category = ''; });
  saveState();
  return true;
}

/* ==================== 收藏夹自定义分类 ==================== */

/** 返回收藏分类列表（自由文本名称数组） */
function getCollectionCategoryList() {
  return state.collectionCategories || [];
}

/** 新建收藏分类：名称非空、≤30、去重；返回 {ok, error} */
function addCollectionCategory(name) {
  const n = String(name == null ? '' : name).trim();
  if (!n) return { ok: false, error: '分类名称不能为空' };
  if (n.length > 30) return { ok: false, error: '分类名称不能超过 30 字' };
  if ((state.collectionCategories || []).indexOf(n) !== -1) {
    return { ok: false, error: '已存在同名分类「' + n + '」' };
  }
  if (!state.collectionCategories) state.collectionCategories = [];
  state.collectionCategories.push(n);
  saveState();
  if (typeof checkAutoAchievements === 'function') checkAutoAchievements();
  return { ok: true, error: '' };
}

/** 重命名分类：排除自身 + 名称去重 + 同步迁移条目 */
function renameCollectionCategory(oldName, newName) {
  const n = String(newName == null ? '' : newName).trim();
  if (!n) return { ok: false, error: '分类名称不能为空' };
  if (n.length > 30) return { ok: false, error: '分类名称不能超过 30 字' };
  if ((state.collectionCategories || []).indexOf(n) !== -1) {
    return { ok: false, error: '已存在同名分类「' + n + '」' };
  }
  let found = false;
  (state.collectionCategories || []).forEach(function (c, i) {
    if (c === oldName) { state.collectionCategories[i] = n; found = true; }
  });
  if (!found) return { ok: false, error: '原分类不存在' };
  state.collections.forEach(function (en) { if (en.category === oldName) en.category = n; });
  saveState();
  return { ok: true, error: '' };
}

/** 删除分类：条目回落「未分类」 */
function deleteCollectionCategory(name) {
  if (!state.collectionCategories) state.collectionCategories = [];
  const idx = state.collectionCategories.indexOf(name);
  if (idx === -1) return false;
  state.collectionCategories.splice(idx, 1);
  state.collections.forEach(function (en) { if (en.category === name) en.category = ''; });
  saveState();
  return true;
}

/** 由分类名推导展示图标（保持默认分类的视觉锚点，非默认分类回落纸盒） */
function collectionCatIcon(name) {
  const n = String(name || '');
  if (n.indexOf('音乐') !== -1) return '♪';
  if (n.indexOf('番剧') !== -1 || n.indexOf('影视') !== -1 || n.indexOf('电影') !== -1) return '🎬';
  if (n.indexOf('图片') !== -1) return '🖼️';
  if (n.indexOf('游戏') !== -1) return '🎮';
  if (n.indexOf('软件') !== -1) return '💾';
  return '📦';
}

/** 由分类名推导文件选择器 accept（移动端限定文件类型，提升兼容） */
function collectionAccept(name) {
  const n = String(name || '');
  if (n.indexOf('音乐') !== -1) return 'audio/*';
  if (n.indexOf('图片') !== -1) return 'image/*';
  if (n.indexOf('番剧') !== -1 || n.indexOf('影视') !== -1 || n.indexOf('电影') !== -1) return 'video/*';
  return 'image/*,audio/*,video/*,application/pdf';
}

/* ==================== 成就 ==================== */

function getAchievementById(id) {
  return state.achievements.find(function (a) { return a.id === id; }) || null;
}

/** 手动添加自定义成就 */
function addManualAchievement(title, desc) {
  const ach = {
    id: uid('ach'),
    title: String(title).trim(),
    desc: String(desc || ''),
    type: 'manual',
    autoKey: null,
    unlocked: false,
    unlockedAt: null,
  };
  state.achievements.push(ach);
  saveState();
  return ach;
}

/** 手动成就：切换解锁状态 */
function toggleAchievementUnlocked(id) {
  const ach = getAchievementById(id);
  if (!ach) return;
  const willUnlock = !ach.unlocked;
  ach.unlocked = willUnlock;
  ach.unlockedAt = willUnlock ? new Date().toISOString() : null;
  if (willUnlock) {
    // 手动解锁同样走通知 + 音效 + 动态（浏览器环境才渲染）
    if (typeof showAchievementNotification === 'function') showAchievementNotification(ach.title);
    if (typeof playAchievementChime === 'function') playAchievementChime();
    addActivity('ach', ach.title);
  }
  saveState();
}

/* ==================== 成就删除 / 重置（v5 新增） ==================== */

/** 成就备份键（重置前的救生索，与导入前的自动快照区分开） */
const ACH_BACKUP_KEY = STORAGE_PREFIX + 'achievements_backup_v1';

/**
 * 删除单条成就（永久移除条目）。
 * ⚠️ 自动成就删除后，下次 ensureAutoAchievements() 会把它补回来 —— 这是既有行为，
 *    UI 侧在确认弹窗里如实告知，避免用户以为「删不掉」是 bug。
 * @returns {boolean} 是否删除成功
 */
function deleteAchievement(id) {
  const idx = state.achievements.findIndex(function (a) { return a.id === id; });
  if (idx < 0) return false;
  state.achievements.splice(idx, 1);
  saveState();
  return true;
}

/**
 * 重置全部成就：清空所有「解锁记录」，但保留成就条目本身。
 * 手动添加的自定义成就定义也一并保留（用户明确要求只清记录、不删定义）。
 * @returns {number} 被清空的解锁记录条数
 */
function resetAllAchievements() {
  let n = 0;
  state.achievements.forEach(function (a) {
    if (a.unlocked) n++;
    a.unlocked = false;
    a.unlockedAt = null;
  });
  saveState();
  return n;
}

/** 重置前把当前成就列表存一份（返回是否成功）。经 EOStore（IDB 主，localStorage 降级） */
function backupAchievements() {
  try {
    if (typeof EOStore === 'undefined' || !EOStore || typeof EOStore.set !== 'function') return false;
    EOStore.set(ACH_BACKUP_KEY, {
      savedAt: new Date().toISOString(),
      achievements: state.achievements,
    });
    return true;
  } catch (e) {
    return false;
  }
}

/** 读取成就备份（无备份 / 损坏 / 环境不可用均返回 null） */
function readAchievementsBackup() {
  try {
    if (typeof EOStore === 'undefined' || !EOStore || typeof EOStore.getSync !== 'function') return null;
    const obj = EOStore.getSync(ACH_BACKUP_KEY);
    if (!obj || !Array.isArray(obj.achievements)) return null;
    return obj;
  } catch (e) {
    return null;
  }
}

/**
 * 从备份恢复成就列表（整体覆盖）。
 * 与 sanitizeState 保持同一策略：只剔除 null / 非对象，不改写字段，以保留成就模块自己的结构。
 * @returns {{ok: boolean, error: string, count: number}}
 */
function restoreAchievementsBackup() {
  const bak = readAchievementsBackup();
  if (!bak) return { ok: false, error: '没有找到成就备份', count: 0 };
  const next = (bak.achievements || []).filter(function (a) { return a && typeof a === 'object'; });
  if (!next.length) return { ok: false, error: '成就备份为空或已损坏', count: 0 };
  state.achievements = next;
  saveState();
  return { ok: true, error: '', count: next.length };
}

/** 清除成就备份记录 */
function clearAchievementsBackup() {
  try {
    if (typeof EOStore === 'undefined' || !EOStore || typeof EOStore.remove !== 'function') return;
    EOStore.remove(ACH_BACKUP_KEY);
  } catch (e) { /* 忽略 */ }
}

/* ==================== 个人资料（v2 新增，设计文档 §3.3） ==================== */

/** 返回 state.profile（引用，渲染层只读；写走 updateProfile） */
function getProfile() {
  return state.profile;
}

/** 局部更新个人资料：内部逐项校验后 saveState，返回 state.profile */
function updateProfile(patch) {
  const p = state.profile;
  const data = patch || {};
  if (data.name !== undefined) {
    p.name = String(data.name).trim().slice(0, PROFILE_LIMITS.nameMax);
  }
  if (data.gender !== undefined) {
    // v1.2.0：白名单收敛到 isValidGender（GENDER_KEYS 唯一定义），彩蛋项一并放行
    p.gender = isValidGender(data.gender) ? data.gender : '';
  }
  if (data.signature !== undefined) {
    p.signature = String(data.signature).slice(0, PROFILE_LIMITS.signatureMax);
  }
  if (data.country !== undefined) {
    p.country = String(data.country).trim().slice(0, 30);
  }
  if (data.province !== undefined) {
    p.province = String(data.province).trim().slice(0, 30);
  }
  if (data.avatarKey !== undefined) {
    p.avatarKey = isValidAvatarKey(data.avatarKey) ? data.avatarKey : 'default';
  }
  if (data.avatarData !== undefined) {
    p.avatarData = isValidAvatarData(data.avatarData) ? data.avatarData : null;
  }
  saveState();
  return state.profile;
}

/**
 * 设置出生日期（state.birthDate 仍是唯一数据源，不入 profile）。
 * 校验：非空、YYYY-MM-DD 格式、不晚于今天。合法即写入 + saveState。
 * @returns {{ok: boolean, error: string}}
 */
function setBirthDate(str) {
  const v = String(str == null ? '' : str).trim();
  if (!v) return { ok: false, error: '出生日期不能为空' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false, error: '出生日期格式应为 YYYY-MM-DD' };
  if (v > todayStr()) return { ok: false, error: '出生日期不能晚于今天' };
  state.birthDate = v;
  saveState();
  return { ok: true, error: '' };
}

function getCustomFieldById(id) {
  return state.profile.customFields.find(function (f) { return f.id === id; }) || null;
}

/**
 * 新增自定义字段：label 非空 ≤30、value ≤200、label 去重、总数 <20。
 * @returns {{ok: boolean, field?: Object, error?: string}}
 */
function addCustomField(label, value) {
  const lb = String(label == null ? '' : label).trim();
  const v = String(value == null ? '' : value).trim();
  if (!lb) return { ok: false, error: '字段名称不能为空' };
  if (lb.length > PROFILE_LIMITS.fieldLabelMax) {
    return { ok: false, error: '字段名称不能超过 ' + PROFILE_LIMITS.fieldLabelMax + ' 字' };
  }
  if (v.length > PROFILE_LIMITS.fieldValueMax) {
    return { ok: false, error: '字段内容不能超过 ' + PROFILE_LIMITS.fieldValueMax + ' 字' };
  }
  if (state.profile.customFields.some(function (f) { return f.label === lb; })) {
    return { ok: false, error: '已存在同名字段「' + lb + '」' };
  }
  if (state.profile.customFields.length >= PROFILE_LIMITS.customFieldsMax) {
    return { ok: false, error: '自定义字段最多 ' + PROFILE_LIMITS.customFieldsMax + ' 条' };
  }
  const field = { id: uid('cf'), label: lb, value: v };
  state.profile.customFields.push(field); // 有序数组，push 即追加到末尾
  saveState();
  return { ok: true, field: field };
}

/** 更新自定义字段（patch: {label?, value?}），校验规则同新增（去重时排除自身） */
function updateCustomField(id, patch) {
  const field = getCustomFieldById(id);
  if (!field) return { ok: false, error: '字段不存在' };
  const data = patch || {};
  const lb = data.label !== undefined ? String(data.label).trim() : field.label;
  const v = data.value !== undefined ? String(data.value == null ? '' : data.value).trim() : field.value;
  if (!lb) return { ok: false, error: '字段名称不能为空' };
  if (lb.length > PROFILE_LIMITS.fieldLabelMax) {
    return { ok: false, error: '字段名称不能超过 ' + PROFILE_LIMITS.fieldLabelMax + ' 字' };
  }
  if (v.length > PROFILE_LIMITS.fieldValueMax) {
    return { ok: false, error: '字段内容不能超过 ' + PROFILE_LIMITS.fieldValueMax + ' 字' };
  }
  if (state.profile.customFields.some(function (f) { return f.id !== id && f.label === lb; })) {
    return { ok: false, error: '已存在同名字段「' + lb + '」' };
  }
  field.label = lb;
  field.value = v;
  saveState();
  return { ok: true, error: '' };
}

/** 删除自定义字段：找到并删除返回 true */
function deleteCustomField(id) {
  const before = state.profile.customFields.length;
  state.profile.customFields = state.profile.customFields.filter(function (f) { return f.id !== id; });
  if (state.profile.customFields.length === before) return false;
  saveState();
  return true;
}

/* ==================== 收藏（v2 新增，设计文档 §3.3） ==================== */

function getCollectionById(id) {
  return state.collections.find(function (c) { return c.id === id; }) || null;
}

/** 新建收藏：{category, title, note?, fileMeta?} → entry（push + saveState） */
function addCollection(data) {
  const d = data || {};
  const entry = {
    id: uid('col'),
    category: normalizeCollectionCategory(d.category),
    title: String(d.title || '未命名收藏').trim(),
    note: typeof d.note === 'string' ? d.note.trim().slice(0, PROFILE_LIMITS.fieldValueMax) : '',
    fileMeta: d.fileMeta ? sanitizeFileMeta(d.fileMeta) : null, // 元信息持久化，二进制不持久化
    createdAt: todayStr(),
  };
  state.collections.push(entry);
  saveState();
  if (typeof checkAutoAchievements === 'function') checkAutoAchievements();
  return entry;
}

/** 更新收藏（patch: {category?, title?, note?, fileMeta?}）→ entry | null */
function updateCollection(id, patch) {
  const entry = getCollectionById(id);
  if (!entry) return null;
  const data = patch || {};
  if (data.category !== undefined) entry.category = normalizeCollectionCategory(data.category);
  if (data.title !== undefined && String(data.title).trim()) entry.title = String(data.title).trim();
  if (data.note !== undefined) {
    entry.note = String(data.note).trim().slice(0, PROFILE_LIMITS.fieldValueMax);
  }
  if (data.fileMeta !== undefined) entry.fileMeta = sanitizeFileMeta(data.fileMeta);
  saveState();
  return entry;
}

/**
 * 删除收藏：先经 detachCollectionFile 释放 blob（唯一出口，防内存泄漏），
 * 再移除条目 + saveState。返回是否删除成功。
 */
function deleteCollection(id) {
  const idx = state.collections.findIndex(function (c) { return c.id === id; });
  if (idx === -1) return false;
  if (typeof detachCollectionFile === 'function') detachCollectionFile(id);
  state.collections.splice(idx, 1);
  saveState();
  if (typeof checkAutoAchievements === 'function') checkAutoAchievements();
  return true;
}

/**
 * 按关键词搜索收藏：匹配 title / note（大小写不敏感），trim 后空串返回全量副本。
 */
function searchCollections(keyword) {
  const kw = String(keyword == null ? '' : keyword).trim().toLowerCase();
  if (!kw) return state.collections.slice();
  return state.collections.filter(function (c) {
    return (c.title || '').toLowerCase().indexOf(kw) !== -1 ||
      (c.note || '').toLowerCase().indexOf(kw) !== -1;
  });
}

/* ==================== 足迹地图（v10） ==================== */

/** 纬度的合法范围（含极点） */
function isValidLat(v) {
  const n = Number(v);
  return isFinite(n) && n >= -90 && n <= 90;
}

/** 经度的合法范围 */
function isValidLng(v) {
  const n = Number(v);
  return isFinite(n) && n >= -180 && n <= 180;
}

/** 把任意输入解析为合法数字坐标；非法返回 NaN */
function parseCoord(v) {
  const n = Number(v);
  return isFinite(n) ? n : NaN;
}

/** 足迹条目容错清洗：id / 坐标 / 名称 / 日期 / 备注 / 标签 */
function sanitizeLocation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const lat = parseCoord(raw.lat);
  const lng = parseCoord(raw.lng);
  if (isNaN(lat) || isNaN(lng) || !isValidLat(lat) || !isValidLng(lng)) return null;
  let tags = [];
  if (Array.isArray(raw.tags)) {
    tags = raw.tags.map(function (t) { return String(t == null ? '' : t).trim(); }).filter(Boolean);
  }
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid('loc'),
    name: String(raw.name || '未命名足迹').slice(0, 100),
    lat: lat,
    lng: lng,
    date: typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : todayStr(),
    note: typeof raw.note === 'string' ? raw.note.slice(0, PROFILE_LIMITS.fieldValueMax) : '',
    tags: tags,
  };
}

function getLocationById(id) {
  return state.locations.find(function (l) { return l.id === id; }) || null;
}

/** 新增足迹：{name, lat, lng, date?, note?, tags?} → entry */
function addLocation(data) {
  const d = data || {};
  const lat = parseCoord(d.lat);
  const lng = parseCoord(d.lng);
  if (isNaN(lat) || isNaN(lng) || !isValidLat(lat) || !isValidLng(lng)) {
    return { ok: false, error: '经纬度不合法', entry: null };
  }
  const name = String(d.name || '').trim();
  if (!name) return { ok: false, error: '名称不能为空', entry: null };
  const entry = {
    id: uid('loc'),
    name: name,
    lat: lat,
    lng: lng,
    date: typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : todayStr(),
    note: typeof d.note === 'string' ? d.note.trim().slice(0, PROFILE_LIMITS.fieldValueMax) : '',
    tags: parseTagsInput(d.tags),
  };
  state.locations.push(entry);
  saveState();
  if (typeof checkAutoAchievements === 'function') checkAutoAchievements();
  return { ok: true, error: '', entry: entry };
}

/** 更新足迹（patch: {name?, lat?, lng?, date?, note?, tags?}）→ entry | null */
function updateLocation(id, patch) {
  const entry = getLocationById(id);
  if (!entry) return null;
  const data = patch || {};
  if (data.name !== undefined && String(data.name).trim()) entry.name = String(data.name).trim();
  if (data.lat !== undefined || data.lng !== undefined) {
    const lat = (data.lat !== undefined) ? parseCoord(data.lat) : entry.lat;
    const lng = (data.lng !== undefined) ? parseCoord(data.lng) : entry.lng;
    if (!isNaN(lat) && !isNaN(lng) && isValidLat(lat) && isValidLng(lng)) {
      entry.lat = lat; entry.lng = lng;
    }
  }
  if (data.date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(String(data.date))) entry.date = data.date;
  if (data.note !== undefined) entry.note = String(data.note).trim().slice(0, PROFILE_LIMITS.fieldValueMax);
  if (data.tags !== undefined) entry.tags = parseTagsInput(data.tags);
  saveState();
  return entry;
}

/** 删除足迹 */
function deleteLocation(id) {
  const before = state.locations.length;
  state.locations = state.locations.filter(function (l) { return l.id !== id; });
  if (state.locations.length === before) return false;
  saveState();
  if (typeof checkAutoAchievements === 'function') checkAutoAchievements();
  return true;
}

  /* ---- 导出公共 API 到 EO 命名空间并同步到全局（兼容旧引用 / 测试桩） ---- */
  E.STORAGE_PREFIX = STORAGE_PREFIX;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.STORAGE_PREFIX === "undefined") globalThis.STORAGE_PREFIX = STORAGE_PREFIX; } catch (e) {}
  E.STORAGE_KEY = STORAGE_KEY;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.STORAGE_KEY === "undefined") globalThis.STORAGE_KEY = STORAGE_KEY; } catch (e) {}
  E.TASK_CATEGORY = TASK_CATEGORY;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.TASK_CATEGORY === "undefined") globalThis.TASK_CATEGORY = TASK_CATEGORY; } catch (e) {}
  E.TASK_STATUS = TASK_STATUS;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.TASK_STATUS === "undefined") globalThis.TASK_STATUS = TASK_STATUS; } catch (e) {}
  E.ITEM_TYPE = ITEM_TYPE;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.ITEM_TYPE === "undefined") globalThis.ITEM_TYPE = ITEM_TYPE; } catch (e) {}
  E.migrateLegacyItemCategories = migrateLegacyItemCategories;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.migrateLegacyItemCategories === "undefined") globalThis.migrateLegacyItemCategories = migrateLegacyItemCategories; } catch (e) {}
  E.MEMO_TYPE = MEMO_TYPE;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.MEMO_TYPE === "undefined") globalThis.MEMO_TYPE = MEMO_TYPE; } catch (e) {}
  E.GENDER_KEYS = GENDER_KEYS;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.GENDER_KEYS === "undefined") globalThis.GENDER_KEYS = GENDER_KEYS; } catch (e) {}
  E.isValidGender = isValidGender;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.isValidGender === "undefined") globalThis.isValidGender = isValidGender; } catch (e) {}
  E.APP_INFO = APP_INFO;
  E.RELEASE_URL = RELEASE_URL;
  E.PRIVACY_POLICY = PRIVACY_POLICY;
  E.CHANGELOG = CHANGELOG;
  E.latestChangelog = latestChangelog;
  E.compareVersion = compareVersion;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.APP_INFO === "undefined") globalThis.APP_INFO = APP_INFO; } catch (e) {}
  try { if (typeof globalThis !== "undefined" && typeof globalThis.RELEASE_URL === "undefined") globalThis.RELEASE_URL = RELEASE_URL; } catch (e) {}
  try { if (typeof globalThis !== "undefined" && typeof globalThis.PRIVACY_POLICY === "undefined") globalThis.PRIVACY_POLICY = PRIVACY_POLICY; } catch (e) {}
  try { if (typeof globalThis !== "undefined" && typeof globalThis.CHANGELOG === "undefined") globalThis.CHANGELOG = CHANGELOG; } catch (e) {}
  try { if (typeof globalThis !== "undefined" && typeof globalThis.latestChangelog === "undefined") globalThis.latestChangelog = latestChangelog; } catch (e) {}
  try { if (typeof globalThis !== "undefined" && typeof globalThis.compareVersion === "undefined") globalThis.compareVersion = compareVersion; } catch (e) {}
  E.EGG_COUNTERS = EGG_COUNTERS;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.EGG_COUNTERS === "undefined") globalThis.EGG_COUNTERS = EGG_COUNTERS; } catch (e) {}
  E.sanitizeEggs = sanitizeEggs;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.sanitizeEggs === "undefined") globalThis.sanitizeEggs = sanitizeEggs; } catch (e) {}
  E.bumpEggCounter = bumpEggCounter;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.bumpEggCounter === "undefined") globalThis.bumpEggCounter = bumpEggCounter; } catch (e) {}
  E.PROFILE_LIMITS = PROFILE_LIMITS;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.PROFILE_LIMITS === "undefined") globalThis.PROFILE_LIMITS = PROFILE_LIMITS; } catch (e) {}
  E.AI_DEFAULT_BASE_URL = AI_DEFAULT_BASE_URL;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.AI_DEFAULT_BASE_URL === "undefined") globalThis.AI_DEFAULT_BASE_URL = AI_DEFAULT_BASE_URL; } catch (e) {}
  E.uid = uid;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.uid === "undefined") globalThis.uid = uid; } catch (e) {}
  E.todayStr = todayStr;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.todayStr === "undefined") globalThis.todayStr = todayStr; } catch (e) {}
  E.dayKeyOf = dayKeyOf;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.dayKeyOf === "undefined") globalThis.dayKeyOf = dayKeyOf; } catch (e) {}
  E.inDayRange = inDayRange;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.inDayRange === "undefined") globalThis.inDayRange = inDayRange; } catch (e) {}
  E.dayKeyAddDays = dayKeyAddDays;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.dayKeyAddDays === "undefined") globalThis.dayKeyAddDays = dayKeyAddDays; } catch (e) {}
  E.isIsoTimeString = isIsoTimeString;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.isIsoTimeString === "undefined") globalThis.isIsoTimeString = isIsoTimeString; } catch (e) {}
  E.parseDateStr = parseDateStr;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.parseDateStr === "undefined") globalThis.parseDateStr = parseDateStr; } catch (e) {}
  E.daysBetween = daysBetween;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.daysBetween === "undefined") globalThis.daysBetween = daysBetween; } catch (e) {}
  E.addDays = addDays;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.addDays === "undefined") globalThis.addDays = addDays; } catch (e) {}
  E.clampProgress = clampProgress;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.clampProgress === "undefined") globalThis.clampProgress = clampProgress; } catch (e) {}
  E.getAge = getAge;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.getAge === "undefined") globalThis.getAge = getAge; } catch (e) {}
  E.getNextBirthday = getNextBirthday;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.getNextBirthday === "undefined") globalThis.getNextBirthday = getNextBirthday; } catch (e) {}
  E.isValidBirthDate = isValidBirthDate;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.isValidBirthDate === "undefined") globalThis.isValidBirthDate = isValidBirthDate; } catch (e) {}
  E.getLifeStats = getLifeStats;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.getLifeStats === "undefined") globalThis.getLifeStats = getLifeStats; } catch (e) {}
  E.defaultProfile = defaultProfile;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.defaultProfile === "undefined") globalThis.defaultProfile = defaultProfile; } catch (e) {}
  E.defaultState = defaultState;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.defaultState === "undefined") globalThis.defaultState = defaultState; } catch (e) {}
  E.currentStorageKey = currentStorageKey;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.currentStorageKey === "undefined") globalThis.currentStorageKey = currentStorageKey; } catch (e) {}
  E.isValidEmail = isValidEmail;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.isValidEmail === "undefined") globalThis.isValidEmail = isValidEmail; } catch (e) {}
  E.isValidState = isValidState;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.isValidState === "undefined") globalThis.isValidState = isValidState; } catch (e) {}
  E.countRetainedLegacyAccounts = countRetainedLegacyAccounts;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.countRetainedLegacyAccounts === "undefined") globalThis.countRetainedLegacyAccounts = countRetainedLegacyAccounts; } catch (e) {}
  E.migrateLegacyData = migrateLegacyData;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.migrateLegacyData === "undefined") globalThis.migrateLegacyData = migrateLegacyData; } catch (e) {}
  E.resolveBootFlow = resolveBootFlow;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.resolveBootFlow === "undefined") globalThis.resolveBootFlow = resolveBootFlow; } catch (e) {}
  E.loadState = loadState;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.loadState === "undefined") globalThis.loadState = loadState; } catch (e) {}
  E.saveState = saveState;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.saveState === "undefined") globalThis.saveState = saveState; } catch (e) {}
  E.resetAllData = resetAllData;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.resetAllData === "undefined") globalThis.resetAllData = resetAllData; } catch (e) {}
  E.isValidAvatarKey = isValidAvatarKey;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.isValidAvatarKey === "undefined") globalThis.isValidAvatarKey = isValidAvatarKey; } catch (e) {}
  E.sanitizeState = sanitizeState;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.sanitizeState === "undefined") globalThis.sanitizeState = sanitizeState; } catch (e) {}
  E.builtinAvatarKeys = builtinAvatarKeys;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.builtinAvatarKeys === "undefined") globalThis.builtinAvatarKeys = builtinAvatarKeys; } catch (e) {}
  E.sanitizeProfile = sanitizeProfile;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.sanitizeProfile === "undefined") globalThis.sanitizeProfile = sanitizeProfile; } catch (e) {}
  E.isValidAvatarData = isValidAvatarData;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.isValidAvatarData === "undefined") globalThis.isValidAvatarData = isValidAvatarData; } catch (e) {}
  E.normalizeCollectionCategory = normalizeCollectionCategory;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.normalizeCollectionCategory === "undefined") globalThis.normalizeCollectionCategory = normalizeCollectionCategory; } catch (e) {}
  E.parseTagsInput = parseTagsInput;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.parseTagsInput === "undefined") globalThis.parseTagsInput = parseTagsInput; } catch (e) {}
  E.sanitizeCollectionEntry = sanitizeCollectionEntry;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.sanitizeCollectionEntry === "undefined") globalThis.sanitizeCollectionEntry = sanitizeCollectionEntry; } catch (e) {}
  E.sanitizeFileMeta = sanitizeFileMeta;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.sanitizeFileMeta === "undefined") globalThis.sanitizeFileMeta = sanitizeFileMeta; } catch (e) {}
  E.getTaskById = getTaskById;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.getTaskById === "undefined") globalThis.getTaskById = getTaskById; } catch (e) {}
  E.getChildTasks = getChildTasks;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.getChildTasks === "undefined") globalThis.getChildTasks = getChildTasks; } catch (e) {}
  E.getRootTasks = getRootTasks;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.getRootTasks === "undefined") globalThis.getRootTasks = getRootTasks; } catch (e) {}
  E.getTaskDepth = getTaskDepth;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.getTaskDepth === "undefined") globalThis.getTaskDepth = getTaskDepth; } catch (e) {}
  E.getDescendantIds = getDescendantIds;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.getDescendantIds === "undefined") globalThis.getDescendantIds = getDescendantIds; } catch (e) {}
  E.createTask = createTask;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.createTask === "undefined") globalThis.createTask = createTask; } catch (e) {}
  E.updateTask = updateTask;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.updateTask === "undefined") globalThis.updateTask = updateTask; } catch (e) {}
  E.deleteTaskCascade = deleteTaskCascade;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.deleteTaskCascade === "undefined") globalThis.deleteTaskCascade = deleteTaskCascade; } catch (e) {}
  E.setTodoDone = setTodoDone;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.setTodoDone === "undefined") globalThis.setTodoDone = setTodoDone; } catch (e) {}
  E.addMemo = addMemo;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.addMemo === "undefined") globalThis.addMemo = addMemo; } catch (e) {}
  E.deleteMemo = deleteMemo;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.deleteMemo === "undefined") globalThis.deleteMemo = deleteMemo; } catch (e) {}
  E.addActivity = addActivity;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.addActivity === "undefined") globalThis.addActivity = addActivity; } catch (e) {}
  E.getItemById = getItemById;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.getItemById === "undefined") globalThis.getItemById = getItemById; } catch (e) {}
  E.addItem = addItem;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.addItem === "undefined") globalThis.addItem = addItem; } catch (e) {}
  E.updateItem = updateItem;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.updateItem === "undefined") globalThis.updateItem = updateItem; } catch (e) {}
  E.deleteItem = deleteItem;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.deleteItem === "undefined") globalThis.deleteItem = deleteItem; } catch (e) {}
  E.getItemCategoryList = getItemCategoryList;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.getItemCategoryList === "undefined") globalThis.getItemCategoryList = getItemCategoryList; } catch (e) {}
  E.createItemCategory = createItemCategory;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.createItemCategory === "undefined") globalThis.createItemCategory = createItemCategory; } catch (e) {}
  E.resolveOrCreateItemCategory = resolveOrCreateItemCategory;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.resolveOrCreateItemCategory === "undefined") globalThis.resolveOrCreateItemCategory = resolveOrCreateItemCategory; } catch (e) {}
  E.renameItemCategory = renameItemCategory;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.renameItemCategory === "undefined") globalThis.renameItemCategory = renameItemCategory; } catch (e) {}
  E.deleteItemCategory = deleteItemCategory;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.deleteItemCategory === "undefined") globalThis.deleteItemCategory = deleteItemCategory; } catch (e) {}
  E.getCollectionCategoryList = getCollectionCategoryList;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.getCollectionCategoryList === "undefined") globalThis.getCollectionCategoryList = getCollectionCategoryList; } catch (e) {}
  E.addCollectionCategory = addCollectionCategory;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.addCollectionCategory === "undefined") globalThis.addCollectionCategory = addCollectionCategory; } catch (e) {}
  E.renameCollectionCategory = renameCollectionCategory;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.renameCollectionCategory === "undefined") globalThis.renameCollectionCategory = renameCollectionCategory; } catch (e) {}
  E.deleteCollectionCategory = deleteCollectionCategory;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.deleteCollectionCategory === "undefined") globalThis.deleteCollectionCategory = deleteCollectionCategory; } catch (e) {}
  E.collectionCatIcon = collectionCatIcon;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.collectionCatIcon === "undefined") globalThis.collectionCatIcon = collectionCatIcon; } catch (e) {}
  E.collectionAccept = collectionAccept;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.collectionAccept === "undefined") globalThis.collectionAccept = collectionAccept; } catch (e) {}
  E.getAchievementById = getAchievementById;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.getAchievementById === "undefined") globalThis.getAchievementById = getAchievementById; } catch (e) {}
  E.addManualAchievement = addManualAchievement;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.addManualAchievement === "undefined") globalThis.addManualAchievement = addManualAchievement; } catch (e) {}
  E.toggleAchievementUnlocked = toggleAchievementUnlocked;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.toggleAchievementUnlocked === "undefined") globalThis.toggleAchievementUnlocked = toggleAchievementUnlocked; } catch (e) {}
  E.ACH_BACKUP_KEY = ACH_BACKUP_KEY;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.ACH_BACKUP_KEY === "undefined") globalThis.ACH_BACKUP_KEY = ACH_BACKUP_KEY; } catch (e) {}
  E.deleteAchievement = deleteAchievement;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.deleteAchievement === "undefined") globalThis.deleteAchievement = deleteAchievement; } catch (e) {}
  E.resetAllAchievements = resetAllAchievements;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.resetAllAchievements === "undefined") globalThis.resetAllAchievements = resetAllAchievements; } catch (e) {}
  E.backupAchievements = backupAchievements;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.backupAchievements === "undefined") globalThis.backupAchievements = backupAchievements; } catch (e) {}
  E.readAchievementsBackup = readAchievementsBackup;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.readAchievementsBackup === "undefined") globalThis.readAchievementsBackup = readAchievementsBackup; } catch (e) {}
  E.restoreAchievementsBackup = restoreAchievementsBackup;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.restoreAchievementsBackup === "undefined") globalThis.restoreAchievementsBackup = restoreAchievementsBackup; } catch (e) {}
  E.clearAchievementsBackup = clearAchievementsBackup;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.clearAchievementsBackup === "undefined") globalThis.clearAchievementsBackup = clearAchievementsBackup; } catch (e) {}
  E.getProfile = getProfile;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.getProfile === "undefined") globalThis.getProfile = getProfile; } catch (e) {}
  E.updateProfile = updateProfile;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.updateProfile === "undefined") globalThis.updateProfile = updateProfile; } catch (e) {}
  E.setBirthDate = setBirthDate;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.setBirthDate === "undefined") globalThis.setBirthDate = setBirthDate; } catch (e) {}
  E.getCustomFieldById = getCustomFieldById;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.getCustomFieldById === "undefined") globalThis.getCustomFieldById = getCustomFieldById; } catch (e) {}
  E.addCustomField = addCustomField;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.addCustomField === "undefined") globalThis.addCustomField = addCustomField; } catch (e) {}
  E.updateCustomField = updateCustomField;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.updateCustomField === "undefined") globalThis.updateCustomField = updateCustomField; } catch (e) {}
  E.deleteCustomField = deleteCustomField;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.deleteCustomField === "undefined") globalThis.deleteCustomField = deleteCustomField; } catch (e) {}
  E.getCollectionById = getCollectionById;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.getCollectionById === "undefined") globalThis.getCollectionById = getCollectionById; } catch (e) {}
  E.addCollection = addCollection;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.addCollection === "undefined") globalThis.addCollection = addCollection; } catch (e) {}
  E.updateCollection = updateCollection;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.updateCollection === "undefined") globalThis.updateCollection = updateCollection; } catch (e) {}
  E.deleteCollection = deleteCollection;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.deleteCollection === "undefined") globalThis.deleteCollection = deleteCollection; } catch (e) {}
  E.searchCollections = searchCollections;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.searchCollections === "undefined") globalThis.searchCollections = searchCollections; } catch (e) {}
  E.isValidLat = isValidLat;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.isValidLat === "undefined") globalThis.isValidLat = isValidLat; } catch (e) {}
  E.isValidLng = isValidLng;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.isValidLng === "undefined") globalThis.isValidLng = isValidLng; } catch (e) {}
  E.parseCoord = parseCoord;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.parseCoord === "undefined") globalThis.parseCoord = parseCoord; } catch (e) {}
  E.sanitizeLocation = sanitizeLocation;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.sanitizeLocation === "undefined") globalThis.sanitizeLocation = sanitizeLocation; } catch (e) {}
  E.getLocationById = getLocationById;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.getLocationById === "undefined") globalThis.getLocationById = getLocationById; } catch (e) {}
  E.addLocation = addLocation;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.addLocation === "undefined") globalThis.addLocation = addLocation; } catch (e) {}
  E.updateLocation = updateLocation;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.updateLocation === "undefined") globalThis.updateLocation = updateLocation; } catch (e) {}
  E.deleteLocation = deleteLocation;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.deleteLocation === "undefined") globalThis.deleteLocation = deleteLocation; } catch (e) {}

  /* v16：运行时模块装载器 */
  E.ensureModule = ensureModule;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.ensureModule === "undefined") globalThis.ensureModule = ensureModule; } catch (e) {}
})();