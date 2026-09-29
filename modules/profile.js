/* ===== 模块 profile.js（v16 模块化：window.EO 命名空间） ===== */
var state = null;
var currentAccount = null;
var backpackTab = 'all';
(function () {
  'use strict';
  var _g = (typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this));
  _g.EO = _g.EO || {};
  var E = _g.EO;

/**
 * profile.js —— 个人资料页（v2 新增）
 * 职责：renderProfile 渲染、内置头像表、生日保存联动（setBirthDate 校验 +
 * checkAutoAchievements + refreshCurrentPage）、自定义字段增删改模态、
 * P1 头像本地上传（FileReader → dataURL ≤100KB）、侧栏 / 主页头像同步。
 *
 * 约定（设计文档 §7.2 / §7.3）：本模块只导出函数，不自行向 #content 绑定
 * click 监听；所有 data-action 的 case 集中在 pages.js 的统一分发 switch 中。
 * 模态内按钮沿用 v1 先例直接 onclick 绑定；头像上传的隐式 file input 由本模块自建。
 */

/** 内置头像表（8 选 1，emoji 零依赖，不引入外部图片） */
const BUILTIN_AVATARS = [
  { key: 'default', emoji: '🙂', label: '微笑' },
  { key: 'earth',   emoji: '🌍', label: '地球' },
  { key: 'rocket',  emoji: '🚀', label: '火箭' },
  { key: 'game',    emoji: '🎮', label: '手柄' },
  { key: 'cat',     emoji: '🐱', label: '猫猫' },
  { key: 'leaf',    emoji: '🌱', label: '幼苗' },
  { key: 'music',   emoji: '🎧', label: '耳机' },
  { key: 'star',    emoji: '⭐', label: '星星' },
];

/**
 * 性别选项（'' = 保密）。
 * v1.2.0：补两个更离谱的答案 —— 选它们会解锁隐藏成就「性别是流动的」（与 Android 端一致）。
 */
const GENDER_OPTIONS = [
  { key: '',       label: '保密' },
  { key: 'male',   label: '男' },
  { key: 'female', label: '女' },
  { key: 'walmart', label: '🛍️ 沃尔玛购物袋' },
  { key: 'helicopter', label: '🚁 直升机' },
  { key: 'potato', label: '🥔 土豆' },
];

/** 头像上限：≤ 5MB（v3 由 100KB 放宽，便于手机/相机直出原图） */
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/* ---------- 页面级临时状态（不持久化） ---------- */

let profileFormDraft = null;       // 未保存的基础表单草稿（字段操作重渲时保留输入）
let profileAvatarKeyDraft = null;  // null = 未改动，沿用存档 avatarKey
let profileAvatarDataDraft = null; // null = 无上传草稿
let sidebarAvatarChip = null;      // 侧栏头像元素（模块持有引用，不入 DOM id 检查）

/** 头像展示内容：avatarData 非空优先于 avatarKey */
/**
 * App 默认头像：与 icons/icon.svg 同款图形的紧凑版。
 * 内联而非引用文件 —— 头像会在主页/资料页/侧栏多处同时出现，内联可省掉重复请求。
 * 刻意不写 xmlns（HTML 内联 SVG 不需要），也不用 gradient（避免多个实例 id 冲突）。
 */
const DEFAULT_AVATAR_SVG =
  '<svg class="avatar-svg" viewBox="0 0 64 64" role="img" aria-label="默认头像">' +
    '<circle cx="32" cy="32" r="32" fill="#e9d5bd"/>' +
    '<g fill="none" stroke="#ffffff" stroke-opacity="0.7" stroke-width="2">' +
      '<ellipse cx="32" cy="32" rx="12" ry="28"/>' +
      '<path d="M4 32h56"/>' +
      '<path d="M8 20h48M8 44h48"/>' +
    '</g>' +
    '<g fill="#8aaa8a" fill-opacity="0.85">' +
      '<path d="M24 15c5-2 9 1 8 5s-6 4-9 2-3-6 1-7z"/>' +
      '<path d="M36 33c6-1 10 3 8 8-2 6-9 7-12 3s-1-10 4-11z"/>' +
    '</g>' +
  '</svg>';

function buildAvatarInner(avatarData, avatarKey) {
  if (avatarData) return '<img src="' + avatarData + '" alt="头像">';
  // v5：未选择头像（空 key）时展示 App 默认图标，而不是占用第一个内置 emoji
  if (!avatarKey) return DEFAULT_AVATAR_SVG;
  const a = BUILTIN_AVATARS.find(function (x) { return x.key === avatarKey; });
  return a ? '<span class="avatar-emoji">' + a.emoji + '</span>' : DEFAULT_AVATAR_SVG;
}

/** 当前生效头像（草稿优先） */
function currentAvatar() {
  const p = getProfile();
  return {
    data: profileAvatarDataDraft != null ? profileAvatarDataDraft : p.avatarData,
    key: profileAvatarKeyDraft != null ? profileAvatarKeyDraft : p.avatarKey,
  };
}

/* ==================== 渲染 ==================== */

/** 渲染个人资料页（整体提交式：单一「保存资料」按钮 + 行内校验） */
/** 生日选择器的年份下限 */
const BIRTH_YEAR_MIN = 1900;

/** 解析 YYYY-MM-DD；非法时返回 null */
function parseBirthParts(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v == null ? '' : v));
  if (!m) return null;
  return { y: parseInt(m[1], 10), m: parseInt(m[2], 10), d: parseInt(m[3], 10) };
}

