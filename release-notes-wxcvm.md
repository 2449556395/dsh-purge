# 1.1.92-wxcvm.4

## 中文

- **Windows Desktop 升级故障恢复**：升级前完整保存旧插件文件与 profile 关键配置，记录 SHA-256；失败时先尝试按原锁文件重装依赖，如无法恢复，再使用插件快照。被占用或部分回退失败会保留备份与错误，**不宣称真实 Desktop 已通过验收**。
- **源码诊断更准确**：优先与已安装版本对应的 GitHub Release 标签比较 6 个关键文件，不再默认用持续变化的 master 误判旧发布版；UI 显示比较基准。标签不存在才回退 master。
- **可选分享版报告**：命令行报告增加 `--shareable`，基础脱敏常见凭据、目标名称和 IPv4，省略原始截图，原版完整导出不变。自动脱敏并不等于完整匿名，分享前仍需人工复核。
- **交付核对总账**：`docs/DELIVERY_AUDIT.zh-CN.md` 对照旧备份、研究结论、已修复项与真实 Desktop 验收缺口。
- **固定安装来源**：桌面安装深链与 package.json 内的发布包 URL 指向本次 `v1.1.92-wxcvm.4` 标签，避免版本号与 master 漂移导致包内容不一致。
- **测试与发布**：Windows/Linux 宿主兼容矩阵保持不变，发布文件同时提供 ZIP 与 SHA256SUMS.txt。默认依然为 fork 手动发版；本次仅使用精确指定的单次发布提交。
- **仍未验证**：用户真实 Windows Desktop 的 DSH profile、技能的实际模型调用、更新与回滚时的真实 pnpm junction、进程占用场景。

## English

- Snapshot prior plugin files and profile metadata before updating on Windows; verify hashes and restore files after failed pnpm recovery.
- Compare installed key files with the exact release tag rather than moving master.
- Opt-in `--shareable` report bundle with basic masking and omitted screenshot evidence; full original export remains unchanged.
- Add a concrete historical-backup/delivery audit ledger.
- Pin release install metadata and desktop deep links to `v1.1.92-wxcvm.4` rather than branch HEAD.
- Publish SHA256SUMS.txt alongside the GitHub Release ZIP; real Desktop integration acceptance remains pending.
