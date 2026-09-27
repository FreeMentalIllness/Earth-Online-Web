/* ===== 模块 backup.js（v16 模块化：window.EO 命名空间） ===== */
var state = null;
var currentAccount = null;
var backpackTab = 'all';
(function () {
  'use strict';
  var _g = (typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this));
  _g.EO = _g.EO || {};
  var E = _g.EO;

/**
 * backup.js —— PART1 数据安全：导出 / 导入 / 数据摘要
 *
 * 设计约束（设计文档 §1.3 / §3.3 / §6.4）：
 * - 零依赖：Blob + URL.createObjectURL + a[download] → data URI + window.open → 模态框 textarea，三级降级链。
 * - 纯函数与副作用彻底拆开：buildBackupPayload / extractBackupState / applyBackupPayload /
 *   getDataSummary / saveStateSnapshot 可被 QA 直接调用；exportBackup / downloadTextFile /
 *   handleBackupFileSelected 含副作用（其中 handleBackupFileSelected 禁止在 QA 中直接调用）。
 * - location.reload() 只出现在 UI 层（pages.js），不进入本文件的纯函数。
 * - 导入必须走 sanitizeState()（与 loadState 同一迁移通道），这是「旧存档零丢失」的唯一技术保证。
 */

const BACKUP_FORMAT = 'earth-online-backup';
const BACKUP_FORMAT_VERSION = 1;
/** 导入覆盖前的安全快照键（已从导出扫描中排除，避免污染下一份备份） */
const BACKUP_AUTOSAVE_KEY = STORAGE_PREFIX + 'state_autobak_v1';
/* ==================== v1.2.1：本地自动备份（保留最近 3 份） ====================
   每次写操作（saveState）后防抖落一份快照，只留最近 3 份。
   ⚠️ 这些键必须一并从「导出扫描」中排除：自动快照本身就是完整存档，
   若被 collectExtraStorage() 收进下一份备份的 extra，会让备份体积随快照数量线性膨胀。 */
const AUTO_BACKUP_KEEP = 3;
const AUTO_BACKUP_INDEX_KEY = STORAGE_PREFIX + 'autobackup_index';
const AUTO_BACKUP_PREFIX = STORAGE_PREFIX + 'autobackup_';
/** 连续写入合并窗口（ms） */
const AUTO_BACKUP_DEBOUNCE = 5000;
/** 两份快照之间的最小间隔（ms），防止改一个字就写一份 */
const AUTO_BACKUP_MIN_INTERVAL = 60000;
const BACKUP_EXCLUDE_KEYS = [BACKUP_AUTOSAVE_KEY, AUTO_BACKUP_INDEX_KEY];
/** data URI 导航的浏览器长度上限（超出则改用模态框手抄） */
const BACKUP_DATA_URI_LIMIT = 900000;

/**
 * v19：随备份一起带走的附加键已收窄。
 * v10 时代账号系统会额外收集 earth_data_{accountId} / earth_accounts / earth_account；
 * v19 移除账号系统后，主存档由 payload.state 单独承载，不再收集任何 earth_data_*，
 * 仅保留 earth_online_ 前缀键（主题 / 通知 / pwa 提示等外观与偏好）。
 */
const BACKUP_EXTRA_PREFIXES = [STORAGE_PREFIX];
const BACKUP_EXTRA_BARE_KEYS = [];

/** 该键是否属于「需要随备份带走的附加键」 */
function isBackupExtraKey(k) {
  if (typeof k !== 'string' || !k) return false;
  if (BACKUP_EXCLUDE_KEYS.indexOf(k) !== -1) return false;
  // 自动快照本身是完整存档的副本，绝不能进 extra（否则备份会自我膨胀）
  if (k.indexOf(AUTO_BACKUP_PREFIX) === 0) return false;
  // 主存档由 payload.state 单独承载，不重复进 extra
  if (k === STORAGE_KEY || k === currentStorageKey()) return false;
  if (BACKUP_EXTRA_BARE_KEYS.indexOf(k) !== -1) return true;
  return BACKUP_EXTRA_PREFIXES.some(function (p) { return k.indexOf(p) === 0; });
}

/* ==================== 纯函数（无副作用，QA 可直测） ==================== */

/**
 * 组装导出载荷。主存档进 state，其余 earth_online_ 前缀键原样进 extra。
 * @returns {Object} BackupPayload
 */
function buildBackupPayload() {
  const payload = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: (state && typeof state.version === 'number') ? state.version : 3,
    exportedAt: new Date().toISOString(),
    storageKey: STORAGE_KEY,
    state: state,
    extra: collectExtraStorage(),
  };
  return payload;
}

