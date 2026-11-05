/**
 * Isolated Mihomo adapter for one private subscription node.
 *
 * This module owns only the child process it spawns.  It does not mutate
 * process proxy settings, the host application's proxy, or any system proxy.
 * A runtime is keyed by the caller's root and contains one short-lived,
 * loopback-only mixed HTTP listener.
 */
import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { chmod, mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { createServer, connect } from 'node:net'
import { homedir, platform } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'

const DEFAULT_TIMEOUT_MS = 10_000
const MAX_TIMEOUT_MS = 60_000
const RUNTIME_DIRECTORY = 'proxy-runtime'
const CONFIG_FILENAME = 'mihomo.yaml'
const OWNED_GROUP = 'dsh-purge-owned'

/* These are policy/synthetic entries, not outbound proxy implementations. */
const SYNTHETIC_NODE_TYPES = new Set([
  'block', 'compatible', 'dns', 'direct', 'fake-ip', 'fallback', 'load-balance',
  'loadbalance', 'mixed', 'pass', 'reject', 'redir-host', 'relay', 'select',
  'selector', 'tun', 'url-test', 'urltest',
])

const CHAIN_KEYS = new Set([
  'dialer-proxy',
  'proxy',
  'proxy-group',
  'proxy-groups',
  'chain',
  'chaining',
  'underlying-proxy',
  'parent-proxy',
  'proxy-provider',
  'proxy-providers',
  'rule-provider',
  'rule-providers',
  'script',
  'url',
])

const STATES = new Map()
let exitHookInstalled = false

function rootPath(root) {
  return resolve(String(root || '.'))
}

function stateFor(root) {
  const key = rootPath(root)
  let state = STATES.get(key)
  if (!state) {
    state = {
      key,
      root: key,
      queue: Promise.resolve(),
      child: null,
      spawnError: null,
      ready: false,
      profileId: null,
      configHash: null,
      enginePath: null,
      port: 0,
      username: '',
      password: '',
      configPath: null,
      activeController: null,
      activeProfileId: null,
      activeConfigHash: null,
    }
    STATES.set(key, state)
  }
  return state
}

function enqueue(state, work) {
  const previous = state.queue || Promise.resolve()
  const current = previous.catch(() => {}).then(work)
  state.queue = current.catch(() => {})
  return current
}

function executablePath(candidate) {
  if (!candidate) return null
  const value = String(candidate)
  const target = resolve(value)
  try {
    if (!statSync(target).isFile()) return null
    accessSync(target, constants.X_OK)
    return target
  } catch {
    return null
  }
}

function searchPath(command) {
  const wanted = String(command || '')
  if (!wanted) return null
  const pathEntries = String(process.env.PATH || '').split(delimiter).filter(Boolean)
  const names = [wanted]
  if (platform() === 'win32' && !/\.exe$/i.test(wanted)) names.push(wanted + '.exe')
  for (const entry of pathEntries) {
    for (const name of names) {
      const found = executablePath(join(entry, name))
      if (found) return found
    }
  }
  return null
}

function knownEnginePaths() {
  const home = homedir()
  const env = process.env
  const candidates = [
    '/Applications/Clash Party.app/Contents/Resources/sidecar/mihomo',
    '/Applications/Clash Party.app/Contents/Resources/sidecar/mihomo.exe',
    '/Applications/Clash Verge Rev.app/Contents/Resources/mihomo/mihomo',
    '/Applications/Clash Verge Rev.app/Contents/Resources/mihomo/mihomo.exe',
    '/Applications/Clash Verge.app/Contents/Resources/mihomo/mihomo',
    '/Applications/Clash Verge.app/Contents/Resources/mihomo/mihomo.exe',
    '/usr/local/bin/mihomo',
    '/usr/bin/mihomo',
    '/opt/homebrew/bin/mihomo',
    '/opt/homebrew/opt/mihomo/bin/mihomo',
    '/opt/mihomo/mihomo',
    join(home, 'Applications/Clash Party.app/Contents/Resources/sidecar/mihomo'),
    join(home, 'Applications/Clash Party.app/Contents/Resources/sidecar/mihomo.exe'),
    join(home, 'Applications/Clash Verge Rev.app/Contents/Resources/mihomo/mihomo'),
    join(home, 'Applications/Clash Verge Rev.app/Contents/Resources/mihomo/mihomo.exe'),
    join(home, '.local/bin/mihomo'),
    join(home, '.local/bin/mihomo.exe'),
    join(env.ProgramFiles || '', 'Mihomo/mihomo.exe'),
    join(env.ProgramFiles || '', 'Clash Party/resources/sidecar/mihomo.exe'),
    join(env.ProgramFiles || '', 'Clash Verge Rev/resources/mihomo/mihomo.exe'),
    join(env.LOCALAPPDATA || '', 'Programs/Mihomo/mihomo.exe'),
    join(env.LOCALAPPDATA || '', 'Programs/Clash Party/resources/sidecar/mihomo.exe'),
    join(env.LOCALAPPDATA || '', 'Clash Verge Rev/resources/mihomo/mihomo.exe'),
  ]
  return [...new Set(candidates.filter(Boolean))]
}

/** Find an already-installed Mihomo/Clash Meta executable. */
export function detectMihomoPath(explicitPath = '') {
  const explicit = String(explicitPath || '').trim()
  if (explicit) {
    const hasPathSeparator = explicit.includes('/') || explicit.includes('\\') || explicit.startsWith('.')
    return hasPathSeparator ? executablePath(explicit) : searchPath(explicit)
  }
  for (const command of ['mihomo', 'clash-meta', 'clash']) {
    const found = searchPath(command)
    if (found) return found
  }
  for (const candidate of knownEnginePaths()) {
    const found = executablePath(candidate)
    if (found) return found
  }
  return null
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key)
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function cloneJson(value, depth = 0) {
  if (depth > 20) throw new Error('Mihomo node is too deeply nested')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Mihomo node contains an invalid value')
    return value
  }
  if (Array.isArray(value)) return value.map((item) => cloneJson(item, depth + 1))
  if (typeof value !== 'object') throw new Error('Mihomo node contains an invalid value')
  const result = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new Error('Mihomo node contains an invalid field')
    }
    result[key] = cloneJson(item, depth + 1)
  }
  return result
}

