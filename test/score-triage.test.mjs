import test from 'node:test'
import assert from 'node:assert/strict'
import { isUntestedLiveAsset, reviewScoring, nextTaskCard, taskKey, filterBlockedActions, compareProgress, sessionReadiness, reviewCandidateQueue, decideTaskHandoff, planUntestedAssetTasks } from '../lib/redteam/score-triage.js'

const rules = [
  { code: 'server-host', re: /服务器权限|命令执行成功/i },
  { code: 'db-credential', re: /数据库权限|数据库凭据/i },
]
const points = (hits) => ({
  items: [
    { code: 'server-host', points: 50, enabled: true, hits },
    { code: 'db-credential', points: 50, enabled: true, hits: [] },
  ],
})
const vuln = (id, extra = {}) => ({
  id, status: 'confirmed', title: '服务问题', gained: '服务器权限', evidence: '执行结果已记录',
  ...extra,
})
test('待测判定使用 test_status，不把已测试/放弃的资产重新派活', () => {
  assert.equal(isUntestedLiveAsset({ state: 'live', test_status: 'untested' }), true)
  assert.equal(isUntestedLiveAsset({ state: 'live' }), true)
  for (const status of ['tested', 'testing', 'blocked', 'abandoned', 'no_surface']) {
    assert.equal(isUntestedLiveAsset({ state: 'live', test_status: status }), false)
  }
  assert.equal(isUntestedLiveAsset({ state: 'dead', test_status: 'untested' }), false)
})
test('同一个得分 code 在另一个漏洞命中，不能标记本漏洞已得分', () => {
  const result = reviewScoring([vuln(1), vuln(2)], points([{
    id: 4, vuln_id: 1, capped: false, self_created: false,
  }]), rules)
  assert.equal(result.suggestions[0].suggest[0].recorded, true)
  assert.equal(result.suggestions[0].suggest[0].counted, true)
  assert.equal(result.suggestions[1].suggest[0].recorded, false)
  assert.equal(result.suggestions[1].suggest[0].elsewhere_recorded, true)
  assert.equal(result.suggestions[1].status, 'review-ready')
})
test('漏洞标题/组件名称不能冒充权限成果', () => {
  const r = reviewScoring([vuln(5, {
    title: 'MySQL 弱口令风险', gained: '', evidence: '探测结果',
  })], points([]), rules)
  assert.equal(r.suggestions.length, 0)
  assert.equal(r.followup[0].status, 'no-outcome')
})
test('缺证据、被封顶、自建账号不得标记为有效得分', () => {
  const rows = [
    vuln(1, { evidence: '', http_evidence: [] }),
    vuln(2),
    vuln(3),
  ]
  const r = reviewScoring(rows, points([
    { id: 9, vuln_id: 2, capped: true, self_created: false },
    { id: 10, vuln_id: 3, capped: false, self_created: true },
  ]), rules)
  assert.equal(r.needs_evidence, 1)
  assert.equal(r.recorded_not_counted, 2)
  assert.equal(r.counted, 0)
  assert.equal(r.suggestions[1].suggest[0].recorded, true)
  assert.equal(r.suggestions[1].suggest[0].counted, false)
})
test('原始 HTTP 证据存在时可列入待复核，但不会自动加分', () => {
  const r = reviewScoring([vuln(7, {
    evidence: '', http_evidence: [{ request: 'GET / HTTP/1.1' }],
  })], points([]), rules)
  assert.equal(r.review_ready, 1)
  assert.equal(r.counted, 0)
})

test('任务卡只选一个优先待办；priority=0 不被误排到末尾', () => {
  const card = nextTaskCard([
    { priority: 2, action: '可选任务', target: 'asset #7' },
    { priority: 0, action: '核对未计分命中', target: 'vuln #3', tool: 'redteam_score_list' },
  ], { score_points: 100, score_hits: 1, recorded_hits: 3 })
  assert.equal(card.status, 'ready')
  assert.equal(card.title, '核对未计分命中')
  assert.equal(card.first_tool, 'redteam_score_list')
  assert.equal(card.before.score_points, 100)
  assert.equal(card.before.counted_hits, 1)
  assert.equal(card.workflow.length, 3)
})
test('没有可信待办项时，不生成假的得分任务', () => {
  const result = nextTaskCard([], { score_points: 0 })
  assert.equal(result.status, 'idle')
  assert.equal(Object.hasOwn(result, 'first_tool'), false)
})

