# v19 七项增量修改交付报告（账号移除 + 体验修正）

> 版本：v19 ｜ 团队：software-earthonline-v19 ｜ 基线：逻辑 **99** / 静态 **147**（新基线，v18 为 99/145）
> 流程：PM 许清楚（PRD）→ 架构师高见远（DESIGN + T1-T5）→ 工程师 v19-engineer（实现 + 返工）→ QA v19-qa（独立验收）

---

## 一、交付结论

**PASS**（经独立 QA 条件通过后，1 项 P1 + 3 项 P2 返工修复，主理人复核全绿）

| 验收项 | 结果 |
|---|---|
| 回归门禁 `node qa/run_suite.js` | 逻辑 **99/99**，静态 **147/147** |
| Edge headless 实测 `node qa/_verify.js` | **39/39**（桌面 24 + 移动 15，无 JS 错误） |
| 迁移专项 `node qa/_verify_migration.js`（QA 新增） | **29/29**（含「旧单键无条件删除」关键用例） |
| 引导页浏览器专项 `node qa/_verify_browser.js`（QA 新增） | **16/16** |
| 残留清理 grep（旧账号函数） | **0 残留**（仅注释提及 hasLegacyArchive） |
| `node --check` 8 个改动模块 | 全部通过 |
| `node build_pakr.js` 重建 | 成功，index_pakr.html = 944,998 字节（UTF-8） |

---

## 二、七项需求逐项验证表

| # | 需求 | 实现要点 | 验证结果 |
|---|---|---|---|
| ① | 账号移除 + 资料融合 | 唯一主键 `earth_data`；account.js 改造保留为 onboarding 模块；`migrateLegacyData()` 聚合迁移（游客 > 会话账号 > 注册表末位 > 旧单键，先写新键后删旧键、幂等、失败保留旧键）；首次启动引导页；设置页「👤 个人资料」卡；WebDAV 全员开放；backup.js 收窄 | ✅ 迁移 5 场景 + 幂等 + 失败兜底全过（29/29）；引导页 8 字段 + 保存写 IDB + birthDate 顶级 16/16 |
| ② | 下拉刷新优化 + 地图禁用 | 去 `toast('已更新')` 改 done 成功态「✓ 已更新」400ms；`savedY` + rAF 恢复滚动位置；地图页 isDisabled（touchstart/touchmove 两处）；`__ptrBound` 幂等守卫 | ✅ 代码审查 + 冒烟确认 |
| ③ | 更多面板位置 | 桌面 absolute top:calc(100%+8px) right:0（实测 panelRight=btnRight、top=btnBottom+8）；移动端 `positionMorePanelSmart()` 按钮旁 fixed + clamp，空间不足回退底部抽屉 | ✅ 桌面 1280px 紧贴右对齐；移动 390px 按钮右下弹出、360px 完整可见 |
| ④ | 地图主动定位 | `locateWithPermission()` 统一入口（granted→定位 / denied→onLocateDenied 升级文案 / prompt→直接弹系统权限）；删除 consent 弹窗全套 + 3 个 data-action | ✅ 三分支代码审查 + 无 map-consent 残留；真机弹窗需打包 APK 验收 |
| ⑤ | 记账弹窗布局 | 三按钮居中、gap12、等宽 `.modal-actions-equal`、min-height 44px、容器+按钮 nowrap、「123云盘下载」→「123云盘」 | ✅ P1 换行已修复：390px 三按钮单行等宽不溢出（截图复核） |
| ⑥ | 状态栏适配 | body safe-area `constant()`/`env()` 双写（iOS 11.0-11.2 兼容）；viewport-fit=cover / theme-color / manifest standalone 已核实 | ✅ 代码就位；**表现需重新打包 APK 真机验收** |
| ⑦ | UI 统一 + 壁纸全局 | §9.1 硬编码色→var() 令牌（P2 残留 4 处 `#d4a373` 已清）；壁纸 body::before 全局铺底、换壁纸 9 导航页背景统一、失败回退 #f8f6f2；`compressWallpaperFile` canvas 压缩（≤1920px / q0.8 / ≤2MB，超限回退原图） | ✅ 无硬编码残留（仅 :root 定义与 var 回退）；1290px 9 页背景统一 |

---

## 三、返工修复清单（QA 发现 → 已修复）

