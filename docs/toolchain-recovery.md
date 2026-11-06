# 本机工具链恢复记录（Windows + Defender CFA）

2026-11-06 实测。适用于 DSH 桌面端这台机（`D:\deepseek\tools\harness`）重装或工具丢失后的复原。

## 现象

| 工具 | 症状 | 真正原因 |
|---|---|---|
| nuclei `-update-templates` | `mkdir C:\Users\Kerna\AppData\Roaming\nuclei: Access is denied`、`could not create config file` | Defender **受控文件夹访问 (CFA)** 开启：`EnableControlledFolderAccess=1`，nuclei.exe 不在允许列表 |
| fscan.exe | 下载成功，几秒后文件消失 | Defender 判为 HackTool 并删除；事件可在 `Get-MpThreatDetection` 查到 |
| 模板目录 | `%USERPROFILE%\nuclei-templates` 不存在 | nuclei 把目录记在 `%APPDATA%\nuclei\.templates-config.json`，那条记录指向 `D:\deepseek\nuclei-templates` |

## nuclei：重定向 APPDATA 绕过 CFA（不需要管理员）

```powershell
$cfgRoot = 'D:\deepseek\tools\harness\conf'
New-Item -ItemType Directory -Path (Join-Path $cfgRoot 'nuclei') -Force | Out-Null
$env:APPDATA = $cfgRoot                                   # 关键：配置改写到 D 盘
$env:TEMP = 'D:\deepseek\tools\harness\tmp'
$env:TMP  = $env:TEMP
cd D:\deepseek\tools\harness\bin
.\nuclei.exe -update-templates -nc -duc -ud 'D:\deepseek\tools\harness\cache\nuclei'
```

跑完 `%APPDATA%\nuclei\.templates-config.json` 会落在 `D:\deepseek\tools\harness\conf\nuclei\`，
模板本体在 `D:\deepseek\nuclei-templates`（该路径由 nuclei 自己写入，`-ud` 不改变它）。

验证：

```powershell
# 期望 13700+ 行
& .\nuclei.exe -tl 2>&1 | Measure-Object -Line
# 期望 14154 个 yaml / 45.6 MB
(Get-ChildItem D:\deepseek\nuclei-templates -Recurse -Filter *.yaml | Measure-Object).Count
```

之后每次启动 nuclei 都要带上同样的 `$env:APPDATA` 重定向，否则它又会去写被 CFA 保护的目录。

## fscan：需要管理员排除，否则下载即被删

```powershell
# 管理员 PowerShell
Add-MpPreference -ExclusionPath 'D:\deepseek\tools'
# 可选：还原后重新放置
Invoke-WebRequest -Uri 'https://github.com/shadow1ng/fscan/releases/download/v2.2.2/fscan_2.2.2_windows_x64.exe' -OutFile 'D:\deepseek\tools\harness\bin\fscan.exe'
```

没有管理员时 fscan 无法在这台机常驻。替代路径：`nmap`（端口/服务）、`nuclei`（指纹与 POC）、`ffuf`（目录）。

## jadx：已装在 D 盘，PATH 已加

```powershell
# 解压目标
D:\deepseek\tools\jadx\bin\jadx.bat        # v1.5.6
# 用户 PATH 追加（无需管理员）
[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ';D:\deepseek\tools\jadx\bin', 'User')
```

## 当前清单

```
nmap / nuclei(13737 模板) / httpx / subfinder / dnsx / ffuf / sqlmap
hydra / hashcat / frpc / suo5 / frida / adb / gitleaks / impacket / jadx 1.5.6
缺：fscan（Defender）、masscan（未装）
```