function hasMeaningfulValue(value) {
  if (value === undefined || value === null || value === '') return false
  if (Array.isArray(value)) return value.length > 0
  return true
}

function normalizeNode(profile) {
  if (!profile || typeof profile !== 'object' || profile.kind !== 'mihomo') {
    throw new Error('Mihomo profile kind is required')
  }
  const profileId = text(profile.id)
  if (!profileId || profileId.length > 128 || /[\r\n]/.test(profileId)) {
    throw new Error('Mihomo profile ID is invalid')
  }
  if (!profile.node || typeof profile.node !== 'object' || Array.isArray(profile.node)) {
    throw new Error('Mihomo node is required')
  }
  const node = cloneJson(profile.node)
  for (const key of CHAIN_KEYS) {
    if (!own(node, key)) continue
    if (hasMeaningfulValue(node[key])) throw new Error('Mihomo node chaining is unsupported')
    delete node[key]
  }

  const type = text(node.type).toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(type) || SYNTHETIC_NODE_TYPES.has(type)) {
    throw new Error('Mihomo node type is unsupported')
  }
  const server = text(node.server)
  const port = Number(node.port)
  if (!server || /[\r\n\t]/.test(server) || server.length > 255) throw new Error('Mihomo node server is invalid')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Mihomo node port is invalid')

  const name = text(node.name) || 'dsh-mihomo-node'
  if (name.length > 128 || /[\r\n]/.test(name)) throw new Error('Mihomo node name is invalid')
  node.name = name
  node.type = type
  node.server = server
  node.port = port
  return { profileId, node }
}

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  }
  return JSON.stringify(value)
}

function nodeHash(profileId, node) {
  return createHash('sha256').update(canonical({ profileId, node })).digest('hex')
}

function timeoutValue(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_TIMEOUT_MS
  const number = Number(value)
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < 1 || number > MAX_TIMEOUT_MS) {
    throw new Error('Mihomo startup timeout is invalid')
  }
  return number
}

function abortError() {
  const error = new Error('Mihomo startup canceled')
  error.code = 'ABORT_ERR'
  return error
}

