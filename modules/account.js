/* ===== 模块 account.js（v16 模块化：window.EO 命名空间） ===== */
var state = null;
var currentAccount = null;
var backpackTab = 'all';
(function () {
  'use strict';
  var _g = (typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this));
  _g.EO = _g.EO || {};
  var E = _g.EO;

/**
 * account.js —— 首次引导页模块（v19）
 *
 * v19 移除账号系统后，本文件由「登录/注册/游客」界面改造为「个人资料设置」引导页：
 * 全新安装（或迁移失败兜底）时在 #auth-root 内渲染引导表单，
 * 用户填写角色信息保存 → 写入唯一主档键 earth_data → 进入主程序。
 *
 * 文件名刻意保留 account.js（不做成 onboarding.js）——
 * 路由 / 打包 / QA 四处引用全部依赖这个文件名，改名会引发连锁同步。
 *
 * 事件遵循全项目约定：只导出函数，不在本文件里绑监听；
 * data-action 的 case 统一收在 pages.js 的 bindGlobalEvents() switch 里。
 */

/** 国家选项（省份按国家联动：中国给预设列表，其余国家用文本输入） */
const AUTH_COUNTRIES = ['中国', '美国', '日本', '英国', '德国', '澳大利亚', '其他'];

/** 中国省级行政区 */
const CHINA_PROVINCES = [
  '北京市', '天津市', '河北省', '山西省', '内蒙古自治区', '辽宁省', '吉林省', '黑龙江省',
  '上海市', '江苏省', '浙江省', '安徽省', '福建省', '江西省', '山东省', '河南省',
  '湖北省', '湖南省', '广东省', '广西壮族自治区', '海南省', '重庆市', '四川省',
  '贵州省', '云南省', '西藏自治区', '陕西省', '甘肃省', '青海省',
  '宁夏回族自治区', '新疆维吾尔自治区', '台湾省', '香港特别行政区', '澳门特别行政区',
];

/** 引导页表单草稿：国家切换后重渲省份控件时用来回填已填内容 */
let onboardingDraft = {
  name: '',
  gender: '',
  birth: '',
  country: '中国',
  province: '',
  signature: '',
  customLabel: '',
  customValue: '',
};

/** 性别三选一（'' = 保密；自定义走自定义字段）—— 与 profile.js GENDER_OPTIONS 保持一致 */
const ONB_GENDER_OPTIONS = [
  { key: '',       label: '保密' },
  { key: 'male',   label: '男' },
  { key: 'female', label: '女' },
  { key: 'walmart', label: '🛍️ 沃尔玛购物袋' },
  { key: 'helicopter', label: '🚁 直升机' },
  { key: 'potato', label: '🥔 土豆' },
];

/* ==================== 渲染 ==================== */

/**
 * 渲染引导页。
 * 复用 #auth-root 与 body.auth-active（v19 改用途为「引导页容器」，CSS 结构不变）。
 */
function renderOnboardingScreen() {
  const el = document.getElementById('auth-root');
  if (!el) return;
  document.body.classList.add('auth-active');
  el.innerHTML =
    '<div class="auth-screen">' +
      '<div class="auth-card">' +
        buildOnboardingForm() +
      '</div>' +
    '</div>';

  // 国家下拉是 change 事件，不走全局 click 分发，在这里就地绑定。
  // 刻意没给它加 data-action —— 全局分发只监听 click，
  // 加了会既没效果、又触发 QA「有 action 无 case」的双向检查。
  const countrySel = document.getElementById('onbCountry');
  if (countrySel) countrySel.onchange = handleOnboardingCountryChange;
}

/** 引导页表单（角色名 / 性别 / 出生日期 / 区服 / 签名 / 自定义字段，无任何账号概念） */
function buildOnboardingForm() {
  const isChina = onboardingDraft.country === '中国';
  const countryOptions = AUTH_COUNTRIES.map(function (c) {
    return '<option value="' + escapeHtml(c) + '"' + (onboardingDraft.country === c ? ' selected' : '') + '>' + escapeHtml(c) + '</option>';
  }).join('');

  const provinceField = isChina
    ? '<select id="onbProvince" class="auth-input">' +
        '<option value="">请选择省份</option>' +
        CHINA_PROVINCES.map(function (p) {
          return '<option value="' + escapeHtml(p) + '"' + (onboardingDraft.province === p ? ' selected' : '') + '>' + escapeHtml(p) + '</option>';
        }).join('') +
      '</select>'
    : '<input id="onbProvince" class="auth-input" type="text" placeholder="州 / 省（选填）" value="' + escapeHtml(onboardingDraft.province) + '">';

  const genderOptions = ONB_GENDER_OPTIONS.map(function (g) {
    return '<option value="' + g.key + '"' + (onboardingDraft.gender === g.key ? ' selected' : '') + '>' + escapeHtml(g.label) + '</option>';
  }).join('');

  return (
    '<div class="auth-logo">🌍</div>' +
    '<h1 class="auth-title">欢迎来到地球Online</h1>' +
    '<p class="auth-subtitle">先设定你的角色，1 分钟内开始记录人生。</p>' +
    '<div class="auth-form">' +
      '<div class="auth-field">' +
        '<label for="onbName">角色名</label>' +
        '<input id="onbName" class="auth-input" type="text" maxlength="16" placeholder="你的角色名" value="' + escapeHtml(onboardingDraft.name) + '">' +
      '</div>' +
      '<div class="auth-field">' +
        '<label for="onbGender">性别</label>' +
        '<select id="onbGender" class="auth-input">' + genderOptions + '</select>' +
      '</div>' +
      '<div class="auth-field">' +
        '<label for="onbBirth">出生日期</label>' +
        '<input id="onbBirth" class="auth-input" type="date" max="' + todayStr() + '" value="' + escapeHtml(onboardingDraft.birth) + '">' +
      '</div>' +
      '<div class="auth-field">' +
        '<label for="onbCountry">选择区服 - 国家</label>' +
        '<select id="onbCountry" class="auth-input">' + countryOptions + '</select>' +
      '</div>' +
      '<div class="auth-field">' +
        '<label for="onbProvince">' + (isChina ? '选择区服 - 省份' : '选择区服 - 州 / 省') + '</label>' +
        provinceField +
      '</div>' +
      '<div class="auth-field">' +
        '<label for="onbSignature">签名</label>' +
        '<input id="onbSignature" class="auth-input" type="text" maxlength="120" placeholder="一句话介绍自己（选填）" value="' + escapeHtml(onboardingDraft.signature) + '">' +
      '</div>' +
      '<div class="auth-field">' +
        '<label for="onbCustomLabel">自定义字段（选填）</label>' +
        '<div class="auth-code-row">' +
          '<input id="onbCustomLabel" class="auth-input auth-code-input" type="text" maxlength="20" placeholder="字段名，如 昵称" value="' + escapeHtml(onboardingDraft.customLabel) + '">' +
          '<input id="onbCustomValue" class="auth-input auth-code-input" type="text" maxlength="40" placeholder="值" value="' + escapeHtml(onboardingDraft.customValue) + '">' +
        '</div>' +
      '</div>' +
      '<p class="auth-code-tip" id="onbFormError"></p>' +
    '</div>' +
    '<div class="auth-actions">' +
      '<button class="btn btn-primary auth-btn" data-action="onboarding-save">🎮 开始人生</button>' +
    '</div>'
  );
}

/* ==================== 交互 ==================== */

/** 收集团体表单当前值（用于国家切换后保留已填内容） */
function captureOnboardingDraft() {
  onboardingDraft = {
    name: onbVal('onbName'),
    gender: onbVal('onbGender'),
    birth: onbVal('onbBirth'),
    country: onbVal('onbCountry') || onboardingDraft.country,
    province: onbVal('onbProvince'),
    signature: onbVal('onbSignature'),
    customLabel: onbVal('onbCustomLabel'),
    customValue: onbVal('onbCustomValue'),
  };
}

/** 读取某个输入框的值；元素不存在返回空串 */
function onbVal(id) {
  const el = document.getElementById(id);
  return el ? String(el.value == null ? '' : el.value) : '';
}

/** 国家切换：重渲表单以联动省份控件，并保留其它已填内容 */
function handleOnboardingCountryChange() {
  captureOnboardingDraft();
  renderOnboardingScreen();
}

/**
 * 保存引导页：state = defaultState() → 写 profile + birthDate → saveState() → 进主程序。
 * 与资料页共用同一数据模型（state.profile.country/province，设计 §3.4）。
 */
function handleOnboardingSave() {
  const errEl = document.getElementById('onbFormError');
  const fail = function (msg) { if (errEl) errEl.textContent = msg; };

  captureOnboardingDraft();
  const name = onboardingDraft.name.trim();
  const birth = onboardingDraft.birth.trim();

  if (!name) { fail('请填写角色名'); return; }
  if (!birth) { fail('请选择出生日期'); return; }

  state = defaultState();
  const birthResult = setBirthDate(birth);
  if (!birthResult.ok) { fail(birthResult.error); return; }

  const g = onboardingDraft.gender;
  state.profile.name = name.slice(0, 120);
  state.profile.gender = (g === 'male' || g === 'female' || g === 'walmart') ? g : '';
  state.profile.country = String(onboardingDraft.country || '').slice(0, 30);
  state.profile.province = String(onboardingDraft.province || '').slice(0, 30);
  state.profile.signature = String(onboardingDraft.signature || '').slice(0, 120);

  const cl = String(onboardingDraft.customLabel || '').trim().slice(0, 20);
  const cv = String(onboardingDraft.customValue || '').trim().slice(0, 40);
  if (cl && cv) state.profile.customFields.push({ id: uid('cf'), label: cl, value: cv });

  saveState();
  toast('欢迎来到地球Online');
  enterMainApp();
}

/** 退出引导页，进入主程序 */
function enterMainApp() {
  document.body.classList.remove('auth-active');
  const el = document.getElementById('auth-root');
  if (el) el.innerHTML = '';
  startMainApp();
}

  /* ---- 导出公共 API 到 EO 命名空间并同步到全局（兼容旧引用 / 测试桩） ---- */
  E.AUTH_COUNTRIES = AUTH_COUNTRIES;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.AUTH_COUNTRIES === "undefined") globalThis.AUTH_COUNTRIES = AUTH_COUNTRIES; } catch (e) {}
  E.CHINA_PROVINCES = CHINA_PROVINCES;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.CHINA_PROVINCES === "undefined") globalThis.CHINA_PROVINCES = CHINA_PROVINCES; } catch (e) {}
  E.ONB_GENDER_OPTIONS = ONB_GENDER_OPTIONS;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.ONB_GENDER_OPTIONS === "undefined") globalThis.ONB_GENDER_OPTIONS = ONB_GENDER_OPTIONS; } catch (e) {}
  E.onboardingDraft = onboardingDraft;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.onboardingDraft === "undefined") globalThis.onboardingDraft = onboardingDraft; } catch (e) {}
  E.renderOnboardingScreen = renderOnboardingScreen;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.renderOnboardingScreen === "undefined") globalThis.renderOnboardingScreen = renderOnboardingScreen; } catch (e) {}
  E.buildOnboardingForm = buildOnboardingForm;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.buildOnboardingForm === "undefined") globalThis.buildOnboardingForm = buildOnboardingForm; } catch (e) {}
  E.captureOnboardingDraft = captureOnboardingDraft;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.captureOnboardingDraft === "undefined") globalThis.captureOnboardingDraft = captureOnboardingDraft; } catch (e) {}
  E.onbVal = onbVal;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.onbVal === "undefined") globalThis.onbVal = onbVal; } catch (e) {}
  E.handleOnboardingCountryChange = handleOnboardingCountryChange;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.handleOnboardingCountryChange === "undefined") globalThis.handleOnboardingCountryChange = handleOnboardingCountryChange; } catch (e) {}
  E.handleOnboardingSave = handleOnboardingSave;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.handleOnboardingSave === "undefined") globalThis.handleOnboardingSave = handleOnboardingSave; } catch (e) {}
  E.enterMainApp = enterMainApp;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.enterMainApp === "undefined") globalThis.enterMainApp = enterMainApp; } catch (e) {}
})();