/** 某年某月的天数（用下个月第 0 天取上个月最后一天，天然处理闰年） */
function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

/**
 * 生成生日下拉选项。
 * @param {number[]} values 候选值（可倒序）
 * @param {number} selected 当前选中
 * @param {string} suffix 后缀（年/月/日）
 */
function birthOptionsHtml(values, selected, suffix) {
  return values.map(function (v) {
    const s = String(v);
    return '<option value="' + s + '"' + (v === selected ? ' selected' : '') + '>' +
      escapeHtml(s + suffix) + '</option>';
  }).join('');
}

/**
 * 生日选择器 HTML（日期输入框 + 年/月/日下拉）。
 * 两条输入路径双向同步：用日历选完会自动回填下拉；改下拉也会写回日历输入框。
 * 保存时仍只读 #profileBirth，产出恒为 YYYY-MM-DD。
 */
function renderBirthPicker(birthStr) {
  const nowY = new Date().getFullYear();
  const cur = parseBirthParts(birthStr) || { y: nowY - 20, m: 1, d: 1 };
  const years = [];
  for (let y = nowY; y >= BIRTH_YEAR_MIN; y--) years.push(y); // 倒序，今年在前更好找
  const months = [];
  for (let m = 1; m <= 12; m++) months.push(m);
  const maxDay = daysInMonth(cur.y, cur.m);
  const days = [];
  for (let d = 1; d <= maxDay; d++) days.push(d);
  const safeDay = Math.min(cur.d, maxDay);

  return '<div class="birth-picker">' +
      '<input type="date" id="profileBirth" class="list-input" value="' + escapeHtml(birthStr) +
        '" max="' + todayStr() + '">' +
      '<div class="birth-selects">' +
        '<select id="profileBirthYear" class="birth-select" data-role="birth-part" aria-label="出生年份">' +
          birthOptionsHtml(years, cur.y, ' 年') +
        '</select>' +
        '<select id="profileBirthMonth" class="birth-select" data-role="birth-part" aria-label="出生月份">' +
          birthOptionsHtml(months, cur.m, ' 月') +
        '</select>' +
        '<select id="profileBirthDay" class="birth-select" data-role="birth-part" aria-label="出生日">' +
          birthOptionsHtml(days, safeDay, ' 日') +
        '</select>' +
      '</div>' +
    '</div>';
}

/**
 * 下拉变化时把年/月/日组装回 #profileBirth。
 * 日数会按所选年月重算并钳制（避免 2 月 31 日这类非法日期）。
 * @returns {string} 组装后的 YYYY-MM-DD
 */
function syncBirthDateFromSelects() {
  const dateEl = document.getElementById('profileBirth');
  const yEl = document.getElementById('profileBirthYear');
  const mEl = document.getElementById('profileBirthMonth');
  const dEl = document.getElementById('profileBirthDay');
  if (!dateEl || !yEl || !mEl || !dEl) return '';
  const y = parseInt(yEl.value, 10) || new Date().getFullYear();
  const m = parseInt(mEl.value, 10) || 1;
  const maxDay = daysInMonth(y, m);
  let d = parseInt(dEl.value, 10) || 1;
  if (d > maxDay) d = maxDay;
  // 日选项随年月变化，重建一次（保持选中项）
  const days = [];
  for (let i = 1; i <= maxDay; i++) days.push(i);
  dEl.innerHTML = birthOptionsHtml(days, d, ' 日');
  const p = function (n) { return String(n).padStart(2, '0'); };
  const next = y + '-' + p(m) + '-' + p(d);
  dateEl.value = next;
  return next;
}