/**
 * 列出全部持久化键（优先经 EOStore：IDB 主，localStorage 降级；EOStore 未就绪时退化到 localStorage 枚举）。
 * 绝不抛异常。
 */
function listStorageKeys() {
  if (typeof EOStore !== 'undefined' && EOStore && typeof EOStore.keys === 'function') {
    try { return EOStore.keys(); } catch (e) { /* 落到降级分支 */ }
  }
  const keys = [];
  try {
    const ls = (typeof localStorage !== 'undefined') ? localStorage : null;
    if (!ls) return keys;
    if (typeof ls.key === 'function' && typeof ls.length === 'number') {
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (typeof k === 'string') keys.push(k);
      }
      return keys;
    }
  } catch (e) { /* 不可读 → 空列表 */ }
  return keys;
}

/** 读取某键的持久化值：优先经 EOStore（已解码，IDB 直出对象 / localStorage 降级自动 JSON.parse）；退化时读 localStorage 原始串 */
function readStoredValue(k) {
  if (typeof EOStore !== 'undefined' && EOStore && typeof EOStore.getSync === 'function') {
    return EOStore.getSync(k);
  }
  const ls = (typeof localStorage !== 'undefined') ? localStorage : null;
  return (ls && typeof ls.getItem === 'function') ? ls.getItem(k) : null;
}

/** 写回某键：优先经 EOStore（结构化克隆 / JSON 降级，保留类型）；退化时写 localStorage（对象先 JSON 化） */
function writeStoredValue(k, v) {
  if (typeof EOStore !== 'undefined' && EOStore && typeof EOStore.set === 'function') {
    EOStore.set(k, v);
    return;
  }
  const ls = (typeof localStorage !== 'undefined') ? localStorage : null;
  if (ls && typeof ls.setItem === 'function') {
    try { ls.setItem(k, (typeof v === 'string') ? v : JSON.stringify(v)); } catch (e) { /* 忽略 */ }
  }
}

/** 收集除主存档与排除键之外的全部 earth_* 前缀键；存储不可用时退化为 {} */
function collectExtraStorage() {
  const extra = {};
  try {
    listStorageKeys().forEach(function (k) {
      if (!isBackupExtraKey(k)) return;
      try {
        const v = readStoredValue(k);
        if (v !== null && v !== undefined) extra[k] = v;
      } catch (e) { /* 单个键不可读则跳过，不阻断整体导出 */ }
    });
  } catch (e) { /* 整体不可用 → {} */ }
  return extra;
}

/**
 * 双格式兼容：信封格式取 .state，裸 state 直接返回，其它一律 null。
 * @param {*} obj
 * @returns {Object|null}
 */
function extractBackupState(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.format === BACKUP_FORMAT && obj.state && Array.isArray(obj.state.tasks)) return obj.state;
  if (Array.isArray(obj.tasks)) return obj;
  return null;
}

/**
 * 数组类字段的主键取值函数（v1.2.0 合并导入用）。
 * - 实体数组（tasks/…/activities）：主键 id
 * - itemCategories：主键 id
 * - collectionCategories：兼容「字符串分类名」与「{id,name} 对象」两种历史形态
 */