function timeoutError() {
  const error = new Error('Mihomo startup timed out')
  error.code = 'ETIMEDOUT'
  return error
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) throw abortError()
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

function remainingOrThrow(deadline, signal) {
  throwIfAborted(signal)
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw timeoutError()
  return remaining
}

function randomToken(prefix) {
  return prefix + randomBytes(18).toString('hex')
}

function runtimePaths(root) {
  const directory = join(rootPath(root), RUNTIME_DIRECTORY)
  return { directory, config: join(directory, CONFIG_FILENAME) }
}

function buildConfig(node, port, username, password) {
  return {
    'mixed-port': port,
    port: 0,
    'socks-port': 0,
    'redir-port': 0,
    'tproxy-port': 0,
    'allow-lan': false,
    'bind-address': '127.0.0.1',
    mode: 'rule',
    'log-level': 'silent',
    ipv6: false,
    'geo-auto-update': false,
    authentication: [`${username}:${password}`],
    dns: { enable: false },
    tun: { enable: false },
    profile: { 'store-selected': false, 'store-fake-ip': false },
    proxies: [node],
    'proxy-groups': [{ name: OWNED_GROUP, type: 'select', proxies: [node.name] }],
    rules: [`MATCH,${OWNED_GROUP}`],
  }
}

async function writePrivateConfig(paths, config) {
  await mkdir(paths.directory, { recursive: true, mode: 0o700 })
  try { await chmod(paths.directory, 0o700) } catch { /* best effort on Windows */ }
  const temporary = join(paths.directory, `.mihomo-${process.pid}-${randomBytes(8).toString('hex')}.tmp`)
  try {
    await writeFile(temporary, stringifyYaml(config, { lineWidth: 0 }), { encoding: 'utf8', mode: 0o600 })
    try { await chmod(temporary, 0o600) } catch { /* best effort on Windows */ }
    await rename(temporary, paths.config)
    try { await chmod(paths.config, 0o600) } catch { /* best effort on Windows */ }
  } finally {
    await unlink(temporary).catch(() => {})
  }
}

function allocateLoopbackPort(signal, remainingMs) {
  throwIfAborted(signal)
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    let settled = false
    let timer
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      try { signal?.removeEventListener('abort', onAbort) } catch { /* ignore */ }
    }
    const finish = (error, port) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolvePort(port)
    }
    const closeAnd = (error) => {
      try {
        server.close(() => finish(error))
      } catch {
        finish(error)
      }
    }
    const onAbort = () => closeAnd(abortError())
    server.once('error', () => finish(new Error('Mihomo loopback port allocation failed')))
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address()
      const port = address && typeof address === 'object' ? Number(address.port) : 0
      if (!port) {
        closeAnd(new Error('Mihomo loopback port allocation failed'))
        return
      }
      try { server.close(() => finish(null, port)) } catch { finish(new Error('Mihomo loopback port allocation failed')) }
    })
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
    timer = setTimeout(() => closeAnd(timeoutError()), Math.max(1, remainingMs))
  })
}

function childRunning(child) {
  return Boolean(child && child.exitCode === null && !child.signalCode)
}

function childExit(child, waitMs) {
  if (!child || !childRunning(child)) return Promise.resolve()
  return new Promise((resolveExit) => {
    let timer
    const done = () => {
      if (timer) clearTimeout(timer)
      child.removeListener('exit', done)
      resolveExit()
    }
    child.once('exit', done)
    timer = setTimeout(done, Math.max(1, waitMs))
  })
}

async function stopState(state, { urgent = false } = {}) {
  const child = state.child
  if (!child) {
    state.ready = false
    state.profileId = null
    state.configHash = null
    state.enginePath = null
    state.port = 0
    state.username = ''
    state.password = ''
    state.configPath = null
    return
  }
  if (childRunning(child)) {
    try { child.kill('SIGTERM') } catch { /* child may already have exited */ }
    await childExit(child, urgent ? 50 : 300)
    if (childRunning(child)) {
      try { child.kill('SIGKILL') } catch { /* best effort */ }
      await childExit(child, urgent ? 50 : 300)
    }
  }
  if (state.child === child) state.child = null
  state.ready = false
  state.spawnError = null
  state.profileId = null
  state.configHash = null
  state.enginePath = null
  state.port = 0
  state.username = ''
  state.password = ''
  state.configPath = null
}

