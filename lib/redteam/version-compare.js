/** Compare released fork versions, including the wxcvm build revision. */
export function versionLess(a, b) {
  const parse = (value) => {
    const match = String(value || '').replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-(.*))?$/)
    return match ? { core: match.slice(1, 4).map(Number), suffix: match[4] || '' } : null
  }
  const left = parse(a)
  const right = parse(b)
  if (!left || !right) return false
  for (let i = 0; i < 3; i += 1) {
    if (left.core[i] < right.core[i]) return true
    if (left.core[i] > right.core[i]) return false
  }
  if (!left.suffix && right.suffix) return false
  if (left.suffix && !right.suffix) return true
  const fork = /^wxcvm\.(\d+)$/
  const current = left.suffix.match(fork)
  const latest = right.suffix.match(fork)
  return !!(current && latest && Number(current[1]) < Number(latest[1]))
}
