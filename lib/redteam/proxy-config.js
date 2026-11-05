/**
 * Proxy settings used by the plugin's own outbound requests.
 *
 * This deliberately is not process proxy state.  The active password stays in
 * the private proxy.json file and is never returned by the public helpers.
 * Callers must pass the returned config to a bounded request explicitly.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

export const PROXY_PROTOCOLS = Object.freeze(['http', 'https', 'socks5'])

const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  enabled: false,
  protocol: 'http',
  host: '',
  port: 0,
  username: '',
  password: '',
  noProxy: '',
  updated_at: null,
})

const MAX_HOST_LENGTH = 255
const MAX_CREDENTIAL_LENGTH = 1024
const MAX_NO_PROXY_LENGTH = 8192
const MAX_IMPORT_BYTES = 1 << 20

export function proxyConfigPath(root) {
  return join(String(root || '.'), 'proxy.json')
}

function stringValue(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

function protocolValue(value, fallback = DEFAULT_CONFIG.protocol) {
  const protocol = stringValue(value, fallback).toLowerCase().replace(/:$/, '')
  return PROXY_PROTOCOLS.includes(protocol) ? protocol : fallback
}

function portValue(value, fallback = 0) {
  if (value === '' || value === null || value === undefined) return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 65535) return fallback
  return n
}

function hostValue(value, fallback = '') {
  let host = stringValue(value, fallback)
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  return host
}

function noProxyValue(value, fallback = '') {
  if (Array.isArray(value)) return value.map((x) => String(x || '').trim()).filter(Boolean).join(',')
  return stringValue(value, fallback)
}

function rawConfigOf(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    version: 1,
    enabled: source.enabled !== false,
    protocol: protocolValue(source.protocol),
    host: hostValue(source.host),
    port: portValue(source.port),
    username: stringValue(source.username).slice(0, MAX_CREDENTIAL_LENGTH),
    password: typeof source.password === 'string' ? source.password.slice(0, MAX_CREDENTIAL_LENGTH) : '',
    noProxy: noProxyValue(source.noProxy).slice(0, MAX_NO_PROXY_LENGTH),
    updated_at: source.updated_at || null,
  }
}

function endpointOf(config) {
  const c = rawConfigOf(config)
  return [c.protocol, c.host, c.port, c.username].join('\u0000')
}

function validateConfig(config, { allowDisabled = true } = {}) {
  const source = config && typeof config === 'object' ? config : {}
  if (source.protocol !== undefined && !PROXY_PROTOCOLS.includes(String(source.protocol).trim().toLowerCase().replace(/:$/, ''))) {
    throw new Error('代理协议不支持')
  }
  const next = rawConfigOf(config)
  if (!PROXY_PROTOCOLS.includes(next.protocol)) throw new Error('代理协议不支持')
  if (next.host.length > MAX_HOST_LENGTH || /[\r\n\s/@]/.test(next.host)) {
    throw new Error('代理主机无效')
  }
  if (!allowDisabled || next.enabled) {
    if (!next.host || !next.port) throw new Error('代理主机和端口不能为空')
  }
  return next
}

/** Normalize and validate one profile without reading or writing proxy.json. */
export function validateProxyConfig(config, options = {}) {
  return validateConfig(config, options)
}

/**
 * Read the internal form.  `password` is intentionally present only here,
 * inside the host-side module; use proxyConfigPublic before crossing an API.
 */
export function loadProxyConfig(root) {
  const file = proxyConfigPath(root)
  if (!existsSync(file)) return { ...DEFAULT_CONFIG }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return validateConfig({ ...DEFAULT_CONFIG, ...(parsed || {}) })
  } catch {
    throw new Error('代理配置读取失败')
  }
}

export function proxyConfigPublic(config) {
  const c = rawConfigOf(config)
  return {
    enabled: c.enabled,
    protocol: c.protocol,
    host: c.host,
    port: c.port,
    username: c.username,
    passwordSet: c.password.length > 0,
    noProxy: c.noProxy,
  }
}

/**
 * Save a patch and return its redacted public form.  An omitted password is
 * preserved only while the endpoint and username are unchanged.  This avoids
 * accidentally replaying a credential against a newly entered proxy.
 */
