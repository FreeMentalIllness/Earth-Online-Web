# BugFix 报告（v18）

**日期**：2026-09-01  
**范围**：地球Online（`D:\AI\1\earth-online\`，零依赖原生 HTML/CSS/JS）  
**团队状态**：主理人直跑（本轮 team 成员均为 unresumable，按规范声明后由主理人直接实施 + 独立自测）  
**门禁基线**：逻辑 96 / 静态 145（v17 交付基线） → **修复后 逻辑 99 / 静态 145**（+3 条 T 系列新测试，静态无变化）  
**Pakr 包**：879,794 bytes（`node build_pakr.js` 重建成功）

---

## 修复项验证表

| # | Bug | 状态 | 关键证据 |
|---|---|---|---|
| ① | 记账功能点击后白屏 | ✅ 已修复 | 桌面 + 移动端均直接弹"📊 记账功能"下载引导（Verifin/GitHub/123云盘），页面 URL 仍为 `index.html`、`#content .home-page` 保留、`document.body.textContent` 长度 891–914（非白屏）；新增 3 条逻辑测试 T1–T3 全部通过 |
| ② | 更多窗口位置不对，应显示在按钮旁边 | ✅ 已就位（v17 修复，本轮复核无回归） | 桌面 `panelTop=70, btnBottom=62` 恰 8px、右对齐 `panelRight=1256=btnRight`、面板完整可见；移动端（390/360/428）底部抽屉全宽 `left=0, right=vw, bottom=vh` |

**Edge headless 真实浏览器验证（`qa/_verify.js`）**：39/39 全部通过（含 8 项新增记账断言 + 既有更多窗口 / 设置 / 收藏 / 模块冒烟 / 无 JS 错误 / 极值宽度）。

---

## Bug ① 根因 + 修复

**根因**：`modules/pages.js` 的 `openVerifin()` 把 `window.location.href` 赋值为 `intent://...`。`intent://` 仅 Android Chrome 生效；桌面/其它平台指向未知 scheme，浏览器加载错误/空白页（白屏），且文档销毁导致 1200ms 定时器不执行、下载引导永远不弹。

**修复**（按用户规格，整段 try-catch 包裹，所有失败路径兜底 `showDownloadDialog`）：

1. **UA 分流防白屏**（核心）：`/Android/i.test(navigator.userAgent)` —— 非 Android 直接 `showDownloadDialog()` 不做 `location` 跳转；
2. Android：尝试 `window.location.href = 'intent://...'`；抛异常则 `showDownloadDialog()` 并 return；
3. 唤起后 `setTimeout(2000)`：页面仍可见（`document.hidden===false`，App 未被拉起）→ `showDownloadDialog()`，回调内再套 try-catch；
4. 最外层 try-catch，任何意外异常都兜底 `showDownloadDialog()`。

**重命名**：用户指定函数名 `showDownloadDialog()`。`openVerifinGuideModal` → `showDownloadDialog`，加 `var openVerifinGuideModal = showDownloadDialog` 兼容别名，导出块同步导出新名 + 保留旧名全局守卫（防 Pakr 包/外部直调断引用）。

**改动文件**：
- `modules/pages.js` — `openVerifin()` 重写（约 1744–1772），`openVerifinGuideModal` → `showDownloadDialog`（约 1774–1798），导出块（约 2761–2764）。

**新增逻辑测试**（`qa/tests_body.js` T 系列）：
- T1 非 Android UA → 弹窗显示 + `window.location.href` **未被改写**（防白屏关键断言）；
- T2 Android + `window.location` 不可写 → 异常兜底弹窗；
- T3 Android + 可写 location + 同步 setTimeout → `location.href` 以 `intent://` 开头 + 弹窗显示。

**测试技术点**：Node 22 的 `globalThis.navigator` 是 configurable 访问器（`global.navigator = ...` 静默失败），需用 `Object.defineProperty` 覆盖并在 finally 用保存的 descriptor 还原；`showDownloadDialog` 的内部调用无法跨 IIFE 拦截，故接管 `document.getElementById` 让 `#modal-root` 返回共享 stub，从其 `innerHTML` 是否含「记账功能」判断弹窗是否实际显示。

---

## Bug ② 复核（v17 已就位）

CSS 与 HTML 结构全部在位，无回归，未改动：
- `.home-more-wrap { position: relative; flex: 0 0 auto }`（`css/style.css:1433`，relative 锚点）
- `.more-panel { position: absolute; top: calc(100% + 8px); right: 0; z-index: 999 }`（`:1434-1448`）
- 移动端 `@media max-width:768px` `.more-panel { position: fixed; left:0; right:0; bottom:0; border-radius: 12px 12px 0 0 }`（`:1515-1520`，底部抽屉）
- `#app { z-index: auto }`（`:1495`，stacking context 修复）
- HTML：`.home-more-wrap` 包裹 `#moreBtn` + `#morePanel`（`modules/pages.js:396-407`）

---

## 验证结果

**`node qa/run_suite.js`**：逻辑 99 / 静态 145 全绿。  
**`node build_pakr.js`**：index_pakr.html 重建成功，879,794 bytes，`showDownloadDialog` 内联 12 处。  
**`node qa/_verify.js`**：39/39 断言通过，截图 `qa/_shots/desktop-ledger-dialog.png` + `mobile-ledger-dialog.png`（视觉确认主页完整 + 弹窗居中 + 双下载源按钮）。

---

## 改动文件清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `earth-online/modules/pages.js` | 修改 | `openVerifin()` 重写 + `openVerifinGuideModal` → `showDownloadDialog` 重命名 + 兼容别名 + 导出块同步 |
| `earth-online/index_pakr.html` | 自动重建 | `node build_pakr.js` 产物（879,794 bytes） |
| `qa/tests_body.js` | 修改 | 新增 T1–T3 逻辑测试（openVerifin 三条路径覆盖，含 defineProperty navigator + 共享 modal-root stub） |
| `qa/_verify.js` | 修改 | 新增桌面 + 移动端记账弹窗实测（8 项断言 + 2 张截图） |
| `qa/_shots/desktop-ledger-dialog.png` | 新增 | 桌面：主页完整 + 下载引导弹窗居中 |
| `qa/_shots/mobile-ledger-dialog.png` | 新增 | 移动端：主页完整 + 下载引导弹窗居中 |
| `bugfix_v18_report.md` | 新增 | 本报告 |

---

## 团队流程说明

按 `team-runtime-resume` 元数据声明：本轮 `software-earth-online` 团队成员（product-manager / architect / architect-2 / engineer / qa-engineer）均标记为 **unresumable**（无持久任务 id），无法通过 SendMessage 自动唤醒继续上轮任务。按规范不能声称其仍在运行。本轮 BugFix 由主理人直接执行（与 v17 之前主理人直跑的工作流一致），并独立完成代码自测（门禁全绿）+ 真实浏览器实测（Edge headless 39/39）+ 报告交付，全流程无外部依赖与协作阻塞。
