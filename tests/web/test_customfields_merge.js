/**
 * 回归测试：修复 m2 —— Web 从 Android/Windows 导入时 customFields 丢失
 *
 * 真实加载 EarthOnline-Web/modules/core.js（经 stub 浏览器全局），
 * 直接调用模块暴露的 EO.sanitizeState / EO.sanitizeProfile，
 * 验证「customFieldsJson（字符串）→ customFields（数组）」归一化。
 *
 * 运行：node EarthOnline-Web/tests/web/test_customfields_merge.js
 * 依赖：仅 Node 内置（fs/vm），无第三方依赖，不引入新包。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---- 浏览器全局 stub（core.js 加载期仅定义函数/常量，不触碰这些；运行时惰性使用）----
const noopStore = {
  getSync() { return null; },
  set() {},
  remove() {},
  keys() { return []; },
  init() { return Promise.resolve(); },
};
global.window = global;
global.document = {
  createElement() { return { set onload(_) {}, set onerror(_) {}, appendChild() {} }; },
  head: null, body: null, documentElement: null,
};
global.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
global.EOStore = noopStore;

// ---- 加载 core.js 到当前 globalThis 上下文 ----
const corePath = path.resolve(__dirname, '../../modules/core.js');
const code = fs.readFileSync(corePath, 'utf8');
vm.runInThisContext(code, { filename: 'core.js' });

const EO = global.EO;
if (!EO || typeof EO.sanitizeState !== 'function' || typeof EO.sanitizeProfile !== 'function') {
  console.error('FAIL: core.js 未正确暴露 sanitizeState / sanitizeProfile');
  process.exit(1);
}

let pass = 0, fail = 0;
function check(cond, msg) {
  if (cond) { pass++; console.log('  ✅ ' + msg); }
  else { fail++; console.log('  ❌ ' + msg); }
}

// ---- 用例 1：Android wire 格式（profile.customFieldsJson 字符串，字段 id/label/value）----
console.log('[用例1] Android 导出 → 导入 Web（customFieldsJson 字符串）');
const androidState = {
  version: 1,
  profile: {
    name: '测试用户',
    birthDate: '1995-06-15',
    customFieldsJson: JSON.stringify([
      { id: 'cf1', label: '血型', value: 'O' },
      { id: 'cf2', label: '身高', value: '175' },
    ]),
  },
  tasks: [{ id: 't1', title: '主线A', category: 'main', status: 'active', progress: 30 }],
};
const r1 = EO.sanitizeState(androidState);
check(Array.isArray(r1.profile.customFields), 'profile.customFields 为数组');
check(r1.profile.customFields.length === 2, 'customFields 还原 2 条（实际 ' + r1.profile.customFields.length + '）');
check(r1.profile.customFields[0].id === 'cf1' && r1.profile.customFields[0].label === '血型' && r1.profile.customFields[0].value === 'O',
  '第 1 条字段 id/label/value 正确');
check(r1.profile.customFields[1].label === '身高' && r1.profile.customFields[1].value === '175',
  '第 2 条字段 label/value 正确');

// ---- 用例 2：Windows wire 格式（同结构，确认跨端一致）----
console.log('[用例2] Windows 导出 → 导入 Web');
const winState = {
  version: 1,
  profile: { name: 'Win用户', customFieldsJson: '[{"id":"w1","label":"星座","value":"天蝎"}]' },
  tasks: [],
};
const r2 = EO.sanitizeState(winState);
check(r2.profile.customFields.length === 1 && r2.profile.customFields[0].label === '星座',
  'Windows customFieldsJson 还原成功');

// ---- 用例 3：Web 原生数组格式不受影响（回归保护）----
console.log('[用例3] Web 原生 customFields 数组格式（不应被破坏）');
const webState = {
  profile: { name: 'Web用户', customFields: [{ id: 'wf', label: '城市', value: 'Shanghai' }] },
  tasks: [],
};
const r3 = EO.sanitizeState(webState);
check(r3.profile.customFields.length === 1 && r3.profile.customFields[0].label === '城市',
  'Web 数组格式 customFields 保留');

// ---- 用例 4：畸形 customFieldsJson 不崩溃 ----
console.log('[用例4] 畸形 customFieldsJson（非标准 JSON）容错');
const badState = { profile: { name: 'X', customFieldsJson: '{这不是合法json' }, tasks: [] };
let crashed = false, r4 = null;
try { r4 = EO.sanitizeState(badState); } catch (e) { crashed = true; }
check(!crashed, '解析失败不抛异常');
check(r4 && Array.isArray(r4.profile.customFields) && r4.profile.customFields.length === 0,
  '畸形 JSON 被静默丢弃，customFields 回落空数组');

// ---- 用例 5：数组优先于字符串（避免重复合并）----
console.log('[用例5] 同时含 customFields 数组与 customFieldsJson → 数组优先，不重复');
const bothState = {
  profile: {
    name: 'Y',
    customFields: [{ id: 'a', label: 'A', value: '1' }],
    customFieldsJson: JSON.stringify([{ id: 'b', label: 'B', value: '2' }]),
  },
  tasks: [],
};
const r5 = EO.sanitizeState(bothState);
check(r5.profile.customFields.length === 1 && r5.profile.customFields[0].label === 'A',
  '数组优先，customFieldsJson 不重复追加');

console.log('\n==== 结果：' + pass + ' 通过 / ' + fail + ' 失败 ====');
process.exit(fail === 0 ? 0 : 1);
