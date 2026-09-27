# v16 #112 — 地图 / AI 模块运行时动态装载

## 做了什么

把 `modules/pages.js` 里约 700 行「足迹地图」与「AI 助手」逻辑抽成独立的、运行时按需装载的模块：

| 新文件 | 命名空间 | 内容 |
|--------|----------|------|
| `modules/map.js` | `EO.map` | 地图全部函数 + 私有状态（`amap`/`lastMapClick`/`mapListCollapsed`/`AMAP_KEY`… 整段迁入）+ 转发 API |
| `modules/ai.js` | `EO.ai` | `buildAiContextSummary` / `renderAI` / `saveAiConfig` / `handleAiSend` |

`pages.js` 仅保留：
- `renderMapAuto()` / `renderAI()` **转发桩**（保证 `app.js` 的 `MOBILE_TABS` 的 `render:` 引用与全局直调不破坏，避免启动期 ReferenceError）；
- `bindGlobalEvents` 里全部 `map-*` / `ai-*` action 改成 `ensureModule('map'|'ai').then(() => EO.map/ai.xxx())` 转发。

`core.js` 新增 `ensureModule(name)` 装载器：
- 已 `EO[name]`（含 Pakr 内联包）→ 立即 `resolve(true)`；
- 否则注入 `<script src="modules/{name}.js">`；`onerror` → `toast('模块加载失败，请刷新页面重试')`。

## 装载行为

- **`index.html`（开发 / file://）**：不静态装载 `map.js`/`ai.js` → 真正懒加载，首屏更快。
- **`index_pakr.html`（Pakr / WebView）**：`build_pakr.js` 的 FILES 已纳入这两个文件 → 内联进 ES5 包，`EO.map`/`EO.ai` 启动即就绪，`ensureModule` 走 no-op。

## 同步更新的清单

- `index.html`：脚本顺序不变，`core.js` 在 `pages.js` 前（确保 `ensureModule` 可用）。
- `build_pakr.js`：FILES 追加 `modules/map.js`、`modules/ai.js`。
- `qa/run_suite.js`：`SRC_FILES` / `PAGE_MODULES` / `allJs` / 逻辑 bundle 拼装四处同步纳入（否则静态检查误判 `data-action` 死分支）。

## 验证

- `node --check` 全部改动 JS：通过
- `node qa/run_suite.js`：**逻辑 90 passed / 0 failed；静态 144 passed / 0 failed**
- `node build_pakr.js`：重建 `index_pakr.html`（约 871 KB）成功

## v16 两项底层升级收官

① 全量 localStorage → IndexedDB（EOStore）② 代码按功能模块化 + map/ai 运行时动态装载 —— 全部完成，回归门禁全绿。
