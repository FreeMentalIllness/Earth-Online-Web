# 地球Online v1.0.0 发布说明（Release Notes）

> 生成日期：2026-09-28
> 生成角色：项目发布与测试工程师
> 适用范围：Web / Android / Windows 三端

---

## 1. 版本概览

| 项 | 内容 |
|---|---|
| 统一版本号 | **v1.0.0**（Web / Android / Windows 三端对齐） |
| 发布日期 | 2026-09-28 |
| Web 仓库提交 | `8d42c44` `chore: 统一版本号至 v1.0.0`（已推送 `origin/main`） |
| Android 仓库 | 本地 `versionName` / `AppInfo.version` 已为 `1.0.0`，无提交 |
| Windows 仓库 | 本地 `<Version>` 已为 `1.0.0`，无提交 |

---

## 2. 本版变更

### 2.1 版本号统一（核心变更）
- **Web 端**：`APP_INFO.version` 由 `1.0.1` 修正为 `1.0.0`。
  - 源文件：`EarthOnline-Web/modules/core.js`（L140）
  - 打包产物同步：`EarthOnline-Web/index_pakr.html`（L4407，精准替换 APP_INFO 版本行）
- **Android 端**：`versionName`（`app/build.gradle.kts` L25）与 `AppInfo.version`（`ui/settings/AppInfo.kt` L23）复核确认已为 `1.0.0`，**无改动**。
- **Windows 端**：`<Version>`（`EarthOnline-Desktop.csproj` L13）复核确认已为 `1.0.0`，**无改动**。
- **CHANGELOG 历史条目**（含 `1.0.1`）按约定保留，不回溯修改，仅确保当前 `version` 常量统一为 `1.0.0`。

### 2.2 本次明确未含（按约束）
- 未调整任何业务逻辑、UI、WebDAV 合并语义。
- 未引入任何新依赖；未运行 `build_pakr.js`（沿用精准替换方案，待 babel 环境正本清源）。
- 未执行任何 `git push --force` / `-f` 强制推送。

---

## 3. 交付与同步

- **Web 提交与推送**：
  - 提交：`8d42c44 chore: 统一版本号至 v1.0.0`（仅改 `modules/core.js`、`index_pakr.html` 各 1 行版本字符串）。
  - 推送：普通 `git push origin main` 成功，范围 `8df83f3..8d42c44 main -> main`。
  - 推送后状态：`main` 与 `origin/main` 均为 `8d42c44`，工作树干净。
- **环境说明**：本沙箱默认出口 HTTPS 被 TLS 拦截（OpenSSL `unexpected eof`），Git 推送需关闭沙箱才能出网；该限制为环境特性，不影响产物正确性。
- **仓库更名**：GitHub 提示 `Earth-Online-Web.git` 已更名为 `EarthOnline-Web.git`（去连字符），已同步本地 remote URL，避免后续每次推送报 "repository moved"。
- **Android / Windows**：本地已为 `1.0.0`，无需额外提交。

---

## 4. 已知事项与后续

- **交接文档基线**：工作区内不存在文件名含「交接」/「handover」的文档，亦无任何文件将 `v0.9.9` 作为版本基线。该文档需相关方**手动**将其版本基线由 `v0.9.9` 更新为 `v1.0.0`。
- **跨端序列化兼容性（已启动）**：基于审计报告指出的风险，已启动「跨端备份兼容性契约测试」，验证 Web 导出 JSON → Android/Windows 按主键合并的正确性，重点断言 `tagsJson` / `customFieldsJson` / `birthDate` 的 camelCase 与归一化规则三端一致，并评估收紧 Windows 端 `CaseInsensitive` 配置的可行性（详见 `EarthOnline-Tests/`）。
- **WebDAV 恢复文案不一致**（审计遗留）：Web 端 `webdav.js` 恢复确认框写「将覆盖当前所有本地数据」，而真实合并语义为按主键合并；建议后续统一文案，不在本版处理。

---

## 5. 兼容性声明

- 三端 JSON 字段采用 camelCase；Windows 端以 `[JsonPropertyName("camelCase")]` 显式标注，Android 端 kotlinx `@Serializable` 默认 camelCase，Web 端 JS 对象天然 camelCase。
- 三端 WebDAV 导入均按主键合并（Web `mergeByPrimaryKey` / Windows `Upsert` / Android `@Insert(onConflict=REPLACE)`），冲突策略统一为按 `exportedAt` 修改时间比较。
- 跨端备份互通的字段级契约测试为新增保障，详见第 4 节。
