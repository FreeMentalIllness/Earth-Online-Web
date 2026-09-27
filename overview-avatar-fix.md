# 地球Online v3.A — 头像读取失败 Bug 修复

## 完成内容
修复了「上传 1.4MB 头像被拒绝」的根因：v3 放宽了头像**文件**大小到 5MB，但 `isValidAvatarData` 校验的 **dataURL 字符串长度上限**仍停留在  ̃100KB，导致任何编码后超过 100KB 的图片被静默拒绝并给出误导性提示。

## 关键改动（均已验证）
- `js/data.js:67` — `PROFILE_LIMITS.avatarDataMaxBytes` 由 `100 * 1024` 改为 `7 * 1024 * 1024`。取 7MB 而非 5MB，是因为 base64 编码会使字符串膨胀约 1.4 倍，5MB 原图编码后约 6.7MB，若只设 5MB 仍会被二级上限拦截，等于只修一半。
- `js/profile.js:240` — 失败提示由「头像读取结果无效，请换一张图片试试」改为「图片过大或格式不支持，请压缩到 5MB 以内的 JPG/PNG 后重试」，暴露真实原因。
- `qa/tests_body.js` — 新增 L 组 4 条回归用例（L1 超 7MB 拒、L2 ~3MB 通过、L3 边界含等号、L4 前缀校验）。

## 验证结果
- 工程师语法检查：data.js / profile.js OK
- QA 回归：逻辑 **53 passed / 0 failed**（原 49 + 新增 4），静态 **67 passed / 0 failed**，全绿。
- 两层防护一致：上传端 `AVATAR_MAX_BYTES=5MB` 拦超大文件；`isValidAvatarData` 对整条 dataURL 按 `<=7MB` 校验（≈5MB 解码图）。

## 残留风险 / 备注
- `isValidAvatarData` 校验的是 base64 字符串长度而非解码后字节数，建议在 data.js 注释补充说明，避免未来误解（非阻塞）。
- 团队 `software-bugfix-avatar` 已完成。
