/**
 * Private, explicitly managed proxy pool for the plugin's GitHub requests.
 *
 * The pool is deliberately independent from process proxy state.  A request
 * opts in through requestWithProxyPool; no environment variable, global
 * dispatcher, browser, model, or system proxy is changed here.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import {
  importProxyYaml,
  loadProxyConfig,
  proxyConfigPath,
  validateProxyConfig,
} from './proxy-config.js'
import {
  mihomoRuntimeStatus,
  prepareMihomoProxy,
  stopMihomoProxy,
} from './proxy-mihomo.js'
import { matchesNoProxy, requestTextWithProxy } from './proxy-network.js'

export const PROXY_POOL_MAX_PROFILES = 100
export const PROXY_POOL_MAX_LOGS = 200
export const DEFAULT_PROXY_POOL_TIMEOUT_MS = 10000
export const PROXY_POOL_MAX_CYCLE_MS = 60000
export const PROXY_POOL_MAX_ENGINE_PATH_LENGTH = 4096

const PROFILE_STATUSES = new Set(['idle', 'connecting', 'connected', 'error'])
const LOG_LEVELS = new Set(['info', 'warn', 'error'])
const LOG_EVENTS = new Set(['attempt', 'failure', 'timeout', 'switch', 'success', 'exhausted', 'disconnect', 'cancel'])
const STATES = new Map()
const QUEUES = new Map()

function rootKey(root) {
  try { return resolve(String(root || '.')) } catch { return String(root || '.') }
}

export function proxyPoolPath(root) {
  return join(String(root || '.'), 'proxy-pool.json')
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key)
}

function text(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

function idValue(value, fallback = '') {
  const id = text(value, fallback)
  if (!id || id.length > 128 || /[\r\n]/.test(id)) return fallback
  return id
}

function newId(prefix = 'proxy') {
  try { return randomUUID() } catch { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) }
}

function timeoutValue(value, fallback = DEFAULT_PROXY_POOL_TIMEOUT_MS) {
  if (value === undefined || value === null || value === '') return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1000 || n > 30000) throw new Error('代理超时必须在 1000 到 30000 毫秒之间')
  return n
}

function endpointKey(profile) {
  if (profile && profile.kind === 'mihomo') {
    const node = profile.node && typeof profile.node === 'object' ? profile.node : {}
    return ['mihomo', text(node.type, profile.protocol).toLowerCase(), text(node.server, profile.host).toLowerCase(), Number(node.port || profile.port) || 0].join('\u0000')
  }
  const protocol = text(profile && profile.protocol, 'http').toLowerCase().replace(/:$/, '')
  const host = text(profile && profile.host).toLowerCase()
  const port = Number(profile && profile.port) || 0
  const username = text(profile && profile.username)
  return [protocol, host, port, username].join('\u0000')
}

function stableValue(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (seen.has(value)) return 'null'
  seen.add(value)
  if (Array.isArray(value)) return '[' + value.map((item) => stableValue(item, seen)).join(',') + ']'
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableValue(value[key], seen)).join(',') + '}'
}

function profileIdentity(profile) {
  return stableValue({
    kind: profile && profile.kind === 'mihomo' ? 'mihomo' : 'direct',
    name: text(profile && profile.name),
    protocol: text(profile && profile.protocol).toLowerCase(),
    host: text(profile && profile.host).toLowerCase(),
    port: Number(profile && profile.port) || 0,
    username: text(profile && profile.username),
    password: text(profile && profile.password),
    noProxy: text(profile && profile.noProxy),
    node: profile && profile.kind === 'mihomo' ? profile.node : null,
  })
}

function enginePathValue(value, fallback = '') {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string') throw new Error('Mihomo 引擎路径必须是文本')
  const result = value.trim()
  if (result.length > PROXY_POOL_MAX_ENGINE_PATH_LENGTH || /[\0\r\n]/.test(result)) {
    throw new Error('Mihomo 引擎路径无效')
  }
  return result
}

function cleanText(value, fallback = '', limit = 300) {
  let result = text(value, fallback).replace(/[\r\n\t]+/g, ' ')
  result = result.replace(/https?:\/\/[^\s]+/gi, '[url]')
  result = result.replace(/(password|passwd|pwd|token|authorization)\s*[=:]\s*[^\s,;]+/gi, '$1=[redacted]')
  return result.slice(0, limit)
}

function profileLabel(profile) {
  const name = cleanText(profile && profile.name, '', 80)
  return name || '代理节点'
}

function safeNetworkError(error, fallback = '代理连接失败') {
  const code = error && error.code ? String(error.code).toUpperCase() : ''
  if (code === 'ETIMEDOUT' || /timeout|timed out|ETIMEDOUT|超时/i.test(String(error && error.message || ''))) return '代理连接超时'
  if (/^代理返回 HTTP \d+$/.test(String(error && error.message || ''))) return String(error.message)
  if (code) return '代理网络错误（' + code + '）'
  const status = Number(error && error.statusCode)
  if (status > 0) return '代理返回 HTTP ' + status
  return fallback
}

function isTimeout(error) {
  return Boolean(error && (error.code === 'ETIMEDOUT' || /timeout|timed out|ETIMEDOUT|超时/i.test(String(error.message || ''))))
}

function emptyPool() {
  return {
    version: 1,
    enabled: false,
    autoConnect: false,
    timeoutMs: DEFAULT_PROXY_POOL_TIMEOUT_MS,
    enginePath: '',
    activeId: null,
    profiles: [],
    logs: [],
  }
}

function profileStatus(value, fallback = 'idle') {
  const status = text(value, fallback)
  return PROFILE_STATUSES.has(status) ? status : fallback
}

const CORE_CREDENTIAL_KEYS = [
  'password', 'uuid', 'private-key', 'private_key', 'privateKey',
  'client-id', 'client_id', 'clientId', 'psk', 'secret', 'token',
  'pre-shared-key', 'pre_shared_key', 'preSharedKey',
]

function coreNodeType(node, fallback = '') {
  return String(text(node && node.type, String(fallback || '')) || '').toLowerCase()
}

function clearCoreCredentials(node) {
  for (const key of CORE_CREDENTIAL_KEYS) delete node[key]
  return node
}

function coreCredentialValue(node) {
  if (!node || typeof node !== 'object') return false
  return CORE_CREDENTIAL_KEYS.some((key) => {
    const value = node[key]
    return typeof value === 'string' ? value.length > 0 : value !== undefined && value !== null
  })
}

function applyCorePassword(node, value, clearAll = false) {
  const type = coreNodeType(node)
  if (clearAll) clearCoreCredentials(node)
  if (type === 'vmess' || type === 'vless') node.uuid = value
  else if (type === 'wireguard') node['private-key'] = value
  else node.password = value
}

function assertPlainNode(value, depth = 0) {
  if (depth > 20) throw new Error('Mihomo 节点层级过深')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Mihomo 节点字段无效')
    return
  }
  if (typeof value !== 'object') throw new Error('Mihomo 节点字段无效')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) {
    throw new Error('Mihomo 节点必须是普通对象')
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('Mihomo 节点字段无效')
    assertPlainNode(item, depth + 1)
  }
}

function normalizeCoreProfile(source, old, defaultName) {
  const sourceNode = source.node && typeof source.node === 'object' ? source.node : null
  const oldNode = old && old.node && typeof old.node === 'object' ? old.node : null
  if (sourceNode) assertPlainNode(sourceNode)
  const node = clone(sourceNode || oldNode || {})
  const oldProfile = old ? { ...old, node: oldNode || {} } : null
  const candidateProtocol = String(text(source.protocol, coreNodeType(sourceNode, coreNodeType(oldNode, old && old.protocol))) || '')
  const candidateHost = String(text(source.host, text(sourceNode && sourceNode.server, text(oldNode && oldNode.server, old && old.host))) || '')
  const candidatePort = Number(source.port ?? (sourceNode && sourceNode.port) ?? (oldNode && oldNode.port) ?? (old && old.port)) || 0
  const candidateEndpoint = ['mihomo', candidateProtocol.toLowerCase().replace(/:$/, ''), candidateHost.toLowerCase(), candidatePort].join('\u0000')
  const endpointChanged = Boolean(old) && candidateEndpoint !== endpointKey(oldProfile)
  const hasPasswordField = own(source, 'password')
  if (hasPasswordField && typeof source.password !== 'string') throw new Error('密码必须是文本')
  /* YAML candidates carry password: "" as a redacted transport field.  Treat
   * that metadata as omitted when a raw node is supplied; an explicit empty
   * edit without a raw node clears the private credential fields. */
  const hasPasswordPatch = hasPasswordField && (!sourceNode || source.password.length > 0)
  if (endpointChanged) {
    clearCoreCredentials(node)
    if (hasPasswordPatch && source.password.length > 0) applyCorePassword(node, source.password)
  } else if (hasPasswordPatch) {
    applyCorePassword(node, source.password, source.password.length === 0)
  }
  const rawType = text(source.protocol, coreNodeType(node, old && old.protocol))
  const protocol = rawType.toLowerCase().replace(/:$/, '') || coreNodeType(node, 'unknown')
  const name = cleanText(source.name, old ? cleanText(old.name, defaultName) : defaultName, 120) || defaultName
  const host = text(source.host, text(node.server, old ? old.host : ''))
  const port = Number(source.port ?? node.port ?? (old && old.port)) || 0
  if (!protocol || !/^[a-z0-9_-]{1,64}$/i.test(protocol)) throw new Error('Mihomo 节点类型无效')
  if (!host || host.length > 255 || /[\r\n\t]/.test(host)) throw new Error('Mihomo 节点主机无效')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Mihomo 节点端口无效')
  node.name = name
  node.type = protocol
  node.server = host
  node.port = port
  const logicalNode = (value) => {
    const result = value && typeof value === 'object' ? { ...value } : {}
    delete result.name
    return result
  }
  const nodeChanged = !old || stableValue(logicalNode(node)) !== stableValue(logicalNode(oldNode || {}))
  const changed = endpointChanged || nodeChanged || hasPasswordPatch
  return {
    id: idValue(source.id, old ? idValue(old.id) : '') || newId(),
    kind: 'mihomo',
    name,
    enabled: source.enabled === undefined ? (old ? old.enabled !== false : true) : source.enabled !== false,
    protocol,
    host,
    port,
    username: '',
    password: '',
    noProxy: text(source.noProxy, old ? text(old.noProxy) : ''),
    node,
    transportTLS: source.transportTLS === true
      || (source.transportTLS === undefined && old && old.transportTLS === true)
      || node.tls === true,
    status: changed
      ? 'idle'
      : (profileStatus(old && old.status, 'idle') === 'connecting' ? 'idle' : profileStatus(old && old.status)),
    latencyMs: changed
      ? null
      : (old && old.latencyMs !== null && old.latencyMs !== undefined && Number.isFinite(Number(old.latencyMs)) ? Number(old.latencyMs) : null),
    lastError: changed ? null : (cleanText(old && old.lastError, '', 240) || null),
    lastCheckedAt: changed ? null : (typeof (old && old.lastCheckedAt) === 'string' ? old.lastCheckedAt : null),
  }
}

