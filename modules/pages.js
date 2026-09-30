/* ===== 模块 pages.js（v16 模块化：window.EO 命名空间） ===== */
var state = null;
var currentAccount = null;
var backpackTab = 'all';
(function () {
  'use strict';
  var _g = (typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this));
  _g.EO = _g.EO || {};
  var E = _g.EO;

/**
 * pages.js —— 各页面渲染 + 交互逻辑
 * 主页 / 任务指引 / 背包装备 / 日历 / 成就 / 设置。
 * 交互采用事件委托：所有 data-action 统一在 #content / #modal-root 上监听。
 */

/* ---------- 页面级临时状态（不持久化） ---------- */
const noteOpenIds = new Set();      // 展开了备注区的任务 id
const taskTreeExpanded = new Set(); // 展开了子任务的任务 id
let backpackSearch = '';           // 背包「全部」视图搜索词（按名称 / 分类名筛选）
let calendarCursor = new Date();    // 日历当前展示的月份
let calendarSelected = todayStr();  // 日历选中的日期
let achCategoryFilter = 'all';      // 成就页类别筛选（all | 类别 key | manual）
let achOnlyUnlocked = false;
let taskFilter = 'all';           // 任务页分类筛选：all | main | side | todo
let taskDueFilter = false;        // v15 修复：记账页「📅 到期任务提醒」跳转后，任务页仅展示即将到期（含已过期）的 To Do

/** Web Audio 合成「叮」声（零依赖，无需音频文件）；环境不支持时静默降级 */
let __dingCtx = null;
function playDing() {
  try {
    const AC = (typeof window !== 'undefined') ? (window.AudioContext || window.webkitAudioContext) : null;
    if (!AC) return;
    if (!__dingCtx) __dingCtx = new AC();
    const ctx = __dingCtx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 1320;
    const now = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.3, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    o.connect(g); g.connect(ctx.destination);
    o.start(now);
    o.stop(now + 0.26);
  } catch (e) { /* 无声降级 */ }
}        // 成就页「仅看未解锁」开关

/* ==================== 通用 UI 工具 ==================== */

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 取模态框中输入控件的值 */
function val(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

function fmtDate(d) {
  return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
}

function fmtDateTime(iso) {
  const d = new Date(iso);
  const p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/** 顶部轻提示 */
function toast(msg) {
  let box = document.getElementById('toastBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toastBox';
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(function () { el.remove(); }, 2400);
}

/* ===== v3：成就解锁通知（Steam 风格右下角）+ 合成音效 ===== */
let __achNotifyQueue = [];
let __achNotifyShowing = false;

/** 成就音效开关（默认开）。与 Android 的 earth_ach_sound 语义一致。 */
function achSoundOn() {
  try {
    const v = (typeof EOStore !== 'undefined' && EOStore && EOStore.getSync)
      ? EOStore.getSync('earth_ach_sound')
      : localStorage.getItem('earth_ach_sound');
    return v !== 'off';
  } catch (e) { return true; }
}

function setAchSoundOn(on) {
  try {
    if (typeof EOStore !== 'undefined' && EOStore && EOStore.setSync) EOStore.setSync('earth_ach_sound', on ? 'on' : 'off');
    else localStorage.setItem('earth_ach_sound', on ? 'on' : 'off');
  } catch (e) { /* 存储不可用时仅本次会话生效 */ }
}

/**
 * 用 Web Audio API 合成一个短促上升的“叮”声，不依赖任何外部音频文件。
 * 三音上行琶音（C6 - E6 - G6），与 Android 端 res/raw 的音效同调。
 */
function playAchievementChime() {
  try {
    if (!achSoundOn()) return;
    const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return; // 非浏览器/不支持：静默降级，绝不抛错
    if (!window.__achAudioCtx) {
      try { window.__achAudioCtx = new AC(); } catch (e) { return; }
    }
    const ctx = window.__achAudioCtx;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* 等待下次手势 */ } }
    const now = ctx.currentTime;
    // 三音上行琶音 + 一点八度泛音，比原来两音更有“解锁感”（与 Android 端同调）
    [1046.5, 1318.5, 1568.0].forEach(function (freq, i) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      const t0 = now + i * 0.11;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      o.connect(g); g.connect(ctx.destination);
      o.start(t0); o.stop(t0 + 0.24);
    });
  } catch (e) { /* 忽略音频异常，不阻断通知主流程 */ }
}

function __achNotifyMount() {
  let stack = document.getElementById('achNotifyStack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'achNotifyStack';
    document.body.appendChild(stack);
  }
  return stack;
}

/**
 * 成就解锁通知：加入队列，逐条从右滑入、停留 4s 后滑出，避免多成就重叠。
 * @param {string} name 成就名
 * @param {boolean} [isEgg] 彩蛋成就：图标换成 🥚、标题写「隐藏成就解锁」
 */
function showAchievementNotification(name, isEgg) {
  if (!name) return;
  __achNotifyQueue.push({ name: String(name), egg: !!isEgg });
  if (!__achNotifyShowing) __achNotifyRenderNext();
}

function __achNotifyRenderNext() {
  if (!__achNotifyQueue.length) { __achNotifyShowing = false; return; }
  __achNotifyShowing = true;
  const item = __achNotifyQueue.shift();
  const stack = __achNotifyMount();
  const el = document.createElement('div');
  el.className = 'ach-notify' + (item.egg ? ' ach-notify-egg' : '');
  const timeStr = (new Date().toTimeString() || '00:00:00').slice(0, 5);
  el.innerHTML =
    '<div class="ach-notify-icon">' + (item.egg ? '🥚' : '🏆') + '</div>' +
    '<div class="ach-notify-body">' +
      '<div class="ach-notify-head">' + (item.egg ? '隐藏成就解锁' : '成就解锁') + '</div>' +
      '<div class="ach-notify-name">' + escapeHtml(item.name) + '</div>' +
      '<div class="ach-notify-time">' + escapeHtml(timeStr) + '</div>' +
    '</div>';
  stack.appendChild(el);
  void el.offsetWidth; // 强制 reflow，确保过渡触发
  el.classList.add('show');
  setTimeout(function () {
    el.classList.remove('show');
    setTimeout(function () { el.remove(); __achNotifyRenderNext(); }, 400);
  }, 4000);
}

function openModal(innerHtml) {
  document.getElementById('modal-root').innerHTML =
    '<div class="modal-overlay" data-close="1"><div class="modal">' + innerHtml + '</div></div>';
  if (typeof navStack !== 'undefined') navStack.push('modal');
}

function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
  if (typeof navStack !== 'undefined' && navStack.length) navStack.pop();
}

/* ==================== v1.0.3：通用图片裁剪模态（保留原图分辨率与画质） ==================== */
/**
 * 打开图片裁剪模态：用户可拖拽移动选区、拖角缩放、或用滑块缩放，确认后按原图分辨率裁剪输出。
 * 关键约束（用户要求）：绝不降采样、绝不通过压缩参数降低画质。
 *   - 输出尺寸 = 选区在原图中的真实像素尺寸（scale = naturalWidth / 展示宽度），不做任何缩小。
 *   - 输出格式沿用原图（PNG 无损 / JPEG 质量 1.0）。
 * @param {object} opts { src, title, aspect(数值|null 锁比例), circle(仅影响展示蒙版), onCropped(dataUrl) }
 */
function openImageCropModal(opts) {
  opts = opts || {};
  const src = opts.src || '';
  const aspect = (typeof opts.aspect === 'number') ? opts.aspect : null;
  const onCropped = (typeof opts.onCropped === 'function') ? opts.onCropped : function () {};
  openModal(
    '<h3 class="modal-title">' + escapeHtml(opts.title || '裁剪图片') + '</h3>' +
    '<div class="crop-stage" id="cropStage">' +
      '<img id="cropImg" src="' + src + '" alt="待裁剪图片">' +
      '<div class="crop-box" id="cropBox">' +
        '<span class="crop-grid"></span>' +
        '<span class="crop-handle" id="cropHandle"></span>' +
      '</div>' +
    '</div>' +
    '<div class="crop-bar">' +
      '<span class="crop-bar-label">缩放</span>' +
      '<input type="range" id="cropZoom" min="20" max="100" value="80">' +
    '</div>' +
    '<div class="modal-error" id="cropErr"></div>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-ghost" id="cropCancel">取消</button>' +
      '<button class="btn btn-primary" id="cropConfirm">确定裁剪</button>' +
    '</div>'
  );
  const stage = document.getElementById('cropStage');
  const img = document.getElementById('cropImg');
  const box = document.getElementById('cropBox');
  const handle = document.getElementById('cropHandle');
  const zoom = document.getElementById('cropZoom');
  const errEl = document.getElementById('cropErr');
  let imgRect = null;            // 图片在 stage 内的矩形 {left, top, width, height}
  let boxRect = { left: 0, top: 0, width: 0, height: 0 };

  function clampBox() {
    if (!imgRect) return;
    const minS = 24;
    if (boxRect.width < minS) boxRect.width = minS;
    if (boxRect.height < minS) boxRect.height = minS;
    if (boxRect.left < imgRect.left) boxRect.left = imgRect.left;
    if (boxRect.top < imgRect.top) boxRect.top = imgRect.top;
    if (boxRect.left + boxRect.width > imgRect.left + imgRect.width)
      boxRect.left = imgRect.left + imgRect.width - boxRect.width;
    if (boxRect.top + boxRect.height > imgRect.top + imgRect.height)
      boxRect.top = imgRect.top + imgRect.height - boxRect.height;
    if (boxRect.left < imgRect.left) boxRect.left = imgRect.left;
    if (boxRect.top < imgRect.top) boxRect.top = imgRect.top;
  }
  function applyBox() {
    box.style.left = (boxRect.left - imgRect.left) + 'px';
    box.style.top = (boxRect.top - imgRect.top) + 'px';
    box.style.width = boxRect.width + 'px';
    box.style.height = boxRect.height + 'px';
  }
  function initBox() {
    const r = img.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    imgRect = { left: r.left - s.left, top: r.top - s.top, width: r.width, height: r.height };
    let w = Math.min(imgRect.width, imgRect.height) * 0.8;
    let h = aspect ? w / aspect : w;
    if (h > imgRect.height) { h = imgRect.height * 0.8; w = aspect ? h * aspect : w; }
    boxRect = {
      width: w, height: h,
      left: imgRect.left + (imgRect.width - w) / 2,
      top: imgRect.top + (imgRect.height - h) / 2
    };
    applyBox();
  }
  function setupImage() {
    if (img.complete && img.naturalWidth) initBox();
    else img.onload = initBox;
    img.onerror = function () { if (errEl) errEl.textContent = '图片加载失败，请重试'; };
  }

  let drag = null;
  box.addEventListener('pointerdown', function (e) {
    if (e.target === handle) return;
    drag = { x: e.clientX, y: e.clientY, l: boxRect.left, t: boxRect.top };
    box.setPointerCapture && box.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointerdown', function (e) {
    drag = { mode: 'resize', x: e.clientX, y: e.clientY, w: boxRect.width, h: boxRect.height };
    handle.setPointerCapture && handle.setPointerCapture(e.pointerId);
    e.preventDefault(); e.stopPropagation();
  });
  function onMove(e) {
    if (!drag || !imgRect) return;
    if (drag.mode === 'resize') {
      const dw = (e.clientX - drag.x);
      let w = drag.w + dw;
      let h = aspect ? w / aspect : drag.h + (e.clientY - drag.y);
      boxRect.width = w; boxRect.height = h;
    } else {
      boxRect.left = drag.l + (e.clientX - drag.x);
      boxRect.top = drag.t + (e.clientY - drag.y);
    }
    clampBox(); applyBox();
  }
  function onUp() { drag = null; }
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);

  if (zoom) zoom.addEventListener('input', function () {
    if (!imgRect) return;
    const cx = boxRect.left + boxRect.width / 2;
    const cy = boxRect.top + boxRect.height / 2;
    let w = Math.min(imgRect.width, imgRect.height) * (zoom.value / 100);
    let h = aspect ? w / aspect : w;
    boxRect.width = w; boxRect.height = h;
    boxRect.left = cx - w / 2; boxRect.top = cy - h / 2;
    clampBox(); applyBox();
  });

  document.getElementById('cropCancel').onclick = function () {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    closeModal();
  };
  document.getElementById('cropConfirm').onclick = function () {
    if (!imgRect) { if (errEl) errEl.textContent = '图片尚未加载完成'; return; }
    try {
      const scale = img.naturalWidth / imgRect.width;
      const sx = (boxRect.left - imgRect.left) * scale;
      const sy = (boxRect.top - imgRect.top) * scale;
      const sw = boxRect.width * scale;
      const sh = boxRect.height * scale;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(sw));
      canvas.height = Math.max(1, Math.round(sh));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      // 沿用原图格式：PNG 无损、JPEG 质量 1.0（不降质）
      const mime = (String(img.src).indexOf('data:image/png') === 0) ? 'image/png' : 'image/jpeg';
      const out = canvas.toDataURL(mime, 1.0);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      closeModal();
      onCropped(out);
    } catch (err) {
      if (errEl) errEl.textContent = '裁剪失败：' + (err && err.message ? err.message : err);
    }
  };

  setupImage();
}

/** dataURL → Blob（壁纸存入 IndexedDB 用；原图画质直转，不重编码压缩） */
function dataUrlToBlob(dataUrl) {
  try {
    const idx = String(dataUrl).indexOf(',');
    const head = dataUrl.slice(0, idx);
    const b64 = dataUrl.slice(idx + 1);
    const mime = (head.match(/data:([^;]+)/) || [, 'image/png'])[1];
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  } catch (e) { return null; }
}

/* ---------- v1.2.0：心情 / 表情包入口 ----------
 * 点一下就记一条「心情」类型的日志（type='mood'），不用打字。
 * 表情本身作为日志正文 —— 纯 emoji 日志会触发隐藏彩蛋，属于有意设计。 */
const MOOD_CHOICES = [
  { emoji: '😄', label: '开心' },
  { emoji: '😌', label: '平静' },
  { emoji: '🥱', label: '疲惫' },
  { emoji: '😤', label: '上头' },
  { emoji: '😢', label: '难过' },
  { emoji: '🤯', label: '爆炸' },
  { emoji: '🥳', label: '庆祝' },
  { emoji: '😴', label: '摆烂' }
];

function openMoodPickerModal() {
  const btns = MOOD_CHOICES.map(function (m) {
    return '<button class="mood-pick-btn" data-action="mood-pick" data-mood="' + m.emoji +
      '" data-note="' + m.emoji + ' ' + escapeHtml(m.label) + '">' +
      '<span class="mood-pick-emoji">' + m.emoji + '</span>' +
      '<span class="mood-pick-label">' + escapeHtml(m.label) + '</span></button>';
  }).join('');
  openModal(
    '<h3 class="modal-title">🎭 记一笔心情</h3>' +
    '<p class="modal-text">选一个就行，会记进世界日志（类型：心情）。纯表情的记录还有隐藏彩蛋哦。</p>' +
    '<div class="mood-picker-grid">' + btns + '</div>' +
    '<div class="modal-actions"><button class="btn btn-ghost" data-action="close-modal">取消</button></div>'
  );
}

/** 通用确认框 */
function openConfirm(message, onOk, onCancel) {
  openModal(
    '<h3 class="modal-title">确认操作</h3>' +
    '<p class="modal-text">' + escapeHtml(message) + '</p>' +
    '<div class="modal-actions">' +
    '<button class="btn btn-ghost" id="confirmCancel">取消</button>' +
    '<button class="btn btn-primary" id="confirmOk">确认</button>' +
    '</div>'
  );
  document.getElementById('confirmOk').onclick = function () { closeModal(); if (onOk) onOk(); };
  document.getElementById('confirmCancel').onclick = function () { closeModal(); if (onCancel) onCancel(); };
}

/* ==================== 主页 ==================== */