function childEnvironment(runtimeDirectory) {
  const environment = { ...process.env }
  for (const key of Object.keys(environment)) {
    if (/^(?:HTTP|HTTPS|ALL|NO)_PROXY$/i.test(key) || /^(?:CLASH|MIHOMO)_/i.test(key)) delete environment[key]
  }
  environment.HOME = runtimeDirectory
  environment.USERPROFILE = runtimeDirectory
  environment.XDG_CONFIG_HOME = runtimeDirectory
  environment.XDG_DATA_HOME = runtimeDirectory
  environment.APPDATA = runtimeDirectory
  environment.LOCALAPPDATA = runtimeDirectory
  return environment
}

function spawnOwned(state, enginePath, paths) {
  const args = ['-d', paths.directory, '-f', paths.config]
  if (!exitHookInstalled) {
    exitHookInstalled = true
    process.once('exit', () => {
      for (const owned of STATES.values()) {
        if (!childRunning(owned.child)) continue
        try { owned.child.kill('SIGTERM') } catch { /* best effort during process exit */ }
        try { owned.child.kill('SIGKILL') } catch { /* best effort during process exit */ }
      }
    })
  }
  let child
  try {
    child = spawn(enginePath, args, {
      cwd: paths.directory,
      env: childEnvironment(paths.directory),
      shell: false,
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
    })
  } catch {
    throw new Error('Mihomo core failed to spawn')
  }
  state.child = child
  state.spawnError = null
  child.once('error', () => {
    if (state.child === child) state.spawnError = true
  })
  child.once('exit', () => {
    if (state.child !== child) return
    state.child = null
    state.ready = false
    state.spawnError = null
    state.profileId = null
    state.configHash = null
    state.enginePath = null
    state.port = 0
    state.username = ''
    state.password = ''
    state.configPath = null
  })
  return child
}

function waitForReady(state, child, port, deadline, signal) {
  return new Promise((resolveReady, rejectReady) => {
    let settled = false
    let timer
    let socket = null
    const onAbort = () => finish(abortError())
    const onError = () => finish(new Error('Mihomo core failed to start'))
    const onExit = () => finish(new Error('Mihomo core exited before the proxy was ready'))
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      if (socket) {
        try { socket.destroy() } catch { /* ignore */ }
        socket = null
      }
      child.removeListener('error', onError)
      child.removeListener('exit', onExit)
      try { signal?.removeEventListener('abort', onAbort) } catch { /* ignore */ }
    }
    const finish = (error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) rejectReady(error)
      else resolveReady()
    }
    const retry = () => {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        finish(timeoutError())
        return
      }
      timer = setTimeout(probe, Math.min(50, remaining))
    }
    const probe = () => {
      timer = null
      if (signal?.aborted) {
        finish(abortError())
        return
      }
      if (state.spawnError) {
        finish(new Error('Mihomo core failed to start'))
        return
      }
      if (!childRunning(child)) {
        finish(new Error('Mihomo core exited before the proxy was ready'))
        return
      }
      if (Date.now() >= deadline) {
        finish(timeoutError())
        return
      }
      socket = connect({ host: '127.0.0.1', port })
      socket.setTimeout(Math.max(1, Math.min(200, deadline - Date.now())))
      socket.once('connect', () => {
        try { socket.destroy() } catch { /* ignore */ }
        socket = null
        finish()
      })
      const unavailable = () => {
        if (settled) return
        if (socket) {
          try { socket.destroy() } catch { /* ignore */ }
          socket = null
        }
        retry()
      }
      socket.once('error', unavailable)
      socket.once('timeout', unavailable)
    }

    child.once('error', onError)
    child.once('exit', onExit)
    if (signal) {
      if (signal.aborted) {
        finish(abortError())
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
    probe()
  })
}

function publicEndpoint(state) {
  return {
    enabled: true,
    protocol: 'http',
    host: '127.0.0.1',
    port: state.port,
    username: state.username,
    password: state.password,
  }
}

