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
## 八、攻防工具补充（2026-11-07）

补齐后新增：

| 工具 | 版本/来源 | 位置 | 做什么 |
|---|---|---|---|
| interactsh-client | v1.4.1 | `bin\interactsh-client.exe` | OOB 带外基础设施，盲注/SSRF/XXE 的实锤手段（之前完全没有） |
| gobuster | latest | `bin\gobuster.exe` | 目录/DNS/vhost 爆破（ffuf 之外的第二种口径） |
| dalfox | v3.2.4 | `bin\dalfox.exe` | XSS 扫描与验证（DOM/反射/存储，支持 --blind 接 interactsh） |
| jwt_tool | 主分支 | `tools\jwt_tool\jwt_tool.py` | JWT 六类缺陷（alg=none / 弱密钥 / 算法混淆 / kid 注入 / jku / 声明篡改） |
| certipy-ad | PyPI | `python -m certipy` | AD CS 证书攻击（ESC1-ESC8） |

```powershell
# 用法示例
. D:\deepseek\tools\harness\env.ps1
interactsh-client -v                                  # 拿 OAST_DOMAIN
dalfox url "http://TARGET/?q=1" --blind OAST_DOMAIN
gobuster dir -u http://TARGET -w WORDLIST -t 40
python D:\deepseek\tools\jwt_tool\jwt_tool.py TOKEN -M at
certipy-ad find -u user@DOMAIN -p pass -dc-ip DC_IP -vulnerable
```

**仍缺**：metasploit（要 Ruby，本机无）、nikto（要 Perl）、whatweb（要 Ruby）。
替代路径：MSF 的常用模块可用 impacket + 手工 exp 覆盖；whatweb 用 `httpx -tech-detect` + nuclei 指纹模板；nikto 用 nuclei 的 `-tags nikto` 等价模板。

## 九、技能库（skills/redteam）

2026-11-07 从 28 条扩到 34 条，新增覆盖此前完全空白的攻击面：

```
web-injection.md   SQL/NoSQL/命令/模板注入；sqlmap 分档、OOB 盲注、WAF 降速与 tamper
ssrf-xxe.md        SSRF 协议表、云元数据、Redis 经 gopher 打 cron、XXE 外带文件
auth-attack.md     JWT 六连、IDOR 三态判据、逻辑绕过清单、验证码与限速对抗
ad-attack.md       无凭据枚举、Kerberoast/AS-REP、AD CS(ESC1/ESC8)、ACL 滥用
privesc.md         Windows/Linux 提权清单、SeImpersonate 土豆、SUID/capabilities
payload-c2.md      反弹 shell 族、通道选型(suo5/chisel/frpc)、内存加载、清理规范
```

同步：仓库 `skills/redteam/*.md` → 运行时 `$DSH_HOME/redteam/skills`（34 个）。