const MERGE_PRIMARY_KEYS = {
  tasks: function (x) { return x && x.id; },
  memos: function (x) { return x && x.id; },
  items: function (x) { return x && x.id; },
  achievements: function (x) { return x && x.id; },
  collections: function (x) { return x && x.id; },
  locations: function (x) { return x && x.id; },
  activities: function (x) { return x && x.id; },
  itemCategories: function (x) { return x && x.id; },
  collectionCategories: function (x) { return (x && typeof x === 'object') ? x.id : x; },
};

/**
 * 按主键合并两个数组：以本地为底，备份中同主键的条目**覆盖**本地条目，本地独有的条目保留。
 * 这样导入一份旧备份不会删掉导入后新增的数据（两端语义统一，见 Android BackupRepository）。
 * 无有效主键的条目（畸形 / 历史脏数据）一律追加到末尾，不做去重（宁可多留不可丢）。
 */
function mergeByPrimaryKey(localArr, incomingArr, keyOf) {
  const local = Array.isArray(localArr) ? localArr : [];
  const inc = Array.isArray(incomingArr) ? incomingArr : [];
  const indexOf = {};
  const out = local.slice();
  out.forEach(function (item, i) {
    const k = keyOf(item);
    if (k !== undefined && k !== null && k !== '') indexOf[String(k)] = i;
  });
  inc.forEach(function (item) {
    const k = keyOf(item);
    if (k !== undefined && k !== null && k !== '') {
      const hit = indexOf[String(k)];
      if (hit !== undefined) { out[hit] = item; return; }   // 同主键 → 备份优先
      indexOf[String(k)] = out.length;
    }
    out.push(item);                                          // 新条目（或畸形条目）追加
  });
  return out;
}

/**
 * 合并导入：把「清洗后的备份状态」按主键合并进「当前状态」。
 * 语义与 Android 端 BackupRepository.importJson 保持一致 —— 备份里的同主键条目覆盖本地，
 * 本地独有的数据保留，绝不因为导入一份旧备份就丢失新记录。
 * 少数「单值」字段的处理：
 *   - profile / birthDate：备份优先（角色身份跟着备份走；备份里为空则不覆盖本地）
 *   - aiConfig：**本地优先**（接口地址 / 密钥是设备配置，不该被别人的备份抹掉）
 *   - ledgerOpened / eggs 计数：只增不减（取并集 / 取较大值）
 *   - calendarNotes：按日期键浅合并，备份优先
 */
function mergeStateForImport(localState, incState) {
  const local = (localState && typeof localState === 'object') ? localState : {};
  const merged = Object.assign({}, local);

  Object.keys(MERGE_PRIMARY_KEYS).forEach(function (k) {
    merged[k] = mergeByPrimaryKey(local[k], incState[k], MERGE_PRIMARY_KEYS[k]);
  });

  // 角色身份：备份里有内容就采用备份的
  if (incState.profile && typeof incState.profile === 'object') merged.profile = incState.profile;
  if (typeof incState.birthDate === 'string' && incState.birthDate) merged.birthDate = incState.birthDate;

  // 设备侧配置：永远保留本地（缺失时才用备份补全）
  const localAi = (local.aiConfig && typeof local.aiConfig === 'object') ? local.aiConfig : null;
  const incAi = (incState.aiConfig && typeof incState.aiConfig === 'object') ? incState.aiConfig : null;
  if (localAi) merged.aiConfig = localAi;
  else if (incAi) merged.aiConfig = incAi;

  // 日历随手记：浅合并（备份优先），本地其它日期保留
  const notes = Object.assign({},
    (local.calendarNotes && typeof local.calendarNotes === 'object') ? local.calendarNotes : {},
    (incState.calendarNotes && typeof incState.calendarNotes === 'object') ? incState.calendarNotes : {});
  merged.calendarNotes = notes;

  // 单调标记 / 计数器：只增不减
  merged.ledgerOpened = !!(local.ledgerOpened || incState.ledgerOpened);
  const eggCounterKeys = (typeof EGG_COUNTERS !== 'undefined' && Array.isArray(EGG_COUNTERS)) ? EGG_COUNTERS : [];
  const eggs = {};
  eggCounterKeys.forEach(function (k) {
    const a = (local.eggs && typeof local.eggs === 'object') ? Number(local.eggs[k]) : 0;
    const b = (incState.eggs && typeof incState.eggs === 'object') ? Number(incState.eggs[k]) : 0;
    eggs[k] = Math.max(isFinite(a) ? a : 0, isFinite(b) ? b : 0);
  });
  merged.eggs = eggs;

  if (typeof incState.version === 'number') merged.version = incState.version;
  return merged;
}