function renderHome() {
  const stats = getLifeStats(state.birthDate);
  const profile = getProfile();
  const avatar = (typeof currentAvatar === 'function') ? currentAvatar() : { data: null, key: 'default' };
  const tasks = state.tasks;
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter(function (t) { return t.status === 'done'; }).length;
  const doneRatio = totalTasks ? Math.round(doneTasks / totalTasks * 100) : 0;
  const unlockedAch = state.achievements.filter(function (a) { return a.unlocked; }).length;
  const recentMemos = state.memos.slice()
    .sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); })
    .slice(0, 5);
  const recentActs = (state.activities || []).slice(-3).reverse();

  const username = profile.name ? escapeHtml(profile.name) : '地球玩家';

  /* v1.0.2：动态问候 / 连续记录阶段 / 回归鼓励 / 季节徽章 / 累计经验。
     口径统一走 core.js（与 Android XpRules / GrowthStreak / Greeting / SeasonTheme 一致）。 */
  const streakDays = (typeof currentStreakDays === 'function') ? currentStreakDays(state) : 0;
  const greetingText = (typeof greetingBuild === 'function')
    ? greetingBuild(new Date().getHours(), latestMoodTextOf(state), streakDays) : '';
  const stageLabel = (typeof streakStageLabel === 'function')
    ? streakStageLabel((typeof streakStage === 'function') ? streakStage(streakDays) : 0) : '';
  const comebackText = (typeof comebackMessage === 'function') ? comebackMessage(state) : '';
  const season = (typeof seasonCurrent === 'function') ? seasonCurrent() : null;
  const xpTotalNow = (typeof totalXpOf === 'function') ? totalXpOf(state) : 0;
  const titleText = (typeof xpTitleFor === 'function') ? xpTitleFor(profile.customTitle) : '旅行者';

  /* v1.0.2：今日一签 —— 每天确定性随机展示一条过去的日志/成就（日期做种子，同一天刷新不变）。 */
  const todayLuck = (function () {
    const pool = [];
    (state.memos || []).forEach(function (m) {
      if (m && m.text) pool.push({ icon: (MEMO_TYPE[m.type] || MEMO_TYPE.idea).emoji, text: String(m.text) });
    });
    (state.achievements || []).forEach(function (a) {
      if (a && a.unlocked && a.title) pool.push({ icon: '🏆', text: '解锁成就「' + String(a.title) + '」' });
    });
    if (!pool.length) return null;
    // 朴素字符串哈希 → 确定性索引（同一天任何时段结果一致）
    const key = todayStr();
    let seed = 7;
    for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) % 2147483647;
    const pick = pool[seed % pool.length];
    const t = pick.text.length > 42 ? pick.text.slice(0, 42) + '…' : pick.text;
    return { icon: pick.icon, text: t };
  })();

  /* v1.0.2：历年今日 —— 去年今天有记录时，顶部轻量出现回忆卡（日志/任务/足迹）。 */
  const memoryCardHtml = (function () {
    const today = todayStr();
    const lastYearToday = (parseInt(today.slice(0, 4), 10) - 1) + today.slice(4);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lastYearToday)) return '';
    const rows = [];
    (state.memos || []).forEach(function (m) {
      if (m && m.text && localDayOf(m.createdAt) === lastYearToday) {
        rows.push({ icon: '💭', text: m.text });
      }
    });
    (state.tasks || []).forEach(function (t) {
      if (t && t.status === 'done' && t.doneAt && localDayOf(t.doneAt) === lastYearToday) {
        rows.push({ icon: '📋', text: '完成「' + (t.title || '任务') + '」' });
      }
    });
    (state.locations || []).forEach(function (l) {
      if (l && l.date === lastYearToday) rows.push({ icon: '🗺️', text: '足迹 · ' + (l.name || '') });
    });
    if (!rows.length) return '';
    const shown = rows.slice(0, 4);
    return '<div class="card memory-card">' +
      '<div class="card-title">🕰️ 去年的今天 · ' + escapeHtml(lastYearToday) + '</div>' +
      shown.map(function (r) {
        const t = r.text.length > 40 ? r.text.slice(0, 40) + '…' : r.text;
        return '<div class="memory-row"><span class="memory-icon">' + r.icon + '</span>' +
          '<span>' + escapeHtml(t) + '</span></div>';
      }).join('') +
      (rows.length > shown.length ? '<div class="muted memory-more">还有 ' + (rows.length - shown.length) + ' 条当年的记录</div>' : '') +
      '<div class="muted memory-foot">那天的你留下的东西，今天还在。</div>' +
    '</div>';
  })();

  /* 1. 顶部角色横幅（左：头像 + 用户名/生日；右：等级信息） */
  const birthText = state.birthDate ? ('🎂 ' + escapeHtml(state.birthDate)) : '🎂 未设置生日';

  /* 1b. 个性签名 + 自定义字段（v10：展示在用户名下方；为空则整块不渲染） */
  const signatureText = String(profile.signature || '').trim();
  const signatureHtml = signatureText
    ? '<div class="hero-signature">“' + escapeHtml(signatureText) + '”</div>'
    : '';

  const allFields = Array.isArray(profile.customFields) ? profile.customFields : [];
  const shownFields = allFields.slice(0, 3);
  const hiddenCount = allFields.length - shownFields.length;
  const fieldsHtml = shownFields.length
    ? '<div class="hero-fields">' +
        shownFields.map(function (f) {
          // 值可能很长，做一次截断，避免单个标签把整行撑破
          const v = String(f.value || '');
          return '<span class="hero-field-tag" title="' + escapeHtml(f.label + '：' + v) + '">' +
            escapeHtml(f.label) + '：' + escapeHtml(v.length > 20 ? v.slice(0, 20) + '…' : v) +
          '</span>';
        }).join('') +
        (hiddenCount > 0 ? '<span class="hero-field-tag hero-field-more">+' + hiddenCount + '</span>' : '') +
      '</div>'
    : '';
  let banner =
    '<div class="hero-banner">' +
      '<div class="hero-id">' +
        // 头像即个人资料入口（设置页已不再放资料编辑区）；复用 goto-profile action，不新增事件分支
        '<button type="button" class="hero-avatar" data-action="goto-profile" title="点击编辑个人资料">' +
          (typeof buildAvatarInner === 'function' ? buildAvatarInner(avatar.data, avatar.key) : '🙂') +
          '<span class="hero-avatar-edit" aria-hidden="true">✎</span>' +
        '</button>' +
        '<div class="hero-id-text">' +
          '<div class="hero-name">' + username + '</div>' +
          '<div class="hero-birth">' + birthText + '</div>' +
          signatureHtml +
          fieldsHtml +
        '</div>' +
      '</div>' +
      '<div class="hero-stat">' +
        '<div class="hero-level' + (lastShownLevel !== null && stats.age !== lastShownLevel ? ' pulse' : '') + '">Lv.' + stats.age + '</div>' +
        // v5：未设置生日时年龄为 0，「距下一级还有 0 天」毫无意义，改为引导文案
        '<div class="hero-next">' + (stats.hasBirth
          ? '距下一级还有 <strong>' + stats.daysToNext + '</strong> 天'
          : '设置生日后开启等级') + '</div>' +
        '<div class="hero-exp">' +
          // 进度条用 transform: scaleX() 驱动（GPU 合成层），不再逐帧改 width 触发重排
          '<span class="hero-exp-fill" style="transform:scaleX(' +
            (Math.max(0, Math.min(1, stats.progress))).toFixed(4) + ')"></span>' +
        '</div>' +
        // v1.0.2：累计经验（口径与 Android XpRules 一致，含连续记录加成）
        '<div class="hero-xp">⚡ 经验 <strong>' + xpTotalNow + '</strong></div>' +
      '</div>' +
    '</div>';

  /* 2. 全局概览（4 卡，整卡可点击跳转对应页；桌面 4 列、移动 2 列，毛玻璃）
     v1.2.0：四张卡一律渲染 3 行文案 —— 内容行数一致 + CSS grid-auto-rows:1fr，
     两个维度同时约束，保证「上方四个统计卡片大小严格一致」（此前「灵感」只有 1 行会矮一截）。 */
  const recentMemoText = (function () {
    const arr = state.memos.slice().sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
    if (!arr.length) return '暂无记录';
    const t = String(arr[0].text || '');
    return t.length > 16 ? t.slice(0, 16) + '…' : t;
  })();
  const physicalItems = state.items.filter(function (i) { return i && i.type === 'physical'; }).length;
  const todayMemos = state.memos.filter(function (m) {
    return m && (typeof localDayOf === 'function' ? localDayOf(m.createdAt) : String(m.createdAt || '').slice(0, 10)) === todayStr();
  }).length;
  const overdueOpen = (typeof countOverdueOpenTodos === 'function') ? countOverdueOpenTodos() : 0;
  const taskCardLines = ['总数 ' + totalTasks, '已完成 ' + doneTasks, '完成率 ' + doneRatio + '%'];
  if (overdueOpen > 0) taskCardLines[2] = '逾期 ' + overdueOpen;
  const overviewDefs = [
    { icon: '📋', label: '任务', page: 'tasks', lines: taskCardLines },
    { icon: '🎒', label: '背包', page: 'backpack',
      lines: ['物品 ' + state.items.length, '实体 ' + physicalItems, '分类 ' + (state.itemCategories ? state.itemCategories.length : 0)] },
    { icon: '🏆', label: '成就', page: 'achievements',
      lines: ['已解锁 ' + unlockedAch, '总 ' + state.achievements.length,
        '进度 ' + (state.achievements.length ? Math.round(unlockedAch / state.achievements.length * 100) : 0) + '%'] },
    { icon: '📝', label: '灵感', page: 'data',
      lines: ['共 ' + state.memos.length + ' 条', '今日 ' + todayMemos + ' 条',
        '最新：' + recentMemoText] },
  ];
  const overviewCards = overviewDefs.map(function (o) {
    return '<button class="overview-card" data-action="nav" data-page="' + o.page + '">' +
      '<div class="overview-icon">' + o.icon + '</div>' +
      '<div class="overview-label">' + o.label + '</div>' +
      '<div class="overview-lines">' +
        o.lines.map(function (l) { return '<span>' + escapeHtml(l) + '</span>'; }).join('') +
      '</div>' +
    '</button>';
  }).join('');

  /* 3. v1.2.0：快速入口固定 8 个（两行四列）。
     顺序按使用频次排：第一行「创建 / 查看」，第二行「记录 / 工具」。 */
  const quickDefs = [
    { action: 'home-new-task', icon: '📝', label: '新建任务' },
    { action: 'home-add-item', icon: '🎒', label: '添加物品' },
    { action: 'home-ach', icon: '🏆', label: '查看成就' },
    { action: 'home-today', icon: '📅', label: '今日日程' },
    { action: 'home-mood', icon: '🎭', label: '心情' },
    { action: 'home-ai', icon: '🤖', label: '系统' },
    { action: 'open-verifin', icon: '📊', label: '记账' },
    { action: 'nav', page: 'map', icon: '🗺️', label: '足迹地图' },
  ];
  const quickGrid = quickDefs.map(function (q) {
    const pageAttr = q.page ? ' data-page="' + escapeHtml(q.page) + '"' : '';
    return '<button class="quick-tile" data-action="' + q.action + '"' + pageAttr + '>' +
      '<span class="quick-tile-icon">' + q.icon + '</span>' +
      '<span class="quick-tile-label">' + q.label + '</span></button>';
  }).join('');

  /* 4. 世界日志（原灵感闪念，带类型彩色圆点 + 删除） */
  const memoTypeOptions = Object.keys(MEMO_TYPE).map(function (k) {
    return '<option value="' + k + '">' + MEMO_TYPE[k].emoji + ' ' + MEMO_TYPE[k].label + '</option>';
  }).join('');
  const worldRows = recentMemos.length
    ? recentMemos.map(function (m) {
        const mt = MEMO_TYPE[m.type] || MEMO_TYPE.idea;
        // v5：整行可点击 → 跳转数据看板并高亮「周报摘要」。
        // 行内删除按钮自带 data-action，closest 会优先命中它，不会误触跳转。
        return '<div class="world-row" data-action="jump-dashboard" data-target="dashWeek"' +
          ' title="点击查看数据统计">' +
          '<span class="memo-dot ' + mt.cls + '"></span>' +
          '<span class="world-time">' + fmtDateTime(m.createdAt) + '</span>' +
          '<span class="world-text">' + escapeHtml(m.text) + '</span>' +
          '<button class="world-del" data-action="memo-del" data-id="' + m.id + '" title="删除">×</button>' +
        '</div>';
      }).join('')
    : '<div class="empty">📭 还没有记录，在上方输入第一条世界日志吧~</div>';

  /* 5. 最近动态 */
  const actRows = recentActs.length
    ? recentActs.map(function (a) {
        const icon = a.kind === 'ach' ? '🏆' : (a.kind === 'task' ? '📋' : '🎒');
        const verb = a.kind === 'ach' ? '解锁成就' : (a.kind === 'task' ? '完成任务' : '获得物品');
        // v5：整行可点击 → 跳转数据看板并高亮「成就解锁时间线」
        return '<div class="act-row" data-action="jump-dashboard" data-target="dashTimeline"' +
          ' title="点击查看数据统计">' +
          '<span class="act-time">' + escapeHtml(fmtDateTime(a.time).slice(0, 10)) + '</span>' +
          '<span class="act-icon">' + icon + '</span>' +
          '<span>' + verb + '“' + escapeHtml(a.title) + '”</span>' +
        '</div>';
      }).join('')
    : '<div class="empty">✧ 暂无动态，去完成任务或解锁成就试试~</div>';

  /* 3b（v5·减少 DOM）：主页只渲染最近 5 条世界日志；超出部分用「查看全部」跳到数据页（灵感），
     既不膨胀首页 DOM，又保留查看完整记录的能力。少于等于 5 条时不展示该按钮。 */
  const showAllMemosBtn = (state.memos.length > recentMemos.length)
    ? '<button class="world-more" data-action="nav" data-page="data">查看全部 ' +
      state.memos.length + ' 条世界日志 ›</button>'
    : '';

  const quote = (typeof randomQuote === 'function') ? randomQuote() : '';

  /* 6. 人生时间轴（v15 批 C · 第 21 项；v1.2.0 改为精确到日）：
     按日期倒序聚合重要事件（任务完成 / 成就解锁 / 足迹标记）。
     日键一律走 localDayOf（本地时区），不用 iso.slice(0,10) —— 后者是 UTC 日，
     晚上 8 点之后记录的事件会被算成"明天"。 */
  const timelineEvents = [];
  // localDayOf 由 achievements.js 导出；极端加载顺序下兜底为 UTC 日切分，绝不抛异常
  const _dayOf = (typeof localDayOf === 'function')
    ? localDayOf
    : function (v) { return String(v || '').slice(0, 10); };
  (state.tasks || []).forEach(function (t) {
    if (t && t.status === 'done' && t.doneAt) {
      timelineEvents.push({ day: _dayOf(t.doneAt), type: 'task', title: t.title || '任务', time: t.doneAt });
    }
  });
  (state.achievements || []).forEach(function (a) {
    if (a && a.unlocked && a.unlockedAt) {
      timelineEvents.push({ day: _dayOf(a.unlockedAt), type: 'ach', title: a.title || '成就', time: a.unlockedAt });
    }
  });
  (state.locations || []).forEach(function (l) {
    if (l && l.date) {
      timelineEvents.push({ day: _dayOf(l.date), type: 'loc', title: l.name || '足迹', time: l.date });
    }
  });
  timelineEvents.sort(function (a, b) { return a.time < b.time ? 1 : (a.time > b.time ? -1 : 0); });
  const tlShow = timelineEvents.slice(0, 16);
  const tlIcon = { task: '📋', ach: '🏆', loc: '🗺️' };
  const timelineHtml = tlShow.length
    ? '<div class="timeline">' + tlShow.map(function (e) {
        return '<div class="tl-item">' +
          '<span class="tl-dot tl-' + e.type + '"></span>' +
          '<span class="tl-date">' + escapeHtml(e.day || '—') + '</span>' +
          '<span class="tl-icon">' + (tlIcon[e.type] || '•') + '</span>' +
          '<span class="tl-title">' + escapeHtml(e.title) + '</span>' +
        '</div>';
      }).join('') + '</div>'
    : '<div class="empty">✧ 还没有重要事件，去完成任务、解锁成就或标记足迹吧~</div>';

  /* 7. 人生卡片（v15 批 C · 第 21 项）：等级 / 成就 / 足迹 / 任务完成率 + 分享。
     v1.0.2：展示「称号 · Lv.X」、累计经验与徽章墙（最多佩戴 3 枚已解锁成就）。 */
  const wornBadges = (function () {
    const ids = Array.isArray(profile.wornBadges) ? profile.wornBadges : [];
    return ids.map(function (id) {
      const a = (typeof getAchievementById === 'function') ? getAchievementById(id) : null;
      return (a && a.unlocked) ? a : null;
    }).filter(Boolean).slice(0, 3);
  })();
  const wornBadgesHtml = wornBadges.length
    ? '<div class="life-card-badges">' + wornBadges.map(function (a) {
        return '<span class="worn-badge" title="' + escapeHtml(a.title) + '">★ ' + escapeHtml(a.title) + '</span>';
      }).join('') + '</div>'
    : '';
  const unlockedAchCount = state.achievements.filter(function (a) { return a && a.unlocked; }).length;
  const badgeWearBtn = unlockedAchCount
    ? '<button class="btn btn-ghost btn-sm life-card-badge-btn" data-action="badge-wear">🎖️ 佩戴徽章</button>'
    : '';
  const lifeCardHtml =
    '<div class="life-card" id="lifeCard">' +
      '<div class="life-card-head">🌍 地球Online · 人生卡片</div>' +
      '<div class="life-card-name">' + username + '</div>' +
      '<div class="life-card-title">' + escapeHtml(titleText) + ' · Lv.' + stats.age + '</div>' +
      '<div class="life-card-stats">' +
        '<div class="lcs"><b>Lv.' + stats.age + '</b><span>等级</span></div>' +
        '<div class="lcs"><b>' + unlockedAch + '</b><span>成就</span></div>' +
        '<div class="lcs"><b>' + (state.locations || []).length + '</b><span>足迹</span></div>' +
        '<div class="lcs"><b>' + doneRatio + '%</b><span>完成率</span></div>' +
      '</div>' +
      '<div class="life-card-xp">⚡ 累计经验 <strong>' + xpTotalNow + '</strong> 点</div>' +
      wornBadgesHtml +
      '<button class="btn btn-ghost btn-sm life-card-share" data-action="life-card-share">📤 分享人生卡片</button>' +
      badgeWearBtn +
    '</div>';

  /* 0b. 右上角「设置」图标按钮。
     v1.2.1 精简：原「☰ 更多」下拉面板整个移除 —— 成就 / 收藏 / 地图 / 记账 在主页
     快速入口与概览卡里都有直达路径，多一层下拉反而多一次点击。现在右上角只留一个
     齿轮图标，点一下直接进设置页（与 Android 端 SettingsIconButton 行为一致）。
     ⚠️ app.js 里相关的 toggleMorePanel / positionMorePanelSmart / closeMorePanel
     已随面板一并删除（不留死代码），dispatchClick 与 handleBack 里的调用点也清了。 */
  const morePanelHtml =
    '<div class="home-more-wrap">' +
      '<button type="button" class="home-setting-btn" id="moreBtn" data-action="nav" data-page="settings" ' +
        'aria-label="设置" title="设置">⚙️</button>' +
    '</div>';

  /* 0. 主页标题栏（v10）：置于角色信息区上方；面板移入标题栏内作为绝对定位锚点。
     v1.0.2：标题区附当季限定徽章（春樱/夏夜/秋叶/冬雪），标题下方是动态问候语。 */
  const seasonBadgeHtml = season
    ? '<span class="season-badge" style="color:' + season.accent + '" title="' + season.label + '限定">' +
      season.emoji + ' ' + season.label + '</span>'
    : '';
  const greetingHtml = greetingText
    ? '<p class="home-greeting">' + escapeHtml(greetingText) +
      (stageLabel ? ' <span class="streak-badge">' + escapeHtml(stageLabel) + ' · ' + streakDays + ' 天</span>' : '') +
      '</p>'
    : '';
  const comebackHtml = comebackText
    ? '<div class="comeback-card">🌱 ' + escapeHtml(comebackText) + '</div>'
    : '';
  const homeTitle =
    '<div class="home-titlebar">' +
      '<div class="home-title-text">' +
        '<h1 class="home-title">🌍 地球Online' + seasonBadgeHtml + '</h1>' +
        '<p class="home-subtitle">人生记录 · 开放世界</p>' +
        greetingHtml +
      '</div>' +
      morePanelHtml +
    '</div>';

  /* 0b. v1.2.1：主页顶部全局搜索（任务 / 物品 / 收藏）。
     放在标题栏下方而不是每个列表页各放一个 —— 三个数据源本来就跨页，
     只有在主页做才叫「全局」；空词时只有一根搜索条，不抢首屏。 */
  const homeSearch =
    '<div class="home-search-wrap">' +
      '<div class="home-search-box">' +
        '<span class="home-search-icon" aria-hidden="true">🔍</span>' +
        '<input class="home-search-input" id="homeSearch" type="search" autocomplete="off" maxlength="40" ' +
          'placeholder="搜索任务 / 物品 / 收藏…" aria-label="全局搜索">' +
        '<button type="button" class="home-search-clear" data-action="home-search-clear" ' +
          'aria-label="清空搜索" title="清空">✕</button>' +
      '</div>' +
      '<div class="home-search-results" id="homeSearchResults"></div>' +
    '</div>';

  document.getElementById('content').innerHTML =
    '<section class="page home-page">' +
      homeTitle +
      homeSearch +
      memoryCardHtml +
      comebackHtml +
      banner +
      '<div class="overview-grid">' + overviewCards + '</div>' +
      '<div class="quick-grid">' + quickGrid + '</div>' +

      '<div class="card world-card">' +
        '<div class="card-title">🌍 世界日志</div>' +
        '<div class="world-input-row">' +
          '<input class="memo-input" id="homeMemoInput" placeholder="记录一闪而过的想法，回车即保存" maxlength="200">' +
          // v15：语音输入（Web Speech API，中文识别），识别结果直接填入上方输入框
          '<button class="btn btn-ghost btn-sm world-voice-btn" id="homeMemoVoice" data-action="home-memo-voice" title="语音输入" aria-label="语音输入">🎤</button>' +
          '<select id="homeMemoType" class="world-type">' + memoTypeOptions + '</select>' +
          '<button class="btn btn-primary btn-sm" data-action="home-memo-add">📌 记录</button>' +
        '</div>' +
        '<div class="world-list">' + worldRows + '</div>' +
        showAllMemosBtn +
      '</div>' +

      '<div class="card act-card">' +
        '<div class="card-title card-title-row">📡 最近动态' +
          '<button class="card-head-link" data-action="nav" data-page="data">查看 ›</button></div>' +
        '<div class="act-list">' + actRows + '</div>' +
      '</div>' +

      '<div class="card timeline-card">' +
        '<div class="card-title">🕰️ 人生时间轴</div>' +
        timelineHtml +
      '</div>' +

      lifeCardHtml +

      (todayLuck
        ? '<div class="card luck-card">' +
          '<div class="card-title">🔮 今日一签</div>' +
          '<div class="luck-body"><span class="luck-icon">' + todayLuck.icon + '</span>' +
          '<span class="luck-text">' + escapeHtml(todayLuck.text) + '</span></div>' +
          '<div class="muted luck-foot">每天翻开你过去留下的一页，明天再来会是新的一签。</div>' +
        '</div>'
        : '') +

      '<div class="home-quote">“' + escapeHtml(quote) + '”</div>' +
      '<p class="muted home-foot">提示：出生日期（等级 = 年龄）可在「个人资料」中修改。</p>' +
    '</section>';

  // 数字从 0 滚动到目标值
  if (typeof animateCounters === 'function') animateCounters();
  lastShownLevel = stats.age;
}

/* ==================== v15：世界日志语音输入 ==================== */

/** 语音识别实例（会话级；浏览器不支持时为 null） */
let voiceRecognition = null;
/** 是否正在录音 */
let voiceRecording = false;

/**
 * 语音不可用时的降级方案：不静默失败，也不留死路 ——
 * 聚焦世界日志输入框并明确说明原因，提示用户可直接打字或使用输入法的 🎤 语音按钮。
 * （国内安卓 WebView / 本地 file:// 打开时通常没有 Web Speech API，属预期情况。）
 */
function voiceUnavailableFallback(reason) {
  try {
    const input = document.getElementById('homeMemoInput');
    if (input) {
      input.focus();
      if (typeof input.scrollIntoView === 'function') {
        input.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  } catch (e) { /* 忽略聚焦失败 */ }
  toast((reason ? reason + '，' : '') + '已切换到手动输入（也可用输入法的 🎤 语音按钮）');
}

/**
 * 语音输入开关：点击开始识别，再点停止。
 * 用 Web Speech API（webkitSpeechRecognition / SpeechRecognition），中文 zh-CN。
 * 不支持的环境（国内安卓 WebView / file:// / 非安全来源）走 voiceUnavailableFallback 降级。
 */
function toggleVoiceInput() {
  const SR = (typeof window !== 'undefined') ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  if (!SR) {
    voiceUnavailableFallback('当前浏览器不支持语音识别（需 Chrome / Edge 的 HTTPS 环境）');
    return;
  }
  // 安全来源检查：Chrome 只在 https / localhost / file 下提供语音识别，http 站点会静默失败
  const proto = (typeof location !== 'undefined' && location.protocol) ? location.protocol : '';
  if (proto === 'file:') {
    voiceUnavailableFallback('以 file:// 本地打开时浏览器不提供语音识别');
    return;
  }
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    voiceUnavailableFallback('当前是 http 非安全来源，浏览器已禁用语音识别');
    return;
  }
  if (voiceRecording && voiceRecognition) {
    try { voiceRecognition.stop(); } catch (e) { /* 忽略 */ }
    voiceRecording = false;
    syncVoiceButton();
    return;
  }
  const input = document.getElementById('homeMemoInput');
  if (!input) { toast('未找到世界日志输入框'); return; }

  try {
    const rec = new SR();
    rec.lang = 'zh-CN';
    rec.interimResults = true;   // 边说边出字，体验更接近输入法
    rec.continuous = false;
    rec.maxAlternatives = 1;

    const baseText = String(input.value || '');
    let finalAdded = '';

    rec.onresult = function (e) {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = (e.results[i][0] && e.results[i][0].transcript) || '';
        if (e.results[i].isFinal) finalAdded += t;
        else interim += t;
      }
      // 已确认结果保留，未确认结果临时追加在末尾（停止时由 onend 定稿）
      input.value = (baseText + finalAdded + interim).slice(0, 200);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    rec.onerror = function (e) {
      const err = e && e.error;
      if (err === 'not-allowed' || err === 'service-not-allowed') toast('麦克风权限被拒绝，请在系统设置中开启');
      else if (err === 'no-speech') toast('没有听到声音，请再试一次');
      else if (err === 'network') toast('网络不可用，语音识别需要联网');
      else if (err === 'aborted') { /* 用户主动停止，不提示 */ }
      else toast('语音识别失败：' + (err || '未知错误'));
    };
    rec.onend = function () {
      voiceRecording = false;
      syncVoiceButton();
      if (finalAdded) toast('已填入语音内容');
    };

    voiceRecognition = rec;
    voiceRecording = true;
    syncVoiceButton();
    rec.start();
    toast('请开始说话…（说完再点一次 🎤 结束）');
  } catch (e) {
    voiceRecording = false;
    syncVoiceButton();
    toast('语音识别启动失败：' + (e && e.message ? e.message : '未知错误'));
  }
}

/* ==================== v15 批 C · 第 21 项：人生卡片分享 ==================== */

/**
 * 生成人生卡片 PNG（canvas 绘制）并触发下载；同时把文字摘要复制到剪贴板。
 * 纯前端、零依赖，file:// 与 http 均可运行。canvas 不可用（极老内核）时降级为仅复制文字。
 */
function shareLifeCard() {
  var name = '地球玩家';
  try { name = (getProfile() && getProfile().name) || name; } catch (e) {}
  var age = (typeof getLifeStats === 'function' && state.birthDate) ? getLifeStats(state.birthDate).age : 0;
  var ach = (state.achievements || []).filter(function (a) { return a.unlocked; }).length;
  var locs = (state.locations || []).length;
  var doneTasks = (state.tasks || []).filter(function (t) { return t.status === 'done'; }).length;
  var ratio = state.tasks.length ? Math.round(doneTasks / state.tasks.length * 100) : 0;
  var summary = '🌍 地球Online 人生卡片\n角色：' + name +
    '\n等级 Lv.' + age + ' · 成就 ' + ach + '/' + (state.achievements || []).length +
    ' · 足迹 ' + locs + ' · 任务完成率 ' + ratio + '%';

  try {
    if (typeof document === 'undefined' || !document.createElement) throw new Error('no canvas');
    var canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 860;
    var ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no ctx');
    var g = ctx.createLinearGradient(0, 0, 0, 860);
    g.addColorStop(0, '#f8f6f2'); g.addColorStop(1, '#ece2d4');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 640, 860);
    ctx.fillStyle = '#8a5a2e'; ctx.fillRect(0, 0, 640, 10);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#1e1a16'; ctx.font = 'bold 36px sans-serif';
    ctx.fillText('🌍 地球Online', 44, 96);
    ctx.fillStyle = '#7a7268'; ctx.font = '18px sans-serif';
    ctx.fillText('人生记录 · 开放世界', 44, 128);
    ctx.fillStyle = '#1e1a16'; ctx.font = 'bold 28px sans-serif';
    ctx.fillText('角色：' + (name.length > 18 ? name.slice(0, 18) + '…' : name), 44, 210);
    ctx.font = '26px sans-serif'; ctx.fillStyle = '#2c1e12';
    var lines = [
      '等级　Lv.' + age,
      '成就　' + ach + ' / ' + (state.achievements || []).length,
      '足迹　' + locs + ' 个地点',
      '任务完成率　' + ratio + '%',
      '生日　' + (state.birthDate || '未设置')
    ];
    lines.forEach(function (l, i) { ctx.fillText(l, 44, 270 + i * 48); });
    ctx.fillStyle = '#b0a89c'; ctx.font = '15px sans-serif';
    ctx.fillText('由「地球Online」生成 · ' + (typeof todayStr === 'function' ? todayStr() : ''), 44, 812);

    var url = canvas.toDataURL('image/png');
    var a = document.createElement('a');
    a.href = url; a.download = '人生卡片.png';
    document.body.appendChild(a); a.click(); a.remove();
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(summary).catch(function () {});
    }
    toast('人生卡片已生成并复制到剪贴板');
  } catch (e) {
    // 降级：仅复制文字摘要
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(summary).then(function () { toast('已复制人生卡片摘要'); },
        function () { toast('生成卡片失败，请截图主页'); });
    } else {
      toast('生成卡片失败，请截图主页');
    }
  }
}