async function stopMatchingState(state, profileId, configHash) {
  const activeMatches = state.activeController
    && state.activeProfileId === profileId
    && state.activeConfigHash === configHash
  if (activeMatches) {
    try { state.activeController.abort() } catch { /* best effort */ }
  }
  await enqueue(state, () => {
    if (state.profileId === profileId && state.configHash === configHash) {
      return stopState(state, { urgent: true })
    }
    return undefined
  })
}

function startupError(error) {
  if (error && (error.code === 'ABORT_ERR' || error.code === 'ETIMEDOUT')) return error
  if (error && /^Mihomo /.test(String(error.message || ''))) return error
  return new Error('Mihomo core failed to start')
}

/**
 * Start or reuse an isolated Mihomo process for exactly one node.
 *
 * The returned object is intentionally the ordinary HTTP proxy shape used by
 * the request transport.  It is private to the caller and never emitted by
 * mihomoRuntimeStatus.
 */
export async function prepareMihomoProxy(root, profile, options = {}) {
  const { profileId, node } = normalizeNode(profile)
  const signal = options && options.signal
  const timeoutMs = timeoutValue(options && options.timeoutMs)
  const deadline = Date.now() + timeoutMs
  const hash = nodeHash(profileId, node)
  const state = stateFor(root)
  if (signal && signal.aborted) {
    await stopMatchingState(state, profileId, hash)
    throw abortError()
  }
  const enginePath = detectMihomoPath(options && options.enginePath)
  if (!enginePath) throw new Error('Mihomo engine is unavailable')
  return enqueue(state, async () => {
    const operationController = new AbortController()
    const workSignal = combineSignals(signal, operationController.signal)
    state.activeController = operationController
    state.activeProfileId = profileId
    state.activeConfigHash = hash
    let operationChild = null
    let reusedChild = null
    try {
      remainingOrThrow(deadline, workSignal)
      if (
        state.ready
        && childRunning(state.child)
        && state.profileId === profileId
        && state.configHash === hash
        && state.enginePath === enginePath
      ) {
        reusedChild = state.child
        throwIfAborted(workSignal)
        remainingOrThrow(deadline, workSignal)
        return publicEndpoint(state)
      }

      if (state.child) await stopState(state)
      remainingOrThrow(deadline, workSignal)

      const paths = runtimePaths(state.root)
      const port = await allocateLoopbackPort(workSignal, remainingOrThrow(deadline, workSignal))
      const username = randomToken('dsh-')
      const password = randomToken('p-')
      const config = buildConfig(node, port, username, password)
      await writePrivateConfig(paths, config)
      remainingOrThrow(deadline, workSignal)

      const child = spawnOwned(state, enginePath, paths)
      operationChild = child
      state.profileId = profileId
      state.configHash = hash
      state.enginePath = enginePath
      state.port = port
      state.username = username
      state.password = password
      state.configPath = paths.config
      await waitForReady(state, child, port, deadline, workSignal)
      remainingOrThrow(deadline, workSignal)
      state.ready = true
      return publicEndpoint(state)
    } catch (error) {
      const ownsChild = operationChild && state.child === operationChild
      const ownsReuse = reusedChild && state.child === reusedChild
      if (ownsChild || ownsReuse) {
        await stopState(state, { urgent: error && (error.code === 'ABORT_ERR' || error.code === 'ETIMEDOUT') })
      }
      throw startupError(error)
    } finally {
      if (state.activeController === operationController) {
        state.activeController = null
        state.activeProfileId = null
        state.activeConfigHash = null
      }
    }
  })
}

/** Stop only the Mihomo process owned by this module for the supplied root. */
export async function stopMihomoProxy(root) {
  const state = stateFor(root)
  try { state.activeController?.abort() } catch { /* best effort */ }
  await enqueue(state, () => stopState(state))
  return { ok: true, running: false }
}

/** Return non-secret availability and ownership status. */
export function mihomoRuntimeStatus(root, explicitPath = '') {
  const state = stateFor(root)
  const path = detectMihomoPath(explicitPath)
  return {
    available: Boolean(path),
    path,
    running: childRunning(state.child),
  }
}

export default {
  detectMihomoPath,
  prepareMihomoProxy,
  stopMihomoProxy,
  mihomoRuntimeStatus,
}