/**
 * 应用备份（v1.2.0：按主键合并，不再整包覆盖）。
 * 流程：提取 → 清洗备份 → 与当前状态按主键合并 → 再清洗 → 留快照 → 落盘 → 回写 extra。
 * 不调用 location.reload()（由 UI 层负责），因此可被单测。
 * @returns {{ok: boolean, error: string}}
 */
function applyBackupPayload(obj) {
  const incoming = extractBackupState(obj);
  if (!incoming) return { ok: false, error: '这不是地球Online 的备份文件' };

  // 顺序至关重要：必须先清洗、成功后再写快照。
  // 若先写快照，一次清洗失败的坏导入会覆盖掉上一份好快照 —— 最后一道保险被自己人干掉。
  let next;
  try {
    const cleanIncoming = sanitizeState(incoming); // 与 loadState 同一迁移通道 → 旧备份补 doneAt:null，零丢失
    // 与当前状态按主键合并（当前 state 可能是 null —— 极端情况下按空状态处理）
    const merged = mergeStateForImport(state, cleanIncoming);
    next = sanitizeState(merged);                  // 合并结果再走一次清洗，保证结构合法
  } catch (e) {
    // 清洗阶段抛异常时：不写快照、不改 state、不落盘，当前数据分毫未动
    return { ok: false, error: '备份文件已损坏，无法导入（当前数据未改动）' };
  }
  if (!next || typeof next !== 'object') {
    return { ok: false, error: '备份文件已损坏，无法导入（当前数据未改动）' };
  }

  saveStateSnapshot();
  state = next;
  saveState();
  applyExtraStorage(obj && typeof obj === 'object' ? obj.extra : null);
  return { ok: true, error: '' };
}

/** 回写 extra 中的 earth_* 前缀键（排除主存档与快照键，失败不阻断）。值原样经 EOStore 写回，保留类型 */
function applyExtraStorage(extra) {
  if (!extra || typeof extra !== 'object') return;
  try {
    Object.keys(extra).forEach(function (k) {
      if (!isBackupExtraKey(k)) return;
      try { writeStoredValue(k, extra[k]); } catch (e) { /* 单键失败跳过 */ }
    });
  } catch (e) { /* 忽略 */ }
}

/**
 * 覆盖类操作前的最后一道保险：把当前 state 写入 earth_online_state_autobak_v1（经 EOStore）。
 * @returns {boolean} 是否写入成功
 */
function saveStateSnapshot() {
  try {
    if (typeof EOStore === 'undefined' || !EOStore || typeof EOStore.set !== 'function') {
      // 退化：直接写 localStorage 原始串
      const ls = (typeof localStorage !== 'undefined') ? localStorage : null;
      if (!ls || typeof ls.setItem !== 'function') return false;
      let raw = JSON.stringify(state);
      if (!raw) return false;
      ls.setItem(BACKUP_AUTOSAVE_KEY, raw);
      return true;
    }
    EOStore.set(BACKUP_AUTOSAVE_KEY, state); // 存当前内存 state 快照
    return true;
  } catch (e) {
    return false; // 快照失败不阻断导入
  }
}

/* ==================== v1.2.1：本地自动备份 ==================== */

let __autoBackupTimer = null;
let __autoBackupLastAt = 0;

/** 自动备份索引（数组，新 -> 旧；每项 { id, at }）。读失败返回空数组。 */
function readAutoBackupIndex() {
  try {
    const v = readStoredValue(AUTO_BACKUP_INDEX_KEY);
    if (!v) return [];
    const arr = (typeof v === 'string') ? JSON.parse(v) : v;
    return Array.isArray(arr) ? arr.filter(function (x) { return x && typeof x.id === 'string'; }) : [];
  } catch (e) { return []; }
}

