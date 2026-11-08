/**
 * 只读得分对账。漏洞、得分与待测资产都来自同一个演练库。
 * 目标：避免把“发现了组件”错当“拿到权限”，也避免不同漏洞共用一条得分标记。
 */
export function isUntestedLiveAsset(asset) {
  return !!asset && asset.state === 'live'
    && (!asset.test_status || asset.test_status === 'untested')
}

/**
 * 单资产任务卡使用稳定数据库 ID，不把动态资产总数写进 task_key。
 * 允许跳过单个受阻目标后继续下一台；只是只读计划，不触发扫描。
 */
export function planUntestedAssetTasks(assets = []) {
  return (Array.isArray(assets) ? assets : [])
    .filter(isUntestedLiveAsset)
    .slice(0, 30)
    .map((asset) => ({
      priority: 3,
      action: '漏洞发现',
      target: 'asset #' + asset.id,
      why: '资产 ' + (asset.ip || asset.id) + ' 仍标记为未测试；先核对授权范围与既有记录，不推断漏洞是否存在',
      expected: '记录该资产的实际检查结果、测试状态或阻塞原因，不把扫描执行当作得分',
      tool: 'redteam_asset_get → subagent redteamRole: vuln-scan',
    }))
}

export function reviewScoring(vulns = [], board = {}, rules = [], defaultPoints = {}, missingByCode = {}) {
  const points = Array.isArray(board.items) ? board.items : []
  const pointByCode = new Map(points.map((p) => [String(p.code), p]))
  /* 各命中仅索引一次，避免对每条漏洞重复扫描整个得分面板。 */
  const linkedByVuln = new Map()
  for (const point of points) {
    for (const hit of Array.isArray(point.hits) ? point.hits : []) {
      if (hit.vuln_id == null) continue
      const id = Number(hit.vuln_id)
      if (!Number.isFinite(id)) continue
      if (!linkedByVuln.has(id)) linkedByVuln.set(id, [])
      linkedByVuln.get(id).push({ hit, point })
    }
  }
  const confirmed = (Array.isArray(vulns) ? vulns : [])
    .filter((v) => v.status === 'confirmed' || v.status === 'exploited')
  const rows = confirmed.map((v) => {
    const gained = String(v.gained || '').trim()
    const evidence = String(v.evidence || '').trim()
    const hasEvidence = !!evidence || v.has_http_evidence === 1 || v.has_http_evidence === true || (Array.isArray(v.http_evidence)
      && v.http_evidence.some((e) => !!(e.request || e.response || e.note)))
    const vulnId = v.id == null ? NaN : Number(v.id)
    const linked = Number.isFinite(vulnId) ? (linkedByVuln.get(vulnId) || []) : []
    const linkedCounted = linked.some(({ hit, point }) =>
      point.enabled === true && point.legacy !== true && !hit.capped && !hit.self_created)
    const matched = gained
      ? rules.filter((rule) => rule.re.test(gained))
      : []
    const suggest = matched.map((rule) => {
      const point = pointByCode.get(rule.code)
      const hits = point && Array.isArray(point.hits) ? point.hits : []
      const ownHits = linked.filter((item) => item.point === point).map((item) => item.hit)
      return {
        code: rule.code,
        points: point ? Number(point.points) || 0 : defaultPoints[rule.code] || 0,
        available: !!point && point.enabled === true && point.legacy !== true,
        recorded: ownHits.length > 0,
        counted: !!point && point.enabled === true && point.legacy !== true
          && ownHits.some((h) => !h.capped && !h.self_created),
        elsewhere_recorded: hits.length > ownHits.length,
        missing: missingByCode[rule.code] || '补充可复核的目标、结果和证据，再核对计分档位',
      }
    })
    const hasAvailableRule = suggest.some((item) => item.available)
    const status = linkedCounted ? 'counted'
      : linked.length ? 'recorded-not-counted'
      : !gained ? 'no-outcome'
      : matched.length === 0 ? 'unmapped-outcome'
      : !hasAvailableRule ? 'rule-unavailable'
      : !hasEvidence ? 'missing-evidence'
      : 'review-ready'
    const note = status === 'no-outcome'
      ? '已确认漏洞不等于取得权限；补写实际成果，不从标题或组件名推断得分'
      : status === 'missing-evidence'
        ? '已有成果声明但缺少证据；先补实际结果，不自动写分'
        : status === 'recorded-not-counted'
          ? '已有关联命中，但它可能被去重、封顶、禁用或标记为自建账号；查看已有命中原因'
          : status === 'unmapped-outcome'
            ? '成果描述未匹配任何计分项；先读 redteam_score_list 核对真实 code'
            : status === 'rule-unavailable'
              ? '描述能匹配规则，但对应计分点缺失、已禁用或属于旧口径；不能当成待记分成果'
              : status === 'review-ready'
              ? '成果与证据字段已存在；仍需人工或规则复核授权、真实性和档位'
              : '已找到本漏洞关联的有效计分记录'
    return {
      vuln_id: v.id,
      title: String(v.title || '').slice(0, 80),
      severity: v.severity,
      gained: gained.slice(0, 120),
      evidence_present: hasEvidence,
      linked_hits: linked.length,
      status,
      suggest,
      note,
    }
  })
  return {
    confirmed: rows.length,
    counted: rows.filter((row) => row.status === 'counted').length,
    review_ready: rows.filter((row) => row.status === 'review-ready').length,
    needs_evidence: rows.filter((row) => row.status === 'missing-evidence').length,
    needs_outcome: rows.filter((row) => row.status === 'no-outcome').length,
    recorded_not_counted: rows.filter((row) => row.status === 'recorded-not-counted').length,
    unavailable_rule: rows.filter((row) => row.status === 'rule-unavailable').length,
    suggestions: rows.filter((row) => row.suggest.length > 0),
    followup: rows.filter((row) => row.status !== 'counted'),
  }
}

