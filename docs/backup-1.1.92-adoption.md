# 1.1.92 完整备份：第二轮功能吸收

此页记录从用户提供的 1.1.92 完整备份中选择性移植的功能。当前仓库 master 的新版红队界面、任务调度、测试及其他改进保持不变；**不会用旧备份覆盖当前插件**。

## Windows 注入开关：可重建的源代码

- 新增 maintenance/inject-switch/InjectSwitch.cs，参考备份的 WinForms 开关，但完全删掉旧版 HTTP /inject/on、/off 调用和动态端口侦测。
- 只读写 $DSH_HOME/.inject-off，如果没有 DSH_HOME 则为 %USERPROFILE%\.dsh\.inject-off；兼容此前的文件驱动开关。
- 每秒同步一次开关状态；仅控制插件提示词注入，不会停止工具、补丁、会话或演练台。
- 备份内的已编译 EXE 和快捷方式不提交到仓库，也不直接作为受信任的软件发布。

Windows PowerShell 在仓库根目录执行：

    .\maintenance\inject-switch\Build.ps1

输出到 maintenance/inject-switch/dist/dsh-inject-switch.exe。也可在 GitHub Actions 的 Windows 兼容性任务中下载由仓库源码编译的 dsh-inject-switch-windows artifact（仅保留 14 天）。

## Web 端口占用诊断（只读）

备份的 lib/web-reclaim.js 和 lib/web-preflight-entry.js 处理旧版 dsh web 被后台实例占用端口的问题，但原方案会在启动时自动 taskkill / SIGKILL。

这里只吸收解析和记录能力：

- 新增 lib/web-port-diagnostics.js，解析 Windows netstat 和 Unix lsof / ss；只对真实 @deepseek-ai/dsh/lib/bin.js web 命令行标记 dsh-web，无法识别时显示 unknown。
- 插件重启拉起新 Web 进程时，记录子进程 PID 到 $DSH_HOME/dsh-purge/web-server-PORT.json。这仅是诊断线索，不意味着旧 PID 永远属于该实例。
- CLI 示例：node bin/dsh-purge.js --web-port-status 43120。未指定端口则用 PORT 环境变量，或默认 3080。只展示 PID 与分类，不暴露可能包含认证令牌的完整命令行。
- 不主动终止进程、不修改配置。确有冲突时先人工确认所用实例再处理。

## 暂不吸收的代码

- 自动终止端口进程的启动钩子：可能误关仍在使用的 DSH 实例，改为只读诊断。
- lib/subagent-control.js：会将宿主子代理审批策略 never 改成 ask，并对审批请求直接返回 allowed-once；不合并这种审批绕过。
- 备份内 node_modules/.bin、旧安装登记的绝对路径及失效仓库地址：与当前安装方式不兼容，不覆盖。

## 第三轮：吸收配置原子写入

备份里的 lib/redteam/atomic-write.js 提供先写临时文件、同步后再改名的保存方式；当前主线遗漏了这项，部分配置仍直接覆盖 JSON。

本轮新增同名模块，并将三个实际仍在直接写盘的入口统一接入：

- 智能体并发上限：lib/redteam/settings.js
- 工具箱路径、FOFA/VPS 等平台设置：lib/redteam/platform-config.js
- 代理连接与凭据配置：lib/redteam/proxy-config.js

临时文件采用 0600 权限（在支持 POSIX 权限的平台上），写入失败保留原文件并抛出错误；不自动重试、不重置配置。现有已经独立实现原子保存的 proxy-pool.js 维持原样，避免重造功能。

此修改只解决写入中断导致的半截 JSON，不解决多个独立进程同时编辑时的最终覆盖冲突。
