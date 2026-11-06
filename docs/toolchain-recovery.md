# 本机工具链恢复记录（Windows + Defender）

2026-11-06 实测，管理员权限下完成。适用于 `D:\deepseek\tools\harness` 重装或工具丢失后复原。

## 一、根因

| 现象 | 真正原因 |
|---|---|
| `nuclei -update-templates` 报 `mkdir C:\Users\Kerna\AppData\Roaming\nuclei: Access is denied` / `could not create config file` | Defender **受控文件夹访问 (CFA)**：`EnableControlledFolderAccess=1`，nuclei.exe 不在允许列表 |
| `fscan.exe` 下载成功几秒后消失 | Defender 判为 HackTool 直接删除（`Get-MpThreatDetection` 可查到 file:_D:\...\fscan.exe） |
| `nuclei -tl` 只有 9 行，提示 `nuclei-templates are not installed` | `.templates-config.json` 缺 `nuclei-templates-directory` 键，nuclei 回落到不存在的 `%USERPROFILE%\nuclei-templates` |

## 二、管理员方案（推荐）

```powershell
# 1. Defender 排除工具目录（fscan 存活的前提）
Add-MpPreference -ExclusionPath 'D:\deepseek\tools'

# 2. 允许 nuclei 写 AppData（CFA 白名单）
Add-MpPreference -ControlledFolderAccessAllowedApplications 'D:\deepseek\tools\harness\bin\nuclei.exe'

# 3. 模板目录钉在 D 盘（-ud 只更新不写配置，必须手工补这个键）
$f = 'C:\Users\Kerna\AppData\Roaming\nuclei\.templates-config.json'
$j = Get-Content $f -Raw | ConvertFrom-Json
$j | Add-Member -NotePropertyName 'nuclei-templates-directory' -NotePropertyValue 'D:\deepseek\nuclei-templates' -Force
$j | ConvertTo-Json -Compress | Set-Content $f -Encoding utf8
```

验证：

```powershell
cd D:\deepseek\tools\harness\bin
& .\nuclei.exe -tl 2>&1 | Measure-Object -Line      # 期望 13742 行
& .\fscan.exe -h 127.0.0.1 -p 1-100 -nobr           # 期望正常输出
```

## 三、无管理员时的退路

把 APPDATA 重定向到可写目录，让 nuclei 不碰被 CFA 保护的位置：

```powershell
$cfgRoot = 'D:\deepseek\tools\harness\conf'
$env:APPDATA = $cfgRoot
$env:TEMP = 'D:\deepseek\tools\harness\tmp'; $env:TMP = $env:TEMP
.\nuclei.exe -update-templates -nc -duc
```

模板本体仍会落到 `D:\deepseek\nuclei-templates`（nuclei 自己写进配置）。
fscan 在这条路上无法常驻，只能临时用。

## 四、jadx

```powershell
D:\deepseek\tools\jadx\bin\jadx.bat        # v1.5.6
[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ';D:\deepseek\tools\jadx\bin', 'User')
```

## 五、当前清单

```
nmap 7.92 / nuclei v3.11.1 + 13737 模板 / fscan 2.2.2 / httpx / subfinder / dnsx
ffuf / sqlmap / hydra / hashcat / frpc / suo5 / frida / adb / gitleaks / impacket / jadx 1.5.6
缺：masscan（未装）
```

模板位置：`D:\deepseek\nuclei-templates`（14154 个 yaml / 45.6 MB）
nuclei 缓存索引：`D:\deepseek\tools\harness\cache\nuclei\index.gob`
## 六、CFA 白名单的实际边界（2026-11-06 实测修正）

管理员会话里执行过：

```powershell
Add-MpPreference -ControlledFolderAccessAllowedApplications 'D:\deepseek\tools\harness\bin\nuclei.exe'
→ 'CFA allow added'
```

当时以为一劳永逸，**但退出管理员后 nuclei 又报 `mkdir ...\Temp\nucleiXXXX: Access is denied`**。
结论：管理员进程本身绕过 CFA，那条白名单没有真正对普通权限生效。

普通权限下的统一解法是重定向临时目录，而不是依赖白名单：

```powershell
. D:\deepseek\tools\harness\env.ps1     # TEMP/TMP/APPDATA 都指到 D 盘
& .\nuclei.exe -tl | Measure-Object -Line # 期望 13742
```

`env.ps1` 放在 `D:\deepseek\tools\harness\env.ps1`，只影响当前终端会话。

## 七、masscan 是 naabu 兼容层

`bin\masscan.cmd` 不是 masscan，是 `tools\masscan_shim.py`：解析 masscan 常用参数后转调 `bin\naabu.exe`。
naabu 一度缺失（shim 直接崩），2026-11-06 装了 v2.7.0。shim 已自行把子进程的 TEMP 指到 `harness\tmp`，
所以 `masscan <target> -p<ports>` 在普通权限下可用：

```
masscan 127.0.0.1 -p55552,8787  →  127.0.0.1:55552
```