function normalizeProfile(raw, existing = null, defaultName = '代理节点') {
  const source = raw && typeof raw === 'object' ? raw : {}
  const old = existing && typeof existing === 'object' ? existing : null
  if (source.kind === 'mihomo' || (old && old.kind === 'mihomo')) {
    return normalizeCoreProfile(source, old, defaultName)
  }
  const candidate = {
    ...(old || {}),
    ...source,
  }
  const endpointChanged = Boolean(old) && endpointKey(candidate) !== endpointKey(old)
  const password = own(source, 'password')
    ? (typeof source.password === 'string' ? source.password : (() => { throw new Error('密码必须是文本') })())
    : (old && !endpointChanged ? String(old.password || '') : '')
  const passwordChanged = Boolean(old) && own(source, 'password') && password !== String(old.password || '')
  const enabled = source.enabled === undefined ? (old ? old.enabled !== false : true) : source.enabled !== false
  const normalized = validateProxyConfig({
    ...candidate,
    enabled,
    password,
  }, { allowDisabled: true })
  const id = idValue(source.id, old ? idValue(old.id) : '') || newId()
  const name = cleanText(source.name, old ? cleanText(old.name, defaultName) : defaultName, 120) || defaultName
  return {
    id,
    name,
    enabled: normalized.enabled !== false,
    protocol: normalized.protocol,
    host: normalized.host,
    port: normalized.port,
    username: normalized.username,
    password: normalized.password,
    noProxy: normalized.noProxy,
    status: endpointChanged || passwordChanged
      ? 'idle'
      : (profileStatus(old && old.status, 'idle') === 'connecting' ? 'idle' : profileStatus(old && old.status)),
    latencyMs: endpointChanged || passwordChanged
      ? null
      : (old && old.latencyMs !== null && old.latencyMs !== undefined && Number.isFinite(Number(old.latencyMs)) ? Number(old.latencyMs) : null),
    lastError: endpointChanged || passwordChanged ? null : (cleanText(old && old.lastError, '', 240) || null),
    lastCheckedAt: endpointChanged || passwordChanged ? null : (typeof (old && old.lastCheckedAt) === 'string' ? old.lastCheckedAt : null),
  }
}

function normalizeLog(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const event = LOG_EVENTS.has(text(source.event)) ? text(source.event) : 'failure'
  const level = LOG_LEVELS.has(text(source.level)) ? text(source.level) : (event === 'failure' || event === 'timeout' || event === 'exhausted' ? 'error' : 'info')
  const result = {
    id: idValue(source.id) || newId('log'),
    at: typeof source.at === 'string' && source.at ? source.at : new Date().toISOString(),
    level,
    event,
    message: cleanText(source.message, '代理操作记录', 300),
  }
  for (const key of ['profileId', 'fromId', 'toId']) {
    if (source[key] !== undefined && source[key] !== null && text(source[key])) result[key] = idValue(source[key])
  }
  return result
}