export function saveProxyConfig(patch, root) {
  const next = resolveProxyConfig(patch, root)
  const dir = String(root || '.')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = proxyConfigPath(dir)
  writeFileSync(file, JSON.stringify({ ...next, updated_at: new Date().toISOString() }, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  })
  try { chmodSync(file, 0o600) } catch { /* best effort on platforms without POSIX modes */ }
  return proxyConfigPublic(next)
}

/** Resolve a draft without writing it; used for connection tests. */
export function resolveProxyConfig(patch, root) {
  const previous = loadProxyConfig(root)
  const incoming = patch && typeof patch === 'object' ? patch : {}
  const endpointChanged = Object.keys(incoming).some((key) => (
    ['protocol', 'host', 'port', 'username'].includes(key)
  )) && endpointOf({ ...previous, ...incoming }) !== endpointOf(previous)
  const hasPassword = Object.prototype.hasOwnProperty.call(incoming, 'password')
  if (hasPassword && typeof incoming.password !== 'string') throw new Error('密码必须是文本')
  if (!hasPassword && endpointChanged && previous.password) {
    throw new Error('代理地址或账号已更改，请重新输入密码或清空密码')
  }
  const next = validateConfig({
    ...previous,
    ...incoming,
    password: hasPassword ? incoming.password : previous.password,
  })
  return next
}

function warningForUnsupported(type) {
  const label = stringValue(type, 'unknown').toLowerCase()
  return 'YAML 中暂不支持的代理协议：' + label
}

const NON_PROXY_NODE_TYPES = new Set([
  'block', 'compatible', 'dns', 'direct', 'fake-ip', 'fallback', 'load-balance',
  'loadbalance', 'mixed', 'pass', 'reject', 'redir-host', 'relay', 'select',
  'selector', 'tun', 'url-test', 'urltest',
])

const CORE_TRANSPORT_KEYS = new Set([
  'alpn', 'auth', 'auth-str', 'client-fingerprint', 'dialer-proxy', 'fingerprint',
  'grpc-opts', 'h2-opts', 'header', 'headers', 'http-opts', 'interface-name', 'ip-version', 'mptcp',
  'network', 'obfs', 'obfs-password', 'packet-encoding', 'plugin', 'plugin-opts',
  'reality-opts', 'smux', 'sni', 'skip-cert-verify', 'skip_cert_verify', 'tfo',
  'tls-fingerprint', 'udp', 'up', 'down', 'ws-opts', 'xudp',
])

const PROVIDER_KEYS = Object.freeze([
  'proxy-providers', 'proxy_providers', 'proxyProviders', 'proxy-provider',
])

function decodePart(value) {
  try { return decodeURIComponent(String(value || '')) } catch { return String(value || '') }
}

function supportedProtocol(value) {
  const type = stringValue(value).toLowerCase().replace(/:$/, '')
  if (type === 'http' || type === 'https') return type
  if (type === 'socks' || type === 'socks5' || type === 'socks5h') return 'socks5'
  return null
}

function deepPlain(value, seen = new WeakMap()) {
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return null
  if (Array.isArray(value)) {
    const result = []
    seen.set(value, result)
    for (const item of value) result.push(deepPlain(item, seen))
    return result
  }
  const result = {}
  seen.set(value, result)
  for (const key of Object.keys(value)) {
    Object.defineProperty(result, key, {
      value: deepPlain(value[key], seen),
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  return result
}

function stableValue(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (seen.has(value)) return 'null'
  seen.add(value)
  if (Array.isArray(value)) return '[' + value.map((item) => stableValue(item, seen)).join(',') + ']'
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableValue(value[key], seen)).join(',') + '}'
}

function endpointShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return ['host', 'server', 'hostname', 'listen', 'port', 'protocol', 'type', 'username', 'user', 'password', 'name']
    .some((key) => Object.prototype.hasOwnProperty.call(value, key))
}

function nodeName(value, fallback = '') {
  return typeof value === 'object' && value && !Array.isArray(value)
    ? stringValue(value.name, fallback)
    : fallback
}

function endpointFromUrl(value, fallbackProtocol = '') {
  const text = stringValue(value)
  if (!text) return null
  let url
  try {
    const fallback = supportedProtocol(fallbackProtocol) === 'socks5' ? 'socks5h' : (fallbackProtocol || 'http')
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : fallback + '://' + text)
  } catch {
    return null
  }
  const protocol = supportedProtocol(url.protocol)
  if (!protocol) return { unsupported: String(url.protocol || fallbackProtocol || 'unknown').replace(/:$/, '') }
  const port = portValue(url.port, protocol === 'https' ? 443 : 80)
  if (!url.hostname || !port) return null
  return {
    protocol,
    rawProtocol: String(url.protocol || fallbackProtocol || '').replace(/:$/, ''),
    host: url.hostname,
    port,
    username: decodePart(url.username),
    password: decodePart(url.password),
  }
}

