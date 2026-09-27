# 地球Online v8 · Pakr 兼容版构建（`index_pakr.html`）

## 完成内容
- **新增交付文件**：`index_pakr.html`（自包含单文件，314KB），即「Pakr 打包修复」的兼容产物。
- **新增构建工具**：`build_pakr.js` —— 将 9 个源 JS（`data/achievements/profile/collections/backup/webdav/stats/pages/app`）合并并降级为 ES5，内联 CSS（`css/style.css`）与 SVG 图标（data URI），输出零外部依赖的单页 HTML。

## 关键技术决策
- **ES5 转译方案**：esbuild 的 `transform`/`build` API 均不支持 `const/let → var` 降级（报错 `Transforming const to the configured target environment ("es5") is not supported yet`），因此改用 `@babel/standalone`（`preset-env` + `targets: { ie:'11' }`）做语法降级（const/let、箭头函数、模板字符串、默认参数等）。
- **运行时垫片**：Babel 不注入运行时 polyfill，故手写 `Object.assign / padStart / repeat / Array.find / findIndex / Array.from / Set` 垫片，覆盖源码中使用的内置方法。
- **运行时 API 说明**：`webdav.js` 的 `Promise` 仅在该功能被调用时触发（云同步），核心功能不依赖；Pakr WebView 若缺失 `fetch/Promise`，仅「WebDAV 云同步 / AI 对话」功能不可用，不影响本地记录核心体验。这是语法兼容层面的修复，符合「不支持 ES6 → 兼容语法版本」需求。

## 验证
- 产物校验：无 `<script src>` 外部引用、`data:image/svg` 图标内联、单 `<style>` 块、ES5 语法（仅剩注释中「class」字样，无 `const/let/=>`/`class{}` 语法）。
- QA 回归：逻辑 83/83、静态 109/109 全绿（未改动源 JS，仅新增打包脚本；`aiConfig`/walmart_egg 等 v8 改动仍满足断言）。

## 文件清单
- `D:\AI\1\earth-online\index_pakr.html` —— 生成的 Pakr 兼容版（双击即用，离线）。
- `D:\AI\1\earth-online\build_pakr.js` —— 重建命令：`node build_pakr.js`（依赖 `C:/Users/FMI/AppData/Local/Temp/pakr-build/node_modules/@babel/standalone`）。

## 备注
- 构建依赖临时目录里的 `@babel/standalone`，若换机器需重新 `npm install`。
- 如需把构建能力在项目内复用，可考虑保存为 skill。