/**
 * 给能力一般的指挥模型一张唯一的“下一步任务卡”。只组织现有建议，
 * 不执行任务、不验证授权、不写分。执行后应重新读取真实库状态。
 */
/** 会话审阅只认已记录的有效状态，不把离线入口、自建代理或未知通道当成可用路径。 */
export function sessionReadiness(shells = [], tunnels = []) {
  const s = Array.isArray(shells) ? shells : []
  const t = Array.isArray(tunnels) ? tunnels : []
  const online = s.filter((item) => item && item.status === 'online')
  const activeTarget = t.filter((item) => item && item.status === 'active' && item.legit === true)
  return {
    shells_total: s.length,
    online_shells: online.length,
    tunnels_total: t.length,
    active_target_tunnels: activeTarget.length,
    shell_status_review: s.length > 0 && online.length === 0,
    tunnel_status_review: t.length > 0 && activeTarget.length === 0,
  }
}

/**
 * 从已有漏洞库选出「可复核」候选项，避免模型每轮都选列表第一个、
 * 对失活/阻塞目标重复建议攻击，或者把缺证据与缺授权当成已准备好。
 * 这里只处理现有记录，不扫描、不推断授权、不修改漏洞状态。
 */
export function reviewCandidateQueue(vulns = [], assets = []) {
  const assetById = new Map((Array.isArray(assets) ? assets : [])
    .filter((asset) => asset && asset.id !== undefined && asset.id !== null)
    .map((asset) => [String(asset.id), asset]))
  const queue = { ready: [], needs_evidence: [], needs_scope: [], deferred: [] }
  const severityRank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
  for (const vuln of Array.isArray(vulns) ? vulns : []) {
    if (!vuln || vuln.status !== 'candidate') continue
    const asset = vuln.asset_id == null ? null : assetById.get(String(vuln.asset_id))
    const hasEvidence = !!String(vuln.evidence || '').trim()
      || vuln.has_http_evidence === 1 || vuln.has_http_evidence === true
      || (Array.isArray(vuln.http_evidence) && vuln.http_evidence.some((item) =>
        !!(item && (item.request || item.response || item.note))))
    const entry = {
      vuln_id: vuln.id,
      title: String(vuln.title || '').slice(0, 80),
      severity: vuln.severity || 'info',
      asset_id: asset?.id ?? vuln.asset_id ?? null,
      asset_ip: String(asset?.ip || vuln.asset_ip || '').slice(0, 128),
      evidence_present: hasEvidence,
    }
    if (!asset) queue.needs_scope.push(entry)
    else if (asset.state !== 'live' || ['testing', 'blocked', 'abandoned', 'no_surface'].includes(asset.test_status)) {
      queue.deferred.push(entry)
    } else if (!hasEvidence) queue.needs_evidence.push(entry)
    else queue.ready.push(entry)
  }
  const rank = (a, b) => (severityRank[a.severity] ?? 5) - (severityRank[b.severity] ?? 5)
    || Number(a.vuln_id) - Number(b.vuln_id) || String(a.vuln_id).localeCompare(String(b.vuln_id))
  for (const group of Object.values(queue)) group.sort(rank)
  return {
    total: Object.values(queue).reduce((n, group) => n + group.length, 0),
    ready: queue.ready,
    needs_evidence: queue.needs_evidence,
    needs_scope: queue.needs_scope,
    deferred: queue.deferred,
  }
}