function endpointFromObject(value, name, fallbackProtocol = '') {
  if (typeof value === 'string') {
    const parsed = endpointFromUrl(value, fallbackProtocol)
    if (parsed && !parsed.name) parsed.name = name
    return parsed
  }
  if (!value || typeof value !== 'object') return null
  const rawProtocol = stringValue(value.protocol || value.type || fallbackProtocol)
  const type = supportedProtocol(rawProtocol)
  const host = hostValue(value.host || value.server || value.hostname || value.listen)
  const port = portValue(value.port)
  if (!rawProtocol && !host && !port) return null
  return {
    protocol: type,
    rawProtocol,
    host,
    port,
    username: stringValue(value.username || value.user),
    password: typeof value.password === 'string' ? value.password : '',
    noProxy: noProxyValue(value.noProxy || value['no-proxy']),
    name: stringValue(value.name, name),
  }
}

function clashPort(value, bindAddress, protocol, name, auth = {}) {
  if (typeof value === 'number' || /^\d+$/.test(String(value || '').trim())) {
    return { protocol, host: bindAddress, port: Number(value), username: auth.username || '', password: auth.password || '', name }
  }
  const parsed = endpointFromUrl(String(value || ''), protocol)
  if (!parsed || parsed.unsupported) return parsed
  return { ...parsed, protocol, username: auth.username || parsed.username || '', password: auth.password || parsed.password || '', name }
}

function localAuthentication(doc, warnings) {
  const raw = doc.authentication || doc.auth || doc['proxy-auth']
  const list = Array.isArray(raw) ? raw : (raw ? [raw] : [])
  const parsed = []
  for (const item of list) {
    const text = String(item || '')
    const colon = text.indexOf(':')
    if (colon <= 0) continue
    parsed.push({ username: text.slice(0, colon), password: text.slice(colon + 1) })
  }
  if (parsed.length > 1) warnings.push('YAML 中有多个本机代理账号，仅导入第一个账号')
  return parsed[0] || { username: '', password: '' }
}

function transportNeedsMihomo(node, rawProtocol) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false
  const type = stringValue(rawProtocol).toLowerCase()
  if (type === 'http' && node.tls === true) {
    const extra = Object.keys(node).some((key) => CORE_TRANSPORT_KEYS.has(key) && key !== 'tls')
    return extra
  }
  if (node.tls === true && type !== 'https') return true
  return Object.keys(node).some((key) => CORE_TRANSPORT_KEYS.has(key))
}

function candidateIdentity(candidate) {
  return stableValue({
    kind: candidate.kind || 'direct',
    name: candidate.name || '',
    protocol: candidate.protocol || '',
    host: candidate.host || '',
    port: candidate.port || 0,
    username: candidate.username || '',
    password: candidate.password || '',
    noProxy: candidate.noProxy || '',
    node: candidate.kind === 'mihomo' ? candidate.node : null,
  })
}

/**
 * Parse Clash/Mihomo local ports, explicit HTTP(S)/SOCKS endpoints, and
 * complete Mihomo node objects without pretending core-only protocols are HTTP.
 */
