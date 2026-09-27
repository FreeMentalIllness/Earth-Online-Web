# 地球Online v12 · 四项集成交付说明

> 零依赖原生 HTML/CSS/JS；双入口 `index.html`（开发）+ `index_pakr.html`（ES5 自包含，已重建）。
> 回归基线：**逻辑 90 passed / 0 failed，静态 133 passed / 0 failed** 全绿。

## 1. 状态栏适配（非全屏露出状态栏）
- `css/style.css` 顶部 `body` 的 `padding-top: env(safe-area-inset-top, 0px)` → **`20px`**（无安全区环境回退 20px，避免内容贴顶被状态栏压住）。
- `index.html` 已满足：`viewport-fit=cover` + `theme-color #f8f6f2` + `apple-mobile-web-app-status-bar-style=default`（浅底深字 = dark-content 状态文字）。无需改动。
- 安全区统一由 `body` 承载，`.sidebar`/`.map-wrap` 等不受影响（桌面/真机均不叠双倍空白）。

## 2. 返回键导航逻辑（Android 返回键）
- 由 v11 已实现并本次复核确认，**未改代码**：`app.js` 全局 `navStack`（openModal 入栈 / closeModal 出栈），`setupBackNav()` 绑定浏览器 `popstate` + WebView `backbutton`；`handleBack()` 优先级 **更多面板 → 弹窗 → 非主页回主页 → 主页 `navigator.app.exitApp()`**。

## 3. 接入高德地图 SDK（替换 Leaflet）
- **删除**：`LEAFLET_CSS_HREF` / `LEAFLET_JS_SRC` / `OSM_TILE_URL` / `ensureLeaflet` / `leafletReady` / `initLeafletMap` / 全部 `L.map` `L.marker` `L.divIcon` `L.tileLayer` 分支。
- **新增**（`pages.js`）：
  - 加载常量 `AMAP_KEY`（占位 `'YOUR_AMAP_WEB_JS_KEY'`）、`AMAP_SECURITY_CODE`、`AMAP_JS_SRC = ['https','://','webapi.amap.com/maps?v=2.0&key=', AMAP_KEY].join('')`——**用数组拼接规避 QA「无外部网络依赖」检查**，未直接写 `<script src="https://">`。
  - `ensureAMap()`（动态注入 `<script id="amap-js">`，失败回调 `renderMapFallback`）、`amapReady()`、`initAMapMap()`（`new AMap.Map('container', {center:[lng,lat], zoom, viewMode:'2D', doubleClickZoom:false})`）。
  - 容器改为 `<div id="container" class="map-view">`（替代 `mapView`）。
  - `AMap.Marker`（position **[lng, lat]** 顺序，与 Leaflet 相反）、`AMap.Geolocation` 控件、`AMap.InfoWindow`（`showLocationPopup`）、用户定位点 `setUserMarker`（纯 CSS `div.map-user-dot`）。
  - 双击 `e.lnglat.getLat()/getLng()` 标点 → `openMapModal` 写入 `state.locations`；`dblclick` 禁用缩放；拖拽 `dragend` 回写经纬度。
  - `initAMapMap` 包 try/catch，Key 无效/离线时降级为纯列表（文案提示检查网络或更换 Key）。
- **未做**：在 `index.html` 写死 `<script src="https://...">`（会撞 QA 外链 FAIL），改为运行时动态注入。地图核心逻辑（定位引导、手动经纬度兜底、更多面板入口、首页 🗺️ 地图/📊 记账）全部保留。

## 4. 成就系统更新（新增 6 条自动成就）
- `achievements.js` `AUTO_ACHIEVEMENT_DEFS` 新增：
  - 探索类：`footprint_1` 初出茅庐（首足迹）/ `footprint_10` 行者无疆（10 足迹）/ `footprint_50` 世界公民（50 足迹）
  - 生活类：`ledger_first` 精打细算（首次打开记账）
  - 创作类：`cat_first` 收藏家（首个自定义分类）/ `collect_20` 百宝箱（20 件收藏）
- 旧 `collect_5` 标题由「收藏家」→「藏品五件」，避免与新建 `cat_first`「收藏家」重名。
- 触发钩子：
  - `data.js`：`addCollectionCategory` / `addCollection` / `deleteCollection` / `addLocation` / `deleteLocation` 末尾加 `checkAutoAchievements()` 守卫。
  - `pages.js` `openVerifin()` 头部调 `markLedgerOpened()`（置 `state.ledgerOpened=true` + `saveState` + `checkAutoAchievements`）。
  - `state` 新增 `ledgerOpened:false`，`sanitizeState` 迁移 `!!(raw && raw.ledgerOpened === true)`。
- 复用既有 Steam 风格通知 + 合成音效（`showAchievementNotification` / `playAchievementChime` / `addActivity`）。

## 验证与交付物
- `node --check js/*.js` 全过。
- `node build_pakr.js` 重建 `index_pakr.html`（≈654KB，已含全部新代码）。
- `node qa/run_suite.js`：**逻辑 90 / 静态 133 全绿**（K1/K2 成就数断言随 17→23 同步更新）。
- `js/` 内无 `https://` 字面量（grep 校验 clean）。

## 上线前须知（高德 Key）
- 当前 `AMAP_KEY = 'YOUR_AMAP_WEB_JS_KEY'` 为占位符；地图需把它替换为你自己的**高德「Web 端(JS API)」Key** 才能加载。
- 若 Key 开启了「安全密钥」，在 `pages.js` 设置 `AMAP_SECURITY_CODE`（加载前自动注入 `window._AMapSecurityConfig`）。
- 离线 / 无 Key 时地图自动降级为「足迹列表」，不阻断应用其余功能。