function normalizePool(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const result = emptyPool()
  result.enabled = source.enabled === true
  result.autoConnect = source.autoConnect === true
  result.timeoutMs = timeoutValue(source.timeoutMs, DEFAULT_PROXY_POOL_TIMEOUT_MS)
  result.enginePath = enginePathValue(source.enginePath, '')
  const inputProfiles = Array.isArray(source.profiles) ? source.profiles : []
  if (inputProfiles.length > PROXY_POOL_MAX_PROFILES) throw new Error('代理节点不能超过 ' + PROXY_POOL_MAX_PROFILES + ' 个')
  const ids = new Set()
  result.profiles = inputProfiles.map((entry, index) => {
    const profile = normalizeProfile(entry, entry, '代理节点 ' + (index + 1))
    if (ids.has(profile.id)) throw new Error('代理节点 ID 重复')
    ids.add(profile.id)
    return profile
  })
  const active = idValue(source.activeId)
  result.activeId = active && result.profiles.some((entry) => entry.id === active) ? active : null
  result.logs = Array.isArray(source.logs)
    ? source.logs.slice(-PROXY_POOL_MAX_LOGS).map(normalizeLog)
    : []
  return result
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function atomicWritePool(root, pool) {
  const dir = String(root || '.')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const target = proxyPoolPath(dir)
  const temp = target + '.' + process.pid + '.' + newId('tmp') + '.tmp'
  try {
    writeFileSync(temp, JSON.stringify(pool, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    try { chmodSync(temp, 0o600) } catch { /* best effort on Windows */ }
    renameSync(temp, target)
    try { chmodSync(target, 0o600) } catch { /* best effort on Windows */ }
  } catch (error) {
    try { if (existsSync(temp)) unlinkSync(temp) } catch { /* ignore cleanup failure */ }
    throw error
  }
}

function migrateLegacy(root) {
  const oldPath = proxyConfigPath(root)
  if (!existsSync(oldPath)) return emptyPool()
  const old = loadProxyConfig(root)
  const hasEndpoint = Boolean(old.host || old.port || old.username || old.password || old.noProxy)
  if (!hasEndpoint) return emptyPool()
  const legacy = normalizeProfile({ ...old, id: 'legacy', name: '旧代理节点' })
  const migrated = emptyPool()
  migrated.enabled = old.enabled === true
  migrated.activeId = legacy.id
  migrated.profiles = [legacy]
  atomicWritePool(root, migrated)
  return migrated
}

function readPool(root) {
  const file = proxyPoolPath(root)
  if (!existsSync(file)) return migrateLegacy(root)
  try {
    return normalizePool(JSON.parse(readFileSync(file, 'utf8')))
  } catch (error) {
    if (error && /代理节点|代理超时|密码|代理主机|代理协议/.test(String(error.message || ''))) throw error
    throw new Error('代理池配置读取失败')
  }
}

function stateFor(root) {
  const key = rootKey(root)
  let state = STATES.get(key)
  if (!state) {
    state = {
      root: String(root || '.'),
      pool: readPool(root),
      generation: 0,
      abortController: new AbortController(),
      coreProfileId: null,
      coreStop: null,
      corePrepareToken: null,
      corePrepareStop: null,
      batchTest: null,
      cancelledProfileIds: new Set(),
      pendingProfileConnectIds: new Map(),
    }
    STATES.set(key, state)
  }
  return state
}

function combineSignals(...signals) {
  const active = signals.filter((signal) => signal && typeof signal.addEventListener === 'function')
  if (active.length === 0) return null
  if (active.length === 1) return active[0]
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(active)
  const controller = new AbortController()
  const abort = () => controller.abort()
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort()
      break
    }
    signal.addEventListener('abort', abort, { once: true })
  }
  return controller.signal
}

function workContext(state, externalSignal = null, generation = state.generation) {
  return {
    generation,
    signal: combineSignals(state.abortController.signal, externalSignal),
  }
}

function contextCurrent(state, context) {
  return Boolean(context)
    && state.generation === context.generation
    && !state.abortController.signal.aborted
    && !(context.signal && context.signal.aborted)
}

function cancelledError() {
  const error = new Error('代理请求已取消')
  error.code = 'EABORTED'
  return error
}

function publicError(error) {
  return error && error.message ? String(error.message) : error
}

function saveState(state) {
  atomicWritePool(state.root, state.pool)
}

function enqueue(root, work) {
  const key = rootKey(root)
  const previous = QUEUES.get(key) || Promise.resolve()
  const current = previous.catch(() => {}).then(work)
  const cleanup = () => {
    if (QUEUES.get(key) === settled) QUEUES.delete(key)
  }
  const settled = current.then(cleanup, cleanup)
  QUEUES.set(key, settled)
  return current
}

function publicProfile(profile) {
  const isMihomo = profile && profile.kind === 'mihomo'
  return {
    id: profile.id,
    kind: isMihomo ? 'mihomo' : 'direct',
    name: profile.name,
    enabled: profile.enabled,
    protocol: profile.protocol,
    host: profile.host,
    port: profile.port,
    username: profile.username,
    passwordSet: isMihomo ? coreCredentialValue(profile.node) : String(profile.password || '').length > 0,
    noProxy: profile.noProxy,
    ...(isMihomo ? { transportTLS: profile.transportTLS === true } : {}),
    status: profileStatus(profile.status),
    latencyMs: profile.latencyMs !== null && profile.latencyMs !== undefined && Number.isFinite(Number(profile.latencyMs))
      ? Number(profile.latencyMs)
      : null,
    lastError: profile.lastError || null,
    lastCheckedAt: profile.lastCheckedAt || null,
  }
}

function publicBatchTest(batch) {
  if (!batch || typeof batch !== 'object') return null
  return {
    status: batch.status === 'running' || batch.status === 'completed' || batch.status === 'cancelled'
      ? batch.status
      : 'cancelled',
    total: Number.isInteger(batch.total) ? batch.total : 0,
    completed: Number.isInteger(batch.completed) ? batch.completed : 0,
    passed: Number.isInteger(batch.passed) ? batch.passed : 0,
    failed: Number.isInteger(batch.failed) ? batch.failed : 0,
    cancelled: Number.isInteger(batch.cancelled) ? batch.cancelled : 0,
    currentId: idValue(batch.currentId) || null,
  }
}

function publicSnapshot(pool, root = null) {
  const engine = root
    ? mihomoRuntimeStatus(root, pool.enginePath)
    : { available: false, path: null, running: false }
  const runtime = root ? STATES.get(rootKey(root)) : null
  return {
    enabled: pool.enabled,
    autoConnect: pool.autoConnect,
    timeoutMs: pool.timeoutMs,
    enginePath: pool.enginePath || '',
    engine,
    activeId: pool.activeId,
    profiles: pool.profiles.map(publicProfile),
    logs: pool.logs.map(normalizeLog),
    batchTest: publicBatchTest(runtime && runtime.batchTest),
  }
}

function addLog(state, event, message, extra = {}) {
  const level = event === 'failure' || event === 'timeout' || event === 'exhausted' ? 'error' : 'info'
  const entry = normalizeLog({
    id: newId('log'),
    at: new Date().toISOString(),
    level,
    event,
    message,
    ...extra,
  })
  state.pool.logs.push(entry)
  if (state.pool.logs.length > PROXY_POOL_MAX_LOGS) state.pool.logs.splice(0, state.pool.logs.length - PROXY_POOL_MAX_LOGS)
  saveState(state)
  return entry
}

function checkedAt() {
  return new Date().toISOString()
}

function profileById(pool, id) {
  const key = idValue(id)
  return pool.profiles.find((entry) => entry.id === key) || null
}

function bulkProfileIds(pool, ids, { allWhenOmitted = false } = {}) {
  if (ids === undefined || ids === null) {
    if (!allWhenOmitted) throw new Error('代理节点 ID 列表无效')
    ids = pool.profiles.map((entry) => entry.id)
  }
  const source = ids
  if (!Array.isArray(source)) throw new Error('代理节点 ID 列表无效')
  const seen = new Set()
  const result = []
  for (const raw of source) {
    if (typeof raw !== 'string') throw new Error('代理节点 ID 列表无效')
    const id = idValue(raw)
    if (!id || seen.has(id)) throw new Error('代理节点 ID 列表无效')
    if (!profileById(pool, id)) throw new Error('代理节点不存在')
    seen.add(id)
    result.push(id)
  }
  return result
}

function cancelBatchRuntime(state) {
  const batch = state && state.batchTest
  if (!batch || batch.status !== 'running') return
  batch.status = 'cancelled'
  batch.currentId = null
  batch.cancelled = Math.max(0, batch.total - batch.completed)
}

function orderedEnabledProfiles(pool) {
  const enabled = pool.profiles.filter((entry) => entry.enabled)
  if (!pool.activeId) return enabled
  const index = enabled.findIndex((entry) => entry.id === pool.activeId)
  if (index < 0) return enabled
  return [enabled[index], ...enabled.slice(index + 1), ...enabled.slice(0, index)]
}

function requestTimeout(pool, options, remaining = Infinity) {
  const requested = Number(options && options.timeout)
  const base = Number.isFinite(requested) && requested > 0 ? Math.min(requested, pool.timeoutMs) : pool.timeoutMs
  return Math.max(1, Math.min(base, remaining))
}

function failureError(error, response = null) {
  if (response && response.statusCode) return '代理返回 HTTP ' + response.statusCode
  return safeNetworkError(error)
}

function cancelledResult() {
  return { ok: false, cancelled: true, error: cancelledError(), message: '代理请求已取消' }
}

function optionsWithSignal(options, signal) {
  const result = { ...(options || {}) }
  if (signal) result.signal = signal
  else delete result.signal
  return result
}

function isMihomoProfile(profile) {
  return Boolean(profile && profile.kind === 'mihomo')
}

function stopFunctionFor(state, options = {}) {
  return typeof options.stopEngine === 'function'
    ? options.stopEngine
    : (state.coreStop || state.corePrepareStop || stopMihomoProxy)
}

async function stopOwnedCore(state, options = {}, { wait = true, force = false } = {}) {
  const stop = stopFunctionFor(state, options)
  const owned = Boolean(state.coreProfileId || state.coreStop || state.corePrepareToken)
  state.coreProfileId = null
  state.coreStop = null
  if (!owned && !force) return
  try {
    const result = stop(state.root)
    if (wait && result && typeof result.then === 'function') await result
    else if (result && typeof result.catch === 'function') result.catch(() => {})
  } catch { /* best effort: stale core cleanup cannot block pool state */ }
}

function awaitAbortable(value, signal, timeoutMs) {
  const pending = Promise.resolve(value)
  if ((!signal || typeof signal.addEventListener !== 'function') && !(Number.isFinite(timeoutMs) && timeoutMs > 0)) return pending
  return new Promise((resolve, reject) => {
    let settled = false
    let timer
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      try { signal?.removeEventListener('abort', onAbort) } catch { /* ignore */ }
    }
    const finish = (error, result) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve(result)
    }
    const onAbort = () => finish(cancelledError())
    if (signal) {
      if (signal.aborted) {
        finish(cancelledError())
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        const error = new Error('代理连接超时')
        error.code = 'ETIMEDOUT'
        finish(error)
      }, Math.max(1, timeoutMs))
    }
    pending.then((result) => finish(null, result), (error) => finish(error))
  })
}

