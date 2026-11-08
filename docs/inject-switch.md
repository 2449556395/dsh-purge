# 提示词注入总开关 / Prompt injection switch

从用户提供的 1.1.92 完整备份移植到本仓库；只移植需要的源码约定，**没有添加或运行备份中的 Windows EXE**。

## 控制方式

状态文件：`$DSH_HOME/.inject-off`（在常规 Windows 安装中通常是 `%USERPROFILE%\.dsh\.inject-off`）。

- 文件存在：停止插件提示词正文、附加提示词段及对应锚点的注入。
- 文件不存在：恢复当前配置允许的提示词注入。
- 不改动工具注册、演练台、宿主补丁、审批和沙箱设置；这些功能需要单独控制，不能把此开关当作全插件卸载。
- 修改会在后续请求生效，外部文件改动最多约 500ms 被插件读取；已发送给模型的提示词不会追溯删除。

### CLI

```powershell
dsh-purge --inject          # 查看
dsh-purge --inject-off      # 暂停注入
dsh-purge --inject-on       # 恢复注入
dsh-purge --inject-toggle   # 切换
```

### 面板

打开 **Clean / 清洗**，使用“提示词注入总开关”。页面每两秒同步一次状态，因此直接修改标记文件后也会更新。

HTTP 仅允许本地环回连接并复用已有的同源检查：

- `GET /dsh-purge/inject` 只读当前 `off/on`。
- `POST /dsh-purge/inject` 使用 JSON `{"off":true}` 或 `{"off":false}`。
- 不支持 GET 修改状态、URL 参数切换，写盘失败返回错误。

**Windows 独立桌面开关现在可以从源码重新编译**：运行 `maintenance/inject-switch/Build.ps1`，输出至 `maintenance/inject-switch/dist/dsh-inject-switch.exe`。CI 的 Windows 检查还会提供临时下载的 `dsh-inject-switch-windows` artifact。新版桌面开关直接操作相同的标记文件，不再使用旧 HTTP 端点；备份中的原始 EXE 未被并入仓库。详情见 [备份第二轮吸收说明](backup-1.1.92-adoption.md)。

## 测试

`node --test test/inject-switch.test.mjs` 检查文件持久化、外部修改同步、写入失败与锚点闸门。完整宿主兼容性由 GitHub Actions 继续执行。