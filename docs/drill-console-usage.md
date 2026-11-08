# 作战台怎么用（dsh-purge 红队面板）

写给第一次打开的人。全程只在这个页面里点，不用敲命令；也可以直接让 AI 去做（见第 4 节）。

## 1. 打开

- 会话标题旁边的按钮 → 右侧栏分两页：**清洗** / **作战台**。
- 想要全屏：作战台右上角「全面浏览」，会开一个新窗口（地址带 `#redteam-full`）。
- 第一次打开要过授权弹窗（本机已解除，直接进）。

## 2. 八个页签各管什么

| 页签 | 干什么 | 什么时候看 |
|---|---|---|
| **资产测绘** | 靶标的 IP / 域名 / 端口 / 指纹清单，按 C 段分组；每行点开有端口、证书、标题、测试状态 | 每次开局先看这里有没有货 |
| **环境适配** | 工具目录、nuclei 模板目录、bin 搜索路径、`FOFA_KEY`、VPS（`REDTEAM_VPS_HOST` / `REDTEAM_VPS_KEY`）、代理出口只读状态 | **第一次必配**，否则测绘与反弹 shell 都缺件 |
| **智能体** | 并发执行智能体上限（默认 3，可改）+ 六个角色的系统提示词 | 想加并发 / 想改角色口径 |
| **会话隧道** | 已上线的 WebShell（冰蝎/哥斯拉）与 socks5 隧道，含连通性检查 | 打进内网后 |
| **漏洞战果** | 逐条漏洞：等级、状态、原始请求/响应、POC、攻击文件 | 每次子智能体回报后核对 |
| **攻击链** | 按阶段串起来的步骤（信息收集 → 互联网权限 → 边界 → 内网 → 靶标），含得分 | 汇报、复盘、看"这一步怎么拿到的" |
| **得分目标** | 25 项得分点、达成情况、截图证据 | 交付前对分 |
| **报告** | 一键导出 Markdown（含可粘贴进 Burp/Yakit 的原始请求） | 收尾 |

## 3. 五步开一局

1. **建靶标**：作战台里没有靶标时只显示一个输入框，填单位名称 → 「创建靶标」。
2. **配环境**：到「环境适配」页填三项，保存：
   - `toolkitDir`：工具目录（本机现在是 `D:\deepseek\tools\harness\bin`）
   - `FOFA_KEY`：资产测绘用；没有就只用被动 DNS + 子域枚举
   - `REDTEAM_VPS_HOST` / `REDTEAM_VPS_KEY`：反弹 shell 用；没有就先只做不需要落地的东西
3. **派活**：见第 4 节。
4. **看战果**：每轮结束看「资产测绘 / 漏洞战果 / 攻击链」，确认子智能体真的落库了（不要只看它口头说"拿到了"）。
5. **出报告**：「报告」页导出 Markdown。

## 4. 三种派活方式，选一个就行

| 方式 | 怎么做 | 适合 |
|---|---|---|
| **直接跟 AI 说**（推荐） | 在会话里说"打开靶标 X，先做信息收集"，主智能体会 `redteam_engagement_open` 再派 `recon` | 不想学界面 |
| **面板里点** | 「智能体」页看角色与并发；派活的入口仍在会话里（面板只负责配置与查看） | 想先看清配置 |
| **自己写指令** | 说"派 vuln-scan 只打 10.0.0.0/24 的 Web"，我会按你的范围派单个角色 | 有明确范围 |

角色按顺序跑：`recon` 信息收集 → `assess` 资产梳理 → `vuln-scan` 漏洞发现 → `exploit` 利用 → `internal` 内网。

### 4.1 避免重复派活：只做当前可信的一件事

先让主智能体调用 `redteam_next_action`。它会按当前库记录返回 `focus`：可复核的候选必须有资产关联、初步证据，而且资产不能标记为失活、测试中或明确阻塞。其他候选只进入补证据、核对关联或暂缓队列，不会仅因为严重度高就自动认定为成功。

完成当前 `focus` 后，调用 `redteam_progress_check`，把原来的 `focus.before` 完整传入：只有真实的计分变化才算分数增长，新增记录与实测成果分开描述。

