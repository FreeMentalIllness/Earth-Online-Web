# 地球Online 跨端备份兼容性契约测试

> 目标：验证「Web 导出 JSON → Android / Windows 按主键合并」的正确性，
> 重点保证 `tagsJson` / `customFieldsJson` / `birthDate` 的 camelCase 与归一化规则三端一致。
> 本目录为**纯新增**测试脚手架，不修改任何现有业务代码、UI 或 WebDAV 合并语义。

---

## 1. 背景与风险（来自审计报告）

- 三端 JSON 字段约定 camelCase，但仅靠**注释约定**保证逐字一致，无自动化校验。
- Windows 端 `BackupService.Opts` 与 `ProfileService` 解析 `CustomFieldsJson` 时启用了
  `PropertyNameCaseInsensitive = true`，可能**掩盖**大小写漂移，直到换端才暴露。
- WebDAV 恢复弹窗文案（「将覆盖当前所有本地数据」）与真实「按主键合并」语义不一致（仅 UI 文案问题，功能合规）。

## 2. 三端真实字段名（已核对源码，作为契约依据）

| 字段 | Web（导出/state） | Android 实体 | Windows 实体 |
|---|---|---|---|
| 生日 | `state.birthDate`（顶级，YYYY-MM-DD 或 `""`） | `ProfileEntity.birthDate` | `[JsonPropertyName("birthDate")] BirthDate` |
| 自定义字段 | `profile.customFields[]`（数组） | `ProfileEntity.customFieldsJson`（JSON 串） | `[JsonPropertyName("customFieldsJson")] CustomFieldsJson`（JSON 串） |
| 位置标签 | `locations[].tags[]`（数组） | `LocationEntity.tagsJson`（JSON 串） | `[JsonPropertyName("tagsJson")] TagsJson`（JSON 串） |

- Android 用 kotlinx `@Serializable` 默认 camelCase，**未发现 `@SerialName` 覆写**。
- Windows 用 `[JsonPropertyName("camelCase")]` 显式标注，键名与属性名解耦，最稳。
- 导入归一化（Windows `BackupService` 已实现）：`state.birthDate → profile.birthDate`、

  `profile.customFields[] → customFieldsJson`、`locations[].tags[] → tagsJson`。

## 3. 已交付文件（本批，共 3 个，零依赖）

| 文件 | 作用 |
|---|---|
| `contract/backup_contract.sample.json` | 规范样例：Web 导出（wire）格式，覆盖 birthDate / customFields / tags / 多集合按主键合并场景与边缘情况（空 tags、doneAt=null）。 |
| `web/validate_backup_contract.js` | Web 端零依赖校验器（`node` 直接运行）。断言：① 全键 camelCase；② birthDate 格式；③ customFields 内层键与可逆序列化；④ tags 字符串数组与可逆序列化；⑤ 按主键合并语义（本地独有保留 / 云端同键覆盖）。 |
| `README.md` | 本方案文档。 |

运行 Web 校验器（无需安装依赖）：
```bash
node EarthOnline-Tests/web/validate_backup_contract.js
```

## 4. 计划新增的验证文件（后续批次，待允许构建时执行）

> 说明：Android/Windows 的契约需真正序列化其实体并与同一份 wire 契约比对，需在其构建环境运行。
> 本脚手架只定义断言逻辑，不在本环境执行 `dotnet test` / `gradle test`（避免引入新依赖与构建）。

1. **Android（`app/src/test/java/.../BackupContractTest.kt`）**
   - 用 kotlinx `Json.encodeToString(profileEntity)` 将 `ProfileEntity(birthDate="1995-06-15", customFieldsJson=...)` 序列化；
   - 断言输出 JSON 含键 `birthDate`、`customFieldsJson`、`tagsJson` 且全 camelCase；
   - 反序列化样例的 `customFieldsJson` 字符串能还原为 `List<CustomField>`，且 `tagsJson` 还原为 `List<String>`；
   - 用 DAO `insert(onConflict=REPLACE)` 模拟合并：本地插入 t9、云端导入 t1/t2，断言 t9 保留、t1 被覆盖。

2. **Windows（`Tests/BackupContractTests.cs`，新增独立测试项目，仅引用现有实体，不引新 NuGet 包）**
   - `JsonSerializer.Serialize(profileEntity, Opts)` 断言键名与 Android/Web 逐字一致；
   - 反序列化 `customFieldsJson` / `tagsJson` 字符串可还原；
   - 复刻 `Upsert` 合并：本地 t9 + 云端 t1/t2 → 断言 t9 保留、t1 覆盖；
   - **对照实验**：构造一份 `BirthDate`（大写 B）的畸形备份，分别在 `CaseInsensitive=true`（应成功）与 `=false`（应失败/为默认）下反序列化，量化关闭开关的影响面。

## 5. Windows `CaseInsensitive` 收紧可行性评估

- **现状**：`BackupService.Opts.PropertyNameCaseInsensitive = true`，且 `ProfileService` 解析 `CustomFieldsJson` 亦 `= true`。
- **风险点**：开启时，若任一端因 bug 写出 `BirthDate` / `birthdate` 等非标准键，Windows 仍会绑定成功，**隐藏漂移**；关闭后此类键将绑定为默认（`""` / null），即**暴露**问题。
- **可行性结论**：**可行，但必须「先测后关」**。
  1. 先让本契约测试（及 Android/Windows 对照测试）全绿，证明三端当前均严格输出 camelCase；
  2. 确认无历史备份依赖大小写不敏感绑定（现有代码全部硬编码 camelCase，风险低）；
  3. 将 `BackupService.Opts` 与 `ProfileService` 内联选项的 `PropertyNameCaseInsensitive` 由 `true` 改为 `false`；
  4. 保留契约测试作为 CI 回归护栏。
- **本回合不修改该配置**（属序列化严格度变更，留待契约测试就绪后作为独立提交，且需你确认）。

## 6. 退出标准

- Web 校验器零失败；Android/Windows 对照测试在各自构建环境零失败；
- `birthDate` / `customFieldsJson` / `tagsJson` 三端键名与内层结构逐字一致；
- 合并语义三端一致：本地独有主键保留、云端同主键覆盖、冲突按 `exportedAt` 比较。
