# Windows 桌面维护与普通工具

这两个组件独立于 dsh-purge 的启动与补丁入口。默认不修改宿主，不自动重启，不改写模型提示词、认证、审批或沙箱。不需要另装一套 Harness。

## 第一阶段：诊断与同版本恢复

需要 PowerShell 7。准备官方文件时还需要 Node.js 和本地 7-Zip。下例按 Windows 桌面安装根目录运行；按实际位置替换参数，不要把 profile 路径误作安装根目录。

    & .\maintenance\Harness-Recovery.ps1 -Mode Audit -InstallRoot 'D:\your-harness-install'
    & .\maintenance\Harness-Recovery.ps1 -Mode Prepare -InstallRoot 'D:\your-harness-install'

- Audit：识别打包、解包或冲突布局；检查运行进程和 profile 的文件摘要；分别报告安装器错误、启动错误和认证未验收。Windows 错误 32 是共享冲突，不等于能确认锁持有者。
- Prepare：只接受和已安装版本相同、SHA-512 匹配官方 Windows nightly 源且 Authenticode 发布者有效的缓存安装器。解包到独立的本地证据目录，逐文件比较配套资源，再比较 ASAR 打包成员。不执行安装器。
- Restore：明确指定这个模式才允许替换。要求同版本且配套文件全匹配、安装进程已正常退出、profile 未配置会改写宿主的目标插件、当前文件可独占打开。替换前保存精确副本和事务记录，使用原子替换，随后校验读回。该模式不自动启动应用。
- Rollback：仅撤回本工具记录的同版本替换；必须提供对应的 RunDirectory。要求 EXE、当前档案、官方配套文件和备份哈希仍符合事务记录。不会用旧版本 ASAR 回退新版本 EXE。

脚本支持显式 ProfileRoot、UpdaterRoot、EvidenceRoot、Node 和 SevenZip。证据默认保存在当前用户的 LocalAppData，避免在同步目录里写入大体积官方文件；不保存凭据或配置原文。解包布局目前只做诊断，不执行 ASAR 替换。

同版本恢复、官方跨版本更新、桌面启动和认证不是同一件事。官方频道没有更高版本时不能验收真实跨版本更新；跨版本仍走官方桌面安装器，不用 npm 的 next 标签替代。仅看到进程或安装器退出码，不代表桌面认证已通过。

## 第二阶段：普通维护工具

desktop-tools 子目录是独立本地包 harness-maintenance-tools。提供显式记录校验、Markdown／JSON 报告、只读回放、普通模板目录，以及只读 CLI 技能索引。不扫描生产记录，不执行历史命令，不自动激活技能，不替换既有插件。

离线构建时提供 Prepare 验证过的 official-payload 目录。构建脚本另外固定 rc.1 测试 EXE 和 ASAR 的 SHA-256，只接受已核验的运行时。使用独立 npm 缓存和 --ignore-scripts；不覆盖已存在的发布产物。它以 Electron Node 模式做工具接口测试，不启动桌面和模型。

    & .\maintenance\Build-DesktopTools.ps1 -OfficialPayloadRoot 'C:\path\to\official-payload'

详细的数据格式与命令见 desktop-tools 目录的 README。当前声明的宿主是已验证的 0.2.2-rc.1，不扩大到未经验证的版本。发布到现有 desktop profile 需要单独完成真实启动和认证验收；提交源码或打包本身不会安装。

## 自动验证

    & .\maintenance\Test-HarnessRecovery.ps1
    node --test .\maintenance\archive-evidence.test.mjs .\maintenance\desktop-tools\records.test.mjs .\maintenance\desktop-tools\skills.test.mjs

合成测试涵盖占用、过期指纹、原子替换／回退、文件边界、记录渲染、只读索引和工具生命周期。正式工具注册、执行及卸载通过 Build-DesktopTools 的已验证宿主测试，不等价于生产桌面加载或模型行为验收。
