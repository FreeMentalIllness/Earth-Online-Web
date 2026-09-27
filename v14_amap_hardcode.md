# 地球Online · v14 综合更新（高德密钥硬编码 + 既有功能对账）

> 用户给出的 7 项综合更新中，**6 项已在 v12 / v13 落地**，本回合真正的增量只有「把高德地图 Key + 安全密钥硬编码进代码（不再用占位符）并改用入口文件字面量 `<script>` 预加载」+ 配套 QA 放行。

## 本次实质变更（密钥硬编码）

1. **`js/pages.js`**：`AMAP_KEY` 由占位符 `'YOUR_AMAP_WEB_JS_KEY'` → 真实 Key；`AMAP_SECURITY_CODE` 由 `''` → 真实安全密钥。并在注释中说明两处入口文件的加载方式。
2. **`index.html`**（用户明确要求）：在应用脚本前注入
   ```html
   <script>window._AMapSecurityConfig = { securityJsCode: 'd4e92781da1ca5996c246d315af66031' };</script>
   <script src="https://webapi.amap.com/maps?v=2.0&key=07672883965ec7a6f0948813c0a90915"></script>
   ```
   - ⚠️ 用户原文写 `window.AMapSecurityConfig`，但 **AMap JS API 2.0 读取的是带下划线的 `window._AMapSecurityConfig`**；按字面写会导致安全密钥不生效、地图加载失败。故采用官方下划线形式以保证可用，并已同步到代码注释与交付说明。
   - 安全密钥脚本必须排在 SDK `<script>` 之前（已满足）。
3. **`build_pakr.js`**：同样在生成的 `index_pakr.html` `<head>` 注入上述两段脚本，保证 ES5 自包含包也能预加载 AMap。
4. **`qa/run_suite.js`**（两处配套放行，否则字面量 `https://` 会撞「无外部网络依赖」/「index.html 引用存在」检查）：
   - 1.2「index.html 引用存在」：**跳过以 `http(s)://` 开头的外部引用**（该检查本意是校验本地资源）。
   - 1.3「无外部网络依赖」：豁免名单追加 `webapi.amap.com`（高德 SDK 为项目明确要用的在线地图依赖，非偶发外链）。

## 7 项需求对账（其余均已满足，未改动以免回归）

| # | 需求 | 现状（落地点） |
|---|------|------|
| 1 | 地图（高德 JS API，足迹标记/信息窗/定位/双击标点/拖拽/权限） | v12 已实现：`renderMapAuto` + `initAMapMap` + `AMap.Geolocation` + 双击 `addMapModal` + `marker.setDraggable(true)` + 拒绝 Toast「定位权限被拒绝，已使用默认视图」+「重新定位」；足迹 CRUD 同步 `state.locations`（字段 id/name/lat/lng/date/note/tags）。本次仅补密钥 |
| 2 | 状态栏适配（viewport-fit=cover + 安全区内边距 + 关闭全屏） | `index.html` 已有 `viewport-fit=cover` + `apple-mobile-web-app-status-bar-style=default`；`body` 已有 `env(safe-area-inset-*)` 内边距（v12）；APK 构建（build.bat）经核查**本就不强制全屏**（仅设 `windowLightStatusBar`，无 FLAG_FULLSCREEN/immersive），状态栏本就可见 |
| 3 | 返回键导航（导航栈 + backbutton） | v11/v12：`navStack` + `handleBack`（更多面板→弹窗→非主页回主页→主页 exitApp）+ `setupBackNav` 已就位 |
| 4 | 滚动卡顿优化 | v13：`passive` 滚动监听 + rAF 节流 + 滚动时关毛玻璃 + 移除行级 `will-change`；粒子系统 v9 已移除；进度条/数字滚动已 GPU/单 rAF。⚠️ 方案点④「`#content{translateZ(0)}`」**刻意未做**（会使 `#content` 变 backdrop root 废掉毛玻璃，见 v13 说明） |
| 5 | 成就系统（探索/生活/创作 6 条，自动触发 + Steam 风通知 + 音效） | v12 已新增 `footprint_1/10/50`、`ledger_first`、`cat_first`、`collect_20`，并接入 `checkAutoAchievements`（Steam 通知 + 音效已存在） |
| 6 | 收藏夹自定义分类（无默认预设 + 管理面板） | v3 起 `collectionCategories` 默认 `[]`，管理面板支持增删改，添加时可选/新建分类 |
| 7 | 主页整合（全局概览 + 快速入口含记账/地图） | v3/v12：`overview-grid` 4 卡（任务/背包/成就/灵感）+ `quickDefs` 含 `open-verifin`(记账) 与 `nav map`(地图)；更多面板亦含地图入口 |

## 验证

- `node --check js/pages.js` / `build_pakr.js`：通过
- `node build_pakr.js`：成功，`index_pakr.html` 重建（659,963 字节），含 AMap 预加载脚本
- `node qa/run_suite.js`（cwd=`D:/AI/1`）：**逻辑 90 passed / 0 failed，静态 133 passed / 0 failed** 全绿
  - 「无外部网络依赖」PASS（amap 已放行）
  - 「index.html 引用存在」PASS（外部 src 已跳过校验）
  - 「data-action 共 95 个，全部有对应事件分支」PASS（无新增 action）
- 全仓 grep：无 `YOUR_AMAP_WEB_JS_KEY` 占位符残留；`index.html`/`index_pakr.html` 均含 AMap `<script>` 与 `_AMapSecurityConfig`

## 变更文件

- `js/pages.js`（密钥常量）
- `index.html`（字面量 AMap 脚本 + 安全密钥）
- `build_pakr.js`（Pakr 模板注入 AMap 脚本）
- `qa/run_suite.js`（外部依赖放行两处）
- `index_pakr.html`（重建）