async function prepareCore(state, profile, context, options, remaining) {
  const prepare = typeof options.prepareEngine === 'function' ? options.prepareEngine : prepareMihomoProxy
  const stop = stopFunctionFor(state, options)
  if (state.coreProfileId && state.coreProfileId !== profile.id) {
    await stopOwnedCore(state, { stopEngine: stop })
  }
  if (!contextCurrent(state, context)) return null
  const prepareToken = {}
  state.corePrepareToken = prepareToken
  state.corePrepareStop = stop
  const pending = Promise.resolve().then(() => prepare(state.root, profile, {
    signal: context.signal,
    timeoutMs: Math.max(1, remaining),
    enginePath: state.pool.enginePath,
  }))
  try {
    const endpoint = await awaitAbortable(pending, context.signal, remaining)
    if (!contextCurrent(state, context)) {
      if (state.corePrepareToken === prepareToken) {
        state.corePrepareToken = null
        state.corePrepareStop = null
        await stopOwnedCore(state, { stopEngine: stop }, { force: true })
      }
      return null
    }
    if (state.corePrepareToken !== prepareToken) return null
    state.corePrepareToken = null
    state.corePrepareStop = null
    state.coreProfileId = profile.id
    state.coreStop = stop
    return endpoint
  } catch (error) {
    if (!contextCurrent(state, context)) {
      pending.then(() => {
        if (state.corePrepareToken !== prepareToken) return
        state.corePrepareToken = null
        state.corePrepareStop = null
        return stopOwnedCore(state, { stopEngine: stop }, { wait: false, force: true })
      }, () => {})
      return null
    }
    if (state.corePrepareToken === prepareToken) {
      state.corePrepareToken = null
      state.corePrepareStop = null
    }
    throw error
  }
}

async function attemptRequest(state, profile, target, options, remaining, {
  allowDirect = true,
  context = workContext(state, options && options.signal),
} = {}) {
  if (!contextCurrent(state, context)) return cancelledResult()
  const started = Date.now()
  let direct = false
  profile.status = 'connecting'
  profile.lastError = null
  profile.lastCheckedAt = checkedAt()
  addLog(state, 'attempt', '正在尝试代理节点：' + profileLabel(profile), { profileId: profile.id })
  const nodeDeadline = started + requestTimeout(state.pool, options, remaining)
  let timeout = Math.max(1, nodeDeadline - Date.now())
  let transport = profile
  try {
    if (matchesNoProxy(target, profile.noProxy)) {
      if (isMihomoProfile(profile) || state.coreProfileId) await stopOwnedCore(state, options)
      if (!contextCurrent(state, context)) return cancelledResult()
      if (!allowDirect) {
        const error = new Error('备用节点命中直连列表，不能作为代理备用节点')
        error.code = 'ENOPROXYFALLBACK'
        throw error
      }
      direct = true
      const response = await requestTextWithProxy(target, optionsWithSignal({ ...options, timeout }, context.signal), null)
      if (!contextCurrent(state, context)) return cancelledResult()
      profile.status = 'idle'
      profile.latencyMs = null
      profile.lastError = null
      profile.lastCheckedAt = checkedAt()
      addLog(state, 'success', '目标命中节点直连列表，已按规则直连', { profileId: profile.id })
      return { ok: true, direct: true, response }
    }
    if (isMihomoProfile(profile)) {
      transport = await prepareCore(state, profile, context, options, Math.max(1, nodeDeadline - Date.now()))
      if (!transport) return cancelledResult()
      timeout = requestTimeout(state.pool, options, Math.max(1, nodeDeadline - Date.now()))
    } else if (state.coreProfileId) {
      await stopOwnedCore(state, options)
      if (!contextCurrent(state, context)) return cancelledResult()
    }
    const response = await requestTextWithProxy(target, optionsWithSignal({ ...options, timeout }, context.signal), transport)
    if (!contextCurrent(state, context)) return cancelledResult()
    if (response.statusCode === 407) {
      const error = new Error('代理返回 HTTP 407')
      error.code = 'EPROXYAUTH'
      throw error
    }
    profile.status = 'connected'
    profile.latencyMs = Date.now() - started
    profile.lastError = null
    profile.lastCheckedAt = checkedAt()
    addLog(state, 'success', '代理节点连接成功（' + profile.latencyMs + ' ms）', { profileId: profile.id })
    return { ok: true, response }
  } catch (error) {
    if (!contextCurrent(state, context)) return cancelledResult()
    if (isMihomoProfile(profile)) {
      await stopOwnedCore(state, options)
      if (!contextCurrent(state, context)) return cancelledResult()
    }
    profile.status = 'error'
    profile.latencyMs = null
    profile.lastError = failureError(error)
    profile.lastCheckedAt = checkedAt()
    const event = isTimeout(error) ? 'timeout' : 'failure'
    addLog(state, event, event === 'timeout'
      ? '代理节点超时：' + profileLabel(profile)
      : '代理节点失败：' + profileLabel(profile) + '（' + profile.lastError + '）', { profileId: profile.id })
    return { ok: false, error, message: profile.lastError, direct }
  }
}

