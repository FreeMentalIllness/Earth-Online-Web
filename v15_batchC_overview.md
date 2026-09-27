# 地球Online · v15 新功能批（Batch C）

> 21 项综合升级的分批交付第三波（收尾）。聚焦**新功能**：任务到期通知、人生时间轴与人生卡片、收藏文件类型扩展。
> 验证：`node qa/run_suite.js` **逻辑 90 passed / 静态 138 passed**（全绿）；`index_pakr.html` 已重建（693,628 字节）。
> 至此 21 项全部落地（ES Modules 与 exe/apk「拉起系统应用」两项按既定方案处理：保持经典脚本 / 能力分级下载）。

## 本批交付

### 17. 任务到期提醒（Web Notification）
- 数据模型**此前已具备**：任务 `dueDate`（YYYY-MM-DD）+ 任务弹窗 `tmDue` 日期输入 + 主页到期标签（`pages.js` 早已渲染）。本项补齐**到期当天推送**。
- 新增 `app.js` `pushDueNotifications()` / `checkDueNotifications()`：`startMainApp` 首帧后调用，找出「今天到期且未完成」的 To Do 任务，已授权则推送 `Notification`。
- 权限处理符合浏览器规范：**自动请求只发生在用户手势内**（设置页「到期提醒」开关被点击时 `Notification.requestPermission()`），避免无手势弹窗被拦截；被拒绝 Toast「通知提醒已开启（未授权…）」或「通知权限被拒绝，请在浏览器设置中开启」。
- 设置页「🎨 外观」卡片新增「到期提醒」开关（`data-action="notify-toggle"`），偏好存 `localStorage.earth_notify`（默认开）。

### 21. 人生时间轴 + 人生卡片（主页）
- 主页新增「🕰️ 人生时间轴」卡片：聚合**任务完成（doneAt）/ 成就解锁（unlockedAt）/ 足迹标记（date）**三类事件，按年份分组、时间倒序，取最近 16 条（控制首页 DOM，符合「减少 DOM」基调）；空态有引导文案。
- 主页新增「🌍 人生卡片」：展示 **等级 Lv. / 成就数 / 足迹数 / 任务完成率** 四项核心数据。
- 「📤 分享人生卡片」按钮（`data-action="life-card-share"`）：`shareLifeCard()` 用 canvas 绘制 PNG 并触发下载，同时把文字摘要复制到剪贴板；canvas 不可用（极老内核）降级为仅复制文字。纯前端零依赖，`file://` 与 `http` 均可运行。

### 11. 收藏文件类型扩展（能力分级）
- `index.html` 收藏附件选择框 `accept` 扩展至：**图片 / 音乐 / 视频 / PDF / 文档（docx/xlsx/pptx/txt/csv）/ 压缩包 / exe / apk** 等。
- `collections.js` 打开逻辑按能力分级：
  - 图片 / 音频 / 视频 → 应用内 `<img>/<audio>/<video>` 预览播放；
  - **PDF → 新增 `<iframe>` 内嵌预览**（新增 `.file-preview-pdf` 样式）；
  - **exe / apk / msi / dmg 等 → 如实告知「网页无法自动运行/安装，将下载到本地由你手动处理」**，按钮文案随类型切换为「⬇️ 下载到本地」；其它未知类型走「系统默认程序打开」（被拦截时浏览器自动下载）。
  - 完全符合「网页沙箱无法拉起系统应用」的现实约束（此前已与用户确认此分级方案）。

## 变更文件
- `js/app.js`（`checkDueNotifications`/`pushDueNotifications` + `startMainApp` 调用）
- `js/pages.js`（设置页到期提醒开关 + `notify-toggle` 分支；主页时间轴/人生卡片 + `life-card-share` 分支；`shareLifeCard` canvas 函数）
- `js/collections.js`（`openCollectionFile` PDF 分支 + exe/apk 分级提示）
- `css/style.css`（`.timeline`/`.tl-*`、`.life-card`/`.lcs`、`.file-preview-pdf`）
- `index.html`（收藏附件 `accept` 扩展）
- `index_pakr.html`（重建）

## 验证
- `node --check` 三文件全过（app.js / pages.js / collections.js）
- `node qa/run_suite.js`：**逻辑 90 / 静态 138** 全绿（data-action 全部有分支，含 notify-toggle/life-card-share）
- `node build_pakr.js` 重建成功（693,628 字节），ES5 包含时间轴/人生卡片/通知开关/PDF 预览

## 21 项总览（v15 全三批）
- **A 批（体验增强）**：1 下拉刷新、4 底栏样式、12 日历修复、14 游戏化文案、20 语音输入
- **B 批（视觉/架构）**：15 IndexedDB 适配层、16 深色模式、18 自定义壁纸
- **C 批（新功能）**：17 任务到期通知、21 人生时间轴与人生卡片、11 收藏文件类型扩展
- **既有（v3/v10/v12/v13/v14 已落地，本回合对账）**：2 返回导航、3 状态栏、5 更多面板顺序、6 主页标题+概览、7 签名+自定义字段、8 记账 123云盘、9 高德地图、10 定位权限、13 AI 页、19 ES Modules（决议保持经典脚本）
- 交付说明：`v15_batchA_overview.md` / `v15_batchB_overview.md` / `v15_batchC_overview.md`
