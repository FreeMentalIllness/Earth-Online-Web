# v20 交付报告：完全移除下拉刷新功能

> 版本：v20 ｜ 团队：software-earthonline-v20 ｜ 基线：逻辑 **99** / 静态 **146**（v19 为 99/147）
> 流程：工程师 v20-engineer（实现）→ QA v20-qa（独立验收 IS_PASS）

---

## 一、交付结论

**PASS**（独立 QA 验收 IS_PASS，无 P0/P1/P2）

| 验收项 | 结果 |
|---|---|
| 回归门禁 `node qa/run_suite.js` | 逻辑 **99/99**，静态 **146/146**，0 FAIL |
| 残留 grep（modules + css + 三个 HTML/构建脚本） | **0 残留** |
| touch 监听（app.js） | **0 残留** |
| 浏览器实测（独立脚本 `qa/_v20_qa.js`） | **55/55**（9 页遍历 + 下拉触摸模拟 + IDB 读写 + 视觉确认） |
| `node --check`（app.js / build_pakr.js） | 通过 |
| `node build_pakr.js` 重建 | 成功，UTF-8 字节 **937,564**（sha256 确定性一致） |
| 静态 147→146 原因 | 已独立实验证明：唯一减少项为 `#pullRefresh` DOM id 检查项，非 FAIL |

---

## 二、需求达成对照

| 需求 | 达成情况 |
|---|---|
| 删除 touchstart/touchmove/touchend 下拉刷新事件绑定 | ✅ app.js 3 个监听器随 `setupPullToRefresh()` 整个函数删除 |
| 删除指示器 UI（加载动画/刷新箭头/提示文字） | ✅ `#pullRefresh`/`.pull-refresh-icon`/`.pull-refresh-text`/`@keyframes pullSpin`/`.done` 全套样式删除 |
| 删除「已更新」Toast 提示 | ✅ 下拉刷新成功态代码已删；剩余 8 处「已更新」均为表单保存/操作反馈业务 toast（收藏/坐标/足迹/任务/物品/出生日期/壁纸/字段），与下拉刷新无关 |
| 清理状态变量与函数调用（isPulling/refreshData 等） | ✅ `__ptrBound` 守卫、`THRESHOLD/MAX_PULL/DAMPING/BUSY_MS/DONE_MS` 常量、`isDisabled/doRefresh/collapse/render` 内部函数全部删除 |
| 地图页禁用代码一并清理 | ✅ 地图禁用逻辑随整个函数删除（`isDisabled()` 内 map 分支消失） |
| 移除后所有页面正常滚动 | ✅ 9 个导航页全部可滚动（scrollTo 400 生效）、无 JS 错误 |
| 保留手动「刷新/同步」按钮 | ✅ WebDAV upload/restore/test/autosync、backup 导入导出、表单刷新入口全部保留（data-action 92 个全部分支平衡） |
| 不影响 IndexedDB/页面切换等核心功能 | ✅ 浏览器实测 IDB 读写往返、页面切换正常；门禁全绿 |

---

## 三、改动文件清单

| 文件 | 改动 |
|---|---|
| `modules/app.js`（35,006 字节） | 删 `__ptrBound`（L52-53）；删整个 `setupPullToRefresh()`（原 L312-422，含 3 个 touch 监听 + isDisabled/doRefresh/collapse/render + 常量 + `#pullRefresh` 元素创建）；删调用点（原 L715-716）；删导出与 globalThis 守卫（原 L782-783）；删 v15+v19 注释块（原 L304-311）；**保留** `refreshCurrentPage`（仍被 `EarthBus.on('state:idb-restored')` 使用） |
| `css/style.css`（94,936 字节） | 删 `#pullRefresh` 及 `.pull-refresh-*`/`loading`/`done`/`@keyframes pullSpin` 全套（原 L282-315）；**保留** `body{overscroll-behavior-y:contain}`（防安卓原生刷新圈）与 `.page-map{overscroll-behavior-y:contain}`（地图防橡皮筋） |
| `index_pakr.html` | 经 `node build_pakr.js` 重建（非手改，sha256 确定性一致） |
| `qa/_v20_qa.js` | QA 新增独立验收脚本（55 断言），已落盘供后续回归参考 |

---

## 四、静态基线说明（147 → 146）

- `run_suite.js` 未被改动（时间戳早于本次改动）。
- 其「DOM id 可解析」检查用 `/getElementById\('([^']+)'\)/g` 动态扫描模块 JS 收集 id 集合。
- 独立实验：当前 14 模块拼接扫描得 **90 个 id**；临时模拟 v19 追加 `getElementById('pullRefresh')` 得 91 个，差异集合恰好为 `{pullRefresh}`。
- 结论：**146 = 147 - #pullRefresh 单项**，属预期变化，非 FAIL。

---

## 五、遗留问题

1. ~~**`qa/_verify.js` 本机无法直接 spawn msedge**~~ **【已修复，2026-09-01 收尾】**：`_verify.js` 已按 QA 稳健方案改造——脚本内 `child_process.spawn` 预启动 Edge headless（`--headless=new --remote-debugging-port=9223 --remote-allow-origins=* --user-data-dir=<qa/_tmp_verify_edge>`）→ `cdpProbe()` 轮询 CDP ready（500ms×40 次）→ `puppeteer.connect({browserURL})` → finally kill 子进程。**实测 `node qa/_verify.js` 39/39 通过**（桌面 24 + 移动 15），无残留 Edge 进程；门禁复跑逻辑 99 / 静态 146 无回归。`_verify.js` 已恢复为常规浏览器门禁。
2. 项目非 git 仓库，无版本提交（与 v19 一致）。

---

*—— v20 交付 ｜ 2026-09-01 ｜ 团队 software-earthonline-v20 ｜ 主理人汇总*
