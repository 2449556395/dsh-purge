# test-pending —— 尚未收编的规格用例

这里的文件**不在** `npm test` 的扫描范围内（`test/*.test.mjs`），跑它要显式：

```powershell
npm run test:pending      # = node --test test-pending/*.mjs
npm run test:all          # 正式套件 + pending 一起跑
```

## 为什么 `npm test` 要写显式 glob

裸 `node --test` 会把 `maintenance/desktop-tools/Test-OfficialHost.mjs` 当成测试文件执行
（那是个需要真实宿主的手工验收脚本），本地必红、CI 却是绿的——两边判定不一致。
`package.json` 的 `test` 因此固定成 `node --test test/*.test.mjs`，与 CI 的显式文件清单一致。

## 现在还剩什么

只剩 `workflow-coordination.mjs`。它按 ChatGPT 版（`破/dsh-purge` 1.1.71-redteam.1）的
**57 个工具**和那一版的 `redteam_agent_slot` 语义写成；本仓库现在是 **76 个工具**
（含后加的 `redteam_data_quality` 等），`redteam_agent_slot` 用的是「label + 时间戳」键、
`used = max(注册表运行数, 预留数)`，另有探测不到宿主时的退化态字段差异。
硬让它变绿就得回退现在的工具行为，所以留作规格参考，不进 CI。

其余三份（`agent-status` / `store-query` / `prompt-compat`）已经落地并搬进正式套件：

| 原用例 | 现在的落点 |
|---|---|
| `agent-status.mjs` | 实现 `lib/redteam/agent-status.js`；测试 `test/agent-status.test.mjs` |
| `store-query.mjs` | store 侧 `dataQuality` 算子 + 分页校验；测试 `test/store-query.test.mjs` |
| `prompt-compat.mjs` | `lib/identity.js` 装配契约（不多造 `tools`、`interpolate:false` 逐字保留、装配失败原样冒泡）；测试 `test/prompt-compat.test.mjs` |

要收编 `workflow-coordination.mjs`，得先决定：`redteam_agent_slot` 是否切到「key + runId」
语义。这会改工具契约，需要同步更新 `docs/drill-tools-reference.md` 与红队预设里的调用说明。
