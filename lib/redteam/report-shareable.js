/** Optional best-effort sharing copy. Raw reporting remains unchanged.
 * Do not call this comprehensive PII anonymization; review output before publication.
 */
export function makeShareableReport(report) {
  if (!report || typeof report.markdown !== 'string' || !Array.isArray(report.items)) {
    throw new Error('报告缺少 markdown 或 items')
  }
  let content = report.markdown
    .replace(/-----BEGIN (?:(?:RSA|EC|OPENSSH|DSA) )?PRIVATE KEY-----[\s\S]*?-----END (?:(?:RSA|EC|OPENSSH|DSA) )?PRIVATE KEY-----/g,
      '[REDACTED_PRIVATE_KEY]')
    .replace(/\b((?:Proxy-)?Authorization\s*:\s*)[^\r\n]+/gi, '$1[REDACTED_SECRET]')
    .replace(/\b((?:Set-Cookie|Cookie)\s*:\s*)[^\r\n]+/gi, '$1[REDACTED_SECRET]')
    .replace(/(["']?(?:password|passwd|pwd|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|client[_-]?secret)["']?\s*[:=]\s*)(["']?)[^\s"'\r\n&,}\]]+/gi,
      (_whole, prefix, quote) => prefix + quote + '[REDACTED_SECRET]')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '[EVIDENCE OMITTED]')
  if (typeof report.target === 'string' && report.target.length > 2) {
    content = content.split(report.target).join('[REDACTED_TARGET]')
  }
  const ips = new Map()
  content = content.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (ip) => {
    if (!ips.has(ip)) ips.set(ip, 'IP-' + String(ips.size + 1).padStart(2, '0'))
    return ips.get(ip)
  })
  return {
    target: 'shareable',
    summary: report.summary,
    markdown: content,
    items: report.items.map(() => ({ shots: [] })),
  }
}