test('进度对账只把真正的有效分值增长视为得分', () => {
  const base = { score_points: 0, counted_hits: 0, recorded_hits: 0, assets: 2, confirmed: 1 }
  const scored = compareProgress(base, { ...base, score_points: 50, counted_hits: 1, recorded_hits: 1 })
  assert.equal(scored.status, 'scored')
  assert.equal(scored.delta.score_points, 50)
  assert.equal(scored.measurable_change, true)
  const discovered = compareProgress(base, { ...base, assets: 3, confirmed: 2 })
  assert.equal(discovered.status, 'records-added')
  assert.equal(discovered.score_increased, false)
  const duplicated = compareProgress(base, { ...base, recorded_hits: 1 })
  assert.equal(duplicated.status, 'records-added')
  assert.equal(duplicated.score_increased, false)
})
test('没有统计变化不能声称得分，记录减少不能算新增', () => {
  const base = { score_points: 20, counted_hits: 1, recorded_hits: 1, assets: 3, confirmed: 2 }
  const unchanged = compareProgress(base, { ...base })
  assert.equal(unchanged.status, 'no-change')
  assert.equal(unchanged.measurable_change, false)
  const changed = compareProgress(base, { ...base, score_points: 10 })
  assert.equal(changed.status, 'records-changed')
  assert.equal(changed.score_increased, false)
})
test('进度对账拒绝不完整的基线，不能靠缺失字段捏造增量', () => {
  assert.throws(
    () => compareProgress({ assets: 2 }, { score_points: 10, counted_hits: 1, recorded_hits: 1, assets: 2, confirmed: 1 }),
    /progress snapshot requires/,
  )
  assert.throws(
    () => compareProgress({ score_points: 0, counted_hits: 0, recorded_hits: 0, assets: 0, confirmed: 0 },
      { score_points: NaN, counted_hits: 0, recorded_hits: 0, assets: 0, confirmed: 0 }),
    /progress snapshot requires/,
  )
})

test('完成资产检查也算进展，即使没有新增漏洞或分数', () => {
  const before = {
    score_points: 0, counted_hits: 0, recorded_hits: 0, assets: 5, confirmed: 0,
    findings: 0, reviewed_assets: 0, evidence_items: 0,
  }
  const result = compareProgress(before, { ...before, reviewed_assets: 1 })
  assert.equal(result.status, 'records-added')
  assert.equal(result.delta.reviewed_assets, 1)
  assert.equal(result.score_increased, false)
})
test('新增候选漏洞和 HTTP 证据会计入记录进展，但不伪报得分', () => {
  const before = {
    score_points: 10, counted_hits: 1, recorded_hits: 1, assets: 5, confirmed: 1,
    findings: 2, reviewed_assets: 1, evidence_items: 3,
  }
  const result = compareProgress(before, { ...before, findings: 3, evidence_items: 4 })
  assert.equal(result.status, 'records-added')
  assert.equal(result.delta.findings, 1)
  assert.equal(result.delta.evidence_items, 1)
  assert.equal(result.delta.score_points, 0)
})
test('旧版五字段基线仍可对账，新版基线丢字段则报错', () => {
  const old = { score_points: 0, counted_hits: 0, recorded_hits: 0, assets: 1, confirmed: 0 }
  assert.equal(compareProgress(old, { ...old, findings: 3 }).status, 'no-change')
  const fresh = { ...old, findings: 1, reviewed_assets: 0, evidence_items: 0 }
  const card = nextTaskCard([{ priority: 1, action: '检查现有记录' }], fresh)
  assert.equal(card.before.findings, 1)
  assert.equal(card.before.reviewed_assets, 0)
  assert.throws(() => compareProgress(card.before, old), /progress snapshot requires/)
})