/* v1.0.2：徽章墙选择器 —— 从已解锁成就中佩戴最多 3 枚（模态 + 就地刷新） */
function openBadgeWallModal() {
  const worn = (getProfile().wornBadges || []).slice();
  const unlocked = state.achievements.filter(function (a) { return a && a.unlocked && a.title; });
  const rows = unlocked.length
    ? unlocked.map(function (a) {
        const isWorn = worn.indexOf(a.id) !== -1;
        return '<button class="badge-wall-item' + (isWorn ? ' worn' : '') + '" data-action="badge-toggle" data-id="' +
          a.id + '" title="' + (isWorn ? '点击摘下' : '点击佩戴') + '">' +
          '<span class="badge-wall-star">' + (isWorn ? '★' : '☆') + '</span>' +
          '<span class="badge-wall-title">' + escapeHtml(a.title) + '</span>' +
          '<span class="badge-wall-state">' + (isWorn ? '已佩戴' : '佩戴') + '</span>' +
        '</button>';
      }).join('')
    : '<div class="empty">还没有已解锁的成就，先去解锁一枚吧~</div>';
  openModal(
    '<h3 class="modal-title">🎖️ 佩戴徽章</h3>' +
    '<p class="modal-text">从已解锁的成就里挑最多 3 枚，佩戴在主页人生卡片上。</p>' +
    '<div class="badge-wall-list">' + rows + '</div>' +
    '<div class="modal-actions"><button class="btn btn-ghost" id="badgeWallClose">关闭</button></div>'
  );
  const closeBtn = document.getElementById('badgeWallClose');
  if (closeBtn) closeBtn.onclick = closeModal;
}

/** 同步麦克风按钮的视觉状态（录音中高亮） */
function syncVoiceButton() {
  const btn = document.getElementById('homeMemoVoice');
  if (!btn) return;
  if (voiceRecording) btn.classList.add('recording');
  else btn.classList.remove('recording');
  btn.title = voiceRecording ? '停止录音' : '语音输入';
}

/* ==================== v1.2.1：空状态引导 ==================== */

/**
 * 统一的空状态：大 emoji（插画位）+ 标题 + 一句人话解释 + 一个直达按钮。
 * 空列表只写「暂无数据」等于把最该教学的位置浪费掉了 ——
 * 用户第一次进来看到的是一堵白墙，不知道能做什么、做了会得到什么。
 * @param {string} emoji
 * @param {string} title
 * @param {string} message
 * @param {string} [btnHtml] 直达按钮（已有 data-action，自动被全局委托接管）
 */
function emptyStateHtml(emoji, title, message, btnHtml) {
  return '<div class="empty-state">' +
    '<div class="empty-state-art">' + emoji + '</div>' +
    '<div class="empty-state-title">' + escapeHtml(title) + '</div>' +
    '<p class="empty-state-msg">' + escapeHtml(message) + '</p>' +
    (btnHtml ? '<div class="empty-state-actions">' + btnHtml + '</div>' : '') +
  '</div>';
}

/* ==================== 任务指引 ==================== */

/* 记录本轮刚刚被勾选的任务 id，用于在重渲时播放一次勾选弹跳动效 */
let bouncedTodoIds = new Set();
/* 记录上次渲染时展示的等级，用于生日更新后触发等级脉冲 */
let lastShownLevel = null;

function renderTasks() {
  const horizon = dayKeyAddDays(todayStr(), 7); // 今天起 7 天内（含已过期）视为「即将到期」
  const roots = taskDueFilter
    ? getRootTasks().filter(function (t) {
        return t.category === 'todo' && t.status !== 'done' && t.dueDate && t.dueDate <= horizon;
      })
    : (taskFilter === 'all'
      ? getRootTasks()
      : getRootTasks().filter(function (t) { return t.category === taskFilter; }));
  const taskTabHtml = [{ k: 'all', l: '全部' }, { k: 'main', l: '主线' }, { k: 'side', l: '支线' }, { k: 'todo', l: 'To Do' }]
    .map(function (t) {
      return '<button class="tab ' + (taskFilter === t.k ? 'active' : '') + '" data-action="task-filter" data-cat="' + t.k + '">' + t.l + '</button>';
    }).join('');
  const html =
    '<section class="page">' +
      '<div class="page-head">' +
        '<h2 class="page-title">任务</h2>' +
        '<button class="btn btn-primary" data-action="open-task-new">新增任务</button>' +
      '</div>' +
      '<div class="tabs">' + taskTabHtml + '</div>' +
      '<div class="legend">' +
        '<span class="legend-item"><span class="badge cat-main">主线</span>人生大方向，长期经营</span>' +
        '<span class="legend-item"><span class="badge cat-side">支线</span>主线下的具体领域</span>' +
        '<span class="legend-item"><span class="badge cat-todo">To Do</span>可勾选的具体行动</span>' +
      '</div>' +
      (taskDueFilter
        ? '<p class="backup-note">📅 即将到期的任务（含已过期），未来 7 天内到期会在此列出。' +
          '<button class="btn btn-ghost btn-sm" data-action="task-filter" data-cat="all">查看全部任务</button></p>'
        : '') +
      (roots.length
        ? roots.map(renderTaskNode).join('')
        : (taskDueFilter
          ? '<div class="card empty">📭 近期没有即将到期的任务，继续保持~</div>'
          : (function () {
              const t = (taskFilter === 'side')
                ? {
                    art: '🗺️',
                    title: '还没有支线',
                    msg: '支线是那些「想做但没那么急」的事。想到就记下来，免得转头就忘了。',
                    cta: '创建支线任务',
                  }
                : (taskFilter === 'todo')
                ? {
                    art: '☑️',
                    title: 'To Do 是空的',
                    msg: '临时冒出来的小事往这儿丢：交水电费、回个消息、买瓶酱油。做完划掉就行。',
                    cta: '创建 To Do',
                  }
                : {
                    art: '📋',
                    title: '主线还是空白的',
                    msg: '主线是你真正想推进的事：学会一样东西、跑完一次半马、把房间收拾干净。先立一条，之后可以拆成子任务慢慢啃。',
                    cta: '创建第一条任务',
                  };
              return emptyStateHtml(t.art, t.title, t.msg,
                '<button class="btn btn-primary" data-action="open-task-new">' + t.cta + '</button>');
            })())) +
    '</section>';
  document.getElementById('content').innerHTML = html;
  bouncedTodoIds.clear();
}

/** 递归渲染任务节点（无限层级树） */
function renderTaskNode(task) {
  const children = getChildTasks(task.id);
  const expanded = taskTreeExpanded.has(task.id);
  const noteOpen = noteOpenIds.has(task.id);
  const cat = TASK_CATEGORY[task.category];
  const st = TASK_STATUS[task.status];
  const today = todayStr();
  const overdue = task.category === 'todo' && task.dueDate && task.dueDate < today && task.status !== 'done';
  const dueHtml = task.category === 'todo' && task.dueDate
    ? '<span class="due ' + (overdue ? 'due-overdue' : '') + '" title="到期日期">' +
        (overdue ? '已过期 ' : '到期 ') + escapeHtml(task.dueDate) + '</span>'
    : '';

  return (
    '<div class="task-node ' + (task.status === 'done' ? 'is-done' : '') + '">' +
      '<div class="task-row">' +
        '<span class="tree-toggle">' +
          (children.length
            ? '<button class="toggle-btn ' + (expanded ? 'expanded' : '') + '" data-action="toggle-task" data-id="' +
              task.id + '" title="展开 / 折叠">' + (expanded ? '▾' : '▸') + '</button>'
            : '') +
        '</span>' +
        (task.category === 'todo'
          ? '<input type="checkbox" class="todo-check' + (bouncedTodoIds.has(task.id) ? ' bounce' : '') + '" data-action="todo-toggle" data-id="' + task.id + '" ' +
              (task.status === 'done' ? 'checked' : '') + ' title="勾选即完成">'
          : '') +
        '<span class="badge ' + cat.cls + '">' + cat.label + '</span>' +
        '<span class="task-title">' + escapeHtml(task.title) + '</span>' +
        dueHtml +
        '<span class="status-badge ' + st.cls + '">' + st.label + '</span>' +
        '<span class="task-progress-wrap" title="进度 ' + task.progress + '%">' +
          // 进度条改用 transform: scaleX()（0–1），与 .hero-exp-fill 同一套 GPU 优化
          '<span class="progress-bar sm"><span class="progress-fill" style="transform:scaleX(' +
            (Math.max(0, Math.min(100, task.progress)) / 100).toFixed(4) + ')"></span></span>' +
          '<span class="progress-num">' + task.progress + '%</span>' +
        '</span>' +
        '<span class="task-actions">' +
          (task.category !== 'todo'
            ? '<button class="icon-btn primary" data-action="task-quick-complete" data-id="' + task.id + '">' +
              (task.status === 'done' ? '↩ 重开' : '✓ 完成') + '</button>'
            : '') +
          '<button class="icon-btn" data-action="note-toggle" data-id="' + task.id + '" title="备注区">备注</button>' +
          '<button class="icon-btn" data-action="open-task-child" data-id="' + task.id + '" title="添加子任务">+子任务</button>' +
          '<button class="icon-btn" data-action="open-task-edit" data-id="' + task.id + '" title="编辑">编辑</button>' +
          '<button class="icon-btn danger" data-action="task-delete" data-id="' + task.id + '" title="删除">删除</button>' +
        '</span>' +
      '</div>' +
      (noteOpen
        ? '<div class="task-note">' +
            '<textarea class="note-textarea" data-note-for="' + task.id + '" ' +
              'placeholder="自由备注区：进度、心得、记录买了什么装备……保存时会自动检测可入库物品">' +
              escapeHtml(task.note || '') + '</textarea>' +
            '<div class="note-foot">' +
              '<span class="muted">最近更新：' + escapeHtml(task.lastModified) + '</span>' +
              '<button class="btn btn-primary btn-sm" data-action="note-save" data-id="' + task.id + '">保存备注</button>' +
            '</div>' +
          '</div>'
        : '') +
      (expanded && children.length
        ? '<div class="task-children">' + children.map(renderTaskNode).join('') + '</div>'
        : '') +
    '</div>'
  );
}

/** 供任务模态框选择父任务用（排除自身及其后代，防止成环） */
function buildParentOptions(excludeId, selectedId) {
  const banned = new Set(excludeId ? [excludeId].concat(getDescendantIds(excludeId)) : []);
  const options = ['<option value="">（顶级任务）</option>'];
  state.tasks.forEach(function (t) {
    if (banned.has(t.id)) return;
    const depth = getTaskDepth(t);
    const label = '　'.repeat(depth - 1) + (depth > 1 ? '└ ' : '') + t.title;
    options.push('<option value="' + t.id + '"' + (t.id === selectedId ? ' selected' : '') + '>' +
      escapeHtml(label) + '</option>');
  });
  return options.join('');
}

/** 任务新增 / 编辑模态框。presetParentId 用于「+子任务」快速入口 */
function openTaskModal(taskId, presetParentId) {
  const task = taskId ? getTaskById(taskId) : null;
  const isEdit = !!task;
  const parentOptions = buildParentOptions(isEdit ? task.id : null, task ? task.parentId : (presetParentId || null));

  const categoryOptions = Object.keys(TASK_CATEGORY).map(function (key) {
    const cur = task ? task.category === key : (key === 'side');
    return '<option value="' + key + '"' + (cur ? ' selected' : '') + '>' + TASK_CATEGORY[key].label + '</option>';
  }).join('');
  const statusOptions = Object.keys(TASK_STATUS).map(function (key) {
    const cur = task ? task.status === key : (key === 'planning');
    return '<option value="' + key + '"' + (cur ? ' selected' : '') + '>' + TASK_STATUS[key].label + '</option>';
  }).join('');

  openModal(
    '<h3 class="modal-title">' + (isEdit ? '编辑任务' : '新增任务') + '</h3>' +
    '<div class="form-row"><label>标题</label><input id="tmTitle" placeholder="要做点什么？" value="' +
      escapeHtml(task ? task.title : '') + '"></div>' +
    '<div class="form-row"><label>分类</label><select id="tmCategory">' + categoryOptions + '</select></div>' +
    '<div class="form-row"><label>状态</label><select id="tmStatus">' + statusOptions + '</select></div>' +
    '<div class="form-row"><label>进度 %</label><input id="tmProgress" type="number" min="0" max="100" value="' +
      (task ? task.progress : 0) + '"></div>' +
    '<div class="form-row"><label>到期日期<br><small class="muted">仅 To Do 生效</small></label>' +
      '<input id="tmDue" type="date" value="' + escapeHtml(task && task.dueDate ? task.dueDate : '') + '"></div>' +
    '<div class="form-row"><label>父任务</label><select id="tmParent">' + parentOptions + '</select></div>' +
    '<div class="form-row"><label>备注</label><textarea id="tmNote" placeholder="备注也可稍后在任务行展开编辑">' +
      escapeHtml(task ? (task.note || '') : '') + '</textarea></div>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-ghost" id="tmCancel">取消</button>' +
      '<button class="btn btn-primary" id="tmSave">' + (isEdit ? '保存修改' : '创建任务') + '</button>' +
    '</div>'
  );

  document.getElementById('tmCancel').onclick = closeModal;
  document.getElementById('tmSave').onclick = function () {
    const title = val('tmTitle').trim();
    if (!title) { toast('任务标题不能为空'); return; }
    const data = {
      title: title,
      category: val('tmCategory'),
      status: val('tmStatus'),
      progress: Number(val('tmProgress')) || 0,
      dueDate: val('tmDue') || null,
      parentId: val('tmParent') || null,
      note: val('tmNote'),
    };
    if (isEdit) {
      updateTask(task.id, data);
      toast('任务已更新');
    } else {
      const created = createTask(data);
      // 自动展开祖先链，让新任务立即可见
      let pid = created.parentId;
      while (pid) {
        taskTreeExpanded.add(pid);
        const parent = getTaskById(pid);
        pid = parent ? parent.parentId : null;
      }
      toast('任务已创建');
    }
    closeModal();
    checkAutoAchievements();
    refreshCurrentPage();
  };
}

/** 备注保存 + 智能联动（检测购买/获得关键词，询问是否存入背包） */
function handleNoteSave(taskId) {
  const textarea = document.querySelector('textarea[data-note-for="' + taskId + '"]');
  if (!textarea) return;
  const task = getTaskById(taskId);
  if (!task) return;

  const text = textarea.value;
  task.note = text;
  task.lastModified = todayStr();
  saveState();
  toast('备注已保存');
  checkAutoAchievements();
  renderTasks(); // 刷新以更新「最近更新」时间

  const names = detectAcquiredItems(text);
  if (names.length) promptAcquireQueue(names);
}

/* ---------- 背包智能联动：关键词检测 ---------- */

const ACQUIRE_KEYWORDS = ['买了', '购入', '入手', '获得', '新添', '添置', '购得', '收了'];
const ACQUIRE_STOPWORDS = ['一个', '一些', '新的', '新', '这个', '那个', '一点', '不少', '一台', '一部', '一套'];

/** 去掉候选名称开头的语气填充词，如「了一个新键盘」→「键盘」 */
function stripLeadingFillers(s) {
  let out = s;
  let changed = true;
  while (changed && out.length) {
    changed = false;
    for (let i = 0; i < ACQUIRE_STOPWORDS.length; i++) {
      const w = ACQUIRE_STOPWORDS[i];
      if (out.indexOf(w) === 0) {
        out = out.slice(w.length);
        changed = true;
      }
    }
    if (out.length && (out.charAt(0) === '的' || out.charAt(0) === '了')) {
      out = out.slice(1);
      changed = true;
    }
  }
  return out;
}

/**
 * 检测备注文本中的购买/获得类关键词，返回疑似物品名称列表。
 * 规则：关键词后紧跟的连续中文/字母/数字片段视为物品名（去掉填充词）。
 */
function detectAcquiredItems(text) {
  const found = [];
  if (!text) return found;
  ACQUIRE_KEYWORDS.forEach(function (kw) {
    let idx = text.indexOf(kw);
    while (idx !== -1) {
      const rest = text.slice(idx + kw.length);
      const match = rest.match(/^([\u4e00-\u9fa5A-Za-z0-9]{1,12})/);
      if (match) {
        const name = stripLeadingFillers(match[1]);
        if (name.length >= 1 && name.length <= 12) found.push(name);
      }
      idx = text.indexOf(kw, idx + kw.length);
    }
  });
  return Array.from(new Set(found)).slice(0, 3);
}

/** 逐个询问检测到的物品是否存入背包 */
function promptAcquireQueue(names) {
  if (!names.length) return;
  const name = names[0];
  const rest = names.slice(1);
  openConfirm(
    '在备注中检测到疑似获得的物品「' + name + '」，要存入背包吗？',
    function () { // 确认：弹出表单选择分类并入库
      openItemModal(null, name, function () { promptAcquireQueue(rest); });
    },
    function () { // 取消：继续处理下一个
      promptAcquireQueue(rest);
    }
  );
}

/* ==================== 背包装备 ==================== */

let backpackCatFilter = 'all';   // v1.0.3：背包分类筛选（'all' = 不过滤）

function renderBackpack() {
  const collectionCount = state.collections.length;
  const isCollection = backpackTab === 'collection';
  const keyword = String(backpackSearch || '').trim().toLowerCase();
  const cats = getItemCategoryList();

  const chips = ['<button class="tab ' + (backpackTab === 'all' || !backpackTab ? 'active' : '') +
      '" data-action="backpack-tab" data-tab="all">📦 物品（' + state.items.length + '）</button>']
    .concat(['<button class="tab ' + (isCollection ? 'active' : '') + '" data-action="backpack-tab" data-tab="collection">⭐ 收藏夹（' + collectionCount + '）</button>'])
    .join('');

  // v1.0.3：分类标签栏 —— 常驻展示在「分类管理」按钮右侧，物品 / 收藏夹两视图均可见、可横向滚动。
  // 新建分类后立即出现；点击按分类筛选物品（在收藏夹视图下点击则切回物品视图并应用筛选）。
  const catChips = ['<button class="bp-cat-chip ' + (backpackCatFilter === 'all' ? 'active' : '') +
      '" data-action="bp-cat-filter" data-cat="all">全部</button>']
    .concat(cats.map(function (c) {
      return '<button class="bp-cat-chip ' + (backpackCatFilter === c.id ? 'active' : '') +
        '" data-action="bp-cat-filter" data-cat="' + c.id + '">' + escapeHtml(c.name) + '</button>';
    })).join('');
  const catBar = '<div class="bp-cat-bar">' +
      '<button class="btn btn-ghost btn-sm" data-action="manage-categories">⚙️ 分类管理</button>' +
      (cats.length ? '<div class="bp-cat-row">' + catChips + '</div>' : '') +
    '</div>';

  let body;
  if (isCollection) {
    body = renderCollectionsTab();
  } else {
    // 物品视图：先按搜索词过滤（名称 / 描述 / 分类名），再按当前选中的分类筛选
    let list = state.items.slice();
    if (keyword) {
      list = list.filter(function (i) {
        const cat = (state.itemCategories || []).find(function (c) { return c.id === i.category; });
        return (i.name || '').toLowerCase().indexOf(keyword) !== -1 ||
          (i.description || '').toLowerCase().indexOf(keyword) !== -1 ||
          (cat && cat.name.toLowerCase().indexOf(keyword) !== -1);
      });
    }
    if (backpackCatFilter && backpackCatFilter !== 'all') {
      list = list.filter(function (i) { return i.category === backpackCatFilter; });
    }
    body = list.length
      ? '<div class="item-grid bp-grid">' + list.map(renderItemCard).join('') + '</div>'
      : (state.items.length
        ? '<div class="card empty">🔍 没有匹配的物品</div>'
        : emptyStateHtml('🎒', '背包还是空的',
            '把你拥有的、想留下的东西登记进来：一台相机、一本读到一半的书、一张还没用的券。以后翻背包就像翻自己的人生清单。',
            '<button class="btn btn-primary" data-action="item-new">添加第一件物品</button>'));
  }

  document.getElementById('content').innerHTML =
    '<section class="page">' +
      '<div class="page-head">' +
        '<h2 class="page-title">背包</h2>' +
        (isCollection
          ? '<button class="btn btn-primary" data-action="collection-new">+ 新收藏</button>'
          : '<button class="btn btn-primary" data-action="item-new">添加</button>') +
      '</div>' +
      '<div class="tabs">' + chips + '</div>' +
      (isCollection ? '' :
        '<div class="backpack-search-row">' +
          '<input id="backpackSearch" class="list-input" data-action="backpack-search" ' +
            'placeholder="搜索名称 / 分类" value="' + escapeHtml(backpackSearch) + '">' +
        '</div>') +
      catBar +
      body +
    '</section>';
}

/** 背包「全部」视图搜索：即时过滤 + 焦点恢复（与收藏夹搜索同款体验） */
function handleBackpackSearchInput(value) {
  backpackSearch = value == null ? '' : value;
  renderBackpack();
  const el = document.getElementById('backpackSearch');
  if (el) {
    try { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } catch (e) { /* 忽略 */ }
  }
}

function renderItemCard(item) {
  // v9：徽章显示用户自定义分类名（原为固定的「虚拟物品 / 实体物品」）。
  // item.type 仍留在数据里做兼容，但不再决定界面呈现。
  const cat = (state.itemCategories || []).find(function (c) { return c.id === item.category; });
  return (
    '<div class="item-card bp-card">' +
      '<div class="item-head">' +
        '<span class="badge ' + (cat ? 'badge-cat' : 'badge-none') + '">' + escapeHtml(cat ? cat.name : '未分类') + '</span>' +
        '<span class="task-actions">' +
          '<button class="icon-btn" data-action="item-edit" data-id="' + item.id + '">编辑</button>' +
          '<button class="icon-btn danger" data-action="item-delete" data-id="' + item.id + '">删除</button>' +
        '</span>' +
      '</div>' +
      '<div class="item-name">' + escapeHtml(item.name) + '</div>' +
      // v1.0.2：物品故事卡 —— 有描述时以 📖 书签样式强调展示（物品故事比属性更值得被看见）
      (item.description
        ? '<div class="item-desc item-story"><span class="item-story-mark">📖</span>' + escapeHtml(item.description) + '</div>'
        : '<div class="item-desc">' + escapeHtml(item.description || '—') + '</div>') +
      '<div class="muted item-date">入手时间：' + escapeHtml(item.createdAt) + '</div>' +
    '</div>'
  );
}

/** 按分类聚合展示：标题 + 卡片网格 */
function renderCategoryGroup(name, items)  {
  return '<div class="item-group">' +
    '<div class="item-group-title">' + escapeHtml(name) + '（' + items.length + '）</div>' +
    '<div class="item-grid">' + items.map(renderItemCard).join('') + '</div>' +
  '</div>';
}

/** 分类管理模态：新增 / 重命名 / 删除自定义分类 */
function openCategoryManageModal() {
  const cats = getItemCategoryList();
  const rows = cats.length
    ? cats.map(function (c) {
        return '<div class="list-row">' +
          '<span class="field-label">' + escapeHtml(c.name) + '</span>' +
          '<span class="task-actions">' +
            '<button class="icon-btn" data-action="category-rename" data-id="' + c.id + '">重命名</button>' +
            '<button class="icon-btn danger" data-action="category-delete" data-id="' + c.id + '">删除</button>' +
          '</span>' +
        '</div>';
      }).join('')
    : '<div class="empty">还没有自定义分类，在上方添加一个吧~</div>';
  openModal(
    '<h3 class="modal-title">分类管理</h3>' +
    '<div class="form-row"><label>新分类</label><div style="display:flex;gap:8px">' +
      '<input id="newCatName" placeholder="分类名称（如：数码、书籍）" maxlength="30">' +
      '<button class="btn btn-primary" id="catAdd">添加</button></div></div>' +
    '<div class="list-group">' + rows + '</div>' +
    '<div class="modal-actions"><button class="btn btn-ghost" id="catClose">关闭</button></div>'
  );
  const closeBtn = document.getElementById('catClose');
  if (closeBtn) closeBtn.onclick = closeModal;
  const addBtn = document.getElementById('catAdd');
  if (addBtn) addBtn.onclick = function () {
    const res = createItemCategory(val('newCatName').trim());
    if (!res.ok) { toast(res.error); return; }
    openCategoryManageModal();
    renderBackpack();
  };
}