async function attemptConnection(state, profile, target, options = {}, context = workContext(state, options && options.signal)) {
  if (!contextCurrent(state, context)) return cancelledResult()
  const started = Date.now()
  const attemptTimeout = requestTimeout(state.pool, options)
  let requestTimeoutMs = attemptTimeout
  profile.status = 'connecting'
  profile.lastError = null
  profile.lastCheckedAt = checkedAt()
  addLog(state, 'attempt', '正在测试代理节点：' + profileLabel(profile), { profileId: profile.id })
  let transport = { ...profile, enabled: true }
  try {
    if (matchesNoProxy(target, profile.noProxy)) {
      if (isMihomoProfile(profile) || state.coreProfileId) await stopOwnedCore(state, options)
      if (!contextCurrent(state, context)) return cancelledResult()
      const error = new Error('测试地址命中直连列表，请移除目标地址后再测试代理')
      error.code = 'ENOPROXY'
      throw error
    }
    if (isMihomoProfile(profile)) {
      transport = await prepareCore(state, profile, context, options, attemptTimeout)
      if (!transport) return cancelledResult()
      requestTimeoutMs = requestTimeout(state.pool, options, Math.max(1, attemptTimeout - (Date.now() - started)))
    } else if (state.coreProfileId) {
      await stopOwnedCore(state, options)
      if (!contextCurrent(state, context)) return cancelledResult()
    }
    const response = await requestTextWithProxy(target, optionsWithSignal({
      method: 'GET',
      timeout: requestTimeoutMs,
      headers: {
        'user-agent': 'dsh-purge-proxy-test',
        accept: 'application/json,text/plain;q=0.8,*/*;q=0.5',
      },
    }, context.signal), transport)
    if (!contextCurrent(state, context)) return cancelledResult()
    if (response.statusCode < 200 || response.statusCode >= 400) {
      const error = new Error('代理返回 HTTP ' + response.statusCode)
      error.code = response.statusCode === 407 ? 'EPROXYAUTH' : 'EHTTP'
      throw error
    }
    profile.status = 'connected'
    profile.latencyMs = Date.now() - started
    profile.lastError = null
    profile.lastCheckedAt = checkedAt()
    addLog(state, 'success', '代理节点连接成功（' + profile.latencyMs + ' ms）', { profileId: profile.id })
    return { ok: true, latencyMs: profile.latencyMs, message: '代理连接成功' }
  } catch (error) {
    if (!contextCurrent(state, context)) return cancelledResult()
    if (isMihomoProfile(profile)) {
      await stopOwnedCore(state, options)
      if (!contextCurrent(state, context)) return cancelledResult()
    }
    profile.status = 'error'
    profile.latencyMs = null
    profile.lastError = error && error.code === 'ENOPROXY'
      ? '测试地址命中直连列表，请移除目标地址后再测试代理'
      : failureError(error)
    profile.lastCheckedAt = checkedAt()
    const event = isTimeout(error) ? 'timeout' : 'failure'
    addLog(state, event, event === 'timeout'
      ? '代理节点超时：' + profileLabel(profile)
      : '代理节点失败：' + profileLabel(profile) + '（' + profile.lastError + '）', { profileId: profile.id })
    return { ok: false, error: profile.lastError }
  }
}

async function restoreBatchCore(state, profileId, activeId, generation, context, options = {}) {
  if (!profileId || profileId !== activeId || state.generation !== generation || !contextCurrent(state, context)) return null
  const profile = profileById(state.pool, profileId)
  if (!profile || !isMihomoProfile(profile)) return null
  const remaining = Math.max(1, Math.min(state.pool.timeoutMs, 1000))
  try {
    await prepareCore(state, profile, context, options, remaining)
    if (state.coreProfileId !== profileId) throw new Error('活动代理核心恢复失败')
    return null
  } catch (error) {
    if (!contextCurrent(state, context)) return null
    profile.status = 'error'
    profile.latencyMs = null
    profile.lastError = '活动代理核心恢复失败'
    profile.lastCheckedAt = checkedAt()
    state.pool.activeId = null
    addLog(state, 'failure', '活动代理核心恢复失败：' + profileLabel(profile), { profileId })
    return error
  }
}

async function runBatchTests(state, ids, options = {}, expectedGeneration) {
  const context = workContext(state, options && options.signal, expectedGeneration)
  const summary = {
    total: ids.length,
    completed: 0,
    passed: 0,
    failed: 0,
    cancelled: 0,
  }
  if (!contextCurrent(state, context)) {
    summary.cancelled = summary.total
    return {
      ...clone(publicSnapshot(state.pool, state.root)),
      ok: false,
      error: publicError(cancelledError()),
      testSummary: summary,
    }
  }

  const batch = {
    status: 'running',
    ...summary,
    currentId: null,
  }
  state.batchTest = batch
  const originalActiveId = state.pool.activeId
  const originalCoreProfileId = state.coreProfileId
  const originalGeneration = state.generation
  const target = typeof options.testUrl === 'string' && options.testUrl.trim()
    ? options.testUrl.trim()
    : 'https://api.github.com/'
  const deadline = Date.now() + PROXY_POOL_MAX_CYCLE_MS
  let restoreError = null

  for (const id of ids) {
    if (batch.status !== 'running' || !contextCurrent(state, context)) {
      cancelBatchRuntime(state)
      break
    }
    const profile = profileById(state.pool, id)
    if (!profile) {
      cancelBatchRuntime(state)
      break
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      cancelBatchRuntime(state)
      break
    }
    batch.currentId = profile.id
    const requestedTimeout = Number(options && options.timeout)
    const timeout = Math.max(1, Math.min(
      remaining,
      state.pool.timeoutMs,
      Number.isFinite(requestedTimeout) && requestedTimeout > 0 ? requestedTimeout : Infinity,
    ))
    let result
    try {
      result = await attemptConnection(state, profile, target, {
        ...options,
        timeout,
        signal: context.signal,
      }, context)
    } catch (error) {
      if (!contextCurrent(state, context)) {
        cancelBatchRuntime(state)
        break
      }
      profile.status = 'error'
      profile.latencyMs = null
      profile.lastError = failureError(error)
      profile.lastCheckedAt = checkedAt()
      addLog(state, isTimeout(error) ? 'timeout' : 'failure', '代理节点失败：' + profileLabel(profile) + '（' + profile.lastError + '）', { profileId: profile.id })
      result = { ok: false, error }
    }
    await stopOwnedCore(state, options)
    if ((result && result.cancelled) || !contextCurrent(state, context)) {
      cancelBatchRuntime(state)
      break
    }
    batch.completed += 1
    if (result && result.ok) batch.passed += 1
    else batch.failed += 1
    batch.currentId = null
  }

  const completedNaturally = batch.status === 'running' && batch.completed === batch.total
  if (batch.status === 'running' && !completedNaturally) cancelBatchRuntime(state)
  /* Restore after normal completion and an internal total-budget stop.  A
   * disconnect changes generation/aborts context, so it cannot resurrect a
   * late core. */
  const restoreContext = workContext(state, null, originalGeneration)
  const canRestore = Boolean(
    originalCoreProfileId
    && state.generation === originalGeneration
    && !state.abortController.signal.aborted
    && state.pool.enabled
    && state.pool.activeId === originalActiveId,
  )
  if (canRestore) {
    restoreError = await restoreBatchCore(
      state,
      originalCoreProfileId,
      originalActiveId,
      originalGeneration,
      restoreContext,
      options,
    )
  }
  if (completedNaturally && contextCurrent(state, context)) batch.status = 'completed'
  else if (batch.status === 'running') cancelBatchRuntime(state)
  batch.currentId = null
  if (batch.status === 'cancelled') batch.cancelled = Math.max(0, batch.total - batch.completed)
  const snapshot = clone(publicSnapshot(state.pool, state.root))
  return {
    ...snapshot,
    ok: batch.status === 'completed' && !restoreError,
    ...(restoreError
      ? { error: '活动代理核心恢复失败' }
      : (batch.status === 'cancelled' ? { error: publicError(cancelledError()) } : {})),
    testSummary: clone({
      total: batch.total,
      completed: batch.completed,
      passed: batch.passed,
      failed: batch.failed,
      cancelled: batch.cancelled,
    }),
  }
}

