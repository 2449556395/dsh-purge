/** Shared pagination contract: invalid input must never become SQLite LIMIT -1. */
export function queryPage(options = {}, maxLimit = 2000) {
  const integer = (value, fallback, name, minimum) => {
    if (value === undefined) return fallback
    const acceptable = typeof value === 'number'
      || (typeof value === 'string' && /^\d+$/.test(value.trim()))
    const number = acceptable ? Number(value) : NaN
    if (!Number.isSafeInteger(number) || number < minimum) {
      throw new TypeError(`${name} must be a safe integer >= ${minimum}`)
    }
    return number
  }
  return {
    limit: Math.min(integer(options.limit, 200, 'limit', 1), maxLimit),
    offset: integer(options.offset, 0, 'offset', 0),
  }
}

export function pageMetadata(total, returned, { limit, offset }) {
  const hasMore = returned > 0 && returned < total - offset
  return { limit, offset, returned, hasMore, nextOffset: hasMore ? offset + returned : null }
}

/** 批量漏洞查询只保留可定位、可判断证据缺口的字段；原始 HTTP 正文按 ID 再取。 */
export function compactVuln(v) {
  return {
    id: v.id, asset_id: v.asset_id, asset_ip: v.asset_ip, title: v.title,
    cve: v.cve, severity: v.severity, status: v.status, target: v.target,
    confidence: v.confidence, source: v.source,
    gained: String(v.gained || '').slice(0, 160),
    evidence_summary: String(v.evidence || '').slice(0, 240),
    http_evidence_count: Number(v.http_evidence_count) || 0,
    evidence_present: !!String(v.evidence || '').trim() || Number(v.http_evidence_count) > 0,
  }
}
