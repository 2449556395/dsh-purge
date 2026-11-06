# 代理池控制台（独立页面）

插件自带的 client.js 里没有代理设置入口（本地那份是精简打包产物），所以单独做了一个页面，
不侵入打包产物、不需要重新构建。

## 打开

```
D:\deepseek\tools\..\  →  直接双击
C:\Users\Kerna\.dsh\plugins\dsh-purge\maintenance\proxy-console.html
```

浏览器打开后：

1. 端口填当前 DSH 的 GUI 端口（地址栏 `http://127.0.0.1:53380` 里的 53380）
2. 点「连接」

也可以带参数直接进：`proxy-console.html?port=53380`

## 能做什么

| 区块 | 操作 |
|---|---|
| 池状态 | 启用/停用池、测试全部节点、全部断开 |
| 节点 | 连接 / 测试 / 删除单个节点 |
| 添加节点 | 名称、协议（socks5/intro）、主机、端口、账号密码、noProxy |
| YAML 导入 | 粘贴 mihomo 风格订阅，导入到池；或作为单代理配置解析 |

底层全部走 `POST /redteam/api` 的 proxy* op：`proxyPoolGet / proxyPoolSave / proxyProfileSave /
proxyProfileDelete / proxyProfileConnect / proxyProfileTest / proxyPoolTest / proxyPoolDisconnect /
proxyPoolImport / proxyConfigImport`。

## 为什么 file:// 能调

`lib/redteam/ui.js` 的 HTTP 桥对回环来源放行：`origin === 'null'`（file:// 页面）或空 Origin 在
`Host` 是 `127.0.0.1`/`localhost` 时直接通过。实测：

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:53380/redteam/api' -Method Post `
  -Headers @{ Origin = 'null' } -ContentType 'application/json' -Body '{"op":"proxyPoolGet"}'
# → ok=True enabled=False
```

## 边界

页面只改插件自己的池状态（`$DSH_HOME/redteam/proxy-pool.json`、`proxy.json`），
不动系统代理、浏览器代理、模型 API 的代理。池真正被使用的场景只有两处：
插件的 GitHub 版本查询（`fetchJsonFromGithub`）和显式调用的节点测试。