async function connectPoolInternal(state, options = {}, context = workContext(state, options && options.signal)) {
  if (!contextCurrent(state, context)) return { ok: false, cancelled: true, error: cancelledError() }
  const target = typeof options.testUrl === 'string' && options.testUrl.trim()
    ? options.testUrl.trim()
    : 'https://api.github.com/'
  const profiles = orderedEnabledProfiles(state.pool)
  if (profiles.length === 0) {
    addLog(state, 'exhausted', '没有启用的代理节点，未回退直连')
    return { ok: false, error: '没有启用的代理节点' }
  }
  const started = Date.now()
  const deadline = started + PROXY_POOL_MAX_CYCLE_MS
  let lastError = '代理连接失败'
  let previous = null
  let attempted = 0
  for (const profile of profiles) {
    if (!contextCurrent(state, context)) return { ok: false, cancelled: true, error: cancelledError() }
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    if (previous) addLog(state, 'switch', '代理节点失败，正在切换到下一个节点', { fromId: previous.id, toId: profile.id })
    attempted += 1
    const result = await attemptConnection(
      state,
      profile,
      target,
      { ...options, timeout: Math.min(state.pool.timeoutMs, remaining), signal: context.signal },
      context,
    )
    if (result.cancelled || !contextCurrent(state, context)) return { ok: false, cancelled: true, error: cancelledError() }
    if (result.ok) {
      state.pool.enabled = true
      state.pool.activeId = profile.id
      saveState(state)
      return result
    }
    previous = profile
    lastError = result.error || lastError
  }
  if (!contextCurrent(state, context)) return { ok: false, cancelled: true, error: cancelledError() }
  const budgetExhausted = attempted < profiles.length && Date.now() >= deadline
  addLog(state, 'exhausted', budgetExhausted
    ? '代理连接周期超过 60 秒，已停止重试，未回退直连'
    : '所有可用代理节点均失败，未回退直连')
  return { ok: false, error: lastError }
}

export function loadProxyPool(root) {
  return clone(stateFor(root).pool)
}

export function proxyPoolSnapshot(root) {
  const state = stateFor(root)
  return clone(publicSnapshot(state.pool, state.root))
}

export function clearProxyPoolState(root) {
  const key = rootKey(root)
  if (QUEUES.has(key)) return
  const state = STATES.get(key)
  if (state) void disposeProxyPool(state.root)
  else void stopMihomoProxy(String(root || '.')).catch(() => {})
  STATES.delete(key)
}

function abortPoolRuntime(state, wait = false) {
  const previousController = state.abortController
  state.generation += 1
  state.abortController = new AbortController()
  cancelBatchRuntime(state)
  for (const profile of state.pool.profiles) {
    if (profile.status === 'connecting' || profile.id === state.coreProfileId) {
      profile.status = 'idle'
      profile.latencyMs = null
      profile.lastError = null
    }
  }
  try { previousController.abort() } catch { /* best effort: transport cleanup is idempotent */ }
  return stopOwnedCore(state, {}, { wait })
}

/** Dispose runtime-only work during plugin hot reload without changing pool settings. */
export function disposeProxyPool(root) {
  return abortPoolRuntime(stateFor(root), false)
}

/**
 * Stop all pool-owned work for this root without entering the per-root queue.
 * The generation and controller are runtime-only fields and are never written
 * to proxy-pool.json.  A later explicit connect gets a fresh generation.
 */
export async function proxyPoolDisconnect(root, id = undefined) {
  const state = stateFor(root)
  const requestedId = idValue(id)
  const requested = requestedId ? profileById(state.pool, requestedId) : null
  if (requestedId && state.pool.activeId !== requestedId && requested?.status !== 'connecting') {
    return {
      ...clone(publicSnapshot(state.pool, state.root)),
      ok: false,
      error: '代理节点已变化，未执行断开',
    }
  }

  const runtimeStop = abortPoolRuntime(state, true)
  const activeId = state.pool.activeId
  state.pool.enabled = false
  state.pool.autoConnect = false
  state.pool.activeId = null
  for (const profile of state.pool.profiles) {
    if (profile.id === activeId || profile.status === 'connecting') {
      profile.status = 'idle'
      profile.latencyMs = null
      profile.lastError = null
    }
  }
  addLog(state, 'cancel', '已取消正在进行的代理连接与自动连接')
  addLog(state, 'disconnect', '代理池已断开，已停止自动连接')
  await runtimeStop
  return clone(publicSnapshot(state.pool, state.root))
}

export async function proxyPoolSave(root, settings = {}, options = {}) {
  return enqueue(root, async () => {
    const state = stateFor(root)
    const source = settings && typeof settings === 'object' ? settings : {}
    const next = {
      ...state.pool,
      profiles: state.pool.profiles,
      logs: state.pool.logs,
    }
    if (own(source, 'enabled')) next.enabled = source.enabled === true
    if (own(source, 'autoConnect')) next.autoConnect = source.autoConnect === true
    if (own(source, 'timeoutMs')) next.timeoutMs = timeoutValue(source.timeoutMs, state.pool.timeoutMs)
    if (own(source, 'enginePath')) next.enginePath = enginePathValue(source.enginePath, state.pool.enginePath)
    if (own(source, 'activeId')) {
      const active = idValue(source.activeId)
      if (active && !profileById(next, active)) throw new Error('活动代理节点不存在')
      next.activeId = active || null
    }
    state.pool = next
    saveState(state)
    if (!state.pool.enabled) await stopOwnedCore(state, options)
    if (state.pool.enabled && state.pool.autoConnect && state.pool.profiles.some((entry) => entry.enabled)) {
      await connectPoolInternal(state, options)
    }
    return clone(publicSnapshot(state.pool, state.root))
  })
}

