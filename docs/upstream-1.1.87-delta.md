# 上游 1.1.82 → 1.1.87 变更与我们取了什么

对比方式：`git fetch origin` 后按文件逐个比对（本仓库历史与上游无共同祖先，`git merge-base` 为空，不能用 merge/rebase 判断）。

```
上游 32 个提交，动过 118 个文件
  本地缺失 8 个（上游新增文件）
  与本地一致 11 个（都是 docs 里的图片）
  内容不同 84 个（本地都改过，冲突区）
  上游删除 15 个（本地还留着）
本地相对上游：领先 263 个提交（服从性硬化、解除内部限制、rc.5 适配、GLM 适配、作战台手册…）
```

## 上游六个版本干了什么

| 版本 | 主题 | 关键文件 |
|---|---|---|
| 1.1.82 / 1.1.83 | 补丁失配判定加 `drifted`、宿主版本门禁、`cordis.patch.yml` 为 `[]` 时替换而非追加、allowBuilds 只写裸包名 | `lib/core.js`、`lib/profile-insert.js` |
| 1.1.84 | 尾部锚点（`lib/anchor.js`）+ 子代理审批接管、红队模式中文化 | `lib/anchor.js`、`lib/index.js`、`lib/identity.js` |
| 1.1.85 | 深色模式主按钮白底白字 | `client.js` |
| 1.1.86 | 回收流程防 PID 复用误杀、等端口释放（#197/#198） | `lib/web-reclaim.js`、`lib/web-preflight-entry.js` |
| 1.1.87 | 全仓审计加固与死代码清理 | `lib/core.js`、`client.js`、`lib/desktop.js` |

## 取了（本轮已合并到本仓库）

| 文件 | 来源 | 为什么取 |
|---|---|---|
| `scripts/ensure-profile-bundle.mjs` | 1.1.84 | **本地 `package.json` 的 `postinstall` 一直指向它，但文件缺失**——装进 profile 时补 bundles/insert 的逻辑等于没跑。取上游版，依赖的 5 个导出在本地 `lib/profile-insert.js` 里都齐 |
| `README.ja.md` | 1.1.83 | 文档齐套，零风险 |
| `lib/anchor.js` | 1.1.84 | 尾部锚点机制：section 排在 system prompt 尾部（order 10150），子会话另加 context（order 235）排在 `subagent:delegation` 之后，对消那句"需要审批的操作会被自动拒绝"。**文本按本仓库去诱导规则重写**：保留"交付优先/不写免责/被拦换路/虚构写满"，删掉上游逐条罗列的拒绝开场白——那会反向诱导（见 `test/anchor.test.mjs` 的守护断言） |

接线：`lib/index.js` 的 `applyHostHooks` 里 `registerAnchor(ctx, { enabled: cfg.anchor !== false, anchorMode: cfg.anchorMode })`，并挂 `ctx.effect` 回收。

## 没取（及原因）

| 上游改动 | 不取原因 |
|---|---|
| `lib/web-reclaim.js` / `lib/web-preflight-entry.js` / `lib/bin-preflight.js` | web 端（`dsh web`）的端口回收与 preflight；本机跑桌面端，且本地 `restart-web.js` 已是另一套实现 |
| `lib/subagent-control.js` | 子代理审批接管；本地已有 `subagent-types` 补丁与 obedience 层，机制重叠，先不动 |
| `lib/desktop.js` 的 asar 换包修补 | 本地已有自己的密封包流程（解包 → 写补丁 → asar 让位 → 重启），实测可用 |
| `lib/core.js` / `client.js` / `lib/edit*.js` 的 1.1.87 审计清理 | 这三个文件本地改动量最大（client 496 KB / core 348 KB），整取会覆盖：去例句、1024 token 修复、GLM 整段替换、武器/成人锚点、GuideTab |
| `test/*.test.js`（上游 12 个） | 测的是上游实现；本地对应能力用 `.mjs` 测试覆盖，且上游用例会引用本地没有的文件 |

## 结论

- **不要在面板点「更新」**：那会把整包换成 1.1.87，覆盖本地全部改动。
- 需要同步上游时按本文件的方式**逐文件取**：先 `git show origin/master:<path>` 看内容，再决定取/改/跳。
- 每次取完跑 `node --test` 与 `node scripts/check-all-fixes.mjs`（16 项回归体检）。