| 严重度 | 问题 | 修复 |
|---|---|---|
| P1 | 移动端记账弹窗按钮文字换行（`.btn` 缺 nowrap） | style.css `.modal-actions .btn` 补 `white-space: nowrap`，390px 复核单行 |
| P2 | 迁移清理未显式删 `earth_online_state_v1`（高优先级键命中时残留） | core.js 清理段追加 `EOStore.remove('earth_online_state_v1')`；迁移专项 b 用例 PASS |
| P2 | 地图定位拒绝文案不一致（denied vs err.code===1） | map.js 统一 code 1 → `onLocateDenied()` 升级文案；code 2/3 保留原「定位失败」 |
| P2 | §9.1 配色残留 4 处 `#d4a373` | style.css 875/884/921/986 → `var(--amber)`（渐变内同步替换） |

---

## 四、改动文件清单

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `modules/core.js` | 改/删/加 | STORAGE_KEY→`earth_data`；删 4 账号常量 + 15 账号函数；新增 `isValidState/countRetainedLegacyAccounts/migrateLegacyData/resolveBootFlow`；profile 增 country/province |
| `modules/account.js` | 改 | 保留文件名，重写为 onboarding 模块（renderOnboardingScreen/buildOnboardingForm/captureOnboardingDraft/handleOnboardingCountryChange/handleOnboardingSave） |
| `modules/app.js` | 改 | `initApp` async（先 `await EOStore.init()` 再分流）；`setupPullToRefresh` done 态 + savedY 恢复 + `__ptrBound`；`toggleMorePanel` + `positionMorePanelSmart` |
| `modules/pages.js` | 改/删/加 | 删 10 个 auth-* case + 3 个 map-consent-* case；新增 onboarding-save case；设置页个人资料卡；showDownloadDialog 文案/等宽；wallpaper-upload 接入压缩 |
| `modules/profile.js` | 改 | 资料页区服国家/省份联动编辑 |
| `modules/webdav.js` | 改 | 删 isGuestAccount 游客禁用分支 |
| `modules/backup.js` | 改 | 收窄为 STORAGE_PREFIX 单前缀 |
| `modules/map.js` | 改/删/加 | 删 consent 全套；新增 `locateWithPermission`；拒绝文案统一 |
| `css/style.css` | 改 | .modal-actions 居中/gap12/nowrap/44px + 等宽；more-panel 智能定位覆盖态；pullRefresh done 态；硬编码→var()；safe-area 双写；.page-map overscroll contain |
| `qa/tests_body.js` | 改 | S1-S6 换 6 个引导/迁移用例；E2/E3/M5 键名改 earth_data；M1 断言更新 |
| `qa/_verify.js` | 改 | 桌面/移动引导页保存流；移动端独立 BrowserContext；更多面板断言改智能定位语义 |
| `qa/_verify_migration.js` | 加 | QA 新增迁移专项（29 断言） |
| `qa/_verify_browser.js` | 加 | QA 新增引导页专项（16 断言） |
| `index.html` / `build_pakr.js` | 改（注释） | #auth-root 语义改引导页容器；文件结构零改动 |

---

## 五、数据迁移说明（老用户无感）

- 老用户打开应用：`resolveBootFlow()` 检测 `earth_data` 缺失 → 自动执行 `migrateLegacyData()` → 按优先级（游客 > 会话账号 > 注册表末位 > `earth_online_state_v1`）取第一份有效存档 → 先写 `earth_data` 再删旧键 → 直接进主页，**无引导页、无感**。
- 幂等：`earth_data` 已有效则迁移不触发；写盘失败保留全部旧键、下次启动重试。
- 多账号：只迁主账号（不合并），其余 `earth_data_{id}` 保留，设置页提示「检测到 N 份旧账号数据已保留」。
- 密码/邮箱不迁移（注册表随删）；如需历史账号快照，升级前先导出一次备份。
- 壁纸独立键 `earth_wallpaper` + `wallpaper_blob`（IDB）**不并入** state，维持现状。

---

## 六、遗留问题与后续项

1. **真机验收（需重新打包 APK）**：需求 ④ 系统定位权限弹窗、需求 ⑥ 状态栏表现、下拉刷新触摸手感、壁纸视觉——桌面/模拟器无法完整覆盖，建议 `build.bat` 打包后在真实 Android 回归。
2. **项目非 git 仓库**：`earth-online/` 与 `D:\AI\1` 均无 `.git`，未做版本提交；如需版本记录需先 `git init`。
3. **QA 新增脚本**：`_verify_migration.js` / `_verify_browser.js` 已落盘 `qa/`，可纳入后续回归常备。
4. **工程师单位口径**：`build_pakr.js` 输出 `bytes=873349` 为 UTF-16 码元，实际文件 UTF-8 字节数 944,998（文件本身正确，仅报告口径差异）。

---

*—— v19 交付 ｜ 2026-09-01 ｜ 团队 software-earthonline-v19 ｜ 主理人汇总*