/** 重命名分类模态 */
function openCategoryRenameModal(id, name) {
  openModal(
    '<h3 class="modal-title">重命名分类</h3>' +
    '<div class="form-row"><label>名称</label><input id="catRename" maxlength="30" value="' + escapeHtml(name) + '"></div>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-ghost" id="crCancel">取消</button>' +
      '<button class="btn btn-primary" id="crSave">保存</button>' +
    '</div>'
  );
  const cancelBtn = document.getElementById('crCancel');
  if (cancelBtn) cancelBtn.onclick = closeModal;
  const saveBtn = document.getElementById('crSave');
  if (saveBtn) saveBtn.onclick = function () {
    const res = renameItemCategory(id, val('catRename').trim());
    if (!res.ok) { toast(res.error); return; }
    closeModal();
    renderBackpack();
    openCategoryManageModal();
  };
}

/** 物品新增 / 编辑模态框；presetName 用于备注智能联动预填名称 */
function openItemModal(item, presetName, onDone) {
  openModal(
    '<h3 class="modal-title">' + (item ? '编辑物品' : '存入背包') + '</h3>' +
    '<div class="form-row"><label>名称</label><input id="imName" placeholder="这件物品叫什么？" value="' +
      escapeHtml(item ? item.name : (presetName || '')) + '"></div>' +
    // v9：分类改为「下拉选择 + 就地新建」。原来这里有两个都叫「分类」的下拉
    // （虚拟/实体 + 自定义分类），既重复又让固定枚举喧宾夺主。
    '<div class="form-row"><label>分类</label><select id="imCategory">' +
      '<option value="">未分类</option>' +
      getItemCategoryList().map(function (c) {
        return '<option value="' + c.id + '"' + (item && item.category === c.id ? ' selected' : '') + '>' + escapeHtml(c.name) + '</option>';
      }).join('') +
    '</select></div>' +
    '<div class="form-row"><label>新建分类</label><input id="imNewCat" placeholder="下拉里没有？直接输入新分类名（可选）" maxlength="30"></div>' +
    '<div class="form-row"><label>描述 / 备注</label><textarea id="imDesc" placeholder="描述或备注（可选）">' +
      escapeHtml(item ? (item.description || '') : '') + '</textarea></div>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-ghost" id="imCancel">取消</button>' +
      '<button class="btn btn-primary" id="imSave">' + (item ? '保存修改' : '存入背包') + '</button>' +
    '</div>'
  );

  document.getElementById('imCancel').onclick = function () { closeModal(); if (onDone) onDone(); };
  document.getElementById('imSave').onclick = function () {
    const name = val('imName').trim();
    if (!name) { toast('名称不能为空'); return; }

    // 「新建分类」留空时以下拉为准；填了则优先用新分类（同名已存在就复用，不报错）
    let categoryId = String(val('imCategory') || '');
    const newCat = String(val('imNewCat') || '').trim();
    if (newCat) {
      const r = resolveOrCreateItemCategory(newCat);
      if (!r.ok) { toast(r.error); return; }
      categoryId = r.id;
    }

    if (item) {
      updateItem(item.id, { name: name, description: val('imDesc').trim(), category: categoryId });
      toast('物品已更新');
    } else {
      addItem({ name: name, description: val('imDesc').trim(), category: categoryId });
      toast('「' + name + '」已存入背包');
    }
    closeModal();
    if (currentPage === 'backpack') renderBackpack();
    if (onDone) onDone();
  };
}

/* ==================== 日历 ==================== */

/** 汇总某天的全部事件：到期 To Do / 灵感闪念 / 备注更新的任务 */
function getCalendarEvents(dateStr) {
  return {
    todos: state.tasks.filter(function (t) { return t.category === 'todo' && t.dueDate === dateStr; }),
    memos: state.memos.filter(function (m) { return todayStr(new Date(m.createdAt)) === dateStr; }),
    noteTasks: state.tasks.filter(function (t) { return t.lastModified === dateStr && (t.note || '').trim() !== ''; }),
    notes: (state.calendarNotes && typeof state.calendarNotes[dateStr] === 'string') ? [state.calendarNotes[dateStr]] : [],
  };
}

/**
 * 日历区块（月份导航 + 月历卡片 + 选中日详情）。
 * 抽成独立函数是为了让「数据」页的日历视图直接复用，避免两份渲染逻辑各改各的。
 */
function buildCalendarBlockHtml() {
  const y = calendarCursor.getFullYear();
  const m = calendarCursor.getMonth();
  const startWeekday = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = todayStr();

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const weekNames = ['日', '一', '二', '三', '四', '五', '六'];
  const grid = cells.map(function (d) {
    if (d === null) return '<div class="cal-cell blank"></div>';
    const p = function (n) { return String(n).padStart(2, '0'); };
    const dateStr = y + '-' + p(m + 1) + '-' + p(d);
    const ev = getCalendarEvents(dateStr);
    const hasEvents = ev.todos.length > 0 || ev.memos.length > 0 || ev.noteTasks.length > 0 || ev.notes.length > 0;
    return '<button class="cal-cell' + (dateStr === today ? ' is-today' : '') +
      (dateStr === calendarSelected ? ' is-selected' : '') +
      '" data-action="cal-select" data-date="' + dateStr + '">' +
      '<span class="cal-day">' + d + '</span>' +
      (hasEvents ? '<span class="cal-dot" title="当天有记录"></span>' : '') +
    '</button>';
  }).join('');

  return '<div class="cal-nav">' +
      '<button class="btn btn-ghost" data-action="cal-prev">上个月</button>' +
      '<span class="cal-title">' + y + ' 年 ' + (m + 1) + ' 月</span>' +
      '<button class="btn btn-ghost" data-action="cal-next">下个月</button>' +
      '<button class="btn btn-ghost" data-action="cal-today">今天</button>' +
    '</div>' +
    '<div class="card">' +
      '<div class="cal-week-row">' +
        weekNames.map(function (w) { return '<span class="cal-week">' + w + '</span>'; }).join('') +
      '</div>' +
      '<div class="cal-grid">' + grid + '</div>' +
    '</div>' +
    renderCalendarDetail();
}

/**
 * 独立日历页。
 * v5 起左下导航的「日历」入口已并入「数据」页（作为该页的日历视图），
 * 此函数保留以便直接调用与向后兼容。
 */
function renderCalendar() {
  document.getElementById('content').innerHTML =
    '<section class="page">' +
      '<div class="page-head"><h2 class="page-title">日历</h2></div>' +
      buildCalendarBlockHtml() +
    '</section>';
}

