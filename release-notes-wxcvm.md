# 1.1.92-wxcvm.3

## 中文

- **归档恢复闭环**：新增「管理 → 指南 → 已归档靶标」，可以查看/恢复之前归档的工作区；保留原库、报告和证据，拒绝覆盖活动名册里的同名项目。
- **Windows Desktop 升级**：附带 `scripts/update-desktop-fork.ps1`，只针对选定的 DSH profile 安装指定 fork 版本，提供只读校验与失败后配置、锁文件恢复，并尝试重新安装旧依赖。
- **兼容测试**：现有 Windows 矩阵增加脚本只读与模拟失败恢复验证，不增加矩阵机器数量。
- **发行完整性**：Release workflow 现在把 SHA256SUMS.txt 与 ZIP 同时上传，可对下载的 ZIP 做完整性校验。
- **此前修复延续**：技能库入口、运行中源码诊断、环境状态竞态、通道真实状态展示、靶标归档保留等均继续包含。
- **验收边界**：Windows 自动化检查不能替代用户实际 Desktop 的安装与图形界面验收；本 fork 普通合并依旧不会自动发布。

## English

- Restore archived engagement workspaces without overwriting existing targets.
- Add a pinned Windows Desktop updater with read-only checks and best-effort profile rollback.
- Test the updater safely in the existing Windows compatibility matrix.
- Publish SHA256SUMS.txt alongside the release ZIP.
- Retain previous UI, runtime-diagnostic, environment-state and archive fixes.
- Manual-only publishing and real Desktop acceptance boundaries remain unchanged.
