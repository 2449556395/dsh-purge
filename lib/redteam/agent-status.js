/**
 * Read-only DSH agent/session registry snapshot.
 * Unknown / failed registry reads must never be counted as confirmed free slots.
 */
import { DEFAULT_MAX_AGENTS, MAX_AGENTS_LIMIT, maxAgentsOf, maxAgentsSourceOf } from './settings.js'

function service(ctx, name) {
  try {
    const found = typeof ctx?.get === 'function' ? ctx.get(name) : undefined
    if (found !== undefined && found !== null) return found
  } catch { /* direct property may still be available */ }
  try { return ctx?.[name] } catch { return undefined }
}

const isRunning = (state) => ['running', 'active', 'busy', 'executing'].includes(state)
const isInactive = (state) => ['idle', 'completed', 'finished', 'closed', 'stopped', 'failed', 'cancelled', 'canceled'].includes(state)

function statusName(value) {
  const state = typeof value === 'string' ? value : value && typeof value.state === 'string' ? value.state : ''
  return state.trim().toLowerCase()
}

export async function collectAgentStatus(ctx, options = {}) {
  const root = service(ctx, 'redteam')?.root
  const max = options.max ?? (root ? maxAgentsOf(root, options.env || process.env) : DEFAULT_MAX_AGENTS)
  const source = root ? maxAgentsSourceOf(root, options.env || process.env) : 'default'
  const base = { max, source, limit: MAX_AGENTS_LIMIT, default_max: DEFAULT_MAX_AGENTS }
  const unavailable = (error) => ({
    ...base, ok: false, available: false, used: null, free: null,
    running: [], total_children: null, per_root: [], used_is_lower_bound: false, error,
  })
  const sessions = service(ctx, 'sessions')
  const subagents = service(ctx, 'subagents')
  if (!sessions || typeof sessions.list !== 'function'
      || !subagents || typeof subagents.listChildren !== 'function') {
    return unavailable('subagents / sessions registry unavailable: cannot read concurrent usage.')
  }
  let records
  try { records = await sessions.list() } catch (error) {
    return unavailable('session registry unavailable: ' + (error?.message || String(error)))
  }
  if (!Array.isArray(records)) return unavailable('session registry returned an invalid list')

  const agents = service(ctx, 'agents')
  const roots = records.filter((s) => s && s.id != null
    && s.header && typeof s.header === 'object'
    && (s.header.parentSession === undefined || s.header.parentSession === null))
  const malformed = records.length - records.filter((s) => s && s.id != null && s.header && typeof s.header === 'object').length
  const perRoot = []
  const running = []
  let used = 0
  let totalChildren = 0
  let unknown = malformed

  for (const session of roots) {
    const owner = String(session.id)
    let kids
    try {
      kids = await subagents.listChildren(session.id)
      if (!Array.isArray(kids)) throw new TypeError('invalid child session list')
    } catch (error) {
      unknown += 1
      perRoot.push({ owner, available: false, used: 0, free: null,
        total_children: null, unknown_children: null, error: error?.message || String(error) })
      continue
    }
    const seen = new Set()
    let localUsed = 0
    let localUnknown = 0
    let localTotal = 0
    for (const child of kids) {
      if (!child || (child.kind && child.kind !== 'child')) continue
      const key = child.id == null ? null : String(child.id)
      if (key && seen.has(key)) continue
      if (key) seen.add(key)
      localTotal += 1
      let state = statusName(child.activity || child.status)
      if (!state && key && agents && typeof agents.get === 'function') {
        try {
          const agent = await agents.get(child.id)
          state = statusName(agent?.status || agent?.activity)
        } catch { /* unknown, not idle */ }
      }
      if (isRunning(state)) {
        localUsed += 1
        running.push({ parent: owner, id: key, label: String(child.label || key || '(unnamed)'),
          activity: state, mode: child.mode || null })
      } else if (!isInactive(state)) {
        localUnknown += 1
      }
    }
    used += localUsed
    totalChildren += localTotal
    unknown += localUnknown
    perRoot.push({ owner, available: localUnknown === 0, used: localUsed,
      free: localUnknown === 0 ? Math.max(0, max - localUsed) : null,
      total_children: localTotal, unknown_children: localUnknown })
  }

  const available = roots.length > 0 && unknown === 0
  return {
    ...base, ok: true, available,
    used, free: available && perRoot.length === 1 ? perRoot[0].free : null,
    used_is_lower_bound: unknown > 0,
    total_children: totalChildren, unknown_children: unknown,
    running: running.slice(0, 20), per_root: perRoot,
    note: perRoot.length > 1
      ? 'Multiple root sessions: free capacity is reported per session only, not as one global slot count.'
      : available ? 'Live child session activity was verified.' : 'Some session activity is unknown; free slots cannot be confirmed.',
  }
}