/** 日历输入框变化时，把日期回填到三个下拉（日选项按新月份重建） */
function syncBirthSelectsFromDate() {
  const dateEl = document.getElementById('profileBirth');
  const yEl = document.getElementById('profileBirthYear');
  const mEl = document.getElementById('profileBirthMonth');
  const dEl = document.getElementById('profileBirthDay');
  if (!dateEl || !yEl || !mEl || !dEl) return;
  const cur = parseBirthParts(dateEl.value);
  if (!cur) return;
  yEl.value = String(cur.y);
  mEl.value = String(cur.m);
  const maxDay = daysInMonth(cur.y, cur.m);
  const days = [];
  for (let i = 1; i <= maxDay; i++) days.push(i);
  dEl.innerHTML = birthOptionsHtml(days, Math.min(cur.d, maxDay), ' 日');
}

function renderProfile() {
  const p = getProfile();
  const stats = getLifeStats(state.birthDate);
  const draft = profileFormDraft || {
    name: p.name,
    gender: p.gender,
    country: p.country,
    province: p.province,
    signature: p.signature,
    customTitle: p.customTitle || '',
    birthDate: state.birthDate,
  };
  // v1.0.2：称号展示口径与 Android XpRules.titleFor 一致（未自定义 → 「旅行者」）
  const titleText = (typeof xpTitleFor === 'function') ? xpTitleFor(draft.customTitle) : String(draft.customTitle || '旅行者');
  const avatar = currentAvatar();

  const avatarCells = BUILTIN_AVATARS.map(function (a) {
    return '<button type="button" class="avatar-cell ' + (avatar.key === a.key ? 'selected' : '') +
      '" data-action="profile-avatar-select" data-key="' + a.key + '" title="' + a.label + '">' +
      a.emoji + '</button>';
  }).join('');

  const genderOptions = GENDER_OPTIONS.map(function (g) {
    return '<option value="' + g.key + '"' + (draft.gender === g.key ? ' selected' : '') + '>' +
      g.label + '</option>';
  }).join('');

  // v19：区服（国家/省份）下拉。常量来自 account.js（加载早于 profile.js 的渲染时刻，运行期读 EO 安全）
  const regionCountries = (typeof EO !== 'undefined' && EO && EO.AUTH_COUNTRIES) ? EO.AUTH_COUNTRIES : ['中国'];
  const regionProvinces = (typeof EO !== 'undefined' && EO && EO.CHINA_PROVINCES) ? EO.CHINA_PROVINCES : [];
  const regionIsChina = draft.country === '中国';
  const regionCountryOptions = regionCountries.map(function (c) {
    return '<option value="' + escapeHtml(c) + '"' + (draft.country === c ? ' selected' : '') + '>' + escapeHtml(c) + '</option>';
  }).join('');
  const regionProvinceField = regionIsChina
    ? '<select id="profileProvince" class="list-input">' +
        '<option value="">请选择省份</option>' +
        regionProvinces.map(function (p) {
          return '<option value="' + escapeHtml(p) + '"' + (draft.province === p ? ' selected' : '') + '>' + escapeHtml(p) + '</option>';
        }).join('') +
      '</select>'
    : '<input id="profileProvince" class="list-input" type="text" placeholder="州 / 省（选填）" value="' + escapeHtml(draft.province) + '">';

  const fieldRows = p.customFields.length
    ? p.customFields.map(function (f) {
        return '<div class="list-row">' +
          '<span class="field-label">' + escapeHtml(f.label) + '</span>' +
          '<span class="field-value">' + (f.value ? escapeHtml(f.value) : '<span class="muted">—</span>') + '</span>' +
          '<span class="task-actions">' +
            '<button class="icon-btn" data-action="profile-field-edit" data-id="' + f.id + '">编辑</button>' +
            '<button class="icon-btn danger" data-action="profile-field-delete" data-id="' + f.id + '">删除</button>' +
          '</span>' +
        '</div>';
      }).join('')
    : '<div class="empty">还没有自定义字段，点右上角「+ 添加字段」</div>';

  document.getElementById('content').innerHTML =
    '<section class="page narrow">' +
      '<div class="page-head">' +
        '<h2 class="page-title">个人资料</h2>' +
        '<button class="btn btn-primary" data-action="profile-save">保存资料</button>' +
      '</div>' +

      '<div class="profile-user-card">' +
        '<span class="avatar-circle avatar-circle-lg" id="profileAvatarPreview">' +
          buildAvatarInner(avatar.data, avatar.key) +
        '</span>' +
        '<div class="profile-user-body">' +
          '<div class="profile-user-name">' + (draft.name ? escapeHtml(draft.name) : '<span class="muted">未命名玩家</span>') +
            ' <span class="badge badge-level">' + escapeHtml(titleText) + ' · Lv.' + stats.age + '</span></div>' +
          '<div class="muted profile-user-sign">' +
            (draft.signature ? escapeHtml(draft.signature) : '还没有签名，写一句话介绍自己吧') + '</div>' +
        '</div>' +
      '</div>' +

      '<div class="card">' +
        '<div class="card-title">基础信息</div>' +
        '<div class="list-group">' +
          '<div class="list-row">' +
            '<label class="field-label" for="profileName">姓名</label>' +
            '<input id="profileName" class="list-input" placeholder="怎么称呼你？" maxlength="30" value="' +
              escapeHtml(draft.name) + '">' +
          '</div>' +
          '<div class="list-row">' +
            '<label class="field-label" for="profileTitle">称号</label>' +
            '<input id="profileTitle" class="list-input" placeholder="留空显示「旅行者」" maxlength="12" value="' +
              escapeHtml(draft.customTitle || '') + '">' +
          '</div>' +
          '<div class="list-row list-row-col">' +
            '<span class="field-label">头像</span>' +
            '<div class="avatar-grid">' + avatarCells + '</div>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-action="profile-avatar-upload">' +
              '上传本地图片（≤100KB）</button>' +
          '</div>' +
          '<div class="list-row">' +
            '<label class="field-label" for="profileGender">性别</label>' +
            '<select id="profileGender" class="list-input">' + genderOptions + '</select>' +
          '</div>' +
          '<div class="list-row">' +
            '<label class="field-label" for="profileCountry">区服</label>' +
            '<select id="profileCountry" class="list-input">' + regionCountryOptions + '</select>' +
          '</div>' +
          '<div class="list-row">' +
            '<label class="field-label" for="profileProvince">' + (regionIsChina ? '省份' : '州 / 省') + '</label>' +
            regionProvinceField +
          '</div>' +
          '<div class="list-row list-row-col">' +
            '<label class="field-label" for="profileBirth">出生</label>' +
            renderBirthPicker(draft.birthDate || state.birthDate || '') +
            '<span class="muted">等级 = 年龄，保存后主页等级实时联动。' +
              '可直接在日历里选，也可用下方下拉分别指定年 / 月 / 日（改月份会自动修正天数，如 2 月不会有 31 日）。</span>' +
          '</div>' +
          '<div class="list-row list-row-col">' +
            '<label class="field-label" for="profileSignature">角色签名</label>' +
            '<textarea id="profileSignature" class="list-textarea" maxlength="200" ' +
              'placeholder="一句话介绍自己（≤200 字）">' + escapeHtml(draft.signature) + '</textarea>' +
          '</div>' +
        '</div>' +
        '<div class="form-error" id="profileFormError"></div>' +
      '</div>' +

      '<div class="card">' +
        '<div class="card-head-with-btn">' +
          '<div class="card-title">自定义字段</div>' +
          '<button class="btn btn-ghost btn-sm" data-action="profile-field-add">+ 添加字段</button>' +
        '</div>' +
        '<div class="list-group">' + fieldRows + '</div>' +
        '<p class="muted">字段按添加顺序展示，上限 20 条；名称 ≤30 字，内容 ≤200 字。</p>' +
      '</div>' +
    '</section>';

  syncSidebarAvatar();

  // v19：区服-国家 change 联动省份控件（change 事件不走全局 click 分发，就地绑定；
  // 刻意不加 data-action，避免触发 QA「有 action 无 case」双向检查）
  const regionCountryEl = document.getElementById('profileCountry');
  if (regionCountryEl) regionCountryEl.onchange = handleProfileCountryChange;
}