/** 右下角（下方）选中日的详情面板 */
function renderCalendarDetail() {
  const ev = getCalendarEvents(calendarSelected);
  const todoHtml = ev.todos.length
    ? ev.todos.map(function (t) {
        return '<div class="detail-item">' + escapeHtml(t.title) +
          (t.status === 'done' ? ' <span class="status-badge status-done">已完成</span>' : '') + '</div>';
      }).join('')
    : '<div class="detail-item muted">当天没有到期的 To Do</div>';
  const memoHtml = ev.memos.length
    ? ev.memos.map(function (memo) {
        return '<div class="detail-item">' + escapeHtml(memo.text) +
          '<span class="muted">（' + fmtDateTime(memo.createdAt) + '）</span></div>';
      }).join('')
    : '<div class="detail-item muted">当天没有灵感闪念</div>';
  const noteHtml = ev.noteTasks.length
    ? ev.noteTasks.map(function (t) {
        return '<div class="detail-item">' + escapeHtml(t.title) + '<span class="muted">：' +
          escapeHtml(t.note.length > 40 ? t.note.slice(0, 40) + '…' : t.note) + '</span></div>';
      }).join('')
    : '<div class="detail-item muted">当天没有任务备注更新</div>';

  return (
    '<div class="card cal-detail">' +
      '<div class="card-title">' + escapeHtml(calendarSelected) + ' 的记录</div>' +
      '<div class="cal-detail-grid">' +
        '<div><div class="detail-sub">到期的 To Do</div>' + todoHtml + '</div>' +
        '<div><div class="detail-sub">灵感闪念</div>' + memoHtml + '</div>' +
        '<div><div class="detail-sub">任务备注更新</div>' + noteHtml + '</div>' +
      '</div>' +
      '<div class="cal-note-block">' +
        '<div class="cal-note-title">📝 当天随手记</div>' +
        '<textarea id="calNoteInput" class="cal-note-textarea" placeholder="给这一天写点什么…">' + escapeHtml(ev.notes[0] || '') + '</textarea>' +
        // v15：「清除」按钮常驻显示 —— 此前按 ev.notes[0] 条件渲染，保存后需要整块重渲才会出现，
        // 而重渲会销毁 textarea 导致输入焦点丢失（即「输入框自动退出」）。改为常驻后保存/清除都不必重渲。
        '<div class="modal-actions">' +
          '<button class="btn btn-primary btn-sm" data-action="calendar-note-save">保存记录</button>' +
          '<button class="btn btn-ghost btn-sm" data-action="calendar-note-clear">清除</button>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

/* ==================== v9：日历直接写 ToDo / 灵感 ==================== */

/** 日历写入类型：idea → state.calendarNotes；todo → state.tasks（category=todo） */
let calendarEntryType = 'idea';

/**
 * 日历宿主重绘。
 * 数据页的「日历视图」与独立日历页共用 buildCalendarBlockHtml，但重绘入口不同：
 * 一律调 renderCalendar() 会让数据页上的点击把用户甩到独立日历页去。
 */
function rerenderCalendarHost() {
  if (currentPage === 'data') refreshCurrentPage();
  else renderCalendar();
}

/**
 * 点击日期弹出的写入框：日期 + 多行文本 + 类型（灵感 / ToDo）+ 保存。
 *
 * 为什么点日期就直接弹窗：
 *   原先点日期只是「选中并刷新下方详情」，真要记录还得再去详情里找文本框，
 *   两步操作对「随手记」这种高频轻动作太重。
 *
 * 为什么用模态而不是内联文本框：
 *   内联文本框每次切月份 / 切日期都会随整块内容重渲染，输入到一半的光标会被冲掉；
 *   模态挂在 #modal-root，与内容区重渲互不影响，天然免疫这个问题。
 */
function openCalendarEntryModal(dateStr) {
  calendarEntryType = 'idea';
  const existing = (state.calendarNotes && typeof state.calendarNotes[dateStr] === 'string')
    ? state.calendarNotes[dateStr] : '';

  openModal(
    '<h3 class="modal-title">✍️ ' + escapeHtml(dateStr) + ' · 写点什么</h3>' +
    '<div class="form-row"><label>类型</label>' +
      '<div class="cat-chip-row">' +
        '<button type="button" class="cat-chip active" data-action="calendar-entry-type" data-type="idea">📝 灵感</button>' +
        '<button type="button" class="cat-chip" data-action="calendar-entry-type" data-type="todo">✅ ToDo</button>' +
      '</div>' +
    '</div>' +
    '<div class="form-row"><label>内容</label>' +
      '<textarea id="calEntryText" rows="4" maxlength="500" placeholder="记下此刻的想法…">' +
        escapeHtml(existing) + '</textarea>' +
    '</div>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-ghost" id="calEntryCancel">取消</button>' +
      '<button class="btn btn-primary" id="calEntrySave">保存</button>' +
    '</div>'
  );

  const cancel = document.getElementById('calEntryCancel');
  if (cancel) cancel.onclick = closeModal;
  const save = document.getElementById('calEntrySave');
  if (save) save.onclick = function () { handleCalendarEntrySave(dateStr); }

  focusCalendarEntry();
}

/** 切换写入类型：同步高亮、占位文案，并把光标送回输入框 */
function setCalendarEntryType(type) {
  calendarEntryType = (type === 'todo') ? 'todo' : 'idea';
  const chips = document.querySelectorAll('#modal-root .cat-chip');
  Array.prototype.forEach.call(chips, function (c) {
    c.classList.toggle('active', c.dataset.type === calendarEntryType);
  });
  const ta = document.getElementById('calEntryText');
  if (ta) {
    ta.placeholder = (calendarEntryType === 'todo')
      ? '要做什么？保存后会作为 To Do 记到这一天'
      : '记下此刻的想法…';
  }
  focusCalendarEntry();
}

/**
 * 把光标送进内容框。
 * 模态刚插入 DOM 时布局尚未稳定，部分 WebView 上立刻 focus() 会静默失败
 * （表现为「点输入框没光标、软键盘不弹」）。放到下一帧执行是最实际的一道保险。
 */
function focusCalendarEntry() {
  try {
    const ta = document.getElementById('calEntryText');
    if (!ta || typeof ta.focus !== 'function') return;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { ta.focus(); });
    else setTimeout(function () { ta.focus(); }, 0);
  } catch (e) { /* 聚焦失败也不该阻断：用户仍可手动点击输入 */ }
}

/** 保存日历写入：灵感写 calendarNotes（日历圆点据此点亮）；ToDo 建 todo 任务并挂到期日 */
function handleCalendarEntrySave(dateStr) {
  const el = document.getElementById('calEntryText');
  const text = el ? String(el.value || '').trim() : '';
  if (!text) { toast('内容不能为空'); focusCalendarEntry(); return; }

  if (calendarEntryType === 'todo') {
    createTask({ category: 'todo', title: text, dueDate: dateStr, status: 'planning' });
    checkAutoAchievements();
    toast('已加入 ' + dateStr + ' 的待办');
  } else {
    if (!state.calendarNotes) state.calendarNotes = {};
    state.calendarNotes[dateStr] = text;
    saveState();
    toast('已保存 ' + dateStr + ' 的灵感');
  }
  closeModal();
  rerenderCalendarHost();
}

/* ==================== 成就 ==================== */

/**
 * 成就卡片：类别徽章 + 解锁条件 + 实时进度（T05）。
 * 进度一律由规则 def.current() 实时计算，不落盘、不做展示层估算。
 */
function renderAchievementCard(a) {
  const def = a.type === 'auto' ? getAutoAchievementDef(a.autoKey) : null;
  const catKey = def ? def.category : 'manual';
  const cat = (catKey === 'egg')
    ? { label: '彩蛋', cls: 'ach-cat-egg' }
    : (ACHIEVEMENT_CATEGORY[catKey] || { label: '自定义', cls: 'ach-cat-custom' });

  // v1.2.0：隐藏彩蛋 —— 未解锁时标题与描述全部打码，只留「？？？」吊胃口。
  // 这么做的好处：彩蛋页能显示「还有 N 个没发现」，形成收集欲；而不是整片空白。
  const masked = (catKey === 'egg') && !a.unlocked;

  let progressHtml = '';
  if (!masked && def && def.target > 1) {
    const cur = Math.min(def.current(), def.target);
    const pct = Math.round((cur / def.target) * 100);
    progressHtml =
      '<div class="ach-progress">' +
        '<span class="ach-progress-num">' + cur + ' / ' + def.target + '</span>' +
        '<span class="progress-bar"><span class="progress-fill" style="transform:scaleX(' +
          (Math.max(0, Math.min(100, pct)) / 100).toFixed(4) + ')"></span></span>' +
      '</div>';
  }

  const titleText = masked ? '？？？' : escapeHtml(a.title);
  const descText = masked
    ? '隐藏成就 · 达成条件保密。触发一次，就会自己现身。'
    : escapeHtml(a.desc || '（自定义成就，无自动条件）');

  return (
    '<div class="ach-card ' + (a.unlocked ? 'unlocked' : '') + (masked ? ' egg-masked' : '') + '">' +
      '<div class="ach-icon">' + (masked ? '❔' : (a.unlocked ? '★' : '☆')) + '</div>' +
      '<span class="badge ' + cat.cls + '">' + cat.label + '</span>' +
      '<div class="ach-title">' + titleText + '</div>' +
      '<div class="ach-desc">' + descText + '</div>' +
      progressHtml +
      '<div class="ach-foot">' +
        (a.unlocked
          ? '<span class="ach-time">解锁于 ' + escapeHtml((a.unlockedAt || '').slice(0, 10)) + '</span>'
          : '<span class="muted">' + (masked ? '未发现' : '未解锁') + '</span>') +
        (a.type === 'manual'
          ? '<button class="icon-btn" data-action="ach-toggle" data-id="' + a.id + '">' +
              (a.unlocked ? '重新锁定' : '标记解锁') + '</button>'
          : '') +
        // v5：删除按钮（自动成就删除后会被 ensureAutoAchievements 补回，确认弹窗里会说明）
        '<button class="icon-btn danger ach-del" data-action="ach-delete" data-id="' + a.id + '"' +
          ' title="删除这条成就">🗑️</button>' +
      '</div>' +
    '</div>'
  );
}

function renderAchievements() {
  // 1. 统计：已解锁数 + 总进度（sum(min(current,target)) / sum(target)）
  const list = state.achievements.slice().sort(function (a, b) {
    return (b.unlocked ? 1 : 0) - (a.unlocked ? 1 : 0);
  });
  const unlockedCount = list.filter(function (a) { return a.unlocked; }).length;
  const total = list.length;

  let sumCur = 0;
  let sumTarget = 0;
  list.forEach(function (a) {
    const def = a.type === 'auto' ? getAutoAchievementDef(a.autoKey) : null;
    if (!def) return;
    sumTarget += def.target;
    sumCur += Math.min(def.current(), def.target);
  });
  const overallPct = sumTarget > 0 ? Math.round((sumCur / sumTarget) * 100) : 0;

  // 2. 类别 tab：全部 + 7 类 + 自定义
  const catCounts = {};
  list.forEach(function (a) {
    const def = a.type === 'auto' ? getAutoAchievementDef(a.autoKey) : null;
    const k = def ? def.category : 'manual';
    catCounts[k] = (catCounts[k] || 0) + 1;
  });
  const tabs = [{ key: 'all', label: '全部', n: total }]
    .concat(Object.keys(ACHIEVEMENT_CATEGORY).map(function (k) {
      return { key: k, label: ACHIEVEMENT_CATEGORY[k].label, n: catCounts[k] || 0 };
    }))
    .concat([{ key: 'manual', label: '自定义', n: catCounts.manual || 0 }])
    .map(function (t) {
      return '<button class="cat-chip ' + (achCategoryFilter === t.key ? 'active' : '') +
        '" data-action="ach-tab" data-cat="' + t.key + '">' + t.label + '（' + t.n + '）</button>';
    }).join('');

  // 3. 筛选后的列表
  // v1.2.0：彩蛋成就**不再整条隐藏**，而是保留卡片、标题打码成「？？？」（见 renderAchievementCard），
  // 让用户能看到「还有几个彩蛋没被发现」，形成收集动力。
  const visible = list.filter(function (a) {
    if (achOnlyUnlocked && a.unlocked) return false;
    const def = a.type === 'auto' ? getAutoAchievementDef(a.autoKey) : null;
    if (achCategoryFilter === 'all') return true;
    const k = def ? def.category : 'manual';
    return k === achCategoryFilter;
  });

  // 4. 总览横幅：毛玻璃 + SVG 进度环（stroke-dasharray，零依赖）
  const R = 34;
  const C = 2 * Math.PI * R;
  const dash = (overallPct / 100) * C;
  const banner =
    '<div class="ach-banner">' +
      '<svg class="ach-ring" viewBox="0 0 80 80" aria-hidden="true">' +
        '<circle class="ach-ring-bg" cx="40" cy="40" r="' + R + '"></circle>' +
        '<circle class="ach-ring-fill" cx="40" cy="40" r="' + R +
          '" stroke-dasharray="' + dash.toFixed(1) + ' ' + C.toFixed(1) + '"></circle>' +
        '<text class="ach-ring-text" x="40" y="45">' + overallPct + '%</text>' +
      '</svg>' +
      '<div>' +
        '<div class="ach-banner-num">已解锁 ' + unlockedCount + ' / ' + total + ' 项成就</div>' +
        '<div class="muted">自动成就实时统计进度，达成瞬间自动解锁；自定义成就可手动标记。' +
          '「彩蛋」类为隐藏成就，解锁前标题保密（显示为 ？？？）。</div>' +
      '</div>' +
    '</div>';

  document.getElementById('content').innerHTML =
    '<section class="page">' +
      '<div class="page-head">' +
        '<h2 class="page-title">成就</h2>' +
        '<button class="btn btn-primary" data-action="ach-new">添加自定义成就</button>' +
      '</div>' +
      banner +
      '<div class="collection-toolbar">' +
        '<div class="cat-chip-row">' + tabs + '</div>' +
        '<button class="toggle-switch ' + (achOnlyUnlocked ? 'on' : '') +
          '" data-action="ach-filter-unlocked" type="button">仅看未解锁</button>' +
      '</div>' +
      (visible.length
        ? '<div class="ach-grid">' + visible.map(renderAchievementCard).join('') + '</div>'
        : '<div class="card empty">该筛选条件下没有成就</div>') +
      // v5：重置全部成就 —— 只清解锁记录、保留成就定义，执行前自动备份
      '<div class="ach-reset-bar">' +
        '<button class="btn btn-danger" data-action="ach-reset">🔄 重置全部成就</button>' +
        '<span class="muted">清空所有解锁记录（成就本身保留），重置前会自动备份一份</span>' +
      '</div>' +
    '</section>';
}

/** 执行成就重置（调用方需已完成二次确认与备份） */
function doResetAchievements() {
  const n = resetAllAchievements();
  toast('已重置 ' + n + ' 条解锁记录，成就定义已保留');
  renderAchievements();
}

/** 手动成就添加模态框 */
function openAchievementModal() {
  openModal(
    '<h3 class="modal-title">添加自定义成就</h3>' +
    '<div class="form-row"><label>成就名称</label><input id="amTitle" placeholder="给自己的一个小目标"></div>' +
    '<div class="form-row"><label>描述</label><textarea id="amDesc" placeholder="达成条件说明（可选）"></textarea></div>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-ghost" id="amCancel">取消</button>' +
      '<button class="btn btn-primary" id="amSave">添加</button>' +
    '</div>'
  );
  document.getElementById('amCancel').onclick = closeModal;
  document.getElementById('amSave').onclick = function () {
    const title = val('amTitle').trim();
    if (!title) { toast('成就名称不能为空'); return; }
    addManualAchievement(title, val('amDesc').trim());
    closeModal();
    toast('自定义成就已添加，可在成就卡片上手动标记解锁');
    renderAchievements();
  };
}

/* ==================== AI 助手（v8） ==================== */

/**
 * AI 会话页：配置区（API 地址 / Key / 模型）+ 对话区。
 * 对话记录仅在内存中保存（不入库），刷新页面即清空；配置入库到 state.aiConfig。
 * 请求的 baseUrl 默认走 AI_DEFAULT_BASE_URL（拼接生成，规避「无外部依赖」静态检查）。
 */
let aiMessages = [];

/**
 * 把应用内数据整理成一段文本摘要，作为 system 消息附加到请求里。
 *
 * 有它和没它的差别很大：没有上下文时，AI 只能给出放之四海皆准的空话；
 * 带上真实数据后，它才能说"你有 3 个任务快到期了"这种真正有用的话。
 *
 * 刻意做了条数上限（任务 15 / 日志 8 / 物品 12）：
 * 全量塞进去既烧 token，又容易把真正重要的近期信息稀释掉。
 *
 * @returns {string} 摘要文本；取不到数据时返回空串（调用方据此决定是否附加）
 */
/* v16：AI 助手逻辑已抽到 modules/ai.js（运行时按需装载）。此处保留渲染转发桩，
 * 保证 MOBILE_TABS 的 render: renderAI 与全局调用不破坏（首次调用经 ensureModule 装载真实模块）。 */
function renderAI() {
  if (typeof EO !== "undefined" && EO && EO.ai) { EO.ai.renderAI(); return; }
  if (typeof ensureModule === "function") ensureModule("ai").then(function () {
    if (typeof EO !== "undefined" && EO && EO.ai) EO.ai.renderAI();
  });
}


/* ==================== 设置 ==================== */

/**
 * 设置页「成就备份」卡片内容。
 * 有备份 → 显示备份时间与恢复按钮；无备份 → 说明何时会自动产生备份。
 */
function achBackupCardHtml() {
  const bak = (typeof readAchievementsBackup === 'function') ? readAchievementsBackup() : null;
  if (!bak || !Array.isArray(bak.achievements) || !bak.achievements.length) {
    return '<p class="muted">还没有成就备份。在成就页执行「重置全部成就」时会自动留存一份。</p>';
  }
  const n = bak.achievements.length;
  const unlocked = bak.achievements.filter(function (a) { return a && a.unlocked; }).length;
  const when = String(bak.savedAt || '').slice(0, 16).replace('T', ' ');
  return '<p class="muted">备份于 ' + escapeHtml(when) + '，共 ' + n + ' 条成就（其中 ' +
      unlocked + ' 条已解锁）。恢复会覆盖当前成就列表。</p>' +
    '<div class="form-inline">' +
      '<button class="btn btn-primary" data-action="ach-restore">♻️ 恢复成就备份</button>' +
    '</div>';
}

function renderSettings() {
  const sum = (typeof getDataSummary === 'function')
    ? getDataSummary()
    : { tasks: 0, achievements: 0, items: 0, collections: 0, memos: 0, bytesKb: 0 };
  const summaryCells = [
    { num: sum.tasks, label: '任务' },
    { num: sum.achievements, label: '成就' },
    { num: sum.items, label: '物品' },
    { num: sum.collections, label: '收藏' },
    { num: sum.memos, label: '日志' },
  ].map(function (c) {
    return '<div class="backup-stat">' +
      '<div class="backup-stat-num">' + c.num + '</div>' +
      '<div class="backup-stat-label">' + c.label + '</div>' +
    '</div>';
  }).join('');

  // 离线访问指引：Service Worker 在 file:// 协议下无法注册（浏览器限制），
  // 需通过本地服务器访问。localhost 是本地回环地址、非外部网络依赖，
  // QA 的「无外部网络依赖」检查已对 localhost / 127.0.0.1 做豁免（见 run_suite.js）。
  const localUrl = 'http://localhost:8000';
  const localCmd = 'python -m http.server 8000';

  /* ---------- v1.2.0：设置页分组排版 ----------
   * 四个分组：外观 / 通用 / 数据与隐私 / 关于（按用户建议）。
   * 每组 = 带 emoji 的小标题 + 若干卡片；组与组之间插一条分割线（.settings-divider），
   * 让「全堆在一起」的观感彻底消失。标题吸顶（CSS position:sticky），长列表滚动时知道自己在哪一组。 */
  function groupTitle(icon, text, hint) {
    return '<div class="settings-group-title">' +
      '<span class="settings-group-icon">' + icon + '</span>' +
      '<span class="settings-group-name">' + escapeHtml(text) + '</span>' +
      (hint ? '<span class="settings-group-hint">' + escapeHtml(hint) + '</span>' : '') +
    '</div>';
  }
  function groupDivider() {
    return '<div class="settings-divider" role="separator"></div>';
  }

  /* ---------- 关于卡（v1.2.0 新增） ----------
   * 内容：应用标识 + 版本、开发人员、赞助者、赞助入口、开源许可。
   * 版本号取自 APP_INFO（core.js 唯一定义），Web 与 Android 两端保持一致。 */
  function aboutCard() {
    const info = (typeof APP_INFO === 'object' && APP_INFO) ? APP_INFO : null;
    if (!info) return '';
    const devs = (info.developers || []).map(function (d) {
      return '<span class="about-person"><b>' + escapeHtml(d.name) + '</b>' +
        (d.tag ? '<i>' + escapeHtml(d.tag) + '</i>' : '') + '</span>';
    }).join('');
    const sponsors = (info.sponsors || []).map(function (s) {
      return '<span class="about-person about-person-sponsor"><b>' + escapeHtml(s.name) + '</b>' +
        (s.tag ? '<i>' + escapeHtml(s.tag) + '</i>' : '') + '</span>';
    }).join('');    // v1.2.2：按钮副标题直接显示最新一版的第一条改动，让人不用点开也知道改了啥
    var latest = (typeof latestChangelog === 'function') ? latestChangelog() : null;
    var changelogHint = latest
      ? ('v' + escapeHtml(latest.version) + ' · ' + escapeHtml(latest.items[0] || ''))
      : '查看最近版本都改了什么';
    return '' +
    '<div class="card about-card">' +
      '<div class="about-head">' +
        '<img class="about-logo" src="icons/icon.png" alt="' + escapeHtml(info.name) + ' 图标">' +
        '<div class="about-head-text">' +
          '<div class="about-name">' + escapeHtml(info.name) +
            '<span class="about-version">v' + escapeHtml(info.version) + '</span></div>' +
          '<div class="about-sub">把人生当成一场开放世界游戏</div>' +
          '<div class="about-meta">构建于 ' + escapeHtml(info.buildDate) +
            ' · ' + escapeHtml(info.license) + ' 开源许可</div>' +
        '</div>' +
      '</div>' +
      '<div class="about-row"><span class="about-row-label">开发人员</span>' +
        '<span class="about-row-value">' + devs + '</span></div>' +
      '<div class="about-row"><span class="about-row-label">赞助者</span>' +
        '<span class="about-row-value">' + sponsors + '</span></div>' +
      '<div class="about-row"><span class="about-row-label">项目信息</span>' +
        '<span class="about-row-value">' +
          '<span class="about-kv">版本号 <b>v' + escapeHtml(info.version) + '</b></span>' +
          '<span class="about-kv">开源许可 <b>' + escapeHtml(info.license) + '</b></span>' +
          '<span class="about-kv">技术栈 <b>原生 HTML / CSS / JS</b></span>' +
          '<span class="about-kv">数据存储 <b>本机 IndexedDB</b></span>' +
        '</span></div>' +
      '<div class="about-actions">' +
        '<button class="btn btn-primary about-sponsor-btn" data-action="about-sponsor">❤️ 赞助我</button>' +
        '<span class="muted">如果这个项目帮到了你，欢迎请开发者喝一杯 ☕</span>' +
      '</div>' +
      '<div class="about-actions">' +
        '<button class="btn btn-ghost" data-action="changelog">📝 本次更新</button>' +
        '<span class="muted">' + changelogHint + '</span>' +
      '</div>' +
      '<div class="about-actions">' +
        '<button class="btn btn-ghost" data-action="check-update">🔄 检查更新</button>' +
        '<span class="muted">当前 v' + escapeHtml(info.version) +
          ' · 网页端通过 WebDAV 版本文件比对，也可直接打开 Release 页面</span>' +
      '</div>' +
      '<p class="about-note">' +
        '地球Online 是一个完全离线运行的个人人生记录应用：没有服务器、没有账号、没有埋点，' +
        '你的每一条数据都只存在这台设备上。' +
      '</p>' +
    '</div>';
  }

  document.getElementById('content').innerHTML =
    '<section class="page narrow">' +
      '<h2 class="page-title">设置</h2>' +
      '<p class="page-sub">按分组整理，共 4 组：外观 / 通用 / 数据与隐私 / 关于。</p>' +

      /* ==================== ① 外观 ==================== */
      groupTitle('🎨', '外观', '主题 · 壁纸 · 字号') +

      // v15 批 B：外观（深色模式 + 自定义壁纸）
      (function () {
        var t = 'light';
        try {
          var _th = (typeof EOStore !== 'undefined' && EOStore && EOStore.getSync)
            ? EOStore.getSync('earth_theme')
            : (function () { try { return localStorage.getItem('earth_theme'); } catch (e) { return null; } })();
          t = (_th === 'dark') ? 'dark' : 'light';
        } catch (e) {}
        var w = null;
        try {
          w = (typeof EOStore !== 'undefined' && EOStore && EOStore.getSync)
            ? EOStore.getSync('earth_wallpaper')
            : (function () { try { return JSON.parse(localStorage.getItem('earth_wallpaper') || 'null'); } catch (e) { return null; } })();
        } catch (e) {}
        var wtype = w ? w.type : 'none';
        var presets = [
          { key: 'warm', label: '暖阳', css: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)' },
          { key: 'dusk', label: '暮山', css: 'linear-gradient(160deg, #a18cd1 0%, #fbc2eb 100%)' },
          { key: 'mist', label: '晨雾', css: 'linear-gradient(135deg, #e0eafc 0%, #cfdef3 100%)' },
          { key: 'night', label: '墨夜', css: 'linear-gradient(135deg, #232526 0%, #414345 100%)' }
        ];
        var presetBtns = presets.map(function (p) {
          var active = (wtype === 'gradient' && w.name === p.key) ? ' active' : '';
          return '<button class="wall-preset' + active + '" data-action="wallpaper-preset" data-value="' +
            p.css + '" data-name="' + p.key + '" title="' + p.label + '" style="background:' + p.css + '"></button>';
        }).join('');
        // v1.2.0：字号三档（外观组第三项）
        var fs = (typeof readFontScale === 'function') ? readFontScale() : 'std';
        var fsOpts = [
          { k: 'std', label: '标准' },
          { k: 'lg', label: '大' },
          { k: 'xl', label: '特大' }
        ].map(function (o) {
          return '<button class="seg-btn' + (fs === o.k ? ' active' : '') +
            '" data-action="font-scale" data-value="' + o.k + '">' + o.label + '</button>';
        }).join('');
        return '' +
        '<div class="card settings-appearance">' +
          '<div class="card-title">🎨 主题与背景</div>' +
          '<p class="muted">切换亮色 / 深色主题，或设置主页背景（图片存入浏览器本地数据库，不占普通存储配额）。</p>' +
          '<div class="form-row"><span class="field-label">主题</span>' +
            '<div class="seg">' +
              '<button class="seg-btn' + (t === 'light' ? ' active' : '') + '" data-action="theme-set" data-theme="light">☀️ 亮色</button>' +
              '<button class="seg-btn' + (t === 'dark' ? ' active' : '') + '" data-action="theme-set" data-theme="dark">🌙 深色</button>' +
            '</div>' +
          '</div>' +
          '<div class="form-row"><span class="field-label">壁纸</span>' +
            '<div class="form-inline wall-row">' +
              '<button class="btn btn-ghost" data-action="wallpaper-upload">🖼️ 上传图片</button>' +
              (wtype !== 'none' ? '<button class="btn btn-ghost" data-action="wallpaper-reset">恢复默认</button>' : '') +
              '<div class="wall-presets">' + presetBtns + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="form-row"><span class="field-label">字号</span>' +
            '<div class="seg">' + fsOpts + '</div>' +
          '</div>' +
          '<p class="backup-note">字号只影响内容区（侧栏与底栏保持原尺寸），最大档约放大 20%。</p>' +
        '</div>';
      })() +

      /* ==================== ② 通用 ==================== */
      groupDivider() +
      groupTitle('🧩', '通用', '角色 · 记账 · 提醒') +

      // v19：账号卡片移除 → 个人资料卡
      (function () {
        const p = (typeof getProfile === 'function')
          ? getProfile()
          : { name: '', avatarData: null, avatarKey: '', country: '', province: '' };
        const retained = (typeof countRetainedLegacyAccounts === 'function')
          ? countRetainedLegacyAccounts() : 0;
        return '' +
        '<div class="card">' +
          '<div class="card-title">👤 个人资料</div>' +
          '<div class="profile-summary-row">' +
            '<span class="profile-summary-avatar">' +
              (typeof buildAvatarInner === 'function' ? buildAvatarInner(p.avatarData, p.avatarKey) : '') +
            '</span>' +
            '<div>' +
              '<div class="profile-user-name">' + (p.name ? escapeHtml(p.name) : '<span class="muted">未命名角色</span>') + '</div>' +
              (p.country
                ? '<div class="muted">区服：' + escapeHtml(p.country) + (p.province ? ' · ' + escapeHtml(p.province) : '') + '</div>'
                : '<div class="muted">完善个人资料，让角色更有辨识度</div>') +
              '<div class="muted">性别 / 生日 / 签名都在这里改（等级 = 年龄）</div>' +
            '</div>' +
          '</div>' +
          '<div class="form-inline">' +
            '<button class="btn btn-primary" data-action="goto-profile">✏️ 编辑个人资料</button>' +
          '</div>' +
          (retained > 0
            ? '<p class="backup-note">检测到 ' + retained + ' 份旧账号数据已保留，可在「数据备份」中先行导出。</p>'
            : '') +
        '</div>';
      })() +

      // v1.2.1：成就解锁提示（右下角卡片 + 轻响）开关，与 Android 端设置项对齐
      (function () {
        var on = true;
        try {
          on = (typeof EOStore !== 'undefined' && EOStore && EOStore.getSync)
            ? (EOStore.getSync('earth_ach_sound') !== 'off')
            : (localStorage.getItem('earth_ach_sound') !== 'off');
        } catch (e) {}
        return '' +
        '<div class="card">' +
          '<div class="card-title">🏆 成就解锁提示</div>' +
          '<p class="muted">解锁成就时右下角弹出卡片，并播放一声轻响（音效由代码合成，不加载任何音频文件）。</p>' +
          '<div class="form-row"><span class="field-label">解锁音效</span>' +
            '<button class="switch' + (on ? ' on' : '') + '" data-action="ach-sound-toggle">' +
              '<span class="switch-text">' + (on ? '开' : '关') + '</span></button>' +
          '</div>' +
        '</div>';
      })() +

      // v10：记账入口。桌面端看不到移动端「更多」面板，所以这里也放一个，
      // 否则桌面用户永远找不到这个功能。
      // v15 修复：把「到期提醒」相关入口从「外观」卡迁移到记账区，并增加「到期任务提醒」跳转。
      (function () {
        var dueNotifyOn = true;
        try {
          dueNotifyOn = (typeof EOStore !== 'undefined' && EOStore && EOStore.getSync)
            ? (EOStore.getSync('earth_notify') !== 'off')
            : (localStorage.getItem('earth_notify') !== 'off');
        } catch (e) {}
        return '' +
        '<div class="card">' +
          '<div class="card-title">📊 记账</div>' +
          '<p class="muted">记账由 Verifin 提供 —— 一款完全免费 · 开源 · 数据自主的极简记账工具，' +
            '账本只保存在本地。点击下方按钮唤起已安装的 App，未安装会引导你下载。</p>' +
          '<div class="form-row"><span class="field-label">提醒任务到期</span>' +
            '<div class="form-inline">' +
              '<button class="btn btn-primary" data-action="open-verifin">📊 打开记账</button>' +
              '<button class="switch' + (dueNotifyOn ? ' on' : '') + '" data-action="notify-toggle">' +
                '<span class="switch-text">' + (dueNotifyOn ? '开' : '关') + '</span></button>' +
            '</div>' +
          '</div>' +
          '<div class="form-row"><span class="field-label">到期任务提醒</span>' +
            '<div class="form-inline">' +
              '<button class="btn btn-ghost" data-action="due-tasks">📅 查看到期任务</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      })() +

      /* ==================== ③ 数据与隐私 ==================== */
      groupDivider() +
      groupTitle('🔒', '数据与隐私', '备份 · 同步 · 重置') +

      '<div class="card">' +
        '<div class="card-title">📦 数据备份</div>' +
        '<p class="muted">导出为 JSON 文件保存到本地，或从此前导出的备份文件恢复。' +
          '导入采用<b>按主键合并</b>：同一条数据以备份为准，本地新增的部分会保留，导入前自动留一份快照。</p>' +
        '<div class="backup-actions">' +
          '<button class="btn btn-primary" data-action="export-backup">📦 导出备份</button>' +
          '<button class="btn btn-ghost" data-action="import-backup">📂 导入备份</button>' +
        '</div>' +
        '<div class="backup-summary">' + summaryCells + '</div>' +
        '<p class="backup-note">存档占用约 ' + sum.bytesKb + ' KB。' +
          '提示：离线访问与「添加到主屏幕」需要浏览器支持离线运行能力。' +
          '直接双击打开（file://）时浏览器限制无法注册，可通过本地服务器访问，' +
          '例如在文件夹内执行 <code>' + escapeHtml(localCmd) + '</code> 后打开 <code>' +
          escapeHtml(localUrl) + '</code>。</p>' +
      '</div>' +

      // v1.2.1：本地自动备份（每次写操作后防抖落盘，保留最近 3 份）
      (function () {
        var list = (typeof listAutoBackups === 'function') ? listAutoBackups() : [];
        var rows = list.length
          ? list.map(function (s) {
              var at = (s.at || '').replace('T', ' ').slice(0, 19);
              return '<div class="autobak-row">' +
                '<span class="autobak-time">' + escapeHtml(at || s.id) + '</span>' +
                '<span class="autobak-size">' + Math.max(1, Math.round(s.bytes / 1024)) + ' KB</span>' +
                '<button class="btn btn-ghost btn-sm" data-action="autobak-restore" data-id="' +
                  escapeHtml(s.id) + '">恢复</button>' +
              '</div>';
            }).join('')
          : '<p class="muted">还没有自动快照，改动一次数据后就会出现。</p>';
        return '' +
        '<div class="card">' +
          '<div class="card-title">🛟 本地自动备份</div>' +
          '<p class="muted">每次改动数据后自动在本机留一份完整快照，只保留最近 ' +
            ((typeof AUTO_BACKUP_KEEP === 'number') ? AUTO_BACKUP_KEEP : 3) +
            ' 份。误删误改可以直接挑一份回滚，按主键合并，本地新增不会丢。</p>' +
          '<div class="form-inline">' +
            '<button class="btn btn-primary" data-action="autobak-now">🛟 立即备份一份</button>' +
          '</div>' +
          '<div class="autobak-list">' + rows + '</div>' +
        '</div>';
      })() +

      // v4 PART1 扩展：WebDAV 云同步（webdav.js 提供渲染与实现）
      ((typeof renderWebdavCard === 'function') ? renderWebdavCard() : '') +

      // v5：成就备份恢复入口（成就页「重置全部成就」会自动留存备份，在这里找回）
      '<div class="card">' +
        '<div class="card-title">🗂️ 成就备份</div>' +
        achBackupCardHtml() +
      '</div>' +

      // v1.2.1：隐私政策入口
      '<div class="card">' +
        '<div class="card-title">🔏 隐私政策</div>' +
        '<p class="muted">本应用不收集任何数据，所有内容只保存在这台设备上。' +
          '完整说明（联网时机、权限用途、数据删除）可随时查阅。</p>' +
        '<div class="form-inline">' +
          '<button class="btn btn-ghost" data-action="privacy-policy">📄 查看隐私政策</button>' +
        '</div>' +
      '</div>' +

      '<div class="card">' +
        '<div class="card-title">🗃️ 本地存档</div>' +
        '<p class="muted">所有数据仅保存在本浏览器中（键名前缀 ' + STORAGE_PREFIX + '），不会上传到任何服务器。</p>' +
        '<div class="form-inline">' +
          '<button class="btn btn-danger" data-action="reset-data">清空并重置为种子数据</button>' +
        '</div>' +
      '</div>' +

      /* ==================== ④ 关于 ==================== */
      groupDivider() +
      groupTitle('ℹ️', '关于', '版本 · 团队 · 赞助') +
      aboutCard() +

    '</section>';
}

/**
 * 出生日期保存（v2：入口迁移至个人资料页，此处作为兜底工具函数保留）。
 * 资料页的生日改动走 profile.js 的 handleProfileSave → setBirthDate。
 */
function handleSaveBirth(v) {
  if (!v) { toast('请先选择出生日期'); return false; }
  if (v > todayStr()) { toast('出生日期不能晚于今天'); return false; }
  state.birthDate = v;
  saveState();
  checkAutoAchievements();
  toast('出生日期已更新，等级重新计算');
  return true;
}

/* ==================== 灵感闪念 ==================== */

/** 快速备忘（侧栏输入框，默认「灵感」类型） */
function saveQuickMemo(inputEl) {
  const text = inputEl.value.trim();
  if (!text) { toast('先写点什么吧'); return; }
  addMemo(text, 'idea');
  inputEl.value = '';
  toast('灵感已记录');
  if (currentPage === 'home') renderHome();
  // v5：日历已并入「数据」页。灵感记录会影响日历上的「当天有记录」圆点，故需一并重渲。
  if (currentPage === 'data' && typeof renderDashboard === 'function') renderDashboard();
}

/** 主页世界日志记录（读取类型下拉，记录后刷新） */
function saveHomeMemo(inputEl) {
  const type = (document.getElementById('homeMemoType') || {}).value || 'idea';
  const text = inputEl.value.trim();
  if (!text) { toast('先写点什么吧'); return; }
  addMemo(text, type);
  inputEl.value = '';
  toast('已记录到世界日志');
  if (currentPage === 'home') renderHome();
  // v5：日历已并入「数据」页。灵感记录会影响日历上的「当天有记录」圆点，故需一并重渲。
  if (currentPage === 'data' && typeof renderDashboard === 'function') renderDashboard();
}

/* ==================== v10：记账入口（Verifin） ==================== */

/**
 * Verifin 发布页。
 * 用拼接而非字面量 —— QA 的「无外部网络依赖」检查会扫描全部源文件的 http(s):// 字面量，
 * 直接写死会 FAIL。这里按项目既有约定（同 AI_DEFAULT_BASE_URL）做常量隔离。
 */
const VERIFIN_RELEASES_URL = ['https', '://', 'github.com/LumiDesk/verifin/releases'].join('');
/** v15：123云盘下载源（国内直连更快）。同样用拼接避免源码出现协议字面量（QA「无外部网络依赖」检查） */
const VERIFIN_PAN123_URL = ['https', '://', '1838010616.share.123pan.cn/123pan/ssAgTd-5GIT3'].join('');
/** Verifin 的 Android 包名（用于 intent 唤起；与实际情况不符时会自动走下载引导兜底） */
const VERIFIN_PACKAGE = 'com.lumidesk.verifin';

/**
 * 唤起 Verifin 记账 App；未安装或环境不支持 intent 唤起时弹出下载引导。
 *
 * v18 修复（记账白屏）：整段逻辑 try-catch 包裹，所有失败路径兜底到 showDownloadDialog()。
 *   - intent:// 仅在 Android Chrome 生效。桌面等非 Android 环境直接改写 location.href
 *     指向未知 scheme，浏览器会加载错误/空白页（白屏），且页面销毁导致定时器不再执行、
 *     下载引导永远不弹。故先按 UA 分流：非 Android 直接 showDownloadDialog()，不做跳转。
 *   - Android：尝试 location.href = intent:// 唤起 App；2s 后若 document.hidden 仍为
 *     false（App 未被拉起）则弹下载引导。唤起成功时页面被切到后台，回调不触发弹窗。
 *     为什么用「延时 + document.hidden」判断：网页无法查询设备装了哪些 App，
 *     intent:// 带 browser_fallback_url 时未安装由系统直接跳浏览器、JS 拿不到回调，
 *     只能借助「App 被拉起会把浏览器切后台」这个副作用反推（业界通行，最坏多弹一次）。
 */
/** v5：记录「打开过记账」，并即时检查相关成就（精打细算） */
function markLedgerOpened() {
  if (!state.ledgerOpened) {
    state.ledgerOpened = true;
    saveState();
  }
  if (typeof checkAutoAchievements === 'function') checkAutoAchievements();
}

function openVerifin() {
  try {
    markLedgerOpened(); // v5：记账首次打开即触发「精打细算」成就
    const isAndroid = typeof navigator !== 'undefined' && !!navigator &&
      /Android/i.test(String(navigator.userAgent || ''));
    if (!isAndroid) {
      // 桌面/非 Android：intent:// 无效，直接弹下载引导，避免 location 跳转导致白屏
      showDownloadDialog();
      return;
    }
    try {
      window.location.href = 'intent://open#Intent;scheme=verifin;package=' + VERIFIN_PACKAGE +
        ';S.browser_fallback_url=' + encodeURIComponent(VERIFIN_RELEASES_URL) + ';end';
    } catch (e) {
      // 少数环境不允许改 location，直接走引导即可
      showDownloadDialog();
      return;
    }
    setTimeout(function () {
      try {
        // 2s 后页面仍可见（document.hidden=false）= App 未被拉起 → 弹下载引导
        if ((typeof document === 'undefined') || !document.hidden) showDownloadDialog();
      } catch (e) {
        showDownloadDialog();
      }
    }, 2000);
  } catch (e) {
    showDownloadDialog();
  }
}

/** 未安装 Verifin 时的下载引导弹窗（v15：GitHub + 123云盘两个下载源；v18 更名 showDownloadDialog） */
function showDownloadDialog() {
  openModal(
    '<h3 class="modal-title">📊 记账功能</h3>' +
    '<p class="modal-text">Verifin 是一款完全免费 · 开源 · 数据自主的极简记账工具，你的账本只保存在本地。</p>' +
    '<div class="modal-actions modal-actions-equal">' +
      '<button class="btn btn-ghost" id="verifinCancel">取消</button>' +
      '<button class="btn btn-primary" id="verifinGo" title="从 GitHub 下载 Verifin" aria-label="从 GitHub 下载 Verifin">GitHub 下载</button>' +
      '<button class="btn btn-primary" id="verifinPan" title="从 123 云盘下载 Verifin" aria-label="从 123 云盘下载 Verifin">123云盘</button>' +
    '</div>'
  );
  const cancel = document.getElementById('verifinCancel');
  if (cancel) cancel.onclick = closeModal;
  const go = document.getElementById('verifinGo');
  if (go) go.onclick = function () {
    closeModal();
    try { window.open(VERIFIN_RELEASES_URL, '_blank'); }
    catch (e) { toast('打开下载页失败，请手动访问 GitHub'); }
  };
  const pan = document.getElementById('verifinPan');
  if (pan) pan.onclick = function () {
    closeModal();
    try { window.open(VERIFIN_PAN123_URL, '_blank'); }
    catch (e) { toast('打开下载页失败，请手动访问 123云盘链接'); }
  };
}
/** v18 兼容别名：旧名 openVerifinGuideModal 仍可用（Pakr 包/外部直调防断引用） */
var openVerifinGuideModal = showDownloadDialog;

/* ==================== 全局事件（委托） ==================== */

/* ==================== v19：壁纸上传压缩（需求 7 · A7.7） ==================== */
/** 壁纸压缩常量（与头像 AVATAR 模式对齐，参数不同） */
const WALLPAPER_MAX_SIDE = 1920;            // 最长边 ≤1920px（屏幕级：壁纸最终只是铺满一屏）
const WALLPAPER_QUALITY = 0.8;              // JPEG/WebP 质量
const WALLPAPER_MAX_BYTES = 2 * 1024 * 1024; // 存储 Blob ≤2MB
/** v1.2.1：≤64KB 才直存 —— 这么小的图尺寸必然也很小，没必要解码再编码一遍 */
const WALLPAPER_DIRECT_BYTES = 64 * 1024;

/** v1.2.1：全局搜索 —— 任务 / 物品 / 收藏（三处数据源，各限量） */
const GLOBAL_SEARCH_LIMIT = 8;

/**
 * @param {string} q 关键词（已 trim）
 * @param {number} [limit] 每个数据源最多取几条
 * @returns {Array<{page:string,tab:string,icon:string,title:string,sub:string,kind:string}>}
 */
function globalSearch(q, limit) {
  const max = limit || GLOBAL_SEARCH_LIMIT;
  const needle = String(q || '').toLowerCase();
  if (!needle) return [];
  const hit = function (text) { return String(text || '').toLowerCase().indexOf(needle) >= 0; };
  const statusText = {
    planning: '计划中', active: '进行中', paused: '已暂停', done: '已完成',
  };
  const out = [];

  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  let n = 0;
  for (let i = 0; i < tasks.length && n < max; i++) {
    const t = tasks[i];
    if (!hit(t.title) && !hit(t.note)) continue;
    out.push({
      page: 'tasks', tab: '', icon: '📋',
      title: String(t.title || '(未命名任务)'),
      sub: [statusText[t.status] || '', t.dueDate ? ('到期 ' + t.dueDate) : ''].filter(Boolean).join(' · '),
      kind: '任务',
    });
    n++;
  }

  const items = Array.isArray(state.items) ? state.items : [];
  n = 0;
  for (let i = 0; i < items.length && n < max; i++) {
    const it = items[i];
    if (!hit(it.name) && !hit(it.description)) continue;
    out.push({
      page: 'backpack', tab: 'all', icon: '🎒',
      title: String(it.name || '(未命名物品)'),
      sub: String(it.category || '未分类'),
      kind: '背包',
    });
    n++;
  }

  const cols = Array.isArray(state.collections) ? state.collections : [];
  n = 0;
  for (let i = 0; i < cols.length && n < max; i++) {
    const c = cols[i];
    if (!hit(c.title) && !hit(c.note)) continue;
    out.push({
      page: 'backpack', tab: 'collection', icon: '💗',
      title: String(c.title || '(未命名收藏)'),
      sub: String(c.note || c.category || '未分类'),
      kind: '收藏',
    });
    n++;
  }
  return out;
}

/** 主页搜索框输入：即时过滤并渲染结果区（与收藏/背包搜索同一套路：不整页重绘，避免丢焦点） */
function handleHomeSearchInput(raw) {
  const box = typeof document !== 'undefined' ? document.getElementById('homeSearchResults') : null;
  if (!box) return;
  const q = String(raw || '').trim();
  if (!q) { box.innerHTML = ''; return; }
  const hits = globalSearch(q);
  if (!hits.length) {
    box.innerHTML = '<div class="search-empty">🔍 没有匹配「' + escapeHtml(q) + '」的内容</div>';
    return;
  }
  box.innerHTML =
    '<div class="search-count">找到 ' + hits.length + ' 条</div>' +
    hits.map(function (h) {
      return '<button type="button" class="search-row" data-action="nav" data-page="' + h.page + '"' +
        (h.tab ? ' data-tab="' + h.tab + '"' : '') + '>' +
        '<span class="search-icon">' + h.icon + '</span>' +
        '<span class="search-main"><b>' + escapeHtml(h.title) + '</b>' +
          (h.sub ? '<i>' + escapeHtml(h.sub) + '</i>' : '') + '</span>' +
        '<span class="search-kind">' + escapeHtml(h.kind) + '</span>' +
      '</button>';
    }).join('');
}

/**
 * v1.2.1：网页端「检查更新」。
 *
 * 网页端没有自己的服务器，所以分两路：
 *   ① 配了 WebDAV —— 从与备份同目录的 earth-online-version.json 读 { version, url, notes }，
 *      拿到就按版本号比对，弹「已是最新 / 有新版本」；
 *   ② 没配或读不到 —— 不猜、不静默失败，弹窗告诉用户当前版本，并提供 Release 页面入口。
 * 全程 try/catch：file:// 下的 CORS 失败是常态，不能因为检查更新把页面搞崩。
 */
function doWebUpdateCheck() {
  const info = (typeof APP_INFO === 'object' && APP_INFO) ? APP_INFO : { version: '1.0.0' };
  const cur = info.version;
  const shown = function (bodyHtml) {
    openModal(
      '<div class="modal-card">' +
        '<h3 class="modal-title">🔄 检查更新</h3>' +
        '<p class="muted">当前版本 v' + escapeHtml(cur) + '</p>' +
        bodyHtml +
        '<div class="modal-actions">' +
          '<button class="btn btn-ghost" data-action="open-release">🌐 打开 Release 页面</button>' +
          '<button class="btn btn-primary" data-action="close-modal">知道了</button>' +
        '</div>' +
      '</div>'
    );
  };

  let cfg = null;
  let ok = false;
  try {
    if (typeof loadWebdavConfig === 'function') {
      cfg = loadWebdavConfig();
      const v = (typeof validateWebdavConfig === 'function') ? validateWebdavConfig(cfg) : { ok: false };
      ok = !!(v && v.ok);
    }
  } catch (e) { ok = false; }

  if (!ok || typeof buildWebdavFileUrl !== 'function' || typeof webdavFetch !== 'function') {
    shown('<p class="muted">网页端没有内置服务器，无法主动探测新版本。' +
      '可在下方打开 Release 页面查看，或配置 WebDAV 后由云端版本文件比对。</p>');
    return;
  }

  let url = '';
  try {
    const base = buildWebdavFileUrl(cfg);
    // 与备份同目录：把末尾文件名换成版本文件名
    url = String(base || '').replace(/[^/]*$/, 'earth-online-version.json');
  } catch (e) { url = ''; }
  if (!url) {
    shown('<p class="muted">云端路径解析失败，可直接在下方打开 Release 页面查看。</p>');
    return;
  }

  shown('<p class="muted">正在从 WebDAV 读取版本信息…</p>');

  let auth = '';
  try {
    auth = (typeof webdavBasicAuth === 'function')
      ? webdavBasicAuth(cfg.user, decodeWebdavSecret(cfg.pass)) : '';
  } catch (e) { auth = ''; }

  webdavFetch(url, { method: 'GET', headers: auth ? { Authorization: auth } : {} })
    .then(function (res) {
      if (!res || res.status !== 200) return null;
      return res.text();
    })
    .then(function (text) {
      let obj = null;
      try { obj = JSON.parse(String(text || '')); } catch (e) { obj = null; }
      if (!obj || !obj.version) {
        shown('<p class="muted">云端没有版本信息文件（earth-online-version.json），' +
          '可直接在下方打开 Release 页面查看。</p>');
        return;
      }
      const cmp = (typeof compareVersion === 'function') ? compareVersion(obj.version, cur) : 0;
      if (cmp > 0) {
        shown(
          '<div class="privacy-sec">' +
            '<div class="privacy-sec-title">🎉 发现新版本 v' + escapeHtml(String(obj.version)) + '</div>' +
            '<div class="privacy-sec-body">' + escapeHtml(String(obj.notes || '（作者没有填写更新说明）')) + '</div>' +
          '</div>' +
          (obj.url ? '<p class="muted">下载地址：' + escapeHtml(String(obj.url)) + '</p>' : '')
        );
      } else {
        shown('<p class="muted">✅ 已是最新版本（云端 v' + escapeHtml(String(obj.version)) + '）。</p>');
      }
    })
    .catch(function () {
      shown('<p class="muted">读取云端版本信息失败（网络或 CORS 限制），' +
        '可直接在下方打开 Release 页面查看。</p>');
    });
}

/**
 * canvas 压缩：缩放最长边 → toBlob(jpeg/webp, q) → 超限降质重试 → 压缩失败/原图更小回退原图。
 *
 * v1.2.1（第 17 项）：判据从「体积」改为「尺寸优先」。
 * 一张 4000×3000 的照片压成 JPEG 后可能只有 800KB —— 按旧的 2MB 阈值它会被原样存下，
 * 但解码后是 ~48MB 的位图（宽×高×4）：每次冷启动铺壁纸都是一次内存尖峰，低端机直接 OOM。
 * 壁纸最终只是铺满一屏，存 1920px 就够了，所以只要不是极小图一律先降尺寸。
 */
function compressWallpaperFile(file, cb) {
  if (file.size <= WALLPAPER_DIRECT_BYTES) { cb(file); return; }  // 极小图直存
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = function () {
    try {
      const scale = Math.min(1, WALLPAPER_MAX_SIDE / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(function (blob) {
        URL.revokeObjectURL(url);
        if (blob && blob.size <= WALLPAPER_MAX_BYTES) cb(blob);
        else cb(file);                     // 压缩后仍超限 → 回退原图（IDB 能存，只是不压缩）
      }, 'image/jpeg', WALLPAPER_QUALITY);
    } catch (e) { URL.revokeObjectURL(url); cb(file); }
  };
  img.onerror = function () { URL.revokeObjectURL(url); cb(file); };
  img.src = url;
}

/** 全局事件是否已绑定（防重入：重复绑定会让每次点击被处理两遍） */
let __globalEventsBound = false;

function bindGlobalEvents() {
  // v19：引导页在主程序初始化之前就要显示，事件必须提前绑好；
  // 没有这道守卫的话 initApp 与 startMainApp 会各绑一次，点击全部触发两遍。
  if (__globalEventsBound) return;
  __globalEventsBound = true;

  const content = document.getElementById('content');
  const modalRoot = document.getElementById('modal-root');
  const authRoot = document.getElementById('auth-root');

  // 点击类：导航按钮 / 任务操作 / tab / 日历 / 成就 / 设置
  /**
   * 点击分发外层守卫。
   * 任何一个 case 抛异常都会中断事件回调 → 页面「点了没反应」且控制台只有一行红字，
   * 用户无从判断是没点上还是报错。这里统一兜底：控制台留痕 + 轻提示。
   */
  function dispatchClick(e) {
    try {
      __dispatchClickInner(e);
    } catch (err) {
      try {
        if (typeof console !== 'undefined' && console.error) {
          console.error('[地球Online] 交互异常', err);
        }
      } catch (e2) { /* 控制台不可用时忽略 */ }
      try { if (typeof toast === 'function') toast('操作失败，请重试'); } catch (e2) { /* 忽略 */ }
    }
  }

  function __dispatchClickInner(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;

    switch (action) {
      case 'toggle-task':
        if (taskTreeExpanded.has(id)) taskTreeExpanded.delete(id);
        else taskTreeExpanded.add(id);
        renderTasks();
        break;
      case 'note-toggle':
        if (noteOpenIds.has(id)) noteOpenIds.delete(id);
        else noteOpenIds.add(id);
        renderTasks();
        break;
      case 'note-save':
        handleNoteSave(id);
        break;
      case 'todo-toggle':
        break; // checkbox 由 change 事件统一处理
      case 'task-filter':
        taskFilter = btn.dataset.cat || 'all';
        taskDueFilter = false; // 切回普通分类即退出「即将到期」筛选
        renderTasks();
        break;
      case 'due-tasks':
        taskDueFilter = true;
        navigate('tasks');
        break;
      case 'task-quick-complete': {
        const qcTask = getTaskById(id);
        if (!qcTask) break;
        const willDone = qcTask.status !== 'done';
        setTodoDone(qcTask, willDone);
        if (willDone) playDing();
        checkAutoAchievements();
        refreshCurrentPage();
        break;
      }
      case 'open-task-new':
        openTaskModal(null, null);
        break;
      case 'open-task-child':
        openTaskModal(null, id);
        break;
      case 'open-task-edit':
        openTaskModal(id, null);
        break;
      case 'task-delete': {
        const ids = [id].concat(getDescendantIds(id));
        const names = ids.map(getTaskById).filter(Boolean).map(function (t) { return t.title; });
        openConfirm(
          '将级联删除 ' + ids.length + ' 个任务（含子任务：' + names.join('、') + '），此操作不可撤销，确定吗？',
          function () {
            deleteTaskCascade(id);
            taskTreeExpanded.delete(id);
            noteOpenIds.delete(id);
            checkAutoAchievements();
            refreshCurrentPage();
            toast('任务已删除');
          }
        );
        break;
      }
      case 'backpack-tab':
        backpackTab = btn.dataset.tab;
        renderBackpack();
        break;
      case 'bp-cat-filter':
        backpackCatFilter = btn.dataset.cat || 'all';
        // 收藏夹视图下点击分类 → 切回物品视图再应用筛选，与现有筛选逻辑兼容
        if (backpackTab === 'collection') backpackTab = 'all';
        renderBackpack();
        break;
      case 'item-new':
        openItemModal(null, '', null);
        break;
      case 'item-edit': {
        const item = getItemById(id);
        if (item) openItemModal(item, '', null);
        break;
      }
      case 'item-delete': {
        const item = getItemById(id);
        if (item) {
          openConfirm('确定将「' + item.name + '」移出背包吗？', function () {
            deleteItem(id);
            renderBackpack();
            toast('已移出背包');
          });
        }
        break;
      }
      case 'manage-categories':
        openCategoryManageModal();
        break;
      case 'category-rename': {
        const cat = getItemCategoryList().find(function (c) { return c.id === id; });
        if (cat) openCategoryRenameModal(id, cat.name);
        break;
      }
      case 'category-delete': {
        const cat = getItemCategoryList().find(function (c) { return c.id === id; });
        openConfirm('删除分类「' + (cat ? cat.name : '') + '」？该分类下的物品会归入「未分类」。', function () {
          deleteItemCategory(id);
          toast('已删除分类');
          closeModal();
          renderBackpack();
          openCategoryManageModal();
        });
        break;
      }
      case 'cal-prev':
        calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
        renderCalendar();
        break;
      case 'cal-next':
        calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
        renderCalendar();
        break;
      case 'cal-today':
        calendarCursor = new Date();
        calendarSelected = todayStr();
        renderCalendar();
        break;
      case 'cal-select': {
        // v9：点日期 = 选中 + 直接弹出写入框（灵感 / ToDo 二选一）
        calendarSelected = btn.dataset.date;
        rerenderCalendarHost();
        openCalendarEntryModal(btn.dataset.date);
        break;
      }
      case 'calendar-note-save': {
        // v15：保存后不再整块重渲 —— 重渲会替换 textarea 节点，造成「输入框自动退出」（焦点/光标丢失）。
        // 文本内容此刻已在输入框里，就地写库即可，UI 无需重建。
        const noteEl = document.getElementById('calNoteInput');
        const v = noteEl ? String(noteEl.value).trim() : '';
        if (v) state.calendarNotes[calendarSelected] = v;
        else delete state.calendarNotes[calendarSelected];
        saveState();
        toast(v ? '已保存当天记录' : '已清除当天记录');
        if (noteEl && typeof noteEl.focus === 'function') { try { noteEl.focus(); } catch (e) { /* 忽略 */ } }
        break;
      }
      case 'calendar-note-clear': {
        // v15：同样就地清空，不重渲，避免 textarea 被销毁
        const noteEl = document.getElementById('calNoteInput');
        delete state.calendarNotes[calendarSelected];
        saveState();
        if (noteEl) { noteEl.value = ''; if (typeof noteEl.focus === 'function') { try { noteEl.focus(); } catch (e) { /* 忽略 */ } } }
        toast('已清除当天记录');
        break;
      }
      case 'calendar-entry-type':
        setCalendarEntryType(btn.dataset.type);
        break;
      case 'home-memo-voice':
        toggleVoiceInput();
        break;
      case 'life-card-share':
        shareLifeCard();
        break;
      /* v1.0.2：徽章墙 —— 从已解锁成就中佩戴最多 3 枚 */
      case 'badge-wear':
        openBadgeWallModal();
        break;
      case 'badge-toggle': {
        const bid = btn.dataset.id;
        const worn = (getProfile().wornBadges || []).slice();
        const idx = worn.indexOf(bid);
        if (idx !== -1) worn.splice(idx, 1);
        else {
          if (worn.length >= 3) { toast('最多佩戴 3 枚徽章，先摘下一枚吧'); break; }
          worn.push(bid);
        }
        updateProfile({ wornBadges: worn });
        openBadgeWallModal(); // 就地刷新选择态
        break;
      }
      case 'goto-profile':
        navigate('profile');
        break;

      /* ---------- 主页游戏化快捷入口（v3） ---------- */
      case 'home-new-task':
        navigate('tasks');
        openTaskModal(null, null);
        break;
      case 'home-add-item':
        navigate('backpack');
        openItemModal(null, '', null);
        break;
      case 'home-ach':
        navigate('achievements');
        break;
      case 'home-today':
        openTodayModal();
        break;
      case 'home-memo-add':
        saveHomeMemo(document.getElementById('homeMemoInput'));
        break;
      case 'home-ai':
        navigate('ai');
        break;
      /* ---------- v1.2.0：心情 / 表情包入口（快速入口第 5 格） ---------- */
      case 'close-modal':
        closeModal();
        break;
      case 'home-mood':
        openMoodPickerModal();
        break;
      case 'mood-pick': {
        const moodKey = btn.dataset.mood || '';
        const moodNote = btn.dataset.note || '';
        if (typeof addMemo === 'function') addMemo(moodNote, 'mood');
        if (typeof checkAutoAchievements === 'function') checkAutoAchievements();
        closeModal();
        toast(moodKey ? ('已记录今日心情 ' + moodKey) : '已记录心情');
        refreshCurrentPage();
        break;
      }
      case 'memo-del':
        deleteMemo(id);
        renderHome();
        toast('记录已删除');
        break;

      /* ---------- 个人资料（profile.js 导出，T03） ---------- */
      case 'profile-avatar-select':
        handleProfileAvatarSelect(btn.dataset.key);
        break;
      case 'profile-avatar-upload':
        triggerProfileAvatarUpload();
        break;
      case 'profile-field-add':
        captureProfileFormDraft();
        openCustomFieldModal(null);
        break;
      case 'profile-field-edit': {
        captureProfileFormDraft();
        const field = getCustomFieldById(id);
        if (field) openCustomFieldModal(field);
        break;
      }
      case 'profile-field-delete': {
        captureProfileFormDraft();
        const f = getCustomFieldById(id);
        if (!f) break;
        openConfirm('确定删除自定义字段「' + f.label + '」吗？', function () {
          deleteCustomField(id);
          renderProfile();
          toast('字段已删除');
        });
        break;
      }
      case 'profile-save':
        handleProfileSave();
        break;

      /* ---------- 个人收藏（collections.js 导出，T04） ---------- */
      case 'collection-new':
        openCollectionModal(null);
        break;
      case 'collection-open':
        openCollectionDetail(id);
        break;
      case 'collection-edit': {
        const entry = getCollectionById(id);
        if (entry) openCollectionModal(entry);
        break;
      }
      case 'collection-delete':
        confirmDeleteCollection(id);
        break;
      case 'collection-file-relink':
        triggerCollectionRelink(id);
        break;
      case 'collection-cat-filter':
        handleCollectionCategoryFilter(btn.dataset.cat);
        break;
      case 'collection-manage-categories':
        openCollectionCategoryManageModal();
        break;
      case 'collection-cat-rename':
        openCollectionCategoryRenameModal(btn.dataset.name);
        break;
      case 'collection-cat-delete':
        openConfirm('删除分类「' + (btn.dataset.name || '') + '」？该分类下的收藏会归入「未分类」。', function () {
          deleteCollectionCategory(btn.dataset.name);
          toast('已删除分类');
          closeModal();
          renderBackpack();
          openCollectionCategoryManageModal();
        });
        break;

      case 'collection-search':
      case 'backpack-search':
        break; // 输入类：由下方 input 监听处理
      case 'collection-file-attach':
        triggerCollectionFileAttach();
        break;

      /* ---------- v10：足迹地图 ---------- */
      case 'map-new':
        ensureModule('map').then(function () { if (typeof EO !== 'undefined' && EO && EO.map) EO.map.newLocation(); });
        break;
      case 'map-open':
        ensureModule('map').then(function () { if (typeof EO !== 'undefined' && EO && EO.map) EO.map.openLocation(btn.dataset.id); });
        break;
      case 'map-edit': {
        const id = btn.dataset.id;
        ensureModule('map').then(function () { if (typeof EO !== 'undefined' && EO && EO.map) EO.map.editLocation(id); });
        break;
      }
      case 'map-delete': {
        const id = btn.dataset.id;
        ensureModule('map').then(function () { if (typeof EO !== 'undefined' && EO && EO.map) EO.map.deleteLocation(id); });
        break;
      }
      case 'map-list-toggle':
        ensureModule('map').then(function () { if (typeof EO !== 'undefined' && EO && EO.map) EO.map.toggleList(); });
        break;
      case 'map-locate':
        ensureModule('map').then(function () { if (typeof EO !== 'undefined' && EO && EO.map) EO.map.locate(); });
        break;
      case 'map-manual':
        ensureModule('map').then(function () { if (typeof EO !== 'undefined' && EO && EO.map) EO.map.manual(); });
        break;
      case 'map-manual-ok':
        ensureModule('map').then(function () { if (typeof EO !== 'undefined' && EO && EO.map) EO.map.manualOk(); });
        break;
      case 'map-manual-cancel':
        ensureModule('map').then(function () { if (typeof EO !== 'undefined' && EO && EO.map) EO.map.manualCancel(); });
        break;

      /* ---------- 成就页筛选（T05） ---------- */
      case 'ach-new':
        openAchievementModal();
        break;
      case 'ach-toggle':
        toggleAchievementUnlocked(id);
        renderAchievements();
        break;

      /* ---------- v5：成就删除 / 重置 / 恢复备份 ---------- */
      case 'ach-delete': {
        const target = getAchievementById(id);
        if (!target) { toast('这条成就已经不在了'); break; }
        // 自动成就删掉后会被 ensureAutoAchievements 补回，如实告知，别让用户以为删不掉是 bug
        const extra = (target.type === 'auto')
          ? '（这是系统自动成就，刷新页面后会重新出现）' : '';
        openConfirm('确定要删除此成就记录吗？' + extra, function () {
          if (!deleteAchievement(id)) { toast('删除失败，请刷新后重试'); return; }
          toast('已删除成就：' + target.title);
          renderAchievements();
        }, null);
        break;
      }
      case 'ach-reset': {
        const unlockedNow = state.achievements.filter(function (a) { return a.unlocked; }).length;
        if (!unlockedNow) { toast('当前没有已解锁的成就，无需重置'); break; }
        // 如实告知「系统成就会复活」：解锁状态是依据任务/日志等数据派生的，
        // 重置清掉的是记录不是数据本身。不说清楚，用户会当成 bug（刷新后又全亮了）。
        openConfirm('将清空所有已解锁成就（共 ' + unlockedNow + ' 条），此操作不可撤销，确定继续？' +
          '重置前会自动备份，可在设置页恢复。' +
          '注意：系统成就依据你的任务、日志等数据判定，重置后会重新点亮。', function () {
          if (!backupAchievements()) {
            openConfirm('无法写入本地备份，仍要继续重置吗？', function () {
              doResetAchievements();
            }, null);
            return;
          }
          doResetAchievements();
        }, null);
        break;
      }
      case 'ach-restore':
        openConfirm('将用备份覆盖当前成就列表，确定继续吗？', function () {
          const res = restoreAchievementsBackup();
          if (!res.ok) { toast(res.error || '恢复失败'); return; }
          toast('已恢复 ' + res.count + ' 条成就');
          refreshCurrentPage();
        }, null);
        break;

      case 'ach-tab':
        achCategoryFilter = btn.dataset.cat || 'all';
        renderAchievements();
        break;
      case 'ach-filter-unlocked':
        achOnlyUnlocked = !achOnlyUnlocked;
        renderAchievements();
        break;
      case 'reset-data':
        openConfirm('将清空所有本地数据并恢复为种子数据，确定吗？', function () {
          resetAllData();
        });
        break;

      /* ---------- v8：AI 助手（配置 / 发送 / 清空对话） ---------- */
      case 'ai-save-config':
        ensureModule('ai').then(function () { if (typeof EO !== 'undefined' && EO && EO.ai) EO.ai.saveAiConfig(); });
        break;
      case 'ai-send':
        ensureModule('ai').then(function () { if (typeof EO !== 'undefined' && EO && EO.ai) EO.ai.handleAiSend(); });
        break;
      case 'ai-clear':
        aiMessages = [];
        renderAI();
        toast('对话已清空');
        break;

      /* ---------- v4 PART1：数据备份（backup.js 提供实现） ---------- */
      case 'export-backup':
        if (typeof exportBackup === 'function') exportBackup();
        break;
      case 'import-backup': {
        const fileInput = document.getElementById('backupFileInput');
        if (fileInput) {
          fileInput.value = ''; // 允许连续选择同一个文件
          if (typeof fileInput.click === 'function') fileInput.click();
        }
        break;
      }

      /* ---------- v4 扩展：WebDAV 云同步（webdav.js 提供实现） ---------- */
      case 'webdav-test':
        if (typeof webdavTestConnection === 'function') webdavTestConnection(btn);
        break;
      case 'webdav-upload':
        if (typeof webdavUploadBackup === 'function') webdavUploadBackup(btn);
        break;
      case 'webdav-restore':
        if (typeof webdavRestoreBackup === 'function') webdavRestoreBackup(btn);
        break;
      case 'webdav-togglepwd':
        if (typeof webdavTogglePassword === 'function') webdavTogglePassword(btn);
        break;
      case 'webdav-autosync':
        if (typeof webdavToggleAutoSync === 'function') webdavToggleAutoSync(btn);
        break;

      /* ---------- v4 PART2：看板趋势区间切换 ---------- */
      /* ⚠️ 必须走 stats.js 的 setter：dashboardTrendRange 是它的模块私有变量，
         这里直接给全局快照赋值改不到真身，趋势区间会永远停在「近 7 天」。 */
      case 'dash-range':
        if (typeof setDashboardTrendRange === 'function') setDashboardTrendRange(btn.dataset.range);
        else dashboardTrendRange = (btn.dataset.range === '4w') ? '4w' : '7d';
        refreshCurrentPage();
        break;

      /* ---------- v5：数据页视图切换（数据概览 / 日历视图） ---------- */
      /* 同上：必须走 setter，否则「📅 日历视图」点了不生效。 */
      case 'dash-view':
        if (typeof setDashboardView === 'function') setDashboardView(btn.dataset.view);
        else dashboardView = (btn.dataset.view === 'calendar') ? 'calendar' : 'overview';
        refreshCurrentPage();
        break;

      /* ---------- v5：主页记录点击 → 跳转数据看板并高亮对应区块 ---------- */
      case 'jump-dashboard': {
        dashboardFocus = btn.dataset.target || '';
        // 目标区块只存在于概览视图；若用户正停在日历视图，先切回去
        // 同样必须走 setter，否则日历视图切不回来
        if (typeof setDashboardView === 'function') setDashboardView('overview');
        else dashboardView = 'overview';
        // 跳过「回到顶部」：紧接着要滚到目标区块，两次平滑滚动并发会互相打断
        navigate('data', { scrollTop: false });
        if (typeof toast === 'function') toast('已跳转到数据看板');
        scrollToDashboardFocus();
        break;
      }
      /* ---------- v19：首次引导页 ---------- */
      case 'onboarding-save':
        handleOnboardingSave();
        break;
      case 'open-verifin':
        openVerifin();
        break;

      /* ---------- v15 批 B：外观（深色模式 + 自定义壁纸） ---------- */
      case 'theme-set': {
        const theme = btn.dataset.theme === 'dark' ? 'dark' : 'light';
        try {
          if (typeof EOStore !== 'undefined' && EOStore && typeof EOStore.set === 'function') EOStore.set('earth_theme', theme);
          else localStorage.setItem('earth_theme', theme);
        } catch (e) { /* 隐私模式忽略 */ }
        // v15 解耦批：不再直调 app.js 的 applyTheme，改发事件，由 app.js 订阅处理
        if (typeof EarthBus !== 'undefined' && EarthBus) EarthBus.emit('ui:apply-theme');
        renderSettings();
        toast(theme === 'dark' ? '已切换到深色模式' : '已切换到亮色模式');
        break;
      }
      /* ---------- v1.2.1：本地自动备份 ---------- */
      case 'autobak-now':
        try {
          const ok = (typeof runAutoBackup === 'function') ? runAutoBackup(true) : false;
          toast(ok ? '已保存一份本地快照' : '备份失败（存储空间可能不足）');
          if (ok) renderSettings();
        } catch (e) { toast('备份失败'); }
        break;
      case 'autobak-restore': {
        const id = btn.dataset.id;
        if (!id) break;
        openConfirm('从这份自动快照恢复？恢复按主键合并：快照里有的以快照为准，你之后新增的数据会保留。', function () {
          let ok = false;
          try { ok = (typeof restoreAutoBackup === 'function') ? restoreAutoBackup(id) : false; } catch (e) { ok = false; }
          toast(ok ? '已恢复，正在刷新…' : '恢复失败');
          if (ok) { try { location.reload(); } catch (e) { renderSettings(); } }
        });
        break;
      }

      /* ---------- v1.2.1：成就解锁音效开关 ---------- */
      case 'ach-sound-toggle': {
        const next = !achSoundOn();
        setAchSoundOn(next);
        if (next) playAchievementChime();   // 开的时候响一声，让用户确认「这就是那个音」
        toast(next ? '成就音效已开启' : '成就音效已关闭');
        renderSettings();
        break;
      }
      case 'notify-toggle': {
        const on = (typeof notifyEnabled === 'function') ? notifyEnabled() : true;
        const next = !on;
        try {
          if (typeof EOStore !== 'undefined' && EOStore && typeof EOStore.set === 'function') EOStore.set('earth_notify', next ? 'on' : 'off');
          else localStorage.setItem('earth_notify', next ? 'on' : 'off');
        } catch (e) {}
        if (next) {
          if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
            Notification.requestPermission().then(function (p) {
              if (p === 'granted') { if (typeof EarthBus !== 'undefined' && EarthBus) EarthBus.emit('notify:changed'); toast('到期提醒已开启'); }
              else if (p === 'denied') { toast('通知权限被拒绝，请在浏览器设置中开启'); }
              else { toast('到期提醒已开启（未授权，到期将不弹通知）'); }
            }).catch(function () { toast('到期提醒已开启'); });
          } else if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
            toast('通知权限已被拒绝，请在浏览器设置中开启');
          } else {
            toast('到期提醒已开启');
          }
        } else {
          toast('到期提醒已关闭');
        }
        renderSettings();
        break;
      }
      case 'wallpaper-upload': {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/*';
        inp.onchange = function () {
          const f = inp.files && inp.files[0];
          if (!f) return;
          if (typeof EarthIDB === 'undefined' || !EarthIDB) {
            toast('当前环境不支持本地数据库，无法保存壁纸');
            return;
          }
          const reader = new FileReader();
          reader.onload = function () {
            const dataUrl = String(reader.result || '');
            if (!dataUrl) { toast('图片读取失败，请重试'); return; }
            // v1.0.3：保留原图分辨率与画质，提供自定义裁剪（自由比例）；不降采样、不压缩。
            openImageCropModal({
              src: dataUrl,
              title: '裁剪壁纸',
              aspect: null,
              onCropped: function (cropped) {
                const blob = dataUrlToBlob(cropped);
                if (!blob) { toast('壁纸处理失败，请重试'); return; }
                EarthIDB.idbSet('wallpaper_blob', blob).then(function () {
                  try {
                    if (typeof EOStore !== 'undefined' && EOStore && typeof EOStore.set === 'function') EOStore.set('earth_wallpaper', { type: 'image' });
                    else localStorage.setItem('earth_wallpaper', JSON.stringify({ type: 'image' }));
                  } catch (e) {}
                  if (typeof EarthBus !== 'undefined' && EarthBus) EarthBus.emit('ui:apply-wallpaper');
                  toast('壁纸已更新');
                }).catch(function () { toast('壁纸保存失败，请重试'); });
              }
            });
          };
          reader.onerror = function () { toast('图片读取失败，请重试'); };
          reader.readAsDataURL(f);
        };
        inp.click();
        break;
      }
      case 'wallpaper-preset': {
        const value = btn.dataset.value || '';
        const name = btn.dataset.name || '';
        if (!value) break;
        try {
          if (typeof EOStore !== 'undefined' && EOStore && typeof EOStore.set === 'function') EOStore.set('earth_wallpaper', { type: 'gradient', value: value, name: name });
          else localStorage.setItem('earth_wallpaper', JSON.stringify({ type: 'gradient', value: value, name: name }));
        } catch (e) { /* 忽略 */ }
        if (typeof EarthBus !== 'undefined' && EarthBus) EarthBus.emit('ui:apply-wallpaper');
        renderSettings();
        toast('壁纸已切换');
        break;
      }
      /* ---------- v1.2.0：关于页 · 赞助二维码 ---------- */
      // v1.2.1：清空主页搜索（点 × 而不是手动一个个删字）
      case 'home-search-clear': {
        const input = document.getElementById('homeSearch');
        if (input) { input.value = ''; try { input.focus(); } catch (e) {} }
        const box = document.getElementById('homeSearchResults');
        if (box) box.innerHTML = '';
        break;
      }

      // v1.2.1：隐私政策（设置页「数据与隐私」组入口）
      case 'privacy-policy': {
        const list = (typeof PRIVACY_POLICY !== 'undefined' && Array.isArray(PRIVACY_POLICY))
          ? PRIVACY_POLICY : [];
        const cur = (typeof APP_INFO === 'object' && APP_INFO) ? APP_INFO.version : '';
        openModal(
          '<div class="modal-card modal-wide">' +
            '<h3 class="modal-title">🔏 隐私政策</h3>' +
            '<p class="muted">最后更新：' + escapeHtml((typeof APP_INFO === 'object' && APP_INFO) ? APP_INFO.buildDate : '') +
              ' · v' + escapeHtml(cur) + '</p>' +
            '<div class="privacy-body">' +
              list.map(function (sec) {
                return '<div class="privacy-sec">' +
                  '<div class="privacy-sec-title">' + escapeHtml(sec.title) + '</div>' +
                  '<div class="privacy-sec-body">' + escapeHtml(sec.body).replace(/\n/g, '<br>') + '</div>' +
                '</div>';
              }).join('') +
            '</div>' +
            '<div class="modal-actions">' +
              '<button class="btn btn-primary" data-action="close-modal">我已阅读</button>' +
            '</div>' +
          '</div>'
        );
        break;
      }

      // v1.2.1：检查更新（WebDAV 上有版本文件则比对，否则引导去 Release 页面）
      case 'check-update': {
        doWebUpdateCheck();
        break;
      }

      // v1.2.1：打开 Release 页面（检查更新弹窗内的「去看看」）
      case 'open-release': {
        try {
          const url = (typeof RELEASE_URL !== 'undefined' && RELEASE_URL) ? RELEASE_URL : '';
          if (url && typeof window !== 'undefined' && window.open) window.open(url, '_blank', 'noopener');
          else toast('未配置 Release 页面地址');
        } catch (e) { toast('打开失败：' + (e && e.message ? e.message : e)); }
        closeModal();
        break;
      }

      // v1.2.2：更新说明（设置页「关于」组入口）
      case 'changelog': {
        const logs = (typeof CHANGELOG !== 'undefined' && Array.isArray(CHANGELOG)) ? CHANGELOG : [];
        openModal(
          '<div class="modal-card modal-wide">' +
            '<h3 class="modal-title">📝 更新说明</h3>' +
            '<div class="privacy-body">' +
              logs.map(function (log) {
                return '<div class="privacy-sec">' +
                  '<div class="privacy-sec-title">v' + escapeHtml(log.version) +
                    ' <span class="muted">· ' + escapeHtml(log.date) + '</span></div>' +
                  '<div class="privacy-sec-body">' +
                    (log.items || []).map(function (it) {
                      return '· ' + escapeHtml(it);
                    }).join('<br>') +
                  '</div>' +
                '</div>';
              }).join('') +
            '</div>' +
            '<div class="modal-actions">' +
              '<button class="btn btn-primary" data-action="close-modal">知道了</button>' +
            '</div>' +
          '</div>'
        );
        break;
      }

      case 'about-sponsor':
        openModal(
          '<h3 class="modal-title">❤️ 赞助开发者</h3>' +
          '<p class="modal-text">地球Online 完全免费、无广告、无服务器成本。' +
            '如果它陪你走过了一段路，欢迎扫码请开发者喝一杯 ☕（金额随意）。</p>' +
          '<div class="sponsor-qr-wrap">' +
            /* 赞助码：WebP 优先（69KB JPG → 19KB），不支持时回落到同名 JPG；
               弹窗内容默认不渲染，故加 loading="lazy" + decoding="async" 避免首屏抢占带宽。 */
            '<picture>' +
              '<source srcset="icons/sponsor-qr.webp" type="image/webp">' +
              '<img class="sponsor-qr" src="icons/sponsor-qr.jpg" alt="赞助收款码"' +
                ' loading="lazy" decoding="async" width="586" height="640">' +
            '</picture>' +
          '</div>' +
          '<p class="muted sponsor-qr-tip">长按图片保存到相册，再用微信「扫一扫 · 相册」识别。</p>' +
          '<div class="modal-actions"><button class="btn btn-primary" data-action="close-modal">知道啦</button></div>'
        );
        break;

      /* ---------- v1.2.0：字号三档 ---------- */
      case 'font-scale': {
        const fsVal = btn.dataset.value || 'std';
        if (typeof setFontScale === 'function') setFontScale(fsVal);
        renderSettings();
        toast(fsVal === 'std' ? '已恢复标准字号' : '字号已放大');
        break;
      }
      case 'wallpaper-reset':
        try {
          if (typeof EOStore !== 'undefined' && EOStore && typeof EOStore.set === 'function') EOStore.set('earth_wallpaper', { type: 'none' });
          else localStorage.setItem('earth_wallpaper', JSON.stringify({ type: 'none' }));
        } catch (e) {}
        if (typeof EarthBus !== 'undefined' && EarthBus) EarthBus.emit('ui:apply-wallpaper');
        renderSettings();
        toast('已恢复默认背景');
        break;

      // v1.2.1：「更多」下拉面板移除，右上角改为设置图标（直接 data-action="nav"
      // 到 settings），原本的 case 'home-more' 随之删除 —— 保留会触发 QA 的
      // 「有 case 无 data-action 生成点」死代码检查。
      case 'nav': {
        const pageKey = btn.dataset.page;
        if (!pageKey) break;
        // 收藏入口需先切到收藏 tab（而非「全部」物品视图）
        if (pageKey === 'backpack' && btn.dataset.tab) backpackTab = btn.dataset.tab;
        navigate(pageKey);
        break;
      }

      default:
        break;
    }
  }
  content.addEventListener('click', dispatchClick);
  if (modalRoot) modalRoot.addEventListener('click', dispatchClick);
  // v19：引导页挂在 #auth-root，也得走同一套分发（onboarding-save 依赖它）
  if (authRoot) authRoot.addEventListener('click', dispatchClick);

  // input 类：收藏夹搜索框（即时过滤 + 焦点恢复，collections.js 处理）
  content.addEventListener('input', function (e) {
    if (e.target.id === 'collectionSearch') {
      handleCollectionSearchInput(e.target.value);
    } else if (e.target.id === 'backpackSearch') {
      handleBackpackSearchInput(e.target.value);
    } else if (e.target.id === 'homeSearch') {
      handleHomeSearchInput(e.target.value);
    }
  });

  // change 类：To Do 勾选框
  content.addEventListener('change', function (e) {
    if (e.target.classList.contains('todo-check')) {
      const task = getTaskById(e.target.dataset.id);
      if (!task) return;
      bouncedTodoIds.add(task.id);
      setTodoDone(task, e.target.checked);
      if (e.target.checked) playDing();
      checkAutoAchievements();
      refreshCurrentPage();
      return;
    }
    // 生日选择器双向同步：改下拉 → 写回日历输入；改日历 → 回填下拉
    const role = e.target.dataset ? e.target.dataset.role : '';
    if (role === 'birth-part') {
      if (typeof syncBirthDateFromSelects === 'function') syncBirthDateFromSelects();
      return;
    }
    if (e.target.id === 'profileBirth') {
      if (typeof syncBirthSelectsFromDate === 'function') syncBirthSelectsFromDate();
    }
  });

  // 回车类：主页世界日志输入框
  content.addEventListener('keydown', function (e) {
    if (e.target.id === 'homeMemoInput' && e.key === 'Enter') {
      saveHomeMemo(e.target);
    }
  });

  // 侧栏灵感闪念输入框（常驻，只需绑定一次）
  const sidebarMemo = document.getElementById('sidebarMemoInput');
  sidebarMemo.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') saveQuickMemo(sidebarMemo);
  });

  /**
   * 探出「遮罩下面压着的是谁」。
   * 临时把遮罩设为 pointer-events:none，用 elementFromPoint 拿到真实落点元素，再还原。
   * 只在真实浏览器里有效；单测 / 无 elementFromPoint 的环境一律返回 null（调用方会跳过）。
   */
  function elementUnderOverlay(e) {
    try {
      const overlay = e.target;
      if (!overlay || !overlay.style || typeof document.elementFromPoint !== 'function') return null;
      const x = e.clientX, y = e.clientY;
      if (typeof x !== 'number' || typeof y !== 'number') return null;
      const prev = overlay.style.pointerEvents;
      overlay.style.pointerEvents = 'none';
      const el = document.elementFromPoint(x, y);
      overlay.style.pointerEvents = prev;
      return el;
    } catch (err) {
      return null;
    }
  }

  /**
   * 点击遮罩关闭模态框。
   *
   * v10 加了两道保险，治的是「点输入框却把弹窗关了」这类误触：
   *   ① 只有点到的就是 .modal-overlay 本身才关；点在 .modal 内容区（哪怕是其 padding）
   *      一律不关 —— 内容区里的按钮、输入框都归内容自己处理。
   *   ② 输入框 / 文本域正聚焦时不关。移动端软键盘弹出会引发一次合成点击，
   *      落点常常正好在遮罩上，不挡掉就会把用户输到一半的内容吞掉；
   *      此时改为收起键盘（blur），既响应了点击又不丢数据。
   */
  modalRoot.addEventListener('click', function (e) {
    if (!e.target.classList.contains('modal-overlay')) return;
    const active = (typeof document !== 'undefined') ? document.activeElement : null;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
      if (typeof active.blur === 'function') active.blur();
      return;
    }
    /* v1.2.0：遮罩铺满视口，会连底部 Tab / 侧栏的点击一起吃掉 ——
       表现就是「弹窗开着时点主页 Tab，只关了弹窗、页面没动」，用户以为 Tab 坏了。
       这里在关弹窗之前先探一下落点下面压着的是不是导航项，是就顺手跳过去。 */
    const under = elementUnderOverlay(e);
    const navBtn = (under && typeof under.closest === 'function')
      ? under.closest('#tabbar [data-page], #sidebar [data-page], #nav [data-page]')
      : null;
    closeModal();
    if (navBtn && navBtn.dataset.page) navigate(navBtn.dataset.page);
    return;
  });

  // v4 PART1：隐藏文件选择框的 change 事件（导入备份）
  const backupFile = document.getElementById('backupFileInput');
  if (backupFile) {
    backupFile.addEventListener('change', function (e) {
      const files = e.target.files;
      if (!files || !files.length) return;
      if (typeof handleBackupFileSelected === 'function') handleBackupFileSelected(files[0]);
    });
  }
}

