/** 离线复核工具：不主动连接目标，也不修改演练库。 */
import { isIP } from 'node:net'

function bytesOf(address) {
  const raw = String(address || '').trim().replace(/^\[|\]$/g, '')
  const family = isIP(raw)
  if (family === 4) return raw.split('.').map(Number)
  if (family !== 6) return null
  const expand = (part) => {
    if (!part) return []
    const groups = part.split(':')
    const last = groups[groups.length - 1]
    if (last && last.includes('.')) {
      groups.pop()
      const v4 = bytesOf(last)
      if (!v4 || v4.length !== 4) return null
      groups.push(((v4[0] << 8) | v4[1]).toString(16), ((v4[2] << 8) | v4[3]).toString(16))
    }
    return groups
  }
  const halves = raw.split('::')
  if (halves.length > 2) return null
  const left = expand(halves[0])
  const right = halves.length === 2 ? expand(halves[1]) : []
  if (!left || !right) return null
  const missing = 8 - left.length - right.length
  if ((halves.length === 2 && missing < 1) || (halves.length === 1 && missing !== 0)) return null
  const words = left.concat(new Array(missing).fill('0'), right)
  const out = []
  for (const word of words) {
    const n = Number.parseInt(word, 16)
    if (!Number.isInteger(n) || n < 0 || n > 65535) return null
    out.push(n >>> 8, n & 255)
  }
  return out
}

function parseRule(text) {
  const rule = String(text || '').trim().toLowerCase()
  if (!rule) throw new Error('empty scope rule')
  if (rule.includes('/')) {
    const parts = rule.split('/')
    if (parts.length !== 2 || !/^\d{1,3}$/.test(parts[1])) throw new Error('invalid CIDR: ' + rule)
    const bytes = bytesOf(parts[0])
    const prefix = Number(parts[1])
    if (!bytes || prefix > bytes.length * 8) throw new Error('invalid CIDR: ' + rule)
    return { type: 'cidr', name: rule, bytes, prefix }
  }
  const ip = bytesOf(rule)
  if (ip) return { type: 'ip', name: rule, bytes: ip }
  const wildcard = rule.startsWith('*.')
  const host = wildcard ? rule.slice(2) : rule
  if (host.length > 253 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)
      || !host.includes('.') || host.split('.').some((x) => !x || x.length > 63 || x.startsWith('-') || x.endsWith('-'))) {
    throw new Error('invalid hostname rule: ' + rule)
  }
  return { type: wildcard ? 'subdomain' : 'hostname', name: rule, host }
}

function inCidr(ip, net, prefix) {
  if (!ip || ip.length !== net.length) return false
  const full = Math.floor(prefix / 8)
  for (let i = 0; i < full; i++) if (ip[i] !== net[i]) return false
  const rem = prefix % 8
  return !rem || ((ip[full] ^ net[full]) & (255 << (8 - rem))) === 0
}

/**
 * 显式范围规则支持 IPv4/IPv6、CIDR、精确域名、*.子域名。
 * 域名匹配只能证明名称命中，不能证明解析出的 IP 自动获得授权。
 */
export function reviewScope(assets = [], allowed = '', limit = 25) {
  const texts = String(allowed || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean)
  if (!texts.length) throw new Error('scope requires an explicit nonempty list of authorized hosts or CIDRs')
  if (texts.length > 100) throw new Error('scope supports at most 100 rules')
  const rules = texts.map(parseRule)
  const result = { checked: 0, ip_matched: 0, name_only: 0, unmatched: 0, sample_truncated: false, items: [] }
  const maxItems = Math.max(1, Math.min(100, Math.floor(Number(limit) || 25)))
  for (const asset of Array.isArray(assets) ? assets : []) {
    result.checked++
    const addr = String(asset.ip || '').trim().toLowerCase()
    const addrBytes = bytesOf(addr)
    const names = [asset.primary_name]
      .concat((Array.isArray(asset.names) ? asset.names : []).map((n) => typeof n === 'string' ? n : n && n.name))
      .map((n) => String(n || '').trim().toLowerCase().replace(/\.$/, '')).filter(Boolean)
    const ipRules = rules.filter((r) => {
      if (!addrBytes || (r.type !== 'ip' && r.type !== 'cidr')) return false
      return r.type === 'ip' ? inCidr(addrBytes, r.bytes, r.bytes.length * 8)
        : inCidr(addrBytes, r.bytes, r.prefix)
    })
    const domainRules = rules.filter((r) =>
      (r.type === 'hostname' || r.type === 'subdomain') && names.some((n) =>
        r.type === 'hostname' ? n === r.host : n.endsWith('.' + r.host)))
    const status = ipRules.length ? 'ip-matched' : domainRules.length ? 'name-only' : 'unmatched'
    if (status === 'ip-matched') result.ip_matched++
    else if (status === 'name-only') result.name_only++
    else result.unmatched++
    result.items.push({
      asset_id: asset.id,
      ip: addr || null,
      primary_name: names[0] || null,
      status,
      rule: (ipRules[0] || domainRules[0] || {}).name || null,
      needs_review: status !== 'ip-matched',
    })
  }
  /* 先显示未匹配/仅域名匹配的资产，避免前 25 条全部匹配时真正的范围疑点被藏在后面。 */
  const rank = { unmatched: 0, 'name-only': 1, 'ip-matched': 2 }
  result.items.sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3))
  result.items = result.items.slice(0, maxItems)
  result.sample_truncated = result.checked > result.items.length
  result.note = '这是离线规则匹配，不是授权证明；name-only 表示域名命中但 IP 未被显式匹配，unmatched 不应直接纳入主动测试。'
  return result
}

/**
 * 基于已计入的分数记录检查交付链条完整性：不验证漏洞真实性，也不会改动分数。
 */
export function reviewDelivery(scoreBoard = {}, limit = 25) {
  const points = Array.isArray(scoreBoard.items) ? scoreBoard.items : []
  const maxItems = Math.max(1, Math.min(100, Math.floor(Number(limit) || 25)))
  const gaps = []
  const counts = { counted: 0, no_target: 0, no_evidence: 0, no_origin: 0 }
  for (const point of points) {
    if (point.enabled !== true || point.legacy === true) continue
    for (const hit of Array.isArray(point.hits) ? point.hits : []) {
      if (hit.capped === true || hit.self_created === true) continue
      counts.counted++
      const reasons = []
      if (!String(hit.target || '').trim() && hit.asset_id == null) { reasons.push('no_target'); counts.no_target++ }
      if (!String(hit.evidence || '').trim()) { reasons.push('no_evidence'); counts.no_evidence++ }
      if (hit.vuln_id == null && hit.step_id == null) { reasons.push('no_origin'); counts.no_origin++ }
      if (reasons.length) gaps.push({
        hit_id: hit.id, point_code: point.code, reasons,
        target: String(hit.target || '').slice(0, 120),
      })
    }
  }
  return {
    counted: counts.counted, gaps: gaps.length, reasons: counts,
    issues: gaps.slice(0, maxItems),
    omitted: Math.max(0, gaps.length - maxItems),
    reviewable: counts.counted > 0 && gaps.length === 0,
    note: '仅检查计分记录的目标、结果和来源关联是否填写，不能证明漏洞可复现、目标已授权或得分规则无误。',
  }
}
