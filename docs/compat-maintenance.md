# 维护预览版：1.1.71-compat.2

## 状态与基线

- 日期：2026-10-29，Asia/Shanghai。
- 维护分支：`codex/compat-maintenance`。
- 镜像基线：`wxcvm/dsh-purge`，`033e6bd1e0f101352b39075ecd0d758ffef26b76`，版本 1.1.71。
- 原作者跟踪快照：`YuJunZhiXue/dsh-purge`，`160b9114cbad7beca3d4d3f9f027ec843bf46f5e`，版本 1.1.81。仅用作修复参考，没有整体合并或 rebase。
- 最新宿主源码：[DSH 0.2.2-alpha.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-alpha.2)，固定 SHA `f3803c96974ad4a94195fb97e5c637e9c2a3afe3`。
- 本分支是实验预览，不是对宿主全功能兼容的承诺。`dshTarget` 是适配目标，`targetStatus: experimental` 是当前状态。
- 运行时声明提高为 Node.js >=24.9，与新宿主要求一致；不再沿用无法覆盖 SQLite 功能的旧 Node >=18 声明。
- 保留原作者署名、原有 LICENSE、镜像说明、原有技能和加密默认提示词资源。没有复制上游的技能删减和新增目标门禁。

## 已实现

### compat.2：真实加载验证发现的修复

1. 新建官方 profile 的 `cordis.patch.yml` 含注释和 `[]`。注册器现在替换空列表后再插入，保留注释与换行；不再生成两个 YAML 根节点。无法安全追加的非空 flow-list 配置明确拒绝，两个文件都不改写。
2. 技能同步只写选定 `DSH_HOME/redteam/skills`，不再顺带覆盖默认用户 home 中另一套安装的同名文件。未指定 `DSH_HOME` 时仍使用默认 home。
3. 官方 `0.2.2-alpha.2` 把 `list_agents` 合并到 `dsh-tool-subagent-control`。根据实际运行时元数据，在内存中移除同作用域里多余的旧 `/list-agents` 行；rc.2/rc.3/rc.4 保留旧入口。独立、禁用、条件启用、带自定义配置或隔离域的行不被盲目删除。用户磁盘预设不因该适配而改写，未知宿主版本不猜测支持。
4. 版本递增为 `compat.2`，不以同版本文件覆盖已交付的 `compat.1` 包。

### 最新接口

1. 工具 schema 的嵌套对象显式声明开放性；以前省略的对象保持开放，已有 `additionalProperties: false` 保持封闭。参数对象、输出、回调及注册选项不被原地改写。
2. 工具编译器延迟到 `apply()` 解析，从实际插件／CLI／profile 定位，删除硬编码盘符。模块 import 不再要求先找到宿主。
3. 提示词 waterfall 不再凭空制造 `tools: []`；新宿主工具列表由宿主拥有。旧组装对象已经带来的工具数组保持原引用。
4. 不支持 `cwd` 插值时，系统目录说明使用静态回退；显式 `interpolate: false` 的用户内容不被静默重写。
5. complete 模式补丁仅扩展 section 列表，不覆盖新版 provider tools 或 required contexts。
6. 预设读取时去掉已被宿主拒绝的 `toolFilter` 字段；保留 `maxDepth` 和其他配置。用户磁盘预设没有被本轮工具改写。
7. 子智能体按新版单参数生命周期事件关联并释放准确预留；目录里缺少活动字段时读取真实 `Agent.status`，不可读时报告未知，不能冒充已验证的零运行数。
8. 主插件 3 个控制工具与作战台 56 个工具均经过真实官方工具注册表的接口验证；没有执行工具动作。

### 已取消或放宽的插件控制

