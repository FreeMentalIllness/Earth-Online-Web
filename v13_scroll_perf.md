# 地球Online · v13 主页滚动性能优化

> 目标：解决主页上下滑动卡顿，**保留全部功能与视觉风格**（亮色手账 + 毛玻璃），仅做性能调优。
> 验证基线：逻辑测试 90 passed / 静态检查 133 passed（全绿）；`index_pakr.html` 已重建（659,429 字节）。

## 先核查：v9/v11 已落地的项（无需重复做）

| 方案点 | 现状 | 处理 |
| --- | --- | --- |
| ① 粒子动画 | v9 已移除粒子系统，无 rAF 粒子循环 | 无需改动 |
| ⑦ 进度条 | 已用 `transform: scaleX()` + `transition`（GPU 合成，非逐帧 width） | 已满足 |
| ⑦ 数字滚动 | `animateCounters()` 已是**单个** rAF 批量驱动，且 `__countersDone` 守卫只跑一次 | 已满足，不回退为每数字一循环 |
| ③ 减少 DOM | 世界日志 `slice(0,5)`、最近动态 `slice(-3).reverse()` 已就位 | 已满足 |

## 本次新增/调整（8 点映射）

1. **滚动事件节流（②）**：`app.js` 新增 `setupScrollOptimizer()`，在 `window` 上挂 `{ passive: true }` 滚动监听，rAF 节流只在下一帧挂一次 `.is-scrolling`，停止滚动 300ms 后移除。不阻塞滚动线程。

2. **毛玻璃滚动时降级（⑤，关键收益）**：主页卡顿主因是 `backdrop-filter` 每帧对滚动内容重算模糊（移动端尤甚）。
   CSS 新增 `html.is-scrolling` 规则，滚动期间临时关闭主页毛玻璃元素模糊：
   `.quick-tile` / `.overview-card` / `.memo-input` / `.more-panel` → `backdrop-filter: none`。
   停止滚动 300ms 后自动恢复，**毛玻璃风格不变**。

3. **渲染层合并（⑧）**：移除 `.world-row, .act-row` 上的常驻 `will-change: transform`。
   给每条列表项常驻 will-change 会让浏览器为每行单独建合成层，成百上千条时反而吃内存、拖慢滚动合成（style.css 原有注释已点明此反模式）。入场动画仍由 `.page-enter` 的 `slideInLeft` 驱动，去掉 will-change 仅是少一个提示，不影响动画。

4. **减少 DOM / 查看全部（③）**：主页仅渲染最近 5 条世界日志；超出时新增「查看全部 N 条世界日志 ›」按钮（`data-action="nav" data-page="data"`），跳到数据页（灵感）看完整记录。轻量文字按钮，不新增卡片节点，保留查看能力且不膨胀首页 DOM。

5. **图片懒加载 / 头像压缩（⑥）**：
   - 头像固定宽高：`.hero-avatar` 为 84px 固定圆形容器，内部 `<img>` 已 `width/height:100% + object-fit:cover`，加载完成不引起布局抖动（已满足）。
   - 新增 `compressAvatarIfNeeded()`（`profile.js`）：用户上传 **>200KB** 的位图头像，先降维（最长边 ≤256px、JPEG 0.82）再入库，缩小 localStorage 体积并降低大图解码/缩放对渲染的拖累；SVG/小图/无 canvas 环境安全降级（直接保留原图）。

## 关于方案点④（CSS 硬件加速）的工程取舍

方案原文建议 `#content { will-change: transform; transform: translateZ(0); }`。
**本实现刻意不做**——原因：本应用滚动容器是 `window`，对 `#content` 常驻 `transform`/`will-change` 会使其变成 **backdrop root**，从而令其内**全部后代的 `backdrop-filter` 失效**，即毛玻璃被整体废掉，直接破坏「亮色手账 + 毛玻璃」核心视觉（style.css 第 205–211 行、707–709 行已有同类告诫）。

性能收益改用「滚动时关模糊（⑤）+ 既有 transform/opacity GPU 动画 + rAF 节流滚动监听（②）」达成，二者目标一致且不冲突。若确需 `translateZ` 提升合成，应只对**非毛玻璃祖先**的局部动画元素使用，而非 `#content`。

## 验证

- `node --check js/app.js js/pages.js js/profile.js`：通过
- `node build_pakr.js`：成功，输出 `index_pakr.html`（659,429 字节）
- `node qa/run_suite.js`（cwd=`D:/AI/1`）：逻辑 90 / 静态 133 全绿
  - 静态「无外部网络依赖」通过（未引入任何 `https://` 字面量）
  - 「data-action 95 个全部有分支」通过（新增按钮复用既有 `nav` 分支）

## 移动端（≤768px）

优化对宽度无差别生效（滚动监听与 `.is-scrolling` 规则全局应用）；`@media (max-width:768px)` 断点已存在且未改动。建议在真机/移动模拟器实滑验证流畅度（本环境无法跑真实设备，列为人工验收项）。

## 变更文件

- `js/app.js`：`setupScrollOptimizer()` + `initApp` 调用
- `js/pages.js`：`renderHome` 新增「查看全部」按钮
- `js/profile.js`：`compressAvatarIfNeeded()` + `readAvatarFile` 接入
- `css/style.css`：`html.is-scrolling` 关模糊规则、移除行级 `will-change`、`.world-more` 样式
- `index_pakr.html`：重建
