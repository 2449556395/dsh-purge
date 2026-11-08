# Shannon ↔ DSH：离线报告复核（第一阶段）

Shannon 3.x 是独立的开源 Web/API 白盒测试程序。这里仅添加**离线报告适配层**：读取标准 SARIF 2.1.0 与可选的 Shannon 状态 JSON，生成可以在 DSH 中人工核验的候选摘要。不运行 Shannon、不连接目标、不往 DSH 库写漏洞或得分。

上游：https://github.com/KeygraphHQ/shannon

## 使用

在**明确授权、可丢弃数据**的开发或预发环境运行 Shannon，取得 report.sarif 和（可选）状态快照。Shannon 自身要求 Docker、Node.js 22+ 和可用的模型，按上游官方文档配置。

从仓库根目录执行：

    node scripts/review-shannon-report.mjs --sarif /path/to/report.sarif
    node scripts/review-shannon-report.mjs --sarif /path/to/report.sarif --status /path/to/status.json
    node scripts/review-shannon-report.mjs --sarif /path/to/report.sarif --limit 15

获取状态快照的上游命令为 shannon status WORKSPACE --json（或 npx @keygraph/shannon status WORKSPACE --json）。将输出作为 UTF-8 JSON 文件供 --status 参数读取。

## 重要语义

- 只有 status: completed 能说明 Shannon 的**扫描流程完成**。partial、failed、cancelled、running 等状态，以及没有提供状态文件时，都不可理解成“没有漏洞”。
- SARIF properties.status: exploited 表示**Shannon 自己声称验证成功**，不是 DSH 二次验证。
- SARIF level: error 仅表示 high 或 critical，不能由此擅自确定为 critical。
- SARIF 摘要和代码位置不包含全部复现证据；完整证据应参考 Shannon 原始 PDF/JSON 报告，必要时人工复核。
- 所有输出一律 dsh_status: candidate、independent_review_required: true、proof_included: false。**零数据库写入、零自动计分、零网络访问**。
- 适配器不搬运 Shannon AGPL 源代码，而是独立解析通用 SARIF JSON 与公开的输出字段。

## 暂不做

不直接嵌入 Shannon 的 Docker/Temporal 执行器，不在 DSH 中自动启动攻击，也不把外部 SARIF 的 exploited 等同于当前演练里的有效权限成果。后续若添加显式导入功能，需先匹配目标范围、处理去重和证据来源，再让用户选择是否写入候选库。