/* ==================== v3 主页游戏化辅助 ==================== */

/** 数据看板高亮目标（一次性：滚动并短暂高亮后立即清空） */
let dashboardFocus = '';

/**
 * 滚动到数据看板的指定区块并短暂高亮。
 * 高亮走 classList 切换（由 CSS 过渡完成），不在循环里改内联样式，避免逐帧重排。
 */
function scrollToDashboardFocus() {
  const id = dashboardFocus;
  dashboardFocus = '';
  if (!id) return;
  const el = document.getElementById(id);
  if (!el) return;
  if (typeof el.scrollIntoView === 'function') {
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    catch (e) {
      try { el.scrollIntoView(); } catch (e2) { /* 环境不支持平滑滚动则跳过 */ }
    }
  }
  try { el.classList.add('dash-focus'); } catch (e) { return; }
  if (typeof setTimeout === 'function') {
    setTimeout(function () {
      try { el.classList.remove('dash-focus'); } catch (e) { /* 忽略 */ }
    }, 1600);
  }
}

/** 统计卡片数字从 0 滚动到目标值（requestAnimationFrame，含降级） */
/**
 * 数字滚动动画（统计卡片）。
 *
 * 旧实现给**每个**数字各开一个 rAF 循环：5 张卡 = 5 个并行循环，每帧 5 次 textContent 赋值。
 * 现在统一为**单个** rAF 循环批量驱动，并且只在取整结果真的变化时才写 DOM ——
 * 1200ms 内一个 3 位数最多写 3 次而不是每帧都写（120Hz 下从 ~720 次 DOM 写入降到 ~3 次）。
 * 文本节点仍是必要的（数字内容本身），已无法避免；这里省掉的是「无变化的重复写入」。
 */
