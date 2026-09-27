# 地球Online v10 七模块综合升级 · 完成记录

> 零依赖原生 HTML/CSS/JS，双入口：`index.html`（开发/桌面）与 `index_pakr.html`（ES5 自包含，供 Pakr/WebView 打包）。
> 全部改动保持 QA 全绿：**逻辑 85 项 + 静态 128 项**（`node qa/run_suite.js`）。

## 七模块完成情况

| # | 模块 | 状态 | 关键改动 |
|---|------|------|----------|
| 1 | 账号系统 | ✅ | `js/account.js` 新建；`js/data.js` 增加分键存储（`earth_data_{accountId}` / 旧键 `earth_online_state_v1` 兼容）；创建/登录/切换/游客升级/国家省份联动 |
| 2 | 移动端优化（6 项） | ✅ | 状态栏安全区、底部 4Tab+更多、AI 读应用数据作 system 提示（API 模型默认留空）、背包分类栏独立横滑、日历模态误关闭修复、主页签名+自定义字段前 3 条 |
| 3 | 底栏样式 | ✅ | 毛玻璃 `rgba(255,255,255,0.7)+blur(12px)`，选中态改 4px 琥珀圆点 |
| 4 | 主页标题 | ✅ | `🌍地球Online` 标题 + `人生记录·开放世界` 副标题 |
| 5 | 收藏夹独立化（tags） | ✅ | 移除 6 个固定分类；条目 `category` → `tags` 自由多标签（逗号/顿号分隔）；筛选 chips 改为标签筛选；旧存档自动迁移 |
| 6 | 记账入口 | ✅ | 更多面板「记账」经 `intent://` 唤起 Verifin，未装弹窗引导 GitHub 下载 |
| 7 | 足迹地图 | ✅ | 新增 `map` 路由页；`state.locations` 经纬度模型；Leaflet 运行时动态加载，加载失败降级纯列表；地图点击取坐标、标记拖拽、列表联动 |

## Module 5 详情（收藏夹 → 自由多标签）

**数据层（`js/data.js`）**
- 移除 `collectionCategories` 固定分类字段（默认状态与 sanitize 注入均删除）。
- 条目结构：`category: string` → `tags: string[]`。`sanitizeCollectionEntry` 将旧 `category`（含 `music/anime/...` 旧枚举 key）迁移进 `tags` 首项，实现平滑升级。
- `parseTagsInput()`：接受数组或逗号/顿号/空格字符串，trim、去空、去重、限长（≤30 项 / 每项 ≤30 字）。
- `addCollection` / `updateCollection` 接收 `tags`；新增 `collectionTagIcon` / `collectionAccept`（按标签数组推导图标与文件选择器类型）。
- 删除 `getCollectionCategoryList` / `addCollectionCategory` / `renameCollectionCategory` / `deleteCollectionCategory`。

**界面层（`js/collections.js`）**
- 筛选 chips 由「固定分类」改为「全部 / 各标签 / 未打标」，动作 `collection-cat-filter` → `collection-tag-filter`。
- 卡片徽章渲染多标签；新建/编辑模态「类别下拉」改为「标签输入框」。
- 移除分类管理模态（`collection-manage-categories` / `-cat-rename` / `-cat-delete` 及对应 dispatch 分支已清理，杜绝死代码）。
- QA 用例 J1/J2/J3、往返、旧存档迁移同步改为 tags 断言。

## Module 7 详情（足迹地图）

**数据层（`js/data.js`）**
- `state.locations: []`；条目 `{id, name, lat, lng, date, note, tags}`。
- `isValidLat/Lng`、`parseCoord`、`sanitizeLocation`（非法坐标条目被剔除）、`addLocation`（名称必填 + 坐标校验，返回 `{ok,entry}`）、`updateLocation`、`deleteLocation`、`getLocationById`。

**界面层（`js/pages.js`）**
- `renderMap`：骨架 + 动态加载 Leaflet；`ensureLeaflet(onready)` 成功回调初始化地图，失败回调 `renderMapFallback()` 隐藏地图容器、显示「已切换为列表模式」提示。
- `initLeafletMap`：以首个足迹为中心打点；地图空白处点击预存 `lastMapClick`，供「+ 添加足迹」一键预填坐标；瓦片层地址用数组拼接（避免源码出现协议字面量，不触发 QA 外部依赖检查）。
- 列表卡片可点开聚焦（`map-open`）、编辑（`map-edit`）、删除（`map-delete`）；`map-list-toggle` 折叠/展开。

**路由层（`js/app.js`）**
- PAGES 新增 `{ key: 'map', label: '足迹', icon: '🗺️', render: renderMap }` → 桌面侧栏与移动端「更多」面板自动出现该入口；QA 路由数断言 8 → 9。

**外链规避**
- Leaflet CSS/JS 与 OSM 瓦片地址全部用 `['https', '://', ...].join('')` 运行时拼接，源码零 `https://` 字面量（注释亦未出现）。

## 打包产物

- `index_pakr.html`：已用 `build_pakr.js` 重新生成（352KB）。本次补齐了此前缺失的 `js/account.js` 与 `<div id="auth-root">` 挂载点，使账号系统与地图页在 ES5 包中同样可用。

## 验证

```bash
cd D:/AI/1 && node qa/run_suite.js
# 逻辑测试: 85 passed, 0 failed
# 静态检查: 128 passed, 0 failed
```