/** 侧栏头像（「导航顶部」同步点，P1-1）：模块持有元素引用，避免重复创建 */
function syncSidebarAvatar() {
  if (!sidebarAvatarChip) {
    const logo = document.querySelector('.sidebar .logo');
    if (!logo || !logo.parentNode) return; // 非 profile 相关页面 / 测试环境跳过
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'avatar-circle avatar-circle-sm sidebar-avatar';
    chip.title = '查看个人资料';
    chip.addEventListener('click', function () { navigate('profile'); });
    logo.parentNode.insertBefore(chip, logo.nextSibling);
    sidebarAvatarChip = chip;
  }
  const avatar = currentAvatar();
  sidebarAvatarChip.innerHTML = buildAvatarInner(avatar.data, avatar.key);
}

/* ==================== 交互（由 pages.js 统一分发调用） ==================== */

/** 基础表单未保存输入的草稿捕获（字段操作触发重渲前调用，避免丢失输入） */
function captureProfileFormDraft() {
  const nameEl = document.getElementById('profileName');
  const birthEl = document.getElementById('profileBirth');
  if (!nameEl || !birthEl) return; // 页面未渲染时不采集
  const genderEl = document.getElementById('profileGender');
  const signEl = document.getElementById('profileSignature');
  const countryEl = document.getElementById('profileCountry');
  const provinceEl = document.getElementById('profileProvince');
  const titleEl = document.getElementById('profileTitle');
  profileFormDraft = {
    name: nameEl.value,
    gender: genderEl ? genderEl.value : '',
    signature: signEl ? signEl.value : '',
    birthDate: birthEl.value,
    country: countryEl ? countryEl.value : '',
    province: provinceEl ? provinceEl.value : '',
    customTitle: titleEl ? titleEl.value : '',
  };
}