/** 任务标识只取动作与明确目标，不把分值或优先级编码进去。 */
export function taskKey(action = {}) {
  return String(action.action || '') + ':' + String(action.target || '')
}

/** 用户确认阻塞后，只跳过完全相同的动作+目标；新条件或目标变化不会被永久屏蔽。 */
export function filterBlockedActions(actions = [], blockedTaskKeys = '') {
  const keys = new Set((Array.isArray(blockedTaskKeys) ? blockedTaskKeys : [blockedTaskKeys])
    .filter((key) => typeof key === 'string' && key.trim())
    .map((key) => key.trim()))
  const candidates = Array.isArray(actions) ? actions : []
  return keys.size ? candidates.filter((action) => !keys.has(taskKey(action))) : candidates
}

export function nextTaskCard(actions = [], state = {}) {
  const ranked = (Array.isArray(actions) ? actions : [])
    .map((action, index) => ({ action, index }))
    .sort((a, b) => (Number.isFinite(Number(a.action.priority)) ? Number(a.action.priority) : 99)
      - (Number.isFinite(Number(b.action.priority)) ? Number(b.action.priority) : 99) || a.index - b.index)
  const selected = ranked[0] && ranked[0].action
  if (!selected) return {
    status: 'idle',
    instruction: '没有可信的待办项：先核对任务范围与当前记录，不凭空创建攻击任务。',
  }
  return {
    status: 'ready',
    task_key: taskKey(selected),
    title: String(selected.action || '核对当前任务'),
    target: String(selected.target || ''),
    priority: selected.priority,
    reason: String(selected.why || ''),
    first_tool: String(selected.tool || ''),
    expected: String(selected.expected || '记录可复核的实际结果'),
    before: {
      ...(state.engagement_id ? { engagement_id: String(state.engagement_id) } : {}),
      score_points: Number(state.score_points) || 0,
      counted_hits: Number(state.score_hits) || 0,
      recorded_hits: Number(state.recorded_hits) || 0,
      assets: Number(state.assets) || 0,
      confirmed: Number(state.confirmed) || 0,
      findings: Number(state.findings) || 0,
      reviewed_assets: Number(state.reviewed_assets) || 0,
      evidence_items: Number(state.evidence_items) || 0,
    },
    workflow: [
      '先核对目标是否属于自有或明确授权范围，以及该目标此前的测试记录。',
      '只处理这一件任务；输出真实结果、失败原因与对应的库记录 ID。',
      '任务结束后重读得分和资产状态，只把实际变化算作进展。',
    ],
    done_when: '已有可核对的结果与对应的记录；分数只有在计分面板实际增加时才算新增。',
    if_blocked: '写清缺失资源、失败原因或缺少证据；没有条件变化时不重复同一动作，改为其他可行任务或请求用户决定。',
  }
}

/**
 * 任务完成后的交接判断。基于真实统计增量 + 执行者明确声明的结论，
 * 不能仅凭“调用了工具”或者没有统计变化自动判定任务成功/失败。
 * 纯函数；不会启动下一任务、修改库或重试。
 */
