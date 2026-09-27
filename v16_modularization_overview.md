# 地球Online v16 架构升级 · 收尾概览

两项底层架构升级已全部落地并通过回归门禁：
① 全量数据从 `localStorage` 迁移到 IndexedDB；
② 代码按功能拆分为独立模块（经典脚本 `window.EO` 命名空间）。

## ① IndexedDB 迁移（EOStore）

- `modules/storage.js`：封装本地内置 `vendor/localforage.min.js`（零外链、离线可用），对外 API `init / getSync / set / remove / keys / isFallback / driverName`。
- 驱动优先级 `[IndexedDB, WebSQL, localStorage]`，降级绳齐全；启动时一次性迁移旧 `earth_*` 键并标记 `earth_migrated`。
- `EarthIDB` 别名（idbGet/idbSet/idbDel/openEarthDB）走 Blob 大文件（头像/壁纸/收藏附件）。
- `data.js` / `backup.js` / `pages.js` / `app.js` 全部切到 `EOStore`，保留 `typeof EOStore !== 'undefined' && ...` 守卫 + `localStorage` 回退；`app.startMainApp` 改为 `async` 并在 `loadState()` 前 `await EOStore.init()`。

### 关键修复（本次续跑）
10 项逻辑测试失败根因：`eoGetSync` 在「无 localforage 后端」（node 测试桩 / 纯 localStorage 降级）读取了被前期 `eoSet` 污染的 `mem` 内存镜像，且 E4 降级测试把 `global.localStorage` 换成抛 `'denied'` 的 mock、`ok()` 抛错跳过还原 → 级联污染后续用例。
修复：`eoGetSync` 无 localforage 分支**直读 localStorage**，`eoSet` **仅写 localStorage 不写 `mem`**。

## ② 模块拆分 + window.EO 命名空间

原 `js/*.js` 全部迁入 `modules/`（保留 `file://` 双击 + Pakr 包可用，无 ES Modules / 无 CDN）：

| 模块 | 来源 | 职责 |
|---|---|---|
| `core.js` | data.js | state / 账号系统 / 任务·物品·备忘 CRUD / 成就备份 |
| `account.js` | account.js | 账号 UI + 游戏化文案 |
| `achievements.js` | achievements.js | 自动成就定义与触发 |
| `profile.js` | profile.js | 个人资料 + 头像 |
| `collections.js` | collections.js | 收藏夹 + 自定义分类 |
| `backup.js` | backup.js | 备份导出/导入/WebDAV 快照 |
| `webdav.js` | webdav.js | WebDAV 云同步纯函数 |
| `stats.js` | stats.js | 数据看板聚合 |
| `pages.js` | pages.js | 页面渲染 + `bindGlobalEvents` 事件分发（仍是中枢 dispatcher） |
| `app.js` | app.js | 启动 / 路由 / 导航栈 |
| `bus.js` | bus.js | 事件总线 `EarthBus` |
| `storage.js` | 新建 | EOStore 存储层 |

模块形态：`(function(){ 'use strict'; var E=_g.EO; ... E.fn=fn; globalThis.fn=fn; })()`——公共 API 挂 `EO` 且同步暴露到 `globalThis`，兼容旧直调与 node 测试桩，**零调用点改动**。测试可变全局 `state` / `currentAccount` / `backpackTab` 保留为「真全局」（在 IIFE 外声明）。

同步更新的清单：`index.html`、`build_pakr.js`、`qa/run_suite.js`（SRC_FILES / PAGE_MODULES / allJs / bundle 拼装）、`sw.js` 预缓存。旧 `js/` 目录已删除。

## 验证

- `node --check` 全部改动 JS：通过
- `node qa/run_suite.js`：**逻辑 90 passed / 0 failed；静态 142 passed / 0 failed** 全绿
- `node build_pakr.js`：重建 `index_pakr.html`（872,601 bytes）成功

## 剩余规格项（#112，待办）

规格中「map/ai 运行时动态装载」尚未抽取：当前地图与 AI 逻辑仍内联在 `modules/pages.js`。下一步可从 `pages.js` 抽 `modules/map.js` / `modules/ai.js`，运行时按需注入 `<script>`（file:// 与 Pakr 均可用），加载失败 Toast「模块加载失败，请刷新页面重试」，`bindGlobalEvents` 转发到 `EO.map` / `EO.ai`。该抽取需独立 QA 门禁复跑，建议作为单独一轮执行。