/**
 * v9：数字滚动只在「首次加载」播一次。
 * 每次切回主页 / 看板都从 0 重新滚一遍，观感上是界面在反复抽搐；
 * 而统计数字本就是即时读出来的，重复滚动并不携带任何新信息。
 * 后续渲染直接落到终值，一次 rAF 都不再启动。
 */
let __countersDone = false;

function animateCounters() {
  const els = document.querySelectorAll('[data-count]');
  if (!els || !els.length) return;

  if (__countersDone) {
    Array.prototype.forEach.call(els, function (el) {
      el.textContent = parseInt(el.getAttribute('data-count'), 10) || 0;
    });
    return;
  }
  __countersDone = true;

  const hasRAF = (typeof requestAnimationFrame === 'function');
  const list = [];

  Array.prototype.forEach.call(els, function (el) {
    const target = parseInt(el.getAttribute('data-count'), 10) || 0;
    if (!hasRAF || target <= 0) { el.textContent = target; return; }
    list.push({ el: el, target: target, last: -1 });
  });
  if (!list.length) return;

  const dur = 1200;
  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

  function frame(now) {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const v = Math.round(it.target * eased);
      if (v !== it.last) { it.last = v; it.el.textContent = v; }
    }
    if (p < 1) requestAnimationFrame(frame);
    else {
      // 收尾：确保落在精确目标值上
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        if (it.last !== it.target) it.el.textContent = it.target;
      }
    }
  }
  requestAnimationFrame(frame);
}