export function importProxyYaml(source) {
  const text = typeof source === 'string' ? source : ''
  if (Buffer.byteLength(text, 'utf8') > MAX_IMPORT_BYTES) {
    return { ok: false, error: 'YAML 内容过大，不能超过 1 MB' }
  }
  let doc
  try {
    doc = parseYaml(text)
  } catch (error) {
    const line = Number(error && error.linePos && error.linePos[0] && error.linePos[0].line)
    return { ok: false, error: line > 0 ? 'YAML 格式无效，错误在第 ' + line + ' 行附近' : 'YAML 格式无效' }
  }
  const candidates = []
  const warnings = []
  if (!doc || typeof doc !== 'object') return { ok: false, error: 'YAML 顶层必须是对象或节点列表' }

  const rootObject = Array.isArray(doc) ? {} : doc
  const defaultNoProxy = noProxyValue(rootObject.noProxy || rootObject['no-proxy'] || rootObject.no_proxy || rootObject.bypass)
  const bindAddress = (() => {
    const raw = hostValue(rootObject['bind-address'] || rootObject.bind_address || '127.0.0.1')
    return !raw || raw === '*' || raw === '0.0.0.0' || raw === '::' ? '127.0.0.1' : raw
  })()
  const localAuth = localAuthentication(rootObject, warnings)
  const entries = []
  const skipped = { total: 0, duplicates: 0, providers: 0, synthetic: 0, invalid: 0 }
  let totalNodes = 0
  let localListeners = 0

  const addEntry = (value, name, source = 'node') => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => addEntry(item, nodeName(item, name || source + ' ' + (index + 1)), source))
      return
    }
    if (typeof value === 'string') {
      entries.push({ value, name: stringValue(name, source + ' ' + (entries.length + 1)), source })
      return
    }
    if (!value || typeof value !== 'object') {
      skipped.total += 1
      skipped.invalid += 1
      return
    }
    if (endpointShape(value)) {
      entries.push({ value, name: nodeName(value, stringValue(name, source + ' ' + (entries.length + 1))), source })
      return
    }
    for (const [key, item] of Object.entries(value)) addEntry(item, key, source)
  }

  const addCandidate = (candidate) => {
    const identity = candidateIdentity(candidate)
    if (candidates.some((item) => item._identity === identity)) {
      skipped.total += 1
      skipped.duplicates += 1
      return false
    }
    candidates.push({ ...candidate, _identity: identity })
    return true
  }

  const addParsedEntry = ({ value, name, source, fallbackProtocol = '' }) => {
    totalNodes += 1
    const parsed = endpointFromObject(value, name, fallbackProtocol)
    const rawNode = value && typeof value === 'object' && !Array.isArray(value) ? value : null
    const rawType = stringValue(parsed && parsed.rawProtocol || (rawNode && (rawNode.protocol || rawNode.type)))
    const lowerType = rawType.toLowerCase()
    const host = hostValue(parsed && parsed.host)
    const port = portValue(parsed && parsed.port)
    const displayName = stringValue((rawNode && rawNode.name) || name, source || 'proxy')

    if (parsed && parsed.unsupported) {
      warnings.push(warningForUnsupported(parsed.unsupported))
      skipped.total += 1
      skipped.invalid += 1
      return
    }
    if (!host || !port) {
      if (rawType) warnings.push('YAML 中有节点缺少主机或端口，已跳过')
      skipped.total += 1
      skipped.invalid += 1
      return
    }
    if (NON_PROXY_NODE_TYPES.has(lowerType)) {
      warnings.push('YAML 中发现 Clash 非代理节点，已跳过')
      skipped.total += 1
      skipped.synthetic += 1
      return
    }

    const directProtocol = supportedProtocol(rawType)
    const routeToCore = Boolean(rawNode && (transportNeedsMihomo(rawNode, rawType)
      || (!directProtocol && rawType)))
    if (routeToCore) {
      addCandidate({
        kind: 'mihomo',
        node: deepPlain(rawNode || value),
        name: displayName,
        protocol: rawType || 'unknown',
        host,
        port,
        username: '',
        password: '',
        noProxy: '',
        enabled: true,
      })
      return
    }

    if (!directProtocol) {
      warnings.push(warningForUnsupported(rawType || 'unknown'))
      skipped.total += 1
      skipped.invalid += 1
      return
    }
    let protocol = directProtocol
    if (directProtocol === 'http' && rawNode && rawNode.tls === true) protocol = 'https'
    const parsedName = stringValue(parsed && parsed.name, displayName || protocol + ' proxy')
    addCandidate({
      kind: 'direct',
      name: parsedName,
      protocol,
      host,
      port,
      username: parsed.username || '',
      password: parsed.password || '',
      noProxy: parsed.noProxy || defaultNoProxy || '',
      enabled: true,
    })
  }

  const addLocalCandidate = (value, protocol, label) => {
    if (value === undefined || value === null || value === '') return
    const parsed = clashPort(value, bindAddress, protocol, label, localAuth)
    if (parsed && parsed.unsupported) {
      warnings.push(warningForUnsupported(parsed.unsupported))
      skipped.total += 1
      skipped.invalid += 1
      return
    }
    const endpoint = endpointFromObject(parsed, label)
    if (!endpoint || !endpoint.host || !endpoint.port) {
      warnings.push('YAML 中有本机监听缺少主机或端口，已跳过')
      skipped.total += 1
      skipped.invalid += 1
      return
    }
    if (addCandidate({
      kind: 'direct',
      name: label,
      protocol: supportedProtocol(protocol) || protocol,
      host: endpoint.host,
      port: endpoint.port,
      username: endpoint.username || '',
      password: endpoint.password || '',
      noProxy: defaultNoProxy || '',
      enabled: true,
    })) localListeners += 1
  }

  if (Array.isArray(doc)) {
    for (const [index, item] of doc.entries()) addEntry(item, nodeName(item, 'Clash proxy ' + (index + 1)), 'Clash proxy')
  } else {
    const rootLooksLikeNode = endpointShape(doc)
      && (doc.type || doc.protocol || doc.server || doc.host || doc.hostname)
    const wrappedKeys = new Set([
      'all-proxy', 'all_proxy', 'authentication', 'auth', 'bind-address', 'bind_address',
      'http', 'http-port', 'http-proxy', 'http_proxy', 'httpProxy', 'https', 'https-port',
      'https-proxy', 'https_proxy', 'httpsProxy', 'listeners', 'mixed-port', 'no-proxy',
      'noProxy', 'no_proxy', 'port', 'proxies', 'proxy', 'proxy-auth', 'proxy-providers',
      'proxy-provider', 'proxyProviders', 'proxy_providers', 'socks', 'socks-port',
      'socks5', 'socks5-proxy', 'socks5_proxy', 'socks5h', 'all-proxy', 'bypass',
      'proxy-list', 'proxy_list', 'proxyList',
    ])
    const rootLooksLikeMap = !rootLooksLikeNode
      && !Object.keys(doc).some((key) => wrappedKeys.has(key))
      && Object.values(doc).some((value) => typeof value === 'string' || (value && typeof value === 'object'))
    if (rootLooksLikeNode) addEntry(doc, nodeName(doc, 'proxy'), 'proxy')
    else if (rootLooksLikeMap) addEntry(doc, 'proxy', 'proxy')

    if (!rootLooksLikeNode) {
      for (const [key, protocol, label] of [
        ['mixed-port', 'http', 'Clash mixed-port'],
        ['port', 'http', 'Clash port'],
        ['http-port', 'http', 'Clash http-port'],
        ['socks-port', 'socks5', 'Clash socks-port'],
      ]) {
        addLocalCandidate(doc[key], protocol, label)
        if (key === 'mixed-port' && doc[key] !== undefined && doc[key] !== null && doc[key] !== '') {
          warnings.push('Clash mixed-port 已按 HTTP 导入；本机监听需要 SOCKS5 时请手动切换')
        }
      }
    }

    for (const providerKey of PROVIDER_KEYS) {
      if (doc[providerKey] === undefined || doc[providerKey] === null) continue
      const providerValue = doc[providerKey]
      const count = Array.isArray(providerValue)
        ? providerValue.length
        : providerValue && typeof providerValue === 'object' ? Object.keys(providerValue).length : 1
      skipped.total += count
      skipped.providers += count
      warnings.push('YAML 中包含代理提供器引用，未下载或导入远程节点')
    }

    const explicit = [
      ['http', 'http'], ['https', 'https'], ['socks', 'socks5'], ['socks5h', 'socks5'],
      ['http-proxy', 'http'], ['http_proxy', 'http'], ['httpProxy', 'http'],
      ['https-proxy', 'https'], ['https_proxy', 'https'], ['httpsProxy', 'https'],
      ['socks5-proxy', 'socks5'], ['socks5_proxy', 'socks5'], ['socks5', 'socks5'],
      ['all-proxy', 'http'], ['all_proxy', 'http'], ['proxy', 'http'],
      ['proxy-list', 'http'], ['proxy_list', 'http'], ['proxyList', 'http'],
    ]
    for (const [key, protocol] of explicit) {
      if (doc[key] === undefined || doc[key] === null || doc[key] === '') continue
      const value = doc[key]
      const addExplicit = (entry, name) => {
        if (typeof entry === 'string') {
          const parsed = endpointFromObject(entry, name, protocol)
          if (parsed && parsed.unsupported) {
            warnings.push(warningForUnsupported(parsed.unsupported))
            skipped.total += 1
            skipped.invalid += 1
            return
          }
          if (parsed && parsed.host && parsed.port) addParsedEntry({ value: entry, name, source: key, fallbackProtocol: protocol })
          else {
            skipped.total += 1
            skipped.invalid += 1
          }
          return
        }
        addParsedEntry({ value: entry, name, source: key, fallbackProtocol: protocol })
      }
      if (Array.isArray(value)) {
        value.forEach((entry, index) => addExplicit(entry, nodeName(entry, key + ' ' + (index + 1))))
      } else if (value && typeof value === 'object' && !endpointShape(value)) {
        for (const [name, entry] of Object.entries(value)) addExplicit(entry, name)
      } else {
        addExplicit(value, key)
      }
    }

    if (doc.proxies !== undefined && doc.proxies !== null) addEntry(doc.proxies, 'Clash proxy', 'Clash proxy')
    if (doc.listeners !== undefined && doc.listeners !== null) {
      const listenerEntries = []
      const collectListener = (value, name) => {
        if (Array.isArray(value)) return value.forEach((item, index) => collectListener(item, nodeName(item, name + ' ' + (index + 1))))
        if (value && typeof value === 'object' && !endpointShape(value)) {
          return Object.entries(value).forEach(([key, item]) => collectListener(item, key))
        }
        listenerEntries.push({ value, name })
      }
      collectListener(doc.listeners, 'listener')
      for (const entry of listenerEntries) {
        const item = entry.value && typeof entry.value === 'object' ? entry.value : {}
        const type = stringValue(item.type || item.protocol, 'http').toLowerCase()
        const protocol = type === 'socks' || type === 'socks5' ? 'socks5' : 'http'
        const endpoint = endpointFromObject({ ...item, host: item.host || item.listen || item.server, protocol }, entry.name, protocol)
        if (endpoint && endpoint.host && endpoint.port) {
          if (addCandidate({
            kind: 'direct', name: stringValue(item.name, entry.name), protocol,
            host: endpoint.host, port: endpoint.port, username: endpoint.username || '',
            password: endpoint.password || '', noProxy: defaultNoProxy || '', enabled: true,
          })) localListeners += 1
        } else {
          skipped.total += 1
          skipped.invalid += 1
          warnings.push('YAML 中有本机监听缺少主机或端口，已跳过')
        }
      }
    }
  }

  for (const entry of entries) addParsedEntry(entry)
  if (skipped.duplicates > 0) warnings.push('YAML 中跳过 ' + skipped.duplicates + ' 个完全重复的代理节点')
  if (candidates.length === 0) warnings.push('没有找到可用的代理节点或本机监听')
  const publicCandidates = candidates.map(({ _identity, ...candidate }) => candidate)
  return {
    ok: true,
    candidates: publicCandidates,
    warnings: [...new Set(warnings)],
    summary: {
      totalNodes,
      importedCandidates: publicCandidates.length,
      coreNodes: publicCandidates.filter((candidate) => candidate.kind === 'mihomo').length,
      localListeners,
      skipped: skipped.total,
      skippedDuplicates: skipped.duplicates,
      skippedProviders: skipped.providers,
      skippedSynthetic: skipped.synthetic,
      skippedInvalid: skipped.invalid,
    },
  }
}

export function proxyEndpointChanged(previous, next) {
  return endpointOf(previous) !== endpointOf(next)
}

export function defaultProxyConfig() {
  return proxyConfigPublic(DEFAULT_CONFIG)
}

export default {
  PROXY_PROTOCOLS,
  proxyConfigPath,
  loadProxyConfig,
  proxyConfigPublic,
  saveProxyConfig,
  resolveProxyConfig,
  validateProxyConfig,
  importProxyYaml,
  proxyEndpointChanged,
  defaultProxyConfig,
}