/**
 * v19：区服-国家 change → 重建省份控件（中国给预设下拉，其余国家文本输入）。
 * 整体提交式保存，这里只更新控件与草稿，不写盘。
 */
function handleProfileCountryChange() {
  const countryEl = document.getElementById('profileCountry');
  if (!countryEl) return;
  const country = countryEl.value;
  const regionProvinces = (typeof EO !== 'undefined' && EO && EO.CHINA_PROVINCES) ? EO.CHINA_PROVINCES : [];
  const provinceEl = document.getElementById('profileProvince');
  if (!provinceEl) return;
  const isChina = country === '中国';
  let next;
  if (isChina) {
    next = document.createElement('select');
    next.id = 'profileProvince';
    next.className = 'list-input';
    next.innerHTML = '<option value="">请选择省份</option>' + regionProvinces.map(function (p) {
      return '<option value="' + escapeHtml(p) + '">' + escapeHtml(p) + '</option>';
    }).join('');
  } else {
    next = document.createElement('input');
    next.id = 'profileProvince';
    next.type = 'text';
    next.className = 'list-input';
    next.placeholder = '州 / 省（选填）';
  }
  provinceEl.replaceWith(next);
  // 记住选择（整体提交式，不触发保存）
  profileFormDraft = profileFormDraft || {};
  profileFormDraft.country = country;
  profileFormDraft.province = '';
}

/** 选择内置头像（页面内即时切换选中态，不整页重渲） */
function handleProfileAvatarSelect(key) {
  profileAvatarKeyDraft = key;
  profileAvatarDataDraft = null; // 选内置头像即放弃上传草稿
  document.querySelectorAll('.avatar-cell').forEach(function (cell) {
    cell.classList.toggle('selected', cell.dataset.key === key);
  });
  updateProfileAvatarPreview();
}

/** 更新资料页头像预览与侧栏头像（DOM 局部更新，不重渲） */
function updateProfileAvatarPreview() {
  const el = document.getElementById('profileAvatarPreview');
  if (el) {
    const avatar = currentAvatar();
    el.innerHTML = buildAvatarInner(avatar.data, avatar.key);
  }
  syncSidebarAvatar();
}

/** P1：触发本地头像上传（隐式 file input，自建并绑定 change） */
function triggerProfileAvatarUpload() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', function () {
    const file = input.files && input.files[0];
    if (file) readAvatarFile(file, input);
  });
  input.click();
}