若任务遇到确切阻塞，不要原地重复。可以在 `redteam_next_action` 传入 `blocked_task_key` 跳过一项，也可以传入 `blocked_task_keys`，其值是一个 **JSON 数组字符串**，例如 `["复核有证据的候选漏洞:vuln #12","核对候选证据缺口:vuln #15"]`。条件改变后移除对应 key，避免永久跳过已经恢复的工作。新旧参数可以同时使用。

### 4.2 结果驱动交接：一轮完成后决定继续、跳过还是暂停

本轮改为可在下一次 `redteam_next_action` 中直接传入 `previous_task`：这是 JSON **字符串**，内容包含上一轮 `focus.task_key`、原样 `focus.before` 以及执行结果 `outcome`。比如：

```json
{"task_key":"复核有证据的候选漏洞:vuln #12","before":{"engagement_id":"lab","score_points":0,"counted_hits":0,"recorded_hits":0,"assets":2,"confirmed":0,"findings":1,"reviewed_assets":0,"evidence_items":1},"outcome":"done"}
```

`outcome` 只接受 `done`（执行结束）、`blocked`（明确阻塞）、`inconclusive`（结果尚不确定）。工具会核对 `engagement_id`，重新读取**当前演练的真实库统计**并返回 `handoff`：

- `continue`：有新增分数或记录，重新从当前库选下一张任务卡；新增记录不代表已有得分。
- `skip`：上一轮明确阻塞，自动排除该动作与目标的组合，不在同一条件下重试。
- `hold`：结果不确定、统计没有变化或只有记录修正；`focus.status=needs-review`，本轮不派新任务，先解释真实结果。

这个决策**不自动执行任何工具或攻击**；它只让现有指挥智能体减少一次统计对账调用和无效续派。以前的 `blocked_task_key(s)` 和单独的 `redteam_progress_check` 仍能正常使用。

### 4.3 大型演练：不遗漏后面的资产和漏洞

`redteam_next_action` 使用事实库的**精简全量决策视图**，不受资产列表 2,000 条和漏洞列表 1,000 条的单页限制。它只读取资产的状态、漏洞候选及确认状态，以及“是否有实际 HTTP 证据”标记；不为了排序把原始请求/响应全文搬进任务卡。返回的 `state.assets_truncated` 与 `state.vulns_truncated` 为 `false` 时，表示这次决策已覆盖整个现有演练库（`vulns_relevant` 只统计 candidate/confirmed/exploited）。这不意味着数据库在其他进程并发写入时具有跨查询事务快照。

人工或智能体要看完整详情时，使用 `redteam_asset_query` 或 `redteam_vuln_query` 的 `limit`、`offset` 翻页（工具单次最多返回 200 条）。输出中的 `hasMore` 与 `nextOffset` 告诉下一页的位置，直到没有后续页。查询顺序有稳定的记录 ID 决胜项；如果正在同时新增/删除数据，建议刷新查询以避免传统 OFFSET 分页的移动边界问题。

### 4.4 多台未测资产：逐台处理且可独立跳过

旧任务卡会把所有未测资产合并为一个“未测存活资产 N 条”的目标；数量变化时任务 key 也随之改变，无法稳定跳过具体受阻资产。现在每张任务卡使用 `asset #ID` 作为稳定目标，最多先列出 30 台未测存活资产供排序和选择。遇到单台明确阻塞时，传入其 `focus.task_key`，下一张卡可转向其他资产；IP 或资产总数变化不会使同一个 ID 的任务 key 失效。

只读建议不运行扫描；模型结束后仍需如实更新资产测试状态或结果记录，否则后续调用可能再次建议检查同一资产。

### 4.5 任务卡按 ID 直达记录

拿到 `redteam_next_action` 的 `focus.target` 后，无需全文搜索或逐页翻找：

- `vuln #12` → 调用 `redteam_vuln_query` 并传 `id: 12`，直接读取该漏洞及其 HTTP 证据；`id` 也能与 `status` 等条件一起使用。
- `asset #8` → 调用已有的 `redteam_asset_get` 并传 `id: 8`，直接读取该资产详情。

查询与任务选择是只读操作，不自动更新漏洞状态、执行扫描或计分；完成后仍使用真实记录做进度对账。

### 4.6 概览页：记录进度、证据缺口和阻塞