- 作战台独立倒计时／滚动／勾选确认不再作为功能可用的前置条件。旧前端确认同步和重试链已移除。
- 旧 GET/POST `drill-grant` 兼容接口保留，但不再创建文件、同意记录或时间戳。`granted` 只表达旧客户端所需的功能可用性，另有 `required: false`、`consentRecorded: false`。
- 并发上限不再硬封顶为 10，可配置为更高正整数；默认仍是 3，保留有限安全整数表示边界和任务生命周期管理。
- 主插件入口不再调用或导入地域／域名类别门禁安装器；历史目标清单明确标为诊断用途，不再显示成任务放行前置条件。
- 首次欢迎说明仍保留，不冒充已经产生用户同意记录。

### 目标门禁挂载处理

**主插件入口已取消地域／域名类别门禁挂载。** 此状态从 compat.1 保持到 compat.2；没有修改或伪造公共诊断函数的返回结果。

`lib/net-scope.js` 与镜像基线逐字节一致，显式调用它的分类诊断 API 仍可返回原来的命中结果；主入口不再注册其全局钩子。诊断清单的 HTTP 接口新增 `enforcing: false`、`purpose: legacy-diagnostics`。回归测试同时检查入口没有安装器调用，以及诊断函数仍能分类合成输入，未访问网络。加密默认提示词资源也未修改。旧安装需要换成本包并重新加载后才可能体现入口变化，生产安装和模型会话验收仍待完成；不能描述为所有宿主或模型限制已解除。

### 安装、更新及完整性

- 显式 profile 注册只处理选定 profile 的 `package.json` 和 `cordis.patch.yml`；幂等、修改前备份、事务失败回滚。不扫描所有 home 或 profile。
- 安装生命周期只有能明确证明包位于某个 DSH profile 时才注册；仓库 checkout 中无参运行会 no-op。pnpm 阻止生命周期脚本时可运行下方显式命令。
- **不修改** `pnpm-workspace.yaml`、其他插件的构建许可、锁文件或用户原有 `false`。因此不照搬上游有 URL 冒号截断问题的 `allowBuilds` 改写器。
- bundle 不再重复插入自己的主入口，主入口由 profile 注册。
- 本分支内置更新操作不会安装原作者 master／beta 整包。面板显示维护版需手动安装；稳定源和预发布源没有被推送或发布。
- ZIP 修复目录条目 EEXIST；提取前校验路径、成员冲突、头、长度、CRC 和链接。仍明确拒绝不支持的 ZIP64、多卷及加密格式。
- 原子写保留已有 POSIX 执行位；hostFs 的 fd 操作直接透传，不再把数字描述符当路径。
- 客户端生成改为临时文件原子替换，增加 `--check`，防止生成失败截断既有 bundle。
- 将已存在于镜像 bundle、但遗漏在源 UI 中的 HTTP 错误解析、下载 URL 延迟释放和计时器清理同步回源码，避免重新生成造成回退。
- 修复 skills 模块缺少 `fs` 导入。

## 本机验证范围

测试系统：Windows，Node v24.20.0。API 矩阵使用固定版本官方 npm fixture；另在独立目录安装完整官方 `@deepseek-ai/dsh@0.2.2-alpha.2` 和所需 peer 依赖，安装脚本均禁用。完整宿主未安装进生产配置或系统全局目录。

| 官方 API 包版本 | 自动用例 | 通过 | 失败 | 跳过 |
|---|---:|---:|---:|---:|
| 0.2.1-rc.2 | 76 | 76 | 0 | 0 |
| 0.2.1-rc.3 | 76 | 76 | 0 | 0 |
| 0.2.1-rc.4 | 76 | 76 | 0 | 0 |
| 0.2.2-alpha.2 | 76 | 76 | 0 | 0 |

本轮四组均无跳过，包括此前因 Windows 环境权限跳过的 junction/symlink 提取拒绝测试。Linux 权限位仍需 Linux runner 实证，不能由 Windows 内容写入测试代替。

真实官方包测试包括 Cordis Context、SystemPrompt、ToolsService、59 个工具的编译与注册、实际提示词渲染和组装、实际编译产物补丁匹配。单元测试覆盖配置隔离、重复安装、归档损坏、并发设置、确认接口无写入、更新隔离和生命周期差异。