/** 读取头像文件：超 5MB 拒绝并清空选择框；符合才转 Base64（保存后生效） */
function readAvatarFile(file, input) {
  if (!file) return;
  if (file.size > AVATAR_MAX_BYTES) {
    toast('头像图片大小不能超过 5MB，请压缩后重新上传');
    if (input) input.value = ''; // 清空文件选择框，避免遗留选中态
    return;
  }
  const reader = new FileReader();
  reader.onload = function () {
    const dataUrl = String(reader.result || '');
    if (!isValidAvatarData(dataUrl)) {
      toast('图片过大或格式不支持，请压缩到 5MB 以内的 JPG/PNG 后重试');
      return;
    }
    // v5（图片懒加载/压缩）：超 200KB 的位图头像先降维压缩（≤256px、JPEG 0.82），
    // 再存入草稿。既省 localStorage 体积，也避免大图解码/缩放拖累渲染（尤其移动端）。
    compressAvatarIfNeeded(dataUrl, function (compressed) {
      profileAvatarDataDraft = compressed;
      profileAvatarKeyDraft = null; // 自定义头像优先于内置选择
      updateProfileAvatarPreview();
      toast('头像已就绪，点击「保存资料」生效');
    });
  };
  reader.onerror = function () {
    toast('头像读取失败，请重试');
  };
  reader.readAsDataURL(file);
}

/**
 * v5（图片压缩）→ v1.2.1 改为「尺寸优先」：
 * - 目标最长边 512px、JPEG 质量 0.82；压缩后若仍比原图大则保留原图（不越压越大）。
 * - 为什么改判据：原判据是「体积 > 200KB 才压」。但一张 4000×3000 的压缩 JPEG
 *   可能只有 150KB —— 不触发阈值，解码时却要吃掉 ~48MB 内存（位图 = 宽×高×4字节），
 *   移动端是实打实的 OOM 源。头像最终只显示在 80dp 的圈里，先降尺寸才是硬道理。
 * - 仅作用于位图（data:image/ 且非 svg）；环境无 Image/canvas（如测试桩）时直接返回原图，安全降级。
 * - 通过回调异步返回结果（依赖 Image.onload）。
 * @param {string} dataUrl
 * @param {function(string):void} cb
 */
