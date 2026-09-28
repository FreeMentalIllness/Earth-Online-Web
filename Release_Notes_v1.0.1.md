# 地球Online v1.0.1 发布说明

- **版本号**：三端统一 `v1.0.1`（补丁版 · 以修复为主，无新增功能）
- **发布日期**：2026-09-28
- **配套仓库**：`EarthOnline-Web` / `EarthOnline-Android` / `EarthOnline-Desktop`
- **基线**：在 v1.0.0 正式版之上累积的修复与契约一致性改进

---

## 变更汇总

### Web（EarthOnline-Web）
- `fix` 修正 WebDAV 恢复弹窗文案与「零外部依赖」声明（地图修复 Web 部分）
- `fix` 跨端导入还原自定义字段 `customFields`（修复 m2 导入后字段丢失）
- `docs` 收编发布说明与跨端契约测试脚手架到 Web 仓库（`tests/contract/`）
- `ci` 新增可重装 pre-push 钩子模板，推送前自动校验跨端 camelCase 契约

### Android（EarthOnline-Android）
- `fix` 修复地图打不开 / 黑屏：在 `AndroidView` factory 内同步 `onCreate+onResume`，消除生命周期时序竞争
- 版本：`versionCode` 9 → 10，`versionName` 1.0.0 → 1.0.1（保证覆盖安装）

### Windows（EarthOnline-Desktop）
- `feat` 实现「检查更新」：解析 GitHub Release 资产直链，应用内下载并生成 `update.bat` 自动覆盖重启
- `fix` 收紧 JSON 反序列化严格区分大小写，对齐 camelCase 跨端契约

---

## 跨端契约一致性

- 三端 camelCase 字段（`birthDate` / `customFieldsJson` / `tagsJson` / `status` / `doneAt`）的序列化与按主键合并语义现已一致。
- CI `pre-push` 契约校验（camelCase 字段形状）全绿放行。

## 升级说明

- **Android**：`versionCode` 已递增，已装机用户可直接覆盖安装。
- **Windows**：自 v1.0.1 起桌面端具备「检查更新 → 自升级」能力（v1.0.0 的 exe 不含该功能，需手动下载 v1.0.1）。

## 校验

- 三端 `git tag v1.0.1` 已打并推送 GitHub；代码与远端完全同步（ahead=0 / behind=0）。
