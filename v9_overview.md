# 地球Online · v9 八项优化总览

> 在 v8（背包/收藏自定义分类 + AI 助手 + Pakr 兼容版）之上进行。本轮只动界面与状态，**不动 v8 的 AI/收藏/Pakr 构建链路**，全部变更通过 QA（逻辑 83/83 + 静态 118/118）。

## 1. 移动端底部 4 Tab + 「更多」面板

| 项 | 改动 |
| --- | --- |
| `MOBILE_TABS` | `['home','tasks','backpack','data']` → `['home','tasks','backpack','ai']`（用户偏好"🤖 系统"占第 4 位） |
| 既有「更多」面板 | 沿用底部 ☰（功能上等价"右上角更多按钮"——移动端侧栏已隐藏，底部最右的 ☰ 充当"其余页面入口"，且桌面导航未受影响） |
| 触控尺寸 | `.tab-btn/.tab-more` min-height **52px**；`.tab-sheet-item` min-height **44px** |
| 桌面端 | 左侧导航不变 |

> 决策说明：项目本就有 `tabbar + tabMoreSheet` 完整闭环，没有 mobile header 区。如果另加"右上角"按钮会和底部 ☰ 重复，UX 上更冗余而非更好；保持现状并在概览里说清楚。

## 2. 全局动态移除

- 删除 `js/pages.js` 的 `initParticles()` + `reportFrame()` 整段（用 Python 按行精准切片，比大块 Edit 稳）。
- 删除 `index.html` 的 `<canvas id="bg-canvas">` 与 `<div id="fpsMeter">`。
- 删除 `css/style.css` 的 `#bg-canvas`、`.fps-meter`、移动端 `.fps-meter` 三处规则。
- `animateCounters()` 加 `__countersDone` 守卫：**只在首次加载**从 0 滚到目标值，后续切页直接落终值，不再启 rAF。
- 保留微交互：hover translateY、按钮 `:active` 反馈、进度条 `transform: scaleX()` 填充、卡片圆点 pulse。

## 3. 开屏遮罩 #splash

- **位置**：`index.html` 中作为 `<body>` 的第一个子元素（先于 `#app`），首帧即盖住未渲染内容。
- **内容**：`🌍` 72px → 「地球 *Online*」标题 → 「人生记录 · 加载中」→ 不确定进度条。
- **CSS**：固定全屏、z-index **10000**、背景 `#f8f6f2`、`.splash-bar-fill` 用 1.1s 滑动循环表达"进行中"。
- **淡出**：`hideSplash()` 切 `.splash-hidden` class → 0.5s opacity transition → 600ms 后 `removeChild`。
- **四重兜底**：① initApp 收尾；② `window.load`；③ 3s `setTimeout`；④ CSS 6s `splashFailsafe` 动画。脚本异常也不会把界面永久挡死。
- **入场只动 opacity，不动 transform**（memory 约束：常驻 transform 会成为 backdrop root，未来若遮罩内用毛玻璃会全部失效）。

## 4. 图标 SVG → PNG

- `icons/icon.svg`（512 viewBox）→ `icons/icon.png`（192×192, 7.6KB）+ `icons/icon-512.png`（512×512, 24KB）。用 `sharp@0.33.5`，SVG 渲染取 `density:384` 以保边缘清晰。
- `index.html` 头加 `<link rel="icon" type="image/png" sizes="192x192" href="icons/icon.png">` + `<link rel="apple-touch-icon">`；SVG 保留作为兜底。
- `manifest.json` 的 icons 数组改为 PNG 在前（192/512）、SVG 兜底。
- **Pakr 模板**同步用 PNG data URI 内联（Pakr 的 WebView 对 SVG 图标支持不稳定，会静默回落到系统默认图标——表现"图标没生效"且无报错，PNG 是它明确支持的格式）。

## 5. 锁定视口缩放

`<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">`

手账风格排版按 CSS 像素设计，双指缩放会破坏固定底栏与卡片栅格——索性禁掉。Pakr 模板同步。

## 6. 日历直接写 ToDo / 灵感

**新交互**：点击日期 → 弹模态（不在内联文本框里写）。

模态结构：
- 标题：`✍️ 2026-08-29 · 写点什么`
- 类型：cat-chip 二选一 → **📝 灵感** / **✅ ToDo**（切换会同步占位文案 + 自动把光标送回输入框）
- 内容：多行 textarea（4 行，500 字上限）
- 按钮：取消 / 保存

保存行为：
- 灵感 → `state.calendarNotes[date] = text`（圆点检测据此点亮）
- ToDo → `createTask({ category: 'todo', title: text, dueDate: date, status: 'planning' })` + `checkAutoAchievements()` 触发可能的"创建首条 To Do"成就