export function decideTaskHandoff(progress, outcome) {
  if (!['done', 'blocked', 'inconclusive'].includes(outcome)) {
    throw new Error('outcome must be done, blocked or inconclusive')
  }
  if (!progress || typeof progress.status !== 'string') {
    throw new Error('handoff requires a progress comparison')
  }
  if (outcome === 'blocked') {
    return {
      decision: 'skip',
      reason: '执行者已确认当前任务阻塞；保留阻塞原因，先跳过同一动作和目标，不在相同条件下重试。',
    }
  }
  if (outcome === 'inconclusive') {
    return {
      decision: 'hold',
      reason: '本轮结果不确定：先核对记录和证据，不派新任务，也不当作验证成功。',
    }
  }
  if (progress.status === 'scored' || progress.status === 'records-added') {
    return {
      decision: 'continue',
      reason: progress.status === 'scored'
        ? '计分已实际增长；从最新库记录生成下一张任务卡。'
        : '存在新增记录但不能视为得分；从最新库记录重新选任务。',
    }
  }
  return {
    decision: 'hold',
    reason: progress.status === 'no-change'
      ? '声称完成但所跟踪统计没有变化；先核对实际回报和未覆盖的证据，避免机械重试。'
      : '本轮主要是记录修正或减少，不能当作新增成果；先解释差异。',
  }
}

/**
 * 对比任务卡执行前的基线和当前库统计。只对实际数据变化下结论；
 * “没有新增分数”与“完全没产出”不混为一谈。
 */
export function compareProgress(before, after) {
  /* 新任务卡绑定 engagement；旧卡不带此字段，仍可按原五项计数兼容。 */
  if (before && Object.prototype.hasOwnProperty.call(before, 'engagement_id')) {
    if (typeof before.engagement_id !== 'string' || !before.engagement_id.trim()
      || !after || after.engagement_id !== before.engagement_id) {
      throw new Error('progress snapshot engagement_id mismatch: compare within the same engagement only')
    }
  }
  const required = ['score_points', 'counted_hits', 'recorded_hits', 'assets', 'confirmed']
  /* 老任务卡只有 5 项：按原字段对账。新版附上检测进展和证据积累。
     基线里存在的新字段必须在当前读数中也存在，避免不完整数据制造假增量。 */
  const optional = ['findings', 'reviewed_assets', 'evidence_items']
  const keys = required.concat(optional.filter((key) =>
    before != null && Object.prototype.hasOwnProperty.call(before, key)))
  const valid = (value) => value && typeof value === 'object'
    && keys.every((key) => Number.isFinite(value[key]) && value[key] >= 0)
  if (!valid(before) || !valid(after)) {
    throw new Error('progress snapshot requires finite nonnegative score_points/counted_hits/recorded_hits/assets/confirmed and all baseline optional fields')
  }
  const delta = Object.fromEntries(keys.map((key) => [key, after[key] - before[key]]))
  const scoreIncreased = delta.score_points > 0
  const recordsIncreased = delta.counted_hits > 0 || delta.recorded_hits > 0
    || delta.assets > 0 || delta.confirmed > 0
    || (delta.findings || 0) > 0 || (delta.reviewed_assets || 0) > 0
    || (delta.evidence_items || 0) > 0
  const changed = keys.some((key) => delta[key] !== 0)
  const status = scoreIncreased ? 'scored'
    : recordsIncreased ? 'records-added'
      : changed ? 'records-changed'
        : 'no-change'
  const summary = status === 'scored'
    ? '计分面板的有效分数确实增加了，按新增分值汇报。'
    : status === 'records-added'
      ? '库里有新增记录，但有效得分没有增加，不能汇报为得分。'
      : status === 'records-changed'
        ? '已有记录或计分发生变化，但没有新增有效分；先解释减少或调整原因。'
        : '本次对账未看到所跟踪的统计变化。不能认定为任务失败，也不能宣称取得成果；核对实际回报后再决定是否换任务。'
  return {
    status, delta, score_increased: scoreIncreased,
    measurable_change: changed, before, after, summary,
    next: status === 'no-change'
      ? '核对本轮是否只更新了已有记录或尚未覆盖的证据；相同条件下若再次失败，停止重试并说明阻塞项。'
      : '刷新 redteam_next_action，从当前事实重新生成唯一任务卡。',
  }
}