概览页按当前演练调用只读 `taskBrief`，和原有的 `snapshot` 测试进度一起展示：

- **执行与阻塞**：显示数据库中标记为 `testing` 的资产，以及最近标记为 `blocked` / `abandoned` 的资产和最后一条测试记录。它们是库状态，不表示子智能体进程此刻一定仍在运行。
- **候选证据缺口**：用与智能体相同的 `reviewCandidateQueue` 分类规则汇总待核对证据、缺资产关联和暂缓处理的候选。计数不等于漏洞已经验证。
- **建议下一步**：给出首条有证据候选、缺证据候选、缺关联候选或待测资产的直接记录 ID 和页面入口。这是概览的轻量核查提示，**不等于**完整 `redteam_next_action` 任务卡，也不包含 `previous_task` 阻塞跳过/交接状态。
- 点击概览快捷按钮会切换到目标页签；不会执行扫描、派发智能体或修改计分。摘要只在进入概览和手动刷新时加载，不新增后台轮询。

### 4.7 智能体查询工具：精确筛选与节省上下文

- `redteam_asset_query` 现可直接用 `ip` 和 `test_status` 筛选资产；`port` 只返回真正标记为 `open` 的端口对应资产，避免把关闭端口误报为开放。排序可选 `discovered` 查看最近发现。
- `redteam_vuln_query` 批量检索（不传 `id`）默认 `detail: "summary"`，只返回目标、状态、短证据摘要及包含实际内容的 HTTP 证据条数。这样不会将大量原始请求/响应塞入模型上下文。
- 拿到具体的 `vuln #ID` 后，传 `id` 默认读取 `detail: "full"`，保留现有完整证据查看能力。需要批量完整证据时可显式设 `detail: "full"`；只要摘要时可显式设 `detail: "summary"`。
- `summary` 的 `evidence_present` 仅表示库里已有文本或 HTTP 证据，不表示漏洞已经核实或成功利用。HTTP 原始证据仍保留在本地 SQLite，查询摘要不会删除或修改它。

## 5. 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 资产测绘 0 条 | 没建靶标 / 没派 recon / FOFA_KEY 没填 | 先建靶标，再让 AI 派 recon；没 key 就用 `subfinder + dnsx` 兜底 |
| 派不出子智能体 | 并发名额满了（默认 3） | 「智能体」页把上限调大，或等现有回报 |
| 环境适配报缺工具 | 路径没填 / Defender 拦了 | 填 `toolkitDir` 与 `binDirs`；`chisel` 被 Defender 拦，隧道改用 `frp` / `suo5` |
| 隧道连不上 | 目标侧没打通（只在自己 VPS 上开的不算） | 「会话隧道」页看 `entry_kind`：必须是 `target-http` / `target-outbound` / `target-agent` |
| 得分不涨 | 拿到的是凭据但没有实测登录，或账号是自己注册的 | 用浏览器实测登录；自建账号不计分 |

## 6. 本机当前体检（`redteam_preflight`）

```
技能     24 / 24 可用
工具     13 / 15（缺 chisel、ksubdomain —— Windows 上本来就没有/被杀软拦，隧道用 frp/suo5，子域用 subfinder+dnsx）
平台     Windows，config.json 已存在，toolkitDir = D:\deepseek\tools\harness\bin
出口代理 http://127.0.0.1:7890（只读显示）
缺       FOFA_KEY、VPS 私钥 —— 这两项不填，测绘只能被动、拿不到反弹 shell
```

## 6.5 工具逐个注释

64 个 `redteam_*` 工具的作用、参数、调用时机见 [drill-tools-reference.md](./drill-tools-reference.md)（由 `lib/redteam/tools.js` 自动抽取，改代码后重跑生成脚本即可同步）。

## 7. 想省事就让 AI 全做

把这句话发给我即可：

```
打开靶标 <单位名>，派 recon 收全资产；收完派 assess 排序；
按排序依次派 vuln-scan、exploit；有隧道再派 internal。每步结束把落库结果报给我。
```

我会按并发闸门一个个派、核对落库、最后出报告；你只需要在「环境适配」把 `FOFA_KEY` 和 VPS 填上（或告诉我"没有 VPS"，我走不需要落地的路径）。