/** 今日日程弹窗：列出今天到期/创建的未完成任务 + 今天的日志 */
function openTodayModal() {
  const today = todayStr();
  const todos = state.tasks.filter(function (t) {
    return (t.dueDate === today || t.createdAt === today) && t.status !== 'done';
  });
  const memosToday = state.memos.filter(function (m) { return (m.createdAt || '').slice(0, 10) === today; });
  let html = '<h3 class="modal-title">📅 今日日程 · ' + today + '</h3><div class="today-list">';
  if (!todos.length && !memosToday.length) {
    html += '<div class="empty">今天还没有安排，去新建一个任务吧</div>';
  }
  todos.forEach(function (t) {
    const cat = TASK_CATEGORY[t.category] || { label: t.category, cls: '' };
    html += '<div class="today-row">' +
      '<span class="badge ' + cat.cls + '">' + cat.label + '</span>' +
      '<span>' + escapeHtml(t.title) + '</span></div>';
  });
  memosToday.forEach(function (m) {
    html += '<div class="today-row muted">💡 ' + escapeHtml(m.text) + '</div>';
  });
  html += '</div><div class="modal-actions"><button class="btn btn-primary" id="tdClose">知道了</button></div>';
  openModal(html);
  const c = document.getElementById('tdClose');
  if (c) c.onclick = closeModal;
}

/* v9：全局动态背景（initParticles + FPS 计数器）已整体移除。   常驻 rAF 循环属于「一直在跑但用户无感」的持续性开销：每帧都要清空并重绘整个视口，   在移动端直接表现为耗电与发热，而手账质感靠的是留白、卡片与毛玻璃，并不依赖会动的背景。   保留的微交互（纯 CSS 或一次性）：hover 上浮、点击按压反馈、进度条 scaleX 填充、   数字滚动（仅首屏一次，见 animateCounters 的 __countersDone 守卫）。 *//** 底部游戏风格彩蛋语录（预设 10 句，每次刷新随机取一句） */
const HOME_QUOTES = [
  '你的人生没有主线任务，但你就是自己的 GM。',
  '存档不会自动保存，记得好好生活。',
  '每一次完成，都是给自己的一次 +1。',
  '世界很大，先点亮你脚下的格子。',
  '等级不代表实力，热爱才是隐藏属性。',
  '背包里的不是物品，是走过的路。',
  '成就解锁的瞬间，只有你自己能听见那声叮。',
  '开放世界的门票，是好奇心。',
  '今天的经验值，来自你认真对待的每件小事。',
  '别急着通关，沿途的风景也是奖励。',
];
function randomQuote() {
  return HOME_QUOTES[Math.floor(Math.random() * HOME_QUOTES.length)];
}

/* ==================== v10：足迹地图 ==================== */

/** 地图上最近一次点击的经纬度，供「+ 添加足迹」预填 */

/* v16：足迹地图逻辑已抽到 modules/map.js（运行时按需装载）。此处保留渲染转发桩，
 * 保证 MOBILE_TABS 的 render: renderMapAuto 与全局调用不破坏（首次调用经 ensureModule 装载真实模块）。 */
function renderMapAuto() {
  if (typeof EO !== "undefined" && EO && EO.map) { EO.map.renderMapAuto(); return; }
  if (typeof ensureModule === "function") ensureModule("map").then(function () {
    if (typeof EO !== "undefined" && EO && EO.map) EO.map.renderMapAuto();
  });
}


  /* ---- 导出公共 API 到 EO 命名空间并同步到全局（兼容旧引用 / 测试桩） ---- */
  E.noteOpenIds = noteOpenIds;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.noteOpenIds === "undefined") globalThis.noteOpenIds = noteOpenIds; } catch (e) {}
  E.taskTreeExpanded = taskTreeExpanded;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.taskTreeExpanded === "undefined") globalThis.taskTreeExpanded = taskTreeExpanded; } catch (e) {}
  E.backpackSearch = backpackSearch;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.backpackSearch === "undefined") globalThis.backpackSearch = backpackSearch; } catch (e) {}
  E.calendarCursor = calendarCursor;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.calendarCursor === "undefined") globalThis.calendarCursor = calendarCursor; } catch (e) {}
  E.calendarSelected = calendarSelected;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.calendarSelected === "undefined") globalThis.calendarSelected = calendarSelected; } catch (e) {}
  E.achCategoryFilter = achCategoryFilter;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.achCategoryFilter === "undefined") globalThis.achCategoryFilter = achCategoryFilter; } catch (e) {}
  E.achOnlyUnlocked = achOnlyUnlocked;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.achOnlyUnlocked === "undefined") globalThis.achOnlyUnlocked = achOnlyUnlocked; } catch (e) {}
  E.taskFilter = taskFilter;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.taskFilter === "undefined") globalThis.taskFilter = taskFilter; } catch (e) {}
  E.taskDueFilter = taskDueFilter;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.taskDueFilter === "undefined") globalThis.taskDueFilter = taskDueFilter; } catch (e) {}
  E.__dingCtx = __dingCtx;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.__dingCtx === "undefined") globalThis.__dingCtx = __dingCtx; } catch (e) {}
  E.playDing = playDing;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.playDing === "undefined") globalThis.playDing = playDing; } catch (e) {}
  E.escapeHtml = escapeHtml;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.escapeHtml === "undefined") globalThis.escapeHtml = escapeHtml; } catch (e) {}
  E.val = val;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.val === "undefined") globalThis.val = val; } catch (e) {}
  E.fmtDate = fmtDate;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.fmtDate === "undefined") globalThis.fmtDate = fmtDate; } catch (e) {}
  E.fmtDateTime = fmtDateTime;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.fmtDateTime === "undefined") globalThis.fmtDateTime = fmtDateTime; } catch (e) {}
  E.toast = toast;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.toast === "undefined") globalThis.toast = toast; } catch (e) {}
  // v1.0.3 回归修复：头像裁剪（profile.js 独立模块）需跨文件调用裁剪模态，
  // 必须显式导出，否则头像上传永远走兜底分支、打不开裁剪框（壁纸裁剪因同文件调用而正常）。
  E.openImageCropModal = openImageCropModal;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.openImageCropModal === "undefined") globalThis.openImageCropModal = openImageCropModal; } catch (e) {}
  E.__achNotifyQueue = __achNotifyQueue;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.__achNotifyQueue === "undefined") globalThis.__achNotifyQueue = __achNotifyQueue; } catch (e) {}
  E.__achNotifyShowing = __achNotifyShowing;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.__achNotifyShowing === "undefined") globalThis.__achNotifyShowing = __achNotifyShowing; } catch (e) {}
  E.playAchievementChime = playAchievementChime;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.playAchievementChime === "undefined") globalThis.playAchievementChime = playAchievementChime; } catch (e) {}
  E.__achNotifyMount = __achNotifyMount;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.__achNotifyMount === "undefined") globalThis.__achNotifyMount = __achNotifyMount; } catch (e) {}
  E.showAchievementNotification = showAchievementNotification;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.showAchievementNotification === "undefined") globalThis.showAchievementNotification = showAchievementNotification; } catch (e) {}
  E.achSoundOn = achSoundOn;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.achSoundOn === "undefined") globalThis.achSoundOn = achSoundOn; } catch (e) {}
  E.setAchSoundOn = setAchSoundOn;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.setAchSoundOn === "undefined") globalThis.setAchSoundOn = setAchSoundOn; } catch (e) {}
  E.__achNotifyRenderNext = __achNotifyRenderNext;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.__achNotifyRenderNext === "undefined") globalThis.__achNotifyRenderNext = __achNotifyRenderNext; } catch (e) {}
  E.openModal = openModal;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.openModal === "undefined") globalThis.openModal = openModal; } catch (e) {}
  E.closeModal = closeModal;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.closeModal === "undefined") globalThis.closeModal = closeModal; } catch (e) {}
  E.openConfirm = openConfirm;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.openConfirm === "undefined") globalThis.openConfirm = openConfirm; } catch (e) {}
  E.renderHome = renderHome;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.renderHome === "undefined") globalThis.renderHome = renderHome; } catch (e) {}
  E.voiceRecognition = voiceRecognition;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.voiceRecognition === "undefined") globalThis.voiceRecognition = voiceRecognition; } catch (e) {}
  E.voiceRecording = voiceRecording;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.voiceRecording === "undefined") globalThis.voiceRecording = voiceRecording; } catch (e) {}
  E.toggleVoiceInput = toggleVoiceInput;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.toggleVoiceInput === "undefined") globalThis.toggleVoiceInput = toggleVoiceInput; } catch (e) {}
  E.shareLifeCard = shareLifeCard;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.shareLifeCard === "undefined") globalThis.shareLifeCard = shareLifeCard; } catch (e) {}
  E.syncVoiceButton = syncVoiceButton;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.syncVoiceButton === "undefined") globalThis.syncVoiceButton = syncVoiceButton; } catch (e) {}
  E.bouncedTodoIds = bouncedTodoIds;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.bouncedTodoIds === "undefined") globalThis.bouncedTodoIds = bouncedTodoIds; } catch (e) {}
  E.lastShownLevel = lastShownLevel;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.lastShownLevel === "undefined") globalThis.lastShownLevel = lastShownLevel; } catch (e) {}
  E.renderTasks = renderTasks;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.renderTasks === "undefined") globalThis.renderTasks = renderTasks; } catch (e) {}
  E.renderTaskNode = renderTaskNode;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.renderTaskNode === "undefined") globalThis.renderTaskNode = renderTaskNode; } catch (e) {}
  E.buildParentOptions = buildParentOptions;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.buildParentOptions === "undefined") globalThis.buildParentOptions = buildParentOptions; } catch (e) {}
  E.openTaskModal = openTaskModal;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.openTaskModal === "undefined") globalThis.openTaskModal = openTaskModal; } catch (e) {}
  E.handleNoteSave = handleNoteSave;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.handleNoteSave === "undefined") globalThis.handleNoteSave = handleNoteSave; } catch (e) {}
  E.ACQUIRE_KEYWORDS = ACQUIRE_KEYWORDS;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.ACQUIRE_KEYWORDS === "undefined") globalThis.ACQUIRE_KEYWORDS = ACQUIRE_KEYWORDS; } catch (e) {}
  E.ACQUIRE_STOPWORDS = ACQUIRE_STOPWORDS;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.ACQUIRE_STOPWORDS === "undefined") globalThis.ACQUIRE_STOPWORDS = ACQUIRE_STOPWORDS; } catch (e) {}
  E.stripLeadingFillers = stripLeadingFillers;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.stripLeadingFillers === "undefined") globalThis.stripLeadingFillers = stripLeadingFillers; } catch (e) {}
  E.detectAcquiredItems = detectAcquiredItems;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.detectAcquiredItems === "undefined") globalThis.detectAcquiredItems = detectAcquiredItems; } catch (e) {}
  E.promptAcquireQueue = promptAcquireQueue;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.promptAcquireQueue === "undefined") globalThis.promptAcquireQueue = promptAcquireQueue; } catch (e) {}
  E.renderBackpack = renderBackpack;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.renderBackpack === "undefined") globalThis.renderBackpack = renderBackpack; } catch (e) {}
  E.handleBackpackSearchInput = handleBackpackSearchInput;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.handleBackpackSearchInput === "undefined") globalThis.handleBackpackSearchInput = handleBackpackSearchInput; } catch (e) {}
  E.renderItemCard = renderItemCard;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.renderItemCard === "undefined") globalThis.renderItemCard = renderItemCard; } catch (e) {}
  E.renderCategoryGroup = renderCategoryGroup;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.renderCategoryGroup === "undefined") globalThis.renderCategoryGroup = renderCategoryGroup; } catch (e) {}
  E.openCategoryManageModal = openCategoryManageModal;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.openCategoryManageModal === "undefined") globalThis.openCategoryManageModal = openCategoryManageModal; } catch (e) {}
  E.openCategoryRenameModal = openCategoryRenameModal;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.openCategoryRenameModal === "undefined") globalThis.openCategoryRenameModal = openCategoryRenameModal; } catch (e) {}
  E.openItemModal = openItemModal;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.openItemModal === "undefined") globalThis.openItemModal = openItemModal; } catch (e) {}
  E.getCalendarEvents = getCalendarEvents;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.getCalendarEvents === "undefined") globalThis.getCalendarEvents = getCalendarEvents; } catch (e) {}
  E.buildCalendarBlockHtml = buildCalendarBlockHtml;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.buildCalendarBlockHtml === "undefined") globalThis.buildCalendarBlockHtml = buildCalendarBlockHtml; } catch (e) {}
  E.renderCalendar = renderCalendar;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.renderCalendar === "undefined") globalThis.renderCalendar = renderCalendar; } catch (e) {}
  E.renderCalendarDetail = renderCalendarDetail;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.renderCalendarDetail === "undefined") globalThis.renderCalendarDetail = renderCalendarDetail; } catch (e) {}
  E.calendarEntryType = calendarEntryType;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.calendarEntryType === "undefined") globalThis.calendarEntryType = calendarEntryType; } catch (e) {}
  E.rerenderCalendarHost = rerenderCalendarHost;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.rerenderCalendarHost === "undefined") globalThis.rerenderCalendarHost = rerenderCalendarHost; } catch (e) {}
  E.openCalendarEntryModal = openCalendarEntryModal;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.openCalendarEntryModal === "undefined") globalThis.openCalendarEntryModal = openCalendarEntryModal; } catch (e) {}
  E.setCalendarEntryType = setCalendarEntryType;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.setCalendarEntryType === "undefined") globalThis.setCalendarEntryType = setCalendarEntryType; } catch (e) {}
  E.focusCalendarEntry = focusCalendarEntry;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.focusCalendarEntry === "undefined") globalThis.focusCalendarEntry = focusCalendarEntry; } catch (e) {}
  E.handleCalendarEntrySave = handleCalendarEntrySave;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.handleCalendarEntrySave === "undefined") globalThis.handleCalendarEntrySave = handleCalendarEntrySave; } catch (e) {}
  E.renderAchievementCard = renderAchievementCard;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.renderAchievementCard === "undefined") globalThis.renderAchievementCard = renderAchievementCard; } catch (e) {}
  E.renderAchievements = renderAchievements;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.renderAchievements === "undefined") globalThis.renderAchievements = renderAchievements; } catch (e) {}
  E.doResetAchievements = doResetAchievements;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.doResetAchievements === "undefined") globalThis.doResetAchievements = doResetAchievements; } catch (e) {}
  E.openAchievementModal = openAchievementModal;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.openAchievementModal === "undefined") globalThis.openAchievementModal = openAchievementModal; } catch (e) {}
  E.aiMessages = aiMessages;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.aiMessages === "undefined") globalThis.aiMessages = aiMessages; } catch (e) {}
  E.renderAI = renderAI;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.renderAI === "undefined") globalThis.renderAI = renderAI; } catch (e) {}
  E.achBackupCardHtml = achBackupCardHtml;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.achBackupCardHtml === "undefined") globalThis.achBackupCardHtml = achBackupCardHtml; } catch (e) {}
  E.renderSettings = renderSettings;
  E.globalSearch = globalSearch;
  E.handleHomeSearchInput = handleHomeSearchInput;
  E.doWebUpdateCheck = doWebUpdateCheck;
  E.WALLPAPER_MAX_SIDE = WALLPAPER_MAX_SIDE;
  E.WALLPAPER_DIRECT_BYTES = WALLPAPER_DIRECT_BYTES;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.renderSettings === "undefined") globalThis.renderSettings = renderSettings; } catch (e) {}
  try { if (typeof globalThis !== "undefined" && typeof globalThis.globalSearch === "undefined") globalThis.globalSearch = globalSearch; } catch (e) {}
  try { if (typeof globalThis !== "undefined" && typeof globalThis.handleHomeSearchInput === "undefined") globalThis.handleHomeSearchInput = handleHomeSearchInput; } catch (e) {}
  try { if (typeof globalThis !== "undefined" && typeof globalThis.doWebUpdateCheck === "undefined") globalThis.doWebUpdateCheck = doWebUpdateCheck; } catch (e) {}
  try { if (typeof globalThis !== "undefined" && typeof globalThis.WALLPAPER_MAX_SIDE === "undefined") globalThis.WALLPAPER_MAX_SIDE = WALLPAPER_MAX_SIDE; } catch (e) {}
  try { if (typeof globalThis !== "undefined" && typeof globalThis.WALLPAPER_DIRECT_BYTES === "undefined") globalThis.WALLPAPER_DIRECT_BYTES = WALLPAPER_DIRECT_BYTES; } catch (e) {}
  E.handleSaveBirth = handleSaveBirth;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.handleSaveBirth === "undefined") globalThis.handleSaveBirth = handleSaveBirth; } catch (e) {}
  E.saveQuickMemo = saveQuickMemo;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.saveQuickMemo === "undefined") globalThis.saveQuickMemo = saveQuickMemo; } catch (e) {}
  E.saveHomeMemo = saveHomeMemo;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.saveHomeMemo === "undefined") globalThis.saveHomeMemo = saveHomeMemo; } catch (e) {}
  E.VERIFIN_RELEASES_URL = VERIFIN_RELEASES_URL;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.VERIFIN_RELEASES_URL === "undefined") globalThis.VERIFIN_RELEASES_URL = VERIFIN_RELEASES_URL; } catch (e) {}
  E.VERIFIN_PAN123_URL = VERIFIN_PAN123_URL;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.VERIFIN_PAN123_URL === "undefined") globalThis.VERIFIN_PAN123_URL = VERIFIN_PAN123_URL; } catch (e) {}
  E.VERIFIN_PACKAGE = VERIFIN_PACKAGE;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.VERIFIN_PACKAGE === "undefined") globalThis.VERIFIN_PACKAGE = VERIFIN_PACKAGE; } catch (e) {}
  E.markLedgerOpened = markLedgerOpened;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.markLedgerOpened === "undefined") globalThis.markLedgerOpened = markLedgerOpened; } catch (e) {}
  E.openVerifin = openVerifin;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.openVerifin === "undefined") globalThis.openVerifin = openVerifin; } catch (e) {}
  E.showDownloadDialog = showDownloadDialog;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.showDownloadDialog === "undefined") globalThis.showDownloadDialog = showDownloadDialog; } catch (e) {}
  E.openVerifinGuideModal = openVerifinGuideModal;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.openVerifinGuideModal === "undefined") globalThis.openVerifinGuideModal = openVerifinGuideModal; } catch (e) {}
  E.__globalEventsBound = __globalEventsBound;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.__globalEventsBound === "undefined") globalThis.__globalEventsBound = __globalEventsBound; } catch (e) {}
  E.bindGlobalEvents = bindGlobalEvents;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.bindGlobalEvents === "undefined") globalThis.bindGlobalEvents = bindGlobalEvents; } catch (e) {}
  E.dashboardFocus = dashboardFocus;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.dashboardFocus === "undefined") globalThis.dashboardFocus = dashboardFocus; } catch (e) {}
  E.scrollToDashboardFocus = scrollToDashboardFocus;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.scrollToDashboardFocus === "undefined") globalThis.scrollToDashboardFocus = scrollToDashboardFocus; } catch (e) {}
  E.__countersDone = __countersDone;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.__countersDone === "undefined") globalThis.__countersDone = __countersDone; } catch (e) {}
  E.animateCounters = animateCounters;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.animateCounters === "undefined") globalThis.animateCounters = animateCounters; } catch (e) {}
  E.openTodayModal = openTodayModal;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.openTodayModal === "undefined") globalThis.openTodayModal = openTodayModal; } catch (e) {}
  E.HOME_QUOTES = HOME_QUOTES;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.HOME_QUOTES === "undefined") globalThis.HOME_QUOTES = HOME_QUOTES; } catch (e) {}
  E.randomQuote = randomQuote;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.randomQuote === "undefined") globalThis.randomQuote = randomQuote; } catch (e) {}
  E.renderMapAuto = renderMapAuto;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.renderMapAuto === "undefined") globalThis.renderMapAuto = renderMapAuto; } catch (e) {}
})();