以下**仍未验收**：Electron 桌面 GUI、模型会话完整运行、全部旧补丁对新宿主的匹配率、插件面板的 Apply/Restore/Uninstall 和它们触发的宿主重启、长期运行。Web 面板加载和隔离 profile 安装回退已通过下述验收；没有点击补丁应用按钮，也没有发起模型请求或目标任务。

新增的 GitHub Actions 矩阵包含 Windows/Linux 与上述四个版本；本轮未推送，不能把工作流文件存在写成远程 CI 已通过。

## Web 隔离验收（2026-10-29）

- 使用真实官方 CLI 的 `dsh web` profile 启动，监听 `127.0.0.1` 随机端口；通过 Playwright 驱动真实 Chromium headless 浏览器，非静态 HTML 仿真。
- 配置、用户目录和临时目录隔离；启动进程不带模型密钥，Node 文件写入权限限定到测试根目录，不允许宿主派生子进程。浏览器仅放行本次 loopback HTTP 源，外部请求不放行。
- 官方基线先成功加载；安装并注册维护包后，主入口与整包能够激活，预设登记为 `registered` / `broken: null`，清洗面板和作战台均实际打开。
- 观测到的页面脚本错误为 0，HTTP 4xx/5xx 为 0。两个整包更新按钮均禁用；打开作战台未出现额外确认窗。首次欢迎说明在临时浏览器测试上下文中通过交互关闭，不代表生产用户已经确认。
- profile 注册第二次执行无写入。卸载隔离 profile 内的 npm 包、恢复安装前两个配置文件后，SHA-256 逐字节一致；再启动官方 Web，插件入口消失。测试数据留在隔离目录，不删除用户现有数据。
- 该回退是 **profile 包安装与配置回退**，不能等同于宿主补丁 Restore/Uninstall 已通过。
- 隔离环境中的“无法创建默认工作区”提示在未装插件的官方基线和回退后均存在；没有把它归因于本插件或宣称已修复。工作区创建、真实对话与完整桌面流程仍需后续验收。

## 复现测试

```powershell
node scripts/prepare-host-fixture.mjs 0.2.2-alpha.2
npm install --prefix .scratch/hosts/0.2.2-alpha.2 --ignore-scripts --legacy-peer-deps --no-audit --no-fund --omit=optional
$env:DSH_COMPAT_HOST_ROOT=(Resolve-Path '.scratch/hosts/0.2.2-alpha.2').Path
node scripts/build-client.mjs --check
node scripts/check-syntax.mjs
node --test
```

换版本时对对应版本重复 prepare/install，并修改环境变量。未设置 fixture 环境变量时，真实官方 API 测试会明确 skip，不得当作已经验证。

Codex 当前 Windows sandbox 经 `npm run` 派生的 Node 子进程曾出现 EBADF/ENOENT 路径隔离现象，而直接 `node` 命令通过。最终本机验证使用直接 `node`；没有因此降低产品写入／归档检查。隔离测试临时目录可显式放在 `.scratch/tests`，避免系统临时目录 ACL 干扰。

## 后续安装与回退

本轮产出维护分支和预览包，并完成隔离 Web 基础验收；没有安装到正在使用的宿主。未测试的补丁应用和桌面流程仍不能写成“全部应用成功”。

安装包后，若相应 profile 缺少本体入口，可显式执行：

```powershell
node node_modules/dsh-purge/scripts/ensure-profile-bundle.mjs --profile [ABSOLUTE_PROFILE_PATH]
```

输出会包含确切改动及备份路径。仅在选定 profile 内执行，不需要修改另一个 profile 或放开所有包的安装脚本。

源码回退：保留本分支后切回原 `master`；原镜像提交、标签均未改写。本轮没有修改生产安装宿主；隔离 profile 已按上述步骤回退。
