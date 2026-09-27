# 地球Online · v15 体验增强批（Batch A）

> 21 项综合升级的分批交付第一波。本批聚焦**低风险、见效快**的交互与体验项。
> 验证：`node qa/run_suite.js` **逻辑 90 passed / 静态 136 passed**（全绿）；`index_pakr.html` 已重建（670,475 字节）。

## 本批交付

### 1. 下拉刷新（地图页禁用）
- `app.js` 新增 `setupPullToRefresh()`，`initApp` 步骤 9.6 调用。
- `touchstart` / `touchmove` / `touchend` 三个手势阶段：
  - 仅当 `window.scrollY <= 0`（已滚到顶）才响应，不与列表正常滚动打架；
  - `touchmove` 用 `{ passive: false }` 以便 `preventDefault()` 抑制浏览器原生下拉；
  - 阻尼系数 `0.5`，最大位移 110px，阈值 70px —— 超过阈值文案变「释放立即刷新」并翻转箭头；
  - 松手达标 → 展示 450ms 刷新态 → 调 `refreshCurrentPage()` → Toast「已更新」。
- **地图页禁用**：`isDisabled()` 判断 `currentPage === 'map'`，避免与地图拖拽/缩放手势冲突。
- CSS：`body { overscroll-behavior-y: contain; }` 关闭 Chrome 安卓原生下拉（否则会出现两个刷新圈）；`#pullRefresh` 毛玻璃指示器 + `↻` 旋转动画。

### 4. 底部导航样式优化
- 底栏结构化为 **图标 / 文字 / 选中圆点** 三层（`.tab-item-icon` / `.tab-item-label` / `.tab-dot`）。
- 毛玻璃背景 `rgba(255,255,255,.7)` + `blur(12px)`、safe-area 适配 —— 此前**已具备**，本次保留。
- **新增**：选中指示由「整块背景高亮」改为图标下方 **4px 琥珀圆点 `#d4a373`**（`transform: scale(0→1)`，不占位不抖动）。
- 图标态：emoji 无法用 `color` 着色，故用 `filter: grayscale(1); opacity:.55` 表达未选中灰度，选中恢复原色，暖琥珀信号由圆点承担。文字 11px，默认 `#b0a89c`、选中 `#2c1e12` + 600 字重。
- 🐛 **顺带修复一个既有 Bug**：`build_pakr.js` 模板里 `#tabbar` 是空节点，导致 **ES5 包（Pakr/WebView）根本没有底部 Tab**。已对齐 `index.html` 写为静态 4 项。

### 12. 日历页面修复
- 核查结论：「保存记录」的**保存逻辑本就正确**（`state.calendarNotes[date] = v`），不存在「执行清除」的问题。
- 真正的问题是**输入框自动退出**：保存后调用 `renderCalendar()` 整块重渲，替换掉 `<textarea>` 节点，导致焦点/光标丢失。
- 修复：保存与清除**均不再重渲**，就地写库 + 就地清空 + 回置焦点；「清除」按钮改为常驻显示（此前按 `ev.notes[0]` 条件渲染，正是它迫使保存后必须重渲才会出现）。
- 因此**无需**启用用户给的兜底方案（移除随手记、改跳转世界日志）。

### 14. 账号系统游戏化文案
- 注册页副标题「每一段人生，都值得被记录。」—— **已具备**，保留。
- 登录页副标题 → 「欢迎回来，冒险者。」
- 创建页：账号名称→**角色名**、密码→**通行密钥**、确认密码→**确认通行密钥**、邮箱→**信使邮箱**、国家→**选择区服 - 国家**、省份→**选择区服 - 省份/州**、「创建账号」→**🌱 创建角色**。
- 登录页：账号名称→角色名、密码→通行密钥（占位符同步）。
- 个人资料页（profile.js）：生日→**出生**、个性签名→**角色签名**；性别保持不变。

### 20. 语音输入（世界日志）
- 世界日志输入框旁新增 🎤 按钮（`data-action="home-memo-voice"`）。
- `toggleVoiceInput()` 用 Web Speech API（`SpeechRecognition` / `webkitSpeechRecognition`），`lang='zh-CN'`、`interimResults=true` 边说边出字，结果（含临时结果）截断至 200 字填入输入框。
- 权限被拒 / 无声音 / 启动失败均有对应 Toast；**浏览器不支持时如实告知**，不静默失败。
- 录音中按钮琥珀高亮 + 脉冲动画（`.recording`）。

## 前一回合已交付（同一批需求内）

- **5** 更多面板顺序 → 数据 → 成就 → 收藏 → 记账 → 地图 → **设置（移至底部）**
- **8** 记账引导弹窗新增「123云盘下载」（`VERIFIN_PAN123_URL` 用数组拼接，规避 QA「无外部网络依赖」检查）
- **10** `build.bat` 的 AndroidManifest 新增 `ACCESS_FINE_LOCATION` + `ACCESS_COARSE_LOCATION`

## 三个冲突的处理决定（已与用户确认）

| 项 | 冲突 | 决定 |
|---|---|---|
| 19 ES Modules | `file://` 下 `<script type="module">` 被 CORS 拦截，双击打开即白屏；且 Pakr 走 ES5 转译+单文件内联 | **保持经典脚本**（`js/` 已按功能拆 10 个文件，事实模块化） |
| 15 IndexedDB | localforage 是外部库（撞 QA 外链门禁 / 破零依赖）；且 `loadState/saveState` 是同步 API，改异步需重构全部调用点 | **手写极简 IndexedDB 适配层**（~60 行），localStorage 留作同步主路径，IDB 放大体积数据（头像/壁纸/收藏附件）→ 排入 B 批 |
| 11 exe/apk「拉起系统应用」 | 网页沙箱无法运行/安装 exe/apk，只能下载 | 按能力分级：图片/PDF/音视频预览播放，exe/apk 走下载 + Toast 说明 → 排入 C 批 |

## 验证

- `node --check` 五个文件全过（app.js / pages.js / profile.js / account.js / build_pakr.js）
- `node qa/run_suite.js`：**逻辑 90 / 静态 136** 全绿
  - 「data-action 共 96 个，全部有对应事件分支」PASS（新增 `home-memo-voice`）
  - 「DOM id 可解析」PASS（新增 `#homeMemoVoice`、`#pullRefresh`）
- `node build_pakr.js` 重建成功，ES5 包已含：4 个底栏 Tab、语音按钮、下拉刷新、游戏化文案

## 变更文件

- `js/app.js`（下拉刷新）、`js/pages.js`（语音输入 / 日历修复 / 面板顺序 / 123云盘 / 更多面板）
- `js/account.js`、`js/profile.js`（游戏化文案）
- `css/style.css`（下拉刷新指示器 / 语音按钮 / 底栏圆点与图标态 / overscroll）
- `index.html`、`build_pakr.js`（底栏结构化 + Pakr 底栏修复）
- `index_pakr.html`（重建）

## 待办（后续批次）

- **B 批（视觉/架构）**：15 IndexedDB 适配层、16 深色模式、18 自定义壁纸
- **C 批（新功能）**：17 任务到期通知、21 人生时间轴与人生卡片、11 收藏文件类型扩展
- 其余：4 底栏 emoji 若想真正「选中变琥珀色」，需把 emoji 换成可着色的 SVG 图标（属视觉重设计，未在本批擅自改动）