function writeAutoBackupIndex(arr) {
  try { writeStoredValue(AUTO_BACKUP_INDEX_KEY, arr); } catch (e) { /* 忽略 */ }
}

/**
 * 排掉超出保留份数的旧快照（同时删数据键与索引项）。
 * @param {Array} index 新 -> 旧
 * @returns {Array} 裁剪后的索引
 */
function pruneAutoBackups(index) {
  const keep = index.slice(0, AUTO_BACKUP_KEEP);
  index.slice(AUTO_BACKUP_KEEP).forEach(function (item) {
    try {
      if (typeof EOStore !== 'undefined' && EOStore && typeof EOStore.remove === 'function') {
        EOStore.remove(AUTO_BACKUP_PREFIX + item.id);
      } else if (typeof localStorage !== 'undefined' && localStorage) {
        localStorage.removeItem(AUTO_BACKUP_PREFIX + item.id);
      }
    } catch (e) { /* 单份删不掉不影响其它 */ }
  });
  return keep;
}

/**
 * 立刻写一份自动快照。
 * @param {boolean} [force=false] true 忽略 60s 最小间隔（设置页「立即备份」用）
 * @returns {boolean} 是否真的写了
 */
function runAutoBackup(force) {
  try {
    const now = Date.now();
    if (!force && now - __autoBackupLastAt < AUTO_BACKUP_MIN_INTERVAL) return false;
    if (!state) return false;
    const id = String(now);
    const payload = buildBackupPayload();
    __autoBackupLastAt = now;
    writeStoredValue(AUTO_BACKUP_PREFIX + id, payload);
    const next = pruneAutoBackups([{ id: id, at: payload.exportedAt }].concat(readAutoBackupIndex()));
    writeAutoBackupIndex(next);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 写操作后的防抖调度。由 core.js 的 saveState() 调用 ——
 * 连续多次保存（导入一次会触发十几处写入）只在最后一次之后落一份。
 */
function scheduleAutoBackup() {
  try {
    if (typeof setTimeout !== 'function') return;
    if (__autoBackupTimer) clearTimeout(__autoBackupTimer);
    __autoBackupTimer = setTimeout(function () {
      __autoBackupTimer = null;
      runAutoBackup(false);
    }, AUTO_BACKUP_DEBOUNCE);
  } catch (e) { /* 定时器不可用时静默降级 */ }
}

/** 自动快照列表（新 -> 旧）：{ id, at, bytes } */
function listAutoBackups() {
  return readAutoBackupIndex().map(function (item) {
    let bytes = 0;
    try {
      const v = readStoredValue(AUTO_BACKUP_PREFIX + item.id);
      bytes = v ? String(typeof v === 'string' ? v : JSON.stringify(v)).length : 0;
    } catch (e) { /* 忽略 */ }
    return { id: item.id, at: item.at || '', bytes: bytes };
  });
}

/**
 * 从某份自动快照恢复。与「导入备份」同一语义（按主键合并，本地新增保留）。
 * @param {string} id
 * @returns {boolean}
 */
function restoreAutoBackup(id) {
  try {
    const v = readStoredValue(AUTO_BACKUP_PREFIX + id);
    if (!v) return false;
    const obj = (typeof v === 'string') ? JSON.parse(v) : v;
    return !!applyBackupPayload(obj);
  } catch (e) {
    return false;
  }
}

/**
 * 五宫格数据摘要（设置页「数据备份」卡片用）。
 * @returns {{tasks:number, achievements:number, items:number, collections:number, memos:number, bytesKb:number}}
 */
function getDataSummary() {
  const s = state || {};
  const len = function (v) { return Array.isArray(v) ? v.length : 0; };
  let bytesKb = 0;
  try {
    const raw = JSON.stringify(s) || '';
    bytesKb = Math.round((raw.length / 1024) * 10) / 10;
  } catch (e) {
    bytesKb = 0;
  }
  return {
    tasks: len(s.tasks),
    achievements: len(s.achievements),
    items: len(s.items),
    collections: len(s.collections),
    memos: len(s.memos),
    bytesKb: bytesKb,
  };
}

/* ==================== 副作用函数（含 DOM / 下载 / FileReader） ==================== */

/** 文件名后缀：HHmm（避免同日多次导出互相覆盖） */
function backupTimeSuffix() {
  const d = new Date();
  const p = function (n) { return String(n).padStart(2, '0'); };
  return p(d.getHours()) + p(d.getMinutes());
}

/** 导出备份入口：组装 → 序列化 → 下载（三级降级）→ toast */
function exportBackup() {
  let json = '';
  try {
    json = JSON.stringify(buildBackupPayload(), null, 2);
  } catch (e) {
    if (typeof toast === 'function') toast('备份生成失败：数据无法序列化');
    return;
  }
  const name = 'earth-online-backup-' + todayStr() + '-' + backupTimeSuffix() + '.json';
  downloadTextFile(name, json);
}

/**
 * 下载文本文件，三级降级链（永不抛错）。
 * ① Blob + a[download]  ② 体积 ≤900KB 时 data URI + window.open  ③ 模态框 textarea 手抄
 * @returns {boolean} 是否走通了任一降级路径
 */
function downloadTextFile(name, text) {
  const body = String(text == null ? '' : text);

  // ① 标准路径：Blob + a[download]
  try {
    const hasBlob = (typeof Blob === 'function');
    const hasUrl = (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function');
    const hasDoc = (typeof document !== 'undefined' && typeof document.createElement === 'function');
    if (hasBlob && hasUrl && hasDoc) {
      const blob = new Blob([body], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      if (a && typeof a.click === 'function') {
        a.href = url;
        a.download = name;
        if (a.style) a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        if (typeof a.remove === 'function') a.remove();
        else if (a.parentNode && a.parentNode.removeChild) a.parentNode.removeChild(a);
        if (typeof URL.revokeObjectURL === 'function') {
          if (typeof setTimeout === 'function') {
            setTimeout(function () {
              try { URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ }
            }, 0);
          }
        }
        if (typeof toast === 'function') toast('备份已导出：' + name);
        return true;
      }
    }
  } catch (e) { /* 降级到 ② */ }

  // ② 无 a[download] 支持：data URI 开窗供手动另存
  try {
    if (body.length <= BACKUP_DATA_URI_LIMIT &&
        typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open('data:application/json;charset=utf-8,' + encodeURIComponent(body));
      if (typeof toast === 'function') toast('已在新窗口打开备份内容，请手动另存为 .json');
      return true;
    }
  } catch (e) { /* 降级到 ③ */ }

  // ③ 超大（头像 base64 场景）或前两级均失败：模态框全选复制
  try {
    if (typeof openModal === 'function') {
      openModal(
        '<h3 class="modal-title">备份内容（请全选复制后保存）</h3>' +
        '<textarea class="note-textarea" id="backupTextArea" readonly>' + escapeHtml(body) + '</textarea>' +
        '<div class="modal-actions">' +
          '<button class="btn btn-primary" id="backupTextClose">关闭</button>' +
        '</div>'
      );
      const closeBtn = document.getElementById('backupTextClose');
      if (closeBtn && typeof closeModal === 'function') closeBtn.onclick = closeModal;
      const ta = document.getElementById('backupTextArea');
      if (ta && typeof ta.select === 'function') {
        try { ta.select(); } catch (e) { /* 忽略 */ }
      }
      if (typeof toast === 'function') toast('备份体积过大，请手动复制保存');
      return true;
    }
  } catch (e) { /* 全部失败 */ }

  return false;
}

/**
 * 文件选择后的导入流程（QA 禁止直接调用：mock 无 readAsText、location.reload 会 throw）。
 * 全程守卫：无 FileReader.readAsText → toast 返回；不是本应用文件 → 数据零改动。
 */
function handleBackupFileSelected(file) {
  if (!file) return;
  let reader = null;
  try { reader = new FileReader(); } catch (e) { reader = null; }
  if (!reader || typeof reader.readAsText !== 'function') {
    if (typeof toast === 'function') toast('当前环境不支持读取文件');
    return;
  }

  reader.onload = function () {
    let obj = null;
    try {
      obj = JSON.parse(String(reader.result));
    } catch (e) {
      if (typeof toast === 'function') toast('文件不是合法的 JSON');
      return;
    }
    if (!extractBackupState(obj)) {
      if (typeof toast === 'function') toast('这不是地球Online 的备份文件');
      return;
    }
    if (typeof openConfirm !== 'function') return;
    openConfirm('导入会与当前数据**按主键合并**（同一条数据以备份为准，本地新增的保留；导入前会自动留一份快照），确定吗？', function () {
      let res = null;
      try {
        res = applyBackupPayload(obj);
      } catch (e) {
        // 兜底：任何未预料的异常都必须给用户反馈，不能出现「点了确认却毫无动静」
        if (typeof toast === 'function') toast('导入失败，当前数据未改动');
        return;
      }
      if (!res || !res.ok) {
        if (typeof toast === 'function') toast((res && res.error) || '导入失败');
        return;
      }
      if (typeof toast === 'function') toast('导入成功，即将刷新');
      if (typeof setTimeout === 'function') {
        setTimeout(function () {
          try { location.reload(); } catch (e) { /* 测试环境 reload 会 throw，忽略 */ }
        }, 400);
      }
    }, null);
  };

  reader.onerror = function () {
    if (typeof toast === 'function') toast('文件读取失败');
  };

  try {
    reader.readAsText(file);
  } catch (e) {
    if (typeof toast === 'function') toast('文件读取失败');
  }
}

  /* ---- 导出公共 API 到 EO 命名空间并同步到全局（兼容旧引用 / 测试桩） ---- */
  E.MERGE_PRIMARY_KEYS = MERGE_PRIMARY_KEYS;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.MERGE_PRIMARY_KEYS === "undefined") globalThis.MERGE_PRIMARY_KEYS = MERGE_PRIMARY_KEYS; } catch (e) {}
  E.mergeByPrimaryKey = mergeByPrimaryKey;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.mergeByPrimaryKey === "undefined") globalThis.mergeByPrimaryKey = mergeByPrimaryKey; } catch (e) {}
  E.mergeStateForImport = mergeStateForImport;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.mergeStateForImport === "undefined") globalThis.mergeStateForImport = mergeStateForImport; } catch (e) {}
  E.BACKUP_FORMAT = BACKUP_FORMAT;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.BACKUP_FORMAT === "undefined") globalThis.BACKUP_FORMAT = BACKUP_FORMAT; } catch (e) {}
  E.BACKUP_FORMAT_VERSION = BACKUP_FORMAT_VERSION;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.BACKUP_FORMAT_VERSION === "undefined") globalThis.BACKUP_FORMAT_VERSION = BACKUP_FORMAT_VERSION; } catch (e) {}
  E.BACKUP_AUTOSAVE_KEY = BACKUP_AUTOSAVE_KEY;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.BACKUP_AUTOSAVE_KEY === "undefined") globalThis.BACKUP_AUTOSAVE_KEY = BACKUP_AUTOSAVE_KEY; } catch (e) {}
  E.BACKUP_EXCLUDE_KEYS = BACKUP_EXCLUDE_KEYS;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.BACKUP_EXCLUDE_KEYS === "undefined") globalThis.BACKUP_EXCLUDE_KEYS = BACKUP_EXCLUDE_KEYS; } catch (e) {}
  E.BACKUP_DATA_URI_LIMIT = BACKUP_DATA_URI_LIMIT;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.BACKUP_DATA_URI_LIMIT === "undefined") globalThis.BACKUP_DATA_URI_LIMIT = BACKUP_DATA_URI_LIMIT; } catch (e) {}
  E.BACKUP_EXTRA_PREFIXES = BACKUP_EXTRA_PREFIXES;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.BACKUP_EXTRA_PREFIXES === "undefined") globalThis.BACKUP_EXTRA_PREFIXES = BACKUP_EXTRA_PREFIXES; } catch (e) {}
  E.BACKUP_EXTRA_BARE_KEYS = BACKUP_EXTRA_BARE_KEYS;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.BACKUP_EXTRA_BARE_KEYS === "undefined") globalThis.BACKUP_EXTRA_BARE_KEYS = BACKUP_EXTRA_BARE_KEYS; } catch (e) {}
  E.isBackupExtraKey = isBackupExtraKey;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.isBackupExtraKey === "undefined") globalThis.isBackupExtraKey = isBackupExtraKey; } catch (e) {}
  E.buildBackupPayload = buildBackupPayload;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.buildBackupPayload === "undefined") globalThis.buildBackupPayload = buildBackupPayload; } catch (e) {}
  E.listStorageKeys = listStorageKeys;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.listStorageKeys === "undefined") globalThis.listStorageKeys = listStorageKeys; } catch (e) {}
  E.readStoredValue = readStoredValue;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.readStoredValue === "undefined") globalThis.readStoredValue = readStoredValue; } catch (e) {}
  E.writeStoredValue = writeStoredValue;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.writeStoredValue === "undefined") globalThis.writeStoredValue = writeStoredValue; } catch (e) {}
  E.collectExtraStorage = collectExtraStorage;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.collectExtraStorage === "undefined") globalThis.collectExtraStorage = collectExtraStorage; } catch (e) {}
  E.extractBackupState = extractBackupState;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.extractBackupState === "undefined") globalThis.extractBackupState = extractBackupState; } catch (e) {}
  E.applyBackupPayload = applyBackupPayload;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.applyBackupPayload === "undefined") globalThis.applyBackupPayload = applyBackupPayload; } catch (e) {}
  E.applyExtraStorage = applyExtraStorage;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.applyExtraStorage === "undefined") globalThis.applyExtraStorage = applyExtraStorage; } catch (e) {}
  E.saveStateSnapshot = saveStateSnapshot;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.saveStateSnapshot === "undefined") globalThis.saveStateSnapshot = saveStateSnapshot; } catch (e) {}
  E.AUTO_BACKUP_KEEP = AUTO_BACKUP_KEEP;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.AUTO_BACKUP_KEEP === "undefined") globalThis.AUTO_BACKUP_KEEP = AUTO_BACKUP_KEEP; } catch (e) {}
  E.scheduleAutoBackup = scheduleAutoBackup;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.scheduleAutoBackup === "undefined") globalThis.scheduleAutoBackup = scheduleAutoBackup; } catch (e) {}
  E.runAutoBackup = runAutoBackup;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.runAutoBackup === "undefined") globalThis.runAutoBackup = runAutoBackup; } catch (e) {}
  E.listAutoBackups = listAutoBackups;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.listAutoBackups === "undefined") globalThis.listAutoBackups = listAutoBackups; } catch (e) {}
  E.restoreAutoBackup = restoreAutoBackup;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.restoreAutoBackup === "undefined") globalThis.restoreAutoBackup = restoreAutoBackup; } catch (e) {}
  E.getDataSummary = getDataSummary;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.getDataSummary === "undefined") globalThis.getDataSummary = getDataSummary; } catch (e) {}
  E.backupTimeSuffix = backupTimeSuffix;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.backupTimeSuffix === "undefined") globalThis.backupTimeSuffix = backupTimeSuffix; } catch (e) {}
  E.exportBackup = exportBackup;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.exportBackup === "undefined") globalThis.exportBackup = exportBackup; } catch (e) {}
  E.downloadTextFile = downloadTextFile;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.downloadTextFile === "undefined") globalThis.downloadTextFile = downloadTextFile; } catch (e) {}
  E.handleBackupFileSelected = handleBackupFileSelected;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.handleBackupFileSelected === "undefined") globalThis.handleBackupFileSelected = handleBackupFileSelected; } catch (e) {}
})();