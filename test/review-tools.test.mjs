import test from 'node:test'
import assert from 'node:assert/strict'
import { reviewScope, reviewDelivery } from '../lib/redteam/review-tools.js'

test('显式 IPv4/IPv6 CIDR 精确核对，不把其他网段算入范围', () => {
  const result = reviewScope([
    { id: 1, ip: '192.0.2.22' },
    { id: 2, ip: '192.0.3.1' },
    { id: 3, ip: '2001:db8:1::a' },
    { id: 4, ip: '2001:db9::1' },
    { id: 5, ip: '::ffff:192.0.2.22' },
  ], '192.0.2.0/24, 2001:db8::/32, ::ffff:192.0.2.0/120')
  assert.equal(result.ip_matched, 3)
  assert.equal(result.unmatched, 2)
  assert.equal(result.name_only, 0)
})

test('域名仅命中完整主机或真正的子域名，名称匹配不表示 IP 自动授权', () => {
  const result = reviewScope([
    { id: 1, ip: '198.51.100.1', primary_name: 'example.test' },
    { id: 2, ip: '198.51.100.2', primary_name: 'a.example.test' },
    { id: 3, ip: '198.51.100.3', primary_name: 'fakeexample.test' },
    { id: 4, ip: '198.51.100.4', primary_name: 'example.test.evil' },
    { id: 5, ip: '198.51.100.5', names: [{ name: 'b.example.test' }] },
  ], 'example.test,*.example.test')
  assert.equal(result.name_only, 3)
  assert.equal(result.unmatched, 2)
  assert.equal(result.items[0].needs_review, true)
})
test('无明确规则、非法网段和非法域名均拒绝，不静默放宽范围', () => {
  const a = [{ id: 1, ip: '127.0.0.1' }]
  assert.throws(() => reviewScope(a, ''), /scope requires/)
  assert.throws(() => reviewScope(a, '192.0.2.0/33'), /invalid CIDR/)
  assert.throws(() => reviewScope(a, '2001:db8::/129'), /invalid CIDR/)
  assert.throws(() => reviewScope(a, '*.evil..test'), /invalid hostname/)
})
test('仅审阅真实计分命中，排除封顶、自建、禁用项', () => {
  const result = reviewDelivery({ items: [
    { code: 'server-host', enabled: true, hits: [
      { id: 1, target: '192.0.2.1:443', evidence: '会话已验证', vuln_id: 2, capped: false, self_created: false },
      { id: 2, evidence: '重复', capped: true },
      { id: 3, evidence: '自建账号', self_created: true },
      { id: 4, target: '', evidence: '', vuln_id: null, step_id: null },
    ] },
    { code: 'obsolete', enabled: false, hits: [{ id: 5 }] },
  ] })
  assert.equal(result.counted, 2)
  assert.equal(result.gaps, 1)
  assert.deepEqual(result.issues[0].reasons, ['no_target', 'no_evidence', 'no_origin'])
  assert.equal(result.reviewable, false)
})
test('没有命中不等于交付已就绪；分页只限制详情不改变缺口总数', () => {
  assert.equal(reviewDelivery({ items: [] }).reviewable, false)
  const result = reviewDelivery({ items: [{ code: 'x', enabled: true, hits: [
    { id: 1, evidence: 'evidence' }, { id: 2, evidence: 'evidence' }, { id: 3, evidence: 'evidence' },
  ] }] }, 1)
  assert.equal(result.gaps, 3)
  assert.equal(result.issues.length, 1)
  assert.equal(result.omitted, 2)
})

test('范围复核结果优先呈现未匹配与仅域名匹配资产', () => {
  const assets = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, ip: '192.0.2.' + (i + 1) }))
  assets.push({ id: 31, ip: '198.51.100.1', primary_name: 'sub.example.test' })
  assets.push({ id: 32, ip: '203.0.113.1' })
  const result = reviewScope(assets, '192.0.2.0/24,*.example.test', 3)
  assert.equal(result.ip_matched, 30)
  assert.equal(result.name_only, 1)
  assert.equal(result.unmatched, 1)
  assert.equal(result.items.length, 3)
  assert.deepEqual(result.items.map((x) => x.status), ['unmatched', 'name-only', 'ip-matched'])
  assert.equal(result.sample_truncated, true)
})

test('旧口径命中不能误报为有效交付，禁用规则也应跳过', () => {
  const result = reviewDelivery({ items: [
    { code: 'legacy', enabled: true, legacy: true, hits: [{ id: 1 }] },
    { code: 'disabled', enabled: false, hits: [{ id: 2 }] },
    { code: 'valid', enabled: true, hits: [
      { id: 3, target: '192.0.2.10', evidence: '已记录核对结果', vuln_id: 5 },
    ] },
  ] })
  assert.equal(result.counted, 1)
  assert.equal(result.gaps, 0)
  assert.equal(result.reviewable, true)
})