export async function proxyProfileSave(root, profile = {}) {
  return enqueue(root, async () => {
    const state = stateFor(root)
    const source = profile && typeof profile === 'object' ? profile : {}
    const requestedId = idValue(source.id)
    const existing = requestedId ? profileById(state.pool, requestedId) : null
    if (source.id !== undefined && source.id !== null && source.id !== '' && (!requestedId || !existing)) {
      throw new Error('代理节点不存在')
    }
    if (state.pool.profiles.length >= PROXY_POOL_MAX_PROFILES && !existing) {
      throw new Error('代理节点不能超过 ' + PROXY_POOL_MAX_PROFILES + ' 个')
    }
    const normalized = normalizeProfile(source, existing, existing ? existing.name : '代理节点 ' + (state.pool.profiles.length + 1))
    if (existing && existing.id === state.coreProfileId && (normalized.kind !== 'mihomo' || normalized.status !== 'connected')) {
      await stopOwnedCore(state)
    }
    if (existing) {
      const index = state.pool.profiles.findIndex((entry) => entry.id === existing.id)
      state.pool.profiles[index] = normalized
      if (state.pool.activeId === existing.id
          && (!normalized.enabled || normalized.status !== 'connected' || normalized.lastCheckedAt === null)) {
        state.pool.activeId = null
      }
    } else {
      state.pool.profiles.push(normalized)
    }
    saveState(state)
    return { ...clone(publicSnapshot(state.pool, state.root)), savedId: normalized.id }
  })
}

export async function proxyProfileDelete(root, id) {
  const target = idValue(id)
  if (!target) throw new Error('代理节点不存在')
  return proxyProfilesDelete(root, [target])
}

export async function proxyProfilesDelete(root, ids = undefined) {
  const state = stateFor(root)
  /* Validate the complete request before cancelling any in-flight work or
   * stopping a core.  An explicit empty list is a no-op; callers must pass
   * the current snapshot IDs when they intend to delete all rows. */
  const requestedIds = bulkProfileIds(state.pool, ids)
  if (requestedIds.length === 0) return clone(publicSnapshot(state.pool, state.root))
  for (const id of requestedIds) state.cancelledProfileIds.add(id)
  const cancellationNeeded = Boolean(
    (state.batchTest && state.batchTest.status === 'running')
    || requestedIds.some((id) => {
      const profile = profileById(state.pool, id)
      return id === state.coreProfileId
        || profile?.status === 'connecting'
        || state.pendingProfileConnectIds.has(id)
    }),
  )
  const cancelled = cancellationNeeded ? abortPoolRuntime(state, true) : null
  return enqueue(root, async () => {
    const current = stateFor(root)
    try {
      /* Another queued mutation may have changed the pool while this request
       * waited.  Revalidate the same complete ID set before touching state. */
      for (const id of requestedIds) {
        if (!profileById(current.pool, id)) throw new Error('代理节点不存在')
      }
      if (cancelled) await cancelled
      const targets = new Set(requestedIds)
      if (targets.has(current.coreProfileId)) await stopOwnedCore(current)
      current.pool.profiles = current.pool.profiles.filter((entry) => !targets.has(entry.id))
      if (targets.has(current.pool.activeId)) current.pool.activeId = null
      saveState(current)
      return clone(publicSnapshot(current.pool, current.root))
    } finally {
      for (const id of requestedIds) current.cancelledProfileIds.delete(id)
    }
  })
}

export async function proxyPoolImport(root, yaml) {
  const parsed = importProxyYaml(yaml)
  if (!parsed.ok) return parsed
  return enqueue(root, async () => {
    const state = stateFor(root)
    const warnings = Array.isArray(parsed.warnings) ? [...parsed.warnings] : []
    const existingKeys = new Set(state.pool.profiles.map(profileIdentity))
    let importedCount = 0
    for (const candidate of Array.isArray(parsed.candidates) ? parsed.candidates : []) {
      const key = profileIdentity(candidate)
      if (existingKeys.has(key)) {
        warnings.push('已跳过重复代理节点（不覆盖现有密码）')
        continue
      }
      if (state.pool.profiles.length >= PROXY_POOL_MAX_PROFILES) {
        warnings.push('代理节点已达到 100 个上限，剩余条目未导入')
        break
      }
      const normalized = normalizeProfile({ ...candidate, id: undefined }, null, candidate.name || '导入代理节点')
      state.pool.profiles.push(normalized)
      existingKeys.add(profileIdentity(normalized))
      importedCount += 1
    }
    if (importedCount > 0) saveState(state)
    return { ...clone(publicSnapshot(state.pool, state.root)), importedCount, warnings: [...new Set(warnings)] }
  })
}

export async function proxyPoolConnect(root, options = {}) {
  const expectedGeneration = stateFor(root).generation
  return enqueue(root, async () => {
    const state = stateFor(root)
    if (state.generation !== expectedGeneration) {
      return { ...clone(publicSnapshot(state.pool, state.root)), ok: false, error: publicError(cancelledError()) }
    }
    const context = workContext(state, options && options.signal, expectedGeneration)
    const result = await connectPoolInternal(state, options, context)
    return { ...clone(publicSnapshot(state.pool, state.root)), ok: result.ok, ...(result.ok ? {} : { error: publicError(result.error) }) }
  })
}

export async function proxyPoolTest(root, ids = undefined, options = {}) {
  const state = stateFor(root)
  const requestedIds = bulkProfileIds(state.pool, ids)
  const expectedGeneration = state.generation
  return enqueue(root, async () => {
    const current = stateFor(root)
    if (current.generation !== expectedGeneration) {
      return {
        ...clone(publicSnapshot(current.pool, current.root)),
        ok: false,
        error: publicError(cancelledError()),
        testSummary: {
          total: requestedIds.length,
          completed: 0,
          passed: 0,
          failed: 0,
          cancelled: requestedIds.length,
        },
      }
    }
    for (const id of requestedIds) {
      if (!profileById(current.pool, id)) throw new Error('代理节点不存在')
    }
    return runBatchTests(current, requestedIds, options, expectedGeneration)
  })
}

export async function proxyProfileConnect(root, id, options = {}) {
  const state = stateFor(root)
  const profileId = idValue(id)
  state.pendingProfileConnectIds.set(profileId, (state.pendingProfileConnectIds.get(profileId) || 0) + 1)
  const expectedGeneration = state.generation
  const pending = enqueue(root, async () => {
    const current = stateFor(root)
    if (current.generation !== expectedGeneration) {
      return { ...clone(publicSnapshot(current.pool, current.root)), ok: false, error: publicError(cancelledError()) }
    }
    if (current.cancelledProfileIds.has(profileId)) {
      return { ...clone(publicSnapshot(current.pool, current.root)), ok: false, error: publicError(cancelledError()) }
    }
    const profile = profileById(current.pool, profileId)
    if (!profile) return { ...clone(publicSnapshot(current.pool, current.root)), ok: false, error: '代理节点不存在' }
    const target = typeof options.testUrl === 'string' && options.testUrl.trim()
      ? options.testUrl.trim()
      : 'https://api.github.com/'
    const result = await attemptConnection(current, profile, target, options, workContext(current, options && options.signal, expectedGeneration))
    if (result.cancelled) return { ...clone(publicSnapshot(current.pool, current.root)), ok: false, error: publicError(result.error) }
    if (result.ok) {
      profile.enabled = true
      current.pool.enabled = true
      current.pool.activeId = profile.id
      saveState(current)
      return { ...clone(publicSnapshot(current.pool, current.root)), ok: true }
    }
    return { ...clone(publicSnapshot(current.pool, current.root)), ok: false, error: publicError(result.error) }
  })
  return pending.finally(() => {
    const current = stateFor(root)
    const count = current.pendingProfileConnectIds.get(profileId) || 0
    if (count <= 1) current.pendingProfileConnectIds.delete(profileId)
    else current.pendingProfileConnectIds.set(profileId, count - 1)
  })
}

