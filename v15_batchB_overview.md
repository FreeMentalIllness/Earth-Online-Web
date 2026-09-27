# 地球Online · v15 视觉/架构批（Batch B）

> 21 项综合升级的分批交付第二波。聚焦**视觉与持久化架构**：深色模式、自定义壁纸、IndexedDB 适配层。
> 验证：`node qa/run_suite.js` **逻辑 90 passed / 静态 138 passed**（全绿）；`index_pakr.html` 已重建（682,496 字节）。

## 本批交付

### 15. IndexedDB 适配层（手写，零外部库）
- 新建 `js/storage.js`：`EarthIDB` 全局对象，封装 `openEarthDB / idbGet / idbSet / idbDel`（全部 Promise 异步）。
- 设计原则（与用户确认）：**localStorage 保持同步主路径不变**，IndexedDB 仅放大体积二进制（壁纸图片 / 头像 / 收藏附件），避免 5MB 配额异常；不引入 localforage（破零依赖 + 撞 QA 外链门禁）。
- IndexedDB 原生支持 Blob 存储，图片直接 `put(file)`，无需 base64 二次膨胀。
- WebDAV / 同步契约等不受影响；旧用户 localStorage 数据零迁移、自动兼容。

### 16. 深色模式
- `css/style.css` 新增 `[data-theme="dark"]` 块，仅覆盖语义令牌（背景 `#1a1a1a` / 卡片 `#232326` / 文字 `#e4e4e7` + 全套 amber/边框/毛玻璃/阴影映射），组件全部 `var()` 取色 → 一处覆盖全局生效。
- 顺手修复少量写死白的实面在深色下的刺眼问题：`.modal` / `.pwa-tip` / `.loc-row` / `.file-badge:hover` 跟随 `--panel`。
- 设置页新增「🎨 外观」卡片：亮色 / 深色分段开关（`data-action="theme-set"`）；偏好存 `localStorage.earth_theme`，`startMainApp` 首帧前 `applyTheme()` 应用，无闪烁。

### 18. 自定义壁纸
- 设置页「外观」卡片：🖼️ 上传图片（走 `<input type=file>` → `EarthIDB.idbSet('wallpaper_blob', file)`，不占 localStorage）；4 个预设渐变（暖阳/暮山/晨雾/墨夜，`data-action="wallpaper-preset"`）；「恢复默认」清除（`data-action="wallpaper-reset"`）。
- 应用方式：`body::before` 固定铺满视口、置于内容之下纸纹之上（`z-index:0`，`#app` 为 `z-index:1`）。无壁纸时 `--wallpaper-url` 为 `none`、纸纹正常显示；有图时覆盖纸纹、透出在卡片间隙，亮/暗均可用。
- 偏好配置存 `localStorage.earth_wallpaper`（小 JSON），图片 Blob 存 IDB；离线 / IDB 不可用静默忽略。

## 变更文件
- `js/storage.js`（新增 IDB 适配层）
- `js/app.js`（`applyTheme` / `applyWallpaper` + `startMainApp` 调用）
- `js/pages.js`（设置页「外观」卡片 + 4 个 data-action 分支）
- `css/style.css`（深色变量块 + 壁纸层 + 分段/预设样式 + 写死白面深色修正）
- `index.html`、`build_pakr.js`（加载 `js/storage.js`）
- `qa/run_suite.js`（SRC_FILES / allJs 纳入 `js/storage.js`）
- `index_pakr.html`（重建）

## 验证
- `node --check` 四个文件全过（app.js / pages.js / storage.js / build_pakr.js）
- `node qa/run_suite.js`：**逻辑 90 / 静态 138** 全绿（data-action 100 个全有分支，含 theme-set/wallpaper-*）
- `node build_pakr.js` 重建成功，ES5 包含 storage.js / 外观卡片 / 深色变量

## 待办（后续批次）
- **C 批（新功能）**：17 任务到期通知（Web Notification）、21 人生时间轴与人生卡片、11 收藏文件类型扩展（exe/apk 走下载分级）
- 其余：底栏 emoji 选中色（需替换可着色 SVG 图标）仍属可选视觉重设计