**聚焦修复**：
- `focusCalendarEntry()` 用 `requestAnimationFrame(() => ta.focus())` 把聚焦推到下一帧，避开模态入场动画期间的布局抖动（这是"点输入框没光标、软键盘不弹"在 WebView/Pakr 上最常见的根因）。
- `rerenderCalendarHost()` 取代 `renderCalendar()`：若当前在「数据」页的日历视图，重新走 `refreshCurrentPage()` 渲染，避免点击日期把用户甩到独立日历页。
- z-index 检查：`.modal-overlay` 100、`.toast` 200、`.tabbar` 900、`.ach-notify` 9999，模态正常处于内容之上。

## 7. 命名统一

| 旧 | 新 | 位置 |
| --- | --- | --- |
| 任务指引 | 任务 | `app.js PAGES.tasks` / `pages.js` 任务页标题 / 主页统计 / 快速入口 |
| 背包装备 | 背包 | `app.js PAGES.backpack` / 主页统计 / 背包页标题 / 成就 desc (`gear_10`)/ `manifest.json` description |
| AI 助手 / AI | 系统 | `app.js PAGES.ai` / AI 页标题 / 主页快速入口 |
| 添加装备 | 添加 | 背包页按钮 / 物品弹窗标题 / 主页 nav 标题 |

## 8. 背包分类优化

### 数据层改造
- **修正既有 bug**：`defaultState().itemCategories = []` 导致「首次启动注入默认分类」永远不生效（`Array.isArray([])` 为真，else 分支死代码）。改为 `defaultItemCategories()` 直接带预设。
- **新默认预设**：`["装备","道具","收藏","其他"]`（替代 v8 的 `["虚拟物品","实体物品"]`）。
- **旧数据迁移**：`migrateLegacyItemCategories(result)` 检测到 `cat_virtual` / `cat_physical` 时：
  1. 把旧分类下的物品 `category` 改到新目标分类（`虚拟物品→装备`、`实体物品→道具`）；
  2. 不存在则就地创建（uid 全新 id，避免与用户已有分类撞车）；
  3. 再把旧分类条目过滤掉。
  
  只对 `id` 命中（不认用户自建的名字"虚拟物品"），保守安全。

### 物品弹窗改造
- 移除 `imType` 下拉（**两个都标"分类"** 是 v8 留下的 UI 漏洞，固定枚举也背离"自定义"目标）。
- 改为「下拉选择 + 新建分类输入」组合：
  - 下拉 `imCategory`：未分类 + 自定义分类列表。
  - 输入框 `imNewCat`：留空时以下拉为准；填了则 `resolveOrCreateItemCategory(name)`：
    - 已存在同名分类 → 复用其 id（用户手打与下拉重合不应该报错）。
    - 不存在 → `createItemCategory()` 新建。
- 同步 `addItem/updateItem` 不再传 `type`（data 字段保留做兼容但不再写入）。

### 卡片徽章改造
- `renderItemCard` 的徽章从 `ITEM_TYPE[item.type]`（虚拟/实体）改为显示自定义分类名。
- 复用 `.badge-cat`（amber 调）与 `.badge-none`（中性灰）两个新类。
- `item.type` 字段保留做数据兼容，新 UI 不再决定呈现。

## QA 验证

| 项 | 数 | 说明 |
| --- | --- | --- |
| 逻辑测试 | **83/83** PASS | 含 sanitize、备份、WebDAV、成就删除/重置/恢复 |
| 静态检查 | **118/118** PASS | 含新增的 `icons/icon.png` 文件存在性、PNG 192/512 声明、`splash` 字符串、`badge-cat` 类使用、命名一致性等 |

## 关键工程经验（同步写入今日 memory）

1. **delete-by-line Python 比大块 Edit 稳**：JS 多函数文本里精确删大段（粒子 + FPS 两块），用 `io.open(...).readlines()` + 切片一行不差。
2. **Pakr WebView SVG 图标静默失效**：必须 PNG。`sharp@0.33.5` 已就位 `C:\Users\FMI\AppData\Local\Temp\pakr-build\node_modules`。
3. **Pakr 模板漏元素**：本次顺手补了 `build_pakr.js` 漏掉的 `#collectionFileInput`（隐藏 input 必须持久挂载，WebView 不支持动态 createElement）。
4. **`Array.isArray([])` 是真值**——「key 缺失才注入默认」对"默认状态已写 []"的项目无效。
5. **模态输入框无光标**：rAF/setTimeout 推到下一帧。
6. **splash 不要用 transform 动画**：常驻 transform → backdrop root → 毛玻璃失效。

## 交付物

- 源码改动：`index.html` / `css/style.css` / `js/data.js` / `js/pages.js` / `js/app.js` / `manifest.json` / `build_pakr.js`
- 新增资产：`icons/icon.png` (7.6KB, 192×192) / `icons/icon-512.png` (24KB, 512×512)
- 重新生成 `index_pakr.html` (352KB, ES5 自包含单文件，含 PNG 内联图标)
- 概览：`v9_overview.md`（本文件）
