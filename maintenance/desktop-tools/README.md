# Harness Maintenance Tools 0.1.2

适配已经验证的 Harness 0.2.2-rc.1 / Cordis 4.1.0。独立维护工具包；不包含其他插件源代码，不改 system prompt，不注册额外宿主权限，不访问网络、用户目录、Shell 或生产数据库。

## 接口

| 名称 | 行为 |
|---|---|
| maintenance_validate_records | 校验显式传入的 JSON 记录，返回状态计数 |
| maintenance_export_report | 将同一记录渲染为 Markdown / JSON 文本；不会自行写文件 |
| maintenance_replay_records | 按时间查看记录；同时间保持输入顺序，不执行记录内容 |
| maintenance_template_catalog | 列出六类普通任务模板，或按 ID 取一个模板 |

记录结构为 schemaVersion: 1、records 数组；每条包含 id、title、status、updatedAt，以及可选 summary。状态是 todo、doing、done、blocked。时间使用 UTC 的 ISO 8601，摘要多行请用 LF。只处理显式提供的普通记录，不要传入凭据或私密原文。单次最多 128 KiB、100 条。

JSON 示例：

    {"schemaVersion":1,"records":[{"id":"case-1","title":"示例","status":"done","updatedAt":"2026-11-04T12:00:00Z","summary":"合成数据"}]}

本地 CLI 可运行 catalog / template ID / validate / replay / report markdown|json。记录通过 stdin 传入，结果写 stdout。可由用户自行将输出保存为文件。CLI 不装入 Harness，也不创建额外 profile。

## 对照口径

- 旧镜像与工作区已有报告导出和任务校验功能；不重复移植旧演练库。这里的输入是普通结构化记录，不读取、覆盖或迁移现有演练数据库。
- 会话内目录只列出本包普通模板。另有仅限本地 CLI 的 skills ABSOLUTE_DIR：只看显式提供目录下一层的 SKILL.md 文件元数据，不读正文、不跟随链接、不注册技能。
- 报告回放只读展示，不支持执行历史命令。原生补丁和定时任务提示段继续由 Harness 管理。
- 不含模型拒答、宿主认证、审批、沙箱或目标访问控制的改写。

生产目标是当前 desktop profile。未验收的宿主版本不会按兼容版本部署；这个包没有安装脚本或自动更新钩子。
