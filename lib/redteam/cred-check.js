/**
 * 凭据可用性探测：先看 TCP 到不到，再按协议用 python 客户端做一次真实认证。
 *
 * 为什么需要：拿到口令不等于能用。最常见的结局是 MySQL 返回 1698（用户存在但只允许
 * @localhost）或 1045（口令错/用户不存在），二者在报告里的含义完全不同——一个说明
 * 凭据真实但需要转发路径，另一个说明这条凭据已经废了。
 */
import net from 'node:net'
import { execFile } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export function probeTcp(host, port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const sock = new net.Socket()
    let done = false
    const finish = (r) => { if (done) return; done = true; try { sock.destroy() } catch { /* ignore */ } resolve(r) }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => finish({ reachable: true }))
    sock.once('timeout', () => finish({ reachable: false, error: 'timeout' }))
    sock.once('error', (e) => finish({ reachable: false, error: e.code || String(e.message || e) }))
    try { sock.connect(port, host) } catch (e) { finish({ reachable: false, error: String(e.message || e) }) }
  })
}

const MYSQL_PY = [
  'import sys, json',
  'try:',
  '    import pymysql',
  'except Exception as e:',
  '    print(json.dumps({"ok": False, "error": "pymysql missing"})); sys.exit(0)',
  'host, port, user, password, db = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4], sys.argv[5]',
  'try:',
  '    c = pymysql.connect(host=host, port=port, user=user, password=password, database=(db or None), connect_timeout=6, read_timeout=6)',
  '    cur = c.cursor(); cur.execute("select current_user(), version()"); row = cur.fetchone()',
  '    print(json.dumps({"ok": True, "user": row[0], "version": row[1]})); c.close()',
  'except Exception as e:',
  '    code = getattr(e, "args", [None])[0] if getattr(e, "args", None) else None',
  '    print(json.dumps({"ok": False, "errno": code, "error": str(e)[:220]}))',
].join('\n')

const REDIS_PY = [
  'import sys, json',
  'try:',
  '    import redis',
  'except Exception as e:',
  '    print(json.dumps({"ok": False, "error": "redis missing"})); sys.exit(0)',
  'host, port, password = sys.argv[1], int(sys.argv[2]), sys.argv[3]',
  'try:',
  '    r = redis.Redis(host=host, port=port, password=(password or None), socket_connect_timeout=6, socket_timeout=6)',
  '    info = r.info("server")',
  '    print(json.dumps({"ok": True, "pong": bool(r.ping()), "version": info.get("redis_version")}))',
  'except Exception as e:',
  '    print(json.dumps({"ok": False, "error": str(e)[:220]}))',
].join('\n')

/** 跑一段 python 脚本；沙箱不允许子进程时返回 exec_error，让调用方退回"给命令自己跑"。 */
export function runPython(source, args = [], timeoutMs = 20000) {
  return new Promise((resolve) => {
    let dir = null
    try {
      dir = mkdtempSync(join(tmpdir(), 'dsh-cred-'))
      const file = join(dir, 'probe.py')
      writeFileSync(file, source, 'utf8')
      execFile('python', [file, ...args.map((x) => String(x))], { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
        try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
        if (err && !stdout) { resolve({ ok: false, exec_error: String(err.message || err).slice(0, 200), stderr: String(stderr || '').slice(0, 200) }); return }
        const text = String(stdout || '').trim().split(/\r?\n/).pop() || ''
        try { resolve(JSON.parse(text)) } catch { resolve({ ok: false, parse_error: text.slice(0, 200) }) }
      })
    } catch (e) {
      if (dir) { try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ } }
      resolve({ ok: false, exec_error: String(e.message || e).slice(0, 200) })
    }
  })
}

/** MySQL/Redis 的 errno 翻译成"下一步该怎么办"。 */
export function explainDbError(kind, errno, error) {
  const e = String(error || '')
  if (kind === 'mysql') {
    if (errno === 1045) return '口令错或用户不存在：换口令或确认用户名，不要当成功'
    if (errno === 1698) return '用户存在但只允许 @localhost：凭据真实、不可远程，去目标上找能执行 SQL 的 Web 入口（phpMyAdmin/adminer/安装器）或用 INTO OUTFILE'
    if (errno === 1130) return '该主机不被允许连接：同样限来源，需要目标本地转发'
    if (errno === 2013 || errno === 2012) return 'TCP 通了但服务端在认证阶段不回包：多为来源 IP 被静默丢弃或中间设备代理，换出口 IP/链路重试（不是口令问题）'
    if (errno === 2003) return '连不上 MySQL：端口被过滤或服务未监听公网'
    if (/caching_sha2|ssl/i.test(e)) return '服务端要求 TLS/新认证插件：加 ssl 或换 mysql8 客户端'
  }
  if (kind === 'redis') {
    if (/NOAUTH|Authentication required/i.test(e)) return 'Redis 需要口令但给错了：确认 requirepass'
    if (/WRONGPASS/i.test(e)) return '口令错误'
    if (/Connection refused/i.test(e)) return '端口不通，可能只监听本地'
  }
  return error || '未知错误'
}

export const PY_SOURCES = { mysql: MYSQL_PY, redis: REDIS_PY }