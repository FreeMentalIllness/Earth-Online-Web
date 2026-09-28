#!/usr/bin/env node
/**
 * 跨端备份兼容性契约测试 —— Web 端零依赖校验器
 *
 * 校验对象：三端 WebDAV 实际互通的「裸字段 wire 格式」（即 Android BackupRepository.Payload
 *         / Windows BackupService.BackupPayload / Web buildWebdavPayload 顶层镜像字段）。这是
 *         真正在设备间流动的 JSON 形状，故样例与断言都以此为准：
 *         1) 所有 JSON 键为 camelCase（与 Android kotlinx 默认 / Windows [JsonPropertyName] 一致）；
 *         2) profile.birthDate 归一化为 "YYYY-MM-DD" 或空串 ""（Web 顶级字段在导出时内嵌进 profile）；
 *         3) profile.customFieldsJson 为字符串，可反序列化为 {id,label,value} 数组（Web 数组→字符串）；
 *         4) locations[].tagsJson 为字符串，可反序列化为 string[]（Web 数组→字符串）；
 *         5) 按主键合并语义：本地独有主键保留，云端同主键覆盖。
 *
 * 运行：node EarthOnline-Tests/web/validate_backup_contract.js
 * 依赖：仅 Node 内置（fs），无第三方依赖。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SAMPLE = path.join(__dirname, '..', 'contract', 'backup_contract.sample.json');

let failures = 0;
function check(cond, msg) {
  if (cond) {
    console.log('  ✓ ' + msg);
  } else {
    console.error('  ✗ ' + msg);
    failures++;
  }
}

// camelCase：首字母小写，后续仅字母数字，无下划线
const CAMEL = /^[a-z][a-zA-Z0-9]*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// 递归校验所有键为 camelCase
function assertCamelKeys(node, pathPrefix) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => assertCamelKeys(v, pathPrefix + '[' + i + ']'));
    return;
  }
  if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) {
      const here = pathPrefix ? pathPrefix + '.' + k : k;
      if (!CAMEL.test(k)) {
        check(false, '键必须为 camelCase: "' + here + '" (当前 "' + k + '")');
      }
      assertCamelKeys(node[k], here);
    }
  }
}

// 按主键合并（镜像 Web mergeByPrimaryKey / Windows Upsert / Android REPLACE）
function mergeByPrimaryKey(localArr, cloudArr) {
  const map = new Map();
  for (const it of localArr) map.set(it.id, structuredClone(it));
  for (const it of cloudArr) map.set(it.id, structuredClone(it)); // 云端覆盖同主键
  return [...map.values()];
}

function main() {
  const raw = fs.readFileSync(SAMPLE, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error('样例 JSON 解析失败: ' + e.message);
    process.exit(1);
  }

  console.log('[1] 全键 camelCase 契约');
  assertCamelKeys(data, '');

  console.log('[2] profile.birthDate 归一化契约 (YYYY-MM-DD | "")');
  const bd = data.profile && data.profile.birthDate;
  check(typeof bd === 'string', 'profile.birthDate 存在且为字符串');
  check(bd === '' || ISO_DATE.test(bd),
    'profile.birthDate 为空串或 YYYY-MM-DD（当前 "' + bd + '"）');

  console.log('[3] profile.customFieldsJson 契约（wire 形态为 JSON 字符串）');
  const cfJson = data.profile && data.profile.customFieldsJson;
  check(typeof cfJson === 'string' && cfJson.length > 0, 'profile.customFieldsJson 为字符串');
  let cfOk = true, cfArr = null;
  try {
    cfArr = JSON.parse(cfJson);
    if (!Array.isArray(cfArr)) cfOk = false;
    for (const cf of cfArr || []) {
      if (typeof cf !== 'object' || cf === null) { cfOk = false; break; }
      // 内层键 camelCase：id / label / value
      for (const k of Object.keys(cf)) if (!CAMEL.test(k)) cfOk = false;
      if (typeof cf.id !== 'string' || typeof cf.label !== 'string' || typeof cf.value !== 'string') cfOk = false;
    }
  } catch (e) { cfOk = false; }
  check(cfOk, 'customFieldsJson 可反序列化为 {id,label,value}[] 且内层键 camelCase');
  // 可逆：再序列化后解析结果一致
  let cfRound = true;
  try { cfRound = JSON.stringify(JSON.parse(cfJson)) === cfJson; } catch { cfRound = false; }
  check(cfRound, 'customFieldsJson 往返序列化一致');

  console.log('[4] locations[].tagsJson 契约（wire 形态为 JSON 字符串）');
  let tagsOk = true;
  for (const loc of (data.locations || [])) {
    if (typeof loc.tagsJson !== 'string') { tagsOk = false; break; }
    try {
      const arr = JSON.parse(loc.tagsJson);
      if (!Array.isArray(arr) || !arr.every(t => typeof t === 'string')) { tagsOk = false; break; }
    } catch (e) { tagsOk = false; break; }
  }
  check(tagsOk, 'locations[].tagsJson 均为可解析的 string[] 字符串');

  console.log('[5] 按主键合并语义');
  const localTasks = [
    { id: 't1', title: '本地旧标题', status: 'planning', doneAt: null },
    { id: 't9', title: '仅本地存在', status: 'planning', doneAt: null } // 本地独有主键
  ];
  const cloudTasks = data.tasks; // 含 t1, t2
  const merged = mergeByPrimaryKey(localTasks, cloudTasks);
  const byId = Object.fromEntries(merged.map(t => [t.id, t]));
  check(byId['t9'] && byId['t9'].title === '仅本地存在', '本地独有主键 t9 在合并后保留');
  check(byId['t1'] && byId['t1'].title === '主线任务A', '云端同主键 t1 覆盖本地旧值');
  check(byId['t2'] && byId['t2'].title === '支线B', '云端独有主键 t2 进入结果');
  check(Object.keys(byId).length === 3, '合并结果主键数 = 3（t1,t2,t9）');

  console.log('');
  if (failures === 0) {
    console.log('全部契约断言通过 ✅ (Web 参考格式符合三端互通要求)');
    process.exit(0);
  } else {
    console.error('存在 ' + failures + ' 项契约断言失败 ❌');
    process.exit(1);
  }
}

main();
