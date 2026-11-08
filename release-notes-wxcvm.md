# 1.1.92-wxcvm.1

## 中文

- **wxcvm 分支预览版**：与上游正式版分开发布，不代表真实环境已经完成渗透演练验收。
- **作战台**：概览、测试进度、证据与报告导航、分组页签和响应式布局；切换靶标时丢弃过期快照，避免跨靶标数据显示混乱。
- **任务推进**：`redteam_next_action` 只给一个重点任务卡，`redteam_progress_check` 比较实际得分与新增记录；阻塞任务可跳过，避免反复派活。
- **进度隔离**：新任务卡绑定演练 ID，拒绝跨靶标进度对账；旧任务卡格式保持可用。
- **只读核查工具**：`redteam_scope_review` 检查明示范围与资产匹配；`redteam_delivery_audit` 检查实际计分命中的目标、证据与来源关联。
- **降低误判**：禁用/旧计分规则不再建议直接计分；离线 WebShell、自建或停用隧道不再当成有效通道；候选结论与真实计分分开。
- **验证**：GitHub Actions 兼容性矩阵覆盖 Windows / Ubuntu 与 5 个宿主版本，合并后的主分支全部通过；**尚未在用户真实 DSH Desktop/Web 演练环境验收**。
- **发布方式**：仅在 `wxcvm/dsh-purge` 的 `master` 上手动运行 Release workflow；普通合并不会自动发版。

## English

- **wxcvm preview**, separate from upstream official releases; passing CI does not establish real-world exploitation success.
- **Operations UI**: refreshed overview, review status, evidence and reporting navigation, responsive tabs and protection against stale cross-engagement snapshots.
- **Decision loop**: one focus card from `redteam_next_action`, measurable progress from `redteam_progress_check`, and a blocked-task skip to avoid repetitive work.
- **Engagement isolation**: new task cards bind progress baselines to an engagement ID; legacy card formats remain supported.
- **Read-only reviews**: explicit scope checks and delivery evidence gap reporting.
- **Accurate status**: disabled/legacy scoring rules, offline sessions, and self-only/inactive tunnels are not treated as available score or access evidence.
- **Verification**: the combined master compatibility matrix passed on Windows and Ubuntu across five host versions. Real DSH Desktop/Web walkthrough has not been completed.
- **Publishing**: manually triggered for this fork on `master`; ordinary pushes do not publish.