export async function proxyProfileTest(root, draft = {}, options = {}) {
  const expectedGeneration = stateFor(root).generation
  return enqueue(root, async () => {
    const state = stateFor(root)
    if (state.generation !== expectedGeneration) {
      return { ok: false, error: publicError(cancelledError()) }
    }
    const source = draft && typeof draft === 'object' ? draft : {}
    const existing = own(source, 'id') ? profileById(state.pool, source.id) : null
    if (own(source, 'id') && !existing) return { ok: false, error: '代理节点不存在' }
    let candidate
    try {
      candidate = normalizeProfile(source, existing, existing ? existing.name : '测试节点')
    } catch (error) {
      return { ok: false, error: safeNetworkError(error, error && error.message ? String(error.message) : '代理设置无效') }
    }
    const target = typeof options.testUrl === 'string' && options.testUrl.trim()
      ? options.testUrl.trim()
      : 'https://api.github.com/'
    const context = workContext(state, options && options.signal, expectedGeneration)
    const originalActiveId = state.pool.activeId
    const originalCoreProfileId = state.coreProfileId
    let result = await attemptConnection(state, candidate, target, options, context)
    /* A draft test is never saved as configuration.  A row-level request
     * containing only its ID is the one case that records check fields on the
     * saved profile; a full editor draft must not make an unsaved endpoint
     * appear healthy on the stored node. */
    await stopOwnedCore(state, options)
    const saveCheckResult = existing && own(source, 'id') && Object.keys(source).length === 1
    if (saveCheckResult && contextCurrent(state, context)) {
      const persisted = profileById(state.pool, existing.id)
      if (persisted && candidate.status !== 'connecting') {
        persisted.status = profileStatus(candidate.status)
        persisted.latencyMs = candidate.latencyMs
        persisted.lastError = candidate.lastError || null
        persisted.lastCheckedAt = candidate.lastCheckedAt || null
        saveState(state)
      }
    }
    let restoreError = null
    const restoreContext = workContext(state, null, expectedGeneration)
    const canRestore = Boolean(
      originalCoreProfileId
      && state.generation === expectedGeneration
      && !state.abortController.signal.aborted
      && state.pool.enabled
      && state.pool.activeId === originalActiveId,
    )
    if (canRestore) {
      restoreError = await restoreBatchCore(
        state,
        originalCoreProfileId,
        originalActiveId,
        expectedGeneration,
        restoreContext,
        options,
      )
    }
    if (!contextCurrent(state, context)) {
      return { ok: false, error: publicError(cancelledError()) }
    }
    if (restoreError) result = { ok: false, error: '活动代理核心恢复失败' }
    if (result.ok) return { ok: true, latencyMs: result.latencyMs, message: result.message }
    return { ok: false, error: publicError(result.error) }
  })
}

export async function proxyPoolAutoConnect(root, options = {}) {
  const state = stateFor(root)
  const expectedGeneration = state.generation
  const pool = clone(publicSnapshot(state.pool, state.root))
  if (!pool.enabled || !pool.autoConnect) return pool
  return enqueue(root, async () => {
    const current = stateFor(root)
    if (current.generation !== expectedGeneration || !current.pool.enabled || !current.pool.autoConnect) {
      return clone(publicSnapshot(current.pool, current.root))
    }
    const context = workContext(current, options && options.signal, expectedGeneration)
    const result = await connectPoolInternal(current, options, context)
    return { ...clone(publicSnapshot(current.pool, current.root)), ok: result.ok, ...(result.ok ? {} : { error: publicError(result.error) }) }
  })
}

export async function requestWithProxyPool(root, target, options = {}) {
  const expectedGeneration = stateFor(root).generation
  return enqueue(root, async () => {
    const state = stateFor(root)
    if (state.generation !== expectedGeneration) throw cancelledError()
    const context = workContext(state, options && options.signal, expectedGeneration)
    if (!contextCurrent(state, context)) throw cancelledError()
    const url = target instanceof URL ? target.toString() : String(target)
    const pool = state.pool
    if (!pool.enabled) return requestTextWithProxy(url, optionsWithSignal(options, context.signal), null)
    const autoSwitch = pool.autoConnect === true
    const active = pool.activeId ? profileById(pool, pool.activeId) : null
    const profiles = autoSwitch
      ? orderedEnabledProfiles(pool)
      : (active && active.enabled ? [active] : [])
    if (profiles.length === 0) {
      throw new Error(autoSwitch
        ? '代理池没有可用节点，未回退直连'
        : '代理池尚未连接活动节点，请先手动连接代理节点')
    }
    const deadline = Date.now() + PROXY_POOL_MAX_CYCLE_MS
    let previous = null
    let lastError = '代理连接失败'
    let attempted = 0
    for (const profile of profiles) {
      if (!contextCurrent(state, context)) throw cancelledError()
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      if (previous) addLog(state, 'switch', '代理请求超时或失败，正在切换到下一个节点', { fromId: previous.id, toId: profile.id })
      attempted += 1
      const result = await attemptRequest(state, profile, url, options, remaining, {
        allowDirect: previous === null,
        context,
      })
      if (result.cancelled || !contextCurrent(state, context)) throw cancelledError()
      if (result.ok) {
        if (!result.direct) {
          pool.activeId = profile.id
          saveState(state)
        }
        return result.response
      }
      lastError = failureError(result.error)
      previous = profile
      if (result.direct) break
      if (!autoSwitch) break
    }
    if (!contextCurrent(state, context)) throw cancelledError()
    const budgetExhausted = attempted < profiles.length && Date.now() >= deadline
    addLog(state, 'exhausted', budgetExhausted
      ? '代理请求周期超过 60 秒，已停止重试，未回退直连'
      : '所有可用代理节点均失败，未回退直连')
    throw new Error(lastError === '代理连接失败' ? '代理池节点全部失败，未回退直连' : lastError)
  })
}

export default {
  PROXY_POOL_MAX_PROFILES,
  PROXY_POOL_MAX_LOGS,
  DEFAULT_PROXY_POOL_TIMEOUT_MS,
  PROXY_POOL_MAX_CYCLE_MS,
  PROXY_POOL_MAX_ENGINE_PATH_LENGTH,
  proxyPoolPath,
  loadProxyPool,
  proxyPoolSnapshot,
  proxyPoolSave,
  proxyProfileSave,
  proxyProfileDelete,
  proxyPoolImport,
  proxyPoolConnect,
  proxyPoolTest,
  proxyPoolDisconnect,
  disposeProxyPool,
  proxyProfileConnect,
  proxyProfileTest,
  proxyProfilesDelete,
  proxyPoolAutoConnect,
  requestWithProxyPool,
  clearProxyPoolState,
}