test('禁用、缺失及旧口径得分点不列为可复核记分成果', () => {
  const disabled = reviewScoring([vuln(11)], { items: [
    { code: 'server-host', points: 50, enabled: false, hits: [] },
  ] }, rules)
  assert.equal(disabled.review_ready, 0)
  assert.equal(disabled.unavailable_rule, 1)
  assert.equal(disabled.suggestions[0].suggest[0].available, false)
  assert.equal(disabled.followup[0].status, 'rule-unavailable')

  const missing = reviewScoring([vuln(12)], { items: [] }, rules)
  assert.equal(missing.unavailable_rule, 1)
  assert.equal(missing.review_ready, 0)

  const legacy = reviewScoring([vuln(13)], { items: [
    { code: 'server-host', points: 50, enabled: true, legacy: true, hits: [] },
  ] }, rules)
  assert.equal(legacy.unavailable_rule, 1)
  assert.equal(legacy.suggestions[0].suggest[0].available, false)
})
test('多个匹配规则中只要有一条可用，仍可进入人工复核', () => {
  const r = reviewScoring([vuln(14, { gained: '服务器权限和数据库凭据' })], {
    items: [
      { code: 'server-host', points: 50, enabled: false, hits: [] },
      { code: 'db-credential', points: 50, enabled: true, hits: [] },
    ],
  }, rules)
  assert.equal(r.review_ready, 1)
  assert.equal(r.unavailable_rule, 0)
  assert.equal(r.suggestions[0].suggest.filter((s) => s.available).length, 1)
})

test('确认阻塞的任务可跳过，其他目标不受影响', () => {
  const actions = [
    { priority: 1, action: '核对证据', target: 'vuln #1' },
    { priority: 2, action: '核对证据', target: 'vuln #2' },
  ]
  const blocked = taskKey(actions[0])
  const remaining = filterBlockedActions(actions, blocked)
  assert.equal(remaining.length, 1)
  assert.equal(nextTaskCard(remaining).target, 'vuln #2')
  assert.equal(filterBlockedActions(actions).length, 2)
  assert.equal(filterBlockedActions([actions[0]], blocked).length, 0)
  assert.equal(nextTaskCard(filterBlockedActions([actions[0]], blocked)).status, 'idle')
})
test('计分索引只关联匹配的有效漏洞 ID，不误把非法 ID 归为已有计分', () => {
  const board = { items: [{ code: 'server-host', points: 50, enabled: true, hits: [
    { id: 1, vuln_id: 1, capped: false, self_created: false },
    { id: 2, vuln_id: 'nonsense', capped: false, self_created: false },
    { id: 3, vuln_id: null, capped: false, self_created: false },
  ] }] }
  const result = reviewScoring([vuln(1), vuln(2), vuln('nonsense')], board, rules)
  assert.equal(result.counted, 1)
  assert.equal(result.suggestions[0].linked_hits, 1)
  assert.equal(result.suggestions[1].status, 'review-ready')
  assert.equal(result.suggestions[2].status, 'review-ready')
})
test('批量漏洞与命中仍按对应的 vuln_id 一一对账', () => {
  const vulns = Array.from({ length: 400 }, (_, i) => vuln(i + 1))
  const hits = vulns.map((item) => ({
    id: item.id, vuln_id: item.id, capped: false, self_created: false,
  }))
  const result = reviewScoring(vulns, points(hits), rules)
  assert.equal(result.counted, 400)
  assert.equal(result.suggestions.length, 400)
  assert.equal(result.followup.length, 0)
})

