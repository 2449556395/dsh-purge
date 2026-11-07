---
name: score-mapping
description: 把已确认的漏洞映射到 25 项得分点：哪些能记分、缺什么证据、为什么现在记不上
whenToUse: 一轮打完发现漏洞一堆但分数很低；或汇报前核对得分
role: assess
enabled: true
---

# 成果 → 得分点

## 先认清：什么叫"得分"

~~~
得分点要的是"权限"，不是"发现"。
未授权读取、版本泄露、信息枚举 —— 绝大多数不进分。
能进分的是：服务器权限、DB 凭据（且真的能连）、Web 应用权限、网络设备、集权系统、域控、数据（有量级阈值）。
~~~

## 逐条对照（用 redteam_score_list 拿当前靶标的真实规则）

~~~
1. 调 redteam_score_list，读出每个 point 的 code / points / description（description 里写了判定标准）
2. 调 redteam_vuln_query 拿全部 confirmed 漏洞及其 gained
3. 对每条 gained 问三个问题：
   - 这算不算"拿到了某个系统的权限"？（能登录、能执行、能读全库）
   - 权限级别是 admin 还是 ordinary？（分值差 5-10 倍）
   - 证据够不够？（截图/请求原文/回显）
4. 能记的立刻 redteam_score_hit（带 evidence + target + link 到 vuln_id）
5. 不能记的，写清"差哪一步"，作为下一轮的任务
~~~

## 常见的"看着像成果但不能记"

~~~
版本泄露 / 指纹          -> 0 分，只用于挑 Nday
未授权读取列表           -> 0 分，除非能读到"凭据或全量敏感数据"且达阈值
DB 口令但限 localhost    -> 0 分，必须找到能执行 SQL 的入口
预认证 RCE 但没打通      -> 0 分，只能记"攻击面"
DoS / 服务不可用         -> 多数口径不计分，但要在残余风险里写
自己注册的账号           -> 0 分（self_created），只留痕
~~~

## 一场打完的自检

~~~
漏洞 confirmed 数  vs  得分点数：差距大说明"都是读类漏洞"，下一轮该转向"拿权限"
每条 confirmed 漏洞都要有 gained 与"下一步"（要么已记分，要么写清缺什么）
汇报时把"已记分 X 项 / 待补证据 Y 项 / 不可记分 Z 项"三档分开说
~~~

## 为什么这条重要

一场渗透的真实产出 = 拿到的权限 × 可复现的证据。
漏洞列表长但都得不了分，说明火力集中在"读"，下一步要把资源投到凭据可用性（见 credential-to-access）与读转写（见 read-to-rce）。