function compressAvatarIfNeeded(dataUrl, cb) {
  var MIN_BYTES = 24 * 1024;   // ≤24KB 的图尺寸必然也很小，直接存，不必解码再编码
  var fallback = function () { if (cb) cb(dataUrl); };
  if (!dataUrl || dataUrl.length < MIN_BYTES) { fallback(); return; }
  if (dataUrl.indexOf('data:image/svg') === 0) { fallback(); return; }
  if (typeof Image === 'undefined' || typeof document === 'undefined' || !document.createElement) { fallback(); return; }
  var img = new Image();
  img.onload = function () {
    try {
      var nw = img.naturalWidth || img.width;
      var nh = img.naturalHeight || img.height;
      if (!nw || !nh) { fallback(); return; }
      var maxDim = 512;
      var scale = Math.min(1, maxDim / Math.max(nw, nh));
      var w = Math.max(1, Math.round(nw * scale));
      var h = Math.max(1, Math.round(nh * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext ? canvas.getContext('2d') : null;
      if (!ctx) { fallback(); return; }
      ctx.drawImage(img, 0, 0, w, h);
      var out = canvas.toDataURL('image/jpeg', 0.82);
      if (out && out.length < dataUrl.length) { if (cb) cb(out); }
      else { fallback(); }
    } catch (e) { fallback(); }
  };
  img.onerror = function () { fallback(); };
  img.src = dataUrl;
}

/**
 * 保存资料（整体提交）：生日校验失败 → 行内红字并整表阻止保存；
 * 成功 → setBirthDate + updateProfile + checkAutoAchievements + 重渲。
 */
function handleProfileSave() {
  const errEl = document.getElementById('profileFormError');
  const fail = function (msg) { if (errEl) errEl.textContent = msg; };

  const name = val('profileName').trim();
  const gender = val('profileGender');
  const signature = val('profileSignature');
  const birth = val('profileBirth');
  const country = val('profileCountry');
  const province = val('profileProvince');
  const customTitle = val('profileTitle').trim();

  const birthResult = setBirthDate(birth);
  if (!birthResult.ok) {
    fail(birthResult.error); // 行内红字，不弹 alert，整表阻止保存
    return;
  }

  const patch = { name: name, gender: gender, signature: signature, country: country, province: province, customTitle: customTitle };
  if (profileAvatarDataDraft != null) {
    patch.avatarData = profileAvatarDataDraft;
    patch.avatarKey = 'default';
  } else if (profileAvatarKeyDraft != null) {
    patch.avatarKey = profileAvatarKeyDraft;
    patch.avatarData = null; // 换回内置头像时清空自定义
  }
  updateProfile(patch);

  profileFormDraft = null;
  profileAvatarKeyDraft = null;
  profileAvatarDataDraft = null;

  checkAutoAchievements(); // 年龄成就联动
  toast('个人资料已保存');
  refreshCurrentPage();
}

/** 自定义字段添加 / 编辑双用模态（校验失败行内红字） */
function openCustomFieldModal(field) {
  captureProfileFormDraft(); // 重渲前保留基础表单草稿
  const isEdit = !!field;

  openModal(
    '<h3 class="modal-title">' + (isEdit ? '编辑字段' : '添加字段') + '</h3>' +
    '<div class="form-row"><label>字段名</label><input id="cfLabel" maxlength="30" ' +
      'placeholder="如：MBTI / 所在城市" value="' + escapeHtml(field ? field.label : '') + '"></div>' +
    '<div class="form-row"><label>内容</label><input id="cfValue" maxlength="200" ' +
      'placeholder="如：INFP / 成都" value="' + escapeHtml(field ? field.value : '') + '"></div>' +
    '<div class="form-error" id="cfError"></div>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-ghost" id="cfCancel">取消</button>' +
      '<button class="btn btn-primary" id="cfSave">' + (isEdit ? '保存修改' : '添加') + '</button>' +
    '</div>'
  );

  const errEl = document.getElementById('cfError');
  document.getElementById('cfCancel').onclick = closeModal;
  document.getElementById('cfSave').onclick = function () {
    const label = val('cfLabel').trim();
    const value = val('cfValue').trim();
    const result = isEdit
      ? updateCustomField(field.id, { label: label, value: value })
      : addCustomField(label, value);
    if (!result.ok) {
      if (errEl) errEl.textContent = result.error; // 行内红字提示
      return;
    }
    closeModal();
    toast(isEdit ? '字段已更新' : '字段已添加');
    renderProfile();
  };
}

/** 删除自定义字段（confirm 确认，破坏性操作走 openConfirm） */
function handleProfileFieldDelete(id) {
  captureProfileFormDraft();
  const field = getCustomFieldById(id);
  openConfirm('确定删除字段「' + (field ? field.label : id) + '」吗？', function () {
    deleteCustomField(id);
    toast('字段已删除');
    renderProfile();
  });
}

  /* ---- 导出公共 API 到 EO 命名空间并同步到全局（兼容旧引用 / 测试桩） ---- */
  E.BUILTIN_AVATARS = BUILTIN_AVATARS;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.BUILTIN_AVATARS === "undefined") globalThis.BUILTIN_AVATARS = BUILTIN_AVATARS; } catch (e) {}
  E.GENDER_OPTIONS = GENDER_OPTIONS;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.GENDER_OPTIONS === "undefined") globalThis.GENDER_OPTIONS = GENDER_OPTIONS; } catch (e) {}
  E.AVATAR_MAX_BYTES = AVATAR_MAX_BYTES;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.AVATAR_MAX_BYTES === "undefined") globalThis.AVATAR_MAX_BYTES = AVATAR_MAX_BYTES; } catch (e) {}
  E.profileFormDraft = profileFormDraft;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.profileFormDraft === "undefined") globalThis.profileFormDraft = profileFormDraft; } catch (e) {}
  E.profileAvatarKeyDraft = profileAvatarKeyDraft;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.profileAvatarKeyDraft === "undefined") globalThis.profileAvatarKeyDraft = profileAvatarKeyDraft; } catch (e) {}
  E.profileAvatarDataDraft = profileAvatarDataDraft;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.profileAvatarDataDraft === "undefined") globalThis.profileAvatarDataDraft = profileAvatarDataDraft; } catch (e) {}
  E.sidebarAvatarChip = sidebarAvatarChip;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.sidebarAvatarChip === "undefined") globalThis.sidebarAvatarChip = sidebarAvatarChip; } catch (e) {}
  E.DEFAULT_AVATAR_SVG = DEFAULT_AVATAR_SVG;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.DEFAULT_AVATAR_SVG === "undefined") globalThis.DEFAULT_AVATAR_SVG = DEFAULT_AVATAR_SVG; } catch (e) {}
  E.buildAvatarInner = buildAvatarInner;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.buildAvatarInner === "undefined") globalThis.buildAvatarInner = buildAvatarInner; } catch (e) {}
  E.currentAvatar = currentAvatar;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.currentAvatar === "undefined") globalThis.currentAvatar = currentAvatar; } catch (e) {}
  E.BIRTH_YEAR_MIN = BIRTH_YEAR_MIN;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.BIRTH_YEAR_MIN === "undefined") globalThis.BIRTH_YEAR_MIN = BIRTH_YEAR_MIN; } catch (e) {}
  E.parseBirthParts = parseBirthParts;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.parseBirthParts === "undefined") globalThis.parseBirthParts = parseBirthParts; } catch (e) {}
  E.daysInMonth = daysInMonth;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.daysInMonth === "undefined") globalThis.daysInMonth = daysInMonth; } catch (e) {}
  E.birthOptionsHtml = birthOptionsHtml;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.birthOptionsHtml === "undefined") globalThis.birthOptionsHtml = birthOptionsHtml; } catch (e) {}
  E.renderBirthPicker = renderBirthPicker;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.renderBirthPicker === "undefined") globalThis.renderBirthPicker = renderBirthPicker; } catch (e) {}
  E.syncBirthDateFromSelects = syncBirthDateFromSelects;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.syncBirthDateFromSelects === "undefined") globalThis.syncBirthDateFromSelects = syncBirthDateFromSelects; } catch (e) {}
  E.syncBirthSelectsFromDate = syncBirthSelectsFromDate;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.syncBirthSelectsFromDate === "undefined") globalThis.syncBirthSelectsFromDate = syncBirthSelectsFromDate; } catch (e) {}
  E.renderProfile = renderProfile;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.renderProfile === "undefined") globalThis.renderProfile = renderProfile; } catch (e) {}
  E.syncSidebarAvatar = syncSidebarAvatar;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.syncSidebarAvatar === "undefined") globalThis.syncSidebarAvatar = syncSidebarAvatar; } catch (e) {}
  E.captureProfileFormDraft = captureProfileFormDraft;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.captureProfileFormDraft === "undefined") globalThis.captureProfileFormDraft = captureProfileFormDraft; } catch (e) {}
  E.handleProfileCountryChange = handleProfileCountryChange;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.handleProfileCountryChange === "undefined") globalThis.handleProfileCountryChange = handleProfileCountryChange; } catch (e) {}
  E.handleProfileAvatarSelect = handleProfileAvatarSelect;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.handleProfileAvatarSelect === "undefined") globalThis.handleProfileAvatarSelect = handleProfileAvatarSelect; } catch (e) {}
  E.updateProfileAvatarPreview = updateProfileAvatarPreview;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.updateProfileAvatarPreview === "undefined") globalThis.updateProfileAvatarPreview = updateProfileAvatarPreview; } catch (e) {}
  E.triggerProfileAvatarUpload = triggerProfileAvatarUpload;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.triggerProfileAvatarUpload === "undefined") globalThis.triggerProfileAvatarUpload = triggerProfileAvatarUpload; } catch (e) {}
  E.readAvatarFile = readAvatarFile;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.readAvatarFile === "undefined") globalThis.readAvatarFile = readAvatarFile; } catch (e) {}
  E.compressAvatarIfNeeded = compressAvatarIfNeeded;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.compressAvatarIfNeeded === "undefined") globalThis.compressAvatarIfNeeded = compressAvatarIfNeeded; } catch (e) {}
  E.handleProfileSave = handleProfileSave;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.handleProfileSave === "undefined") globalThis.handleProfileSave = handleProfileSave; } catch (e) {}
  E.openCustomFieldModal = openCustomFieldModal;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.openCustomFieldModal === "undefined") globalThis.openCustomFieldModal = openCustomFieldModal; } catch (e) {}
  E.handleProfileFieldDelete = handleProfileFieldDelete;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.handleProfileFieldDelete === "undefined") globalThis.handleProfileFieldDelete = handleProfileFieldDelete; } catch (e) {}
})();