test('任务进度基线绑定具体演练，拒绝跨靶标混算', () => {
  const state = {
    engagement_id: 'target-a',
    score_points: 5, score_hits: 1, recorded_hits: 1, assets: 2, confirmed: 1,
  }
  const card = nextTaskCard([{ priority: 1, action: '复核证据', target: 'vuln #1' }], state)
  assert.equal(card.before.engagement_id, 'target-a')
  const other = { ...card.before, engagement_id: 'target-b', score_points: 100 }
  assert.throws(() => compareProgress(card.before, other), /engagement_id mismatch/)
  assert.throws(() => compareProgress(card.before, { ...card.before, engagement_id: undefined }), /engagement_id mismatch/)
  const same = compareProgress(card.before, { ...card.before, score_points: 15 })
  assert.equal(same.status, 'scored')
  assert.equal(same.delta.score_points, 10)
})

test('离线入口、自建隧道、未知或关闭通道不得当成有效访问路径', () => {
  const s = sessionReadiness(
    [{ id: 1, status: 'offline' }, { id: 2, status: 'dead' }],
    [
      { id: 10, status: 'active', legit: false },
      { id: 11, status: 'down', legit: true },
      { id: 12, status: 'active', legit: null },
    ],
  )
  assert.equal(s.online_shells, 0)
  assert.equal(s.active_target_tunnels, 0)
  assert.equal(s.shell_status_review, true)
  assert.equal(s.tunnel_status_review, true)
  const valid = sessionReadiness(
    [{ status: 'online' }],
    [{ status: 'active', legit: true }, { status: 'unknown', legit: true }],
  )
  assert.equal(valid.online_shells, 1)
  assert.equal(valid.active_target_tunnels, 1)
  assert.equal(valid.shell_status_review, false)
  assert.equal(valid.tunnel_status_review, false)
  assert.equal(sessionReadiness().active_target_tunnels, 0)
})

test('候选按关联的存活资产及实际证据分队列，严重程度只决定复核顺序', () => {
  const assets = [
    { id: 1, state: 'live', test_status: 'untested', ip: '192.0.2.10' },
    { id: 2, state: 'live', test_status: 'tested', ip: '192.0.2.20' },
  ]
  const candidates = [
    { id: 5, status: 'candidate', asset_id: 1, severity: 'low', title: '低风险候选', evidence: '观察到响应差异' },
    { id: 7, status: 'candidate', asset_id: 2, severity: 'high', title: '高风险候选', http_evidence: [{ note: '已记录测试' }] },
    { id: 8, status: 'candidate', asset_id: 1, severity: 'critical', title: '无证据候选' },
    { id: 9, status: 'confirmed', asset_id: 1, severity: 'critical', evidence: '已确认' },
  ]
  const q = reviewCandidateQueue(candidates, assets)
  assert.equal(q.total, 3)
  assert.deepEqual(q.ready.map((v) => v.vuln_id), [7, 5])
  assert.deepEqual(q.needs_evidence.map((v) => v.vuln_id), [8])
  assert.equal(q.needs_scope.length, 0)
  assert.equal(q.deferred.length, 0)
  assert.equal(q.ready[0].asset_ip, '192.0.2.20')
})

test('无资产关联/记录不在样本中只提示核对范围，失活与阻塞资产暂缓复核', () => {
  const assets = [
    { id: 1, state: 'dead', ip: '192.0.2.1' },
    { id: 2, state: 'live', test_status: 'blocked', ip: '192.0.2.2' },
    { id: 3, state: 'live', test_status: 'abandoned', ip: '192.0.2.3' },
    { id: 4, state: 'live', test_status: 'no_surface', ip: '192.0.2.4' },
    { id: 6, state: 'live', test_status: 'testing', ip: '192.0.2.6' },
  ]
  const candidates = [1, 2, 3, 4, 5, null, 6].map((asset_id, index) => ({
    id: index + 1, status: 'candidate', severity: 'high', asset_id, evidence: '旧观察结果',
  }))
  const q = reviewCandidateQueue(candidates, assets)
  assert.deepEqual(q.deferred.map((v) => v.vuln_id), [1, 2, 3, 4, 7])
  assert.deepEqual(q.needs_scope.map((v) => v.vuln_id), [5, 6])
  assert.equal(q.ready.length, 0)
  assert.equal(q.needs_evidence.length, 0)
})

test('多个阻塞任务一次过滤，仅排除完全相同的动作和目标', () => {
  const actions = [
    { priority: 2, action: '复核漏洞', target: 'vuln #1' },
    { priority: 2, action: '复核漏洞', target: 'vuln #2' },
    { priority: 3, action: '核对证据', target: 'vuln #1' },
    { priority: 3, action: '复核漏洞', target: 'vuln #3' },
  ]
  const blocked = actions.slice(0, 2).map(taskKey)
  const left = filterBlockedActions(actions, blocked)
  assert.deepEqual(left.map((x) => x.target), ['vuln #1', 'vuln #3'])
  assert.equal(left[0].action, '核对证据')
  assert.equal(filterBlockedActions(actions, taskKey(actions[0])).length, 3)
  assert.equal(filterBlockedActions(actions, []).length, 4)
})


test('任务交接：真实新增记录或分数才重新选任务，不把新增记录冒充得分', () => {
  const before = {
    engagement_id: 'authorized-lab',
    score_points: 0, counted_hits: 0, recorded_hits: 0,
    assets: 2, confirmed: 0, findings: 0, reviewed_assets: 1, evidence_items: 0,
  }
  const scored = compareProgress(before, { ...before, score_points: 30, counted_hits: 1 })
  const result1 = decideTaskHandoff(scored, 'done')
  assert.equal(result1.decision, 'continue')
  assert.equal(scored.status, 'scored')
  const evidence = compareProgress(before, { ...before, evidence_items: 1 })
  const result2 = decideTaskHandoff(evidence, 'done')
  assert.equal(result2.decision, 'continue')
  assert.equal(evidence.score_increased, false)
  assert.equal(evidence.status, 'records-added')
})

test('任务交接：声称完成却没有统计变化要停下核查，不因工具调用结束就自动续派', () => {
  const base = { score_points: 10, counted_hits: 1, recorded_hits: 1, assets: 2, confirmed: 0 }
  assert.equal(decideTaskHandoff(compareProgress(base, { ...base }), 'done').decision, 'hold')
  assert.equal(decideTaskHandoff(compareProgress(base, { ...base, score_points: 0 }), 'done').decision, 'hold')
  assert.equal(decideTaskHandoff(compareProgress(base, { ...base, assets: 3 }), 'inconclusive').decision, 'hold')
})

test('任务交接：明确阻塞只跳过本任务；无合法结论拒绝生成决策', () => {
  const base = { score_points: 0, counted_hits: 0, recorded_hits: 0, assets: 1, confirmed: 0 }
  const same = compareProgress(base, { ...base })
  assert.equal(decideTaskHandoff(same, 'blocked').decision, 'skip')
  assert.throws(() => decideTaskHandoff(same, 'success'), /outcome must/)
  assert.throws(() => decideTaskHandoff(null, 'done'), /progress comparison/)
})


test('未测资产逐台生成稳定任务，阻塞一台后可继续下一台', () => {
  const assets = [
    { id: 8, ip: '192.0.2.8', state: 'live', test_status: 'untested' },
    { id: 9, ip: '192.0.2.9', state: 'live', test_status: 'tested' },
    { id: 12, ip: '192.0.2.12', state: 'live', test_status: 'untested' },
  ]
  const actions = planUntestedAssetTasks(assets)
  assert.deepEqual(actions.map((a) => a.target), ['asset #8', 'asset #12'])
  assert.equal(actions[0].action, '漏洞发现')
  assert.match(actions[0].why, /192\.0\.2\.8/)
  const blockedKey = taskKey(actions[0])
  const remaining = filterBlockedActions(actions, blockedKey)
  assert.equal(nextTaskCard(remaining).target, 'asset #12')
  const ipChanged = planUntestedAssetTasks([{ ...assets[0], ip: '198.51.100.8' }])
  assert.equal(taskKey(ipChanged[0]), blockedKey)
  const many = Array.from({ length: 35 }, (_, i) => ({
    id: i + 1, ip: '192.0.2.' + (i + 1), state: 'live', test_status: 'untested',
  }))
  assert.equal(planUntestedAssetTasks(many).length, 30)
})
