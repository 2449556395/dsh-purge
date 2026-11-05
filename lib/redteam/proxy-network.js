/**
 * Explicit, per-request proxy transport for the plugin.
 *
 * Nothing here changes process.env or Node's global dispatcher.  A caller opts
 * in by passing a proxy config to requestTextWithProxy; callers that do not
 * pass one retain the normal direct request behavior.
 */
import http from 'node:http'
import https from 'node:https'
import proxyAgentPackage from 'proxy-agent'

const { ProxyAgent } = proxyAgentPackage
const BODY_CAP = 4 * 1024 * 1024

function hostForUrl(host) {
  const value = String(host || '').trim()
  if (value.includes(':') && !value.startsWith('[')) return '[' + value + ']'
  return value
}

function hostnameForRequest(host) {
  const value = String(host || '').trim()
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value
}

function encodeAuth(value) {
  return encodeURIComponent(String(value || ''))
}

export function proxyUrlOf(config) {
  if (!config || config.enabled === false) return null
  const protocol = String(config.protocol || '').toLowerCase()
  const scheme = protocol === 'socks5' ? 'socks5h' : protocol
  const host = hostForUrl(config.host)
  const port = Number(config.port)
  if (!['http', 'https', 'socks5h'].includes(scheme) || !host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return null
  }
  const username = String(config.username || '')
  const password = String(config.password || '')
  const auth = username ? encodeAuth(username) + (password ? ':' + encodeAuth(password) : '') + '@' : ''
  return scheme + '://' + auth + host + ':' + port
}

function targetPort(url) {
  return Number(url.port || (url.protocol === 'https:' ? 443 : 80))
}

function hostAndPort(value) {
  let token = String(value || '').trim().toLowerCase()
  if (token.startsWith('[')) {
    const end = token.indexOf(']')
    if (end >= 0) return { host: token.slice(1, end), port: token.slice(end + 1).replace(/^:/, '') }
  }
  const colon = token.lastIndexOf(':')
  if (colon > 0 && token.indexOf(':') === colon) return { host: token.slice(0, colon), port: token.slice(colon + 1) }
  return { host: token, port: '' }
}

/** Match the common NO_PROXY forms without consulting process.env. */
export function matchesNoProxy(targetUrl, noProxy) {
  const url = targetUrl instanceof URL ? targetUrl : new URL(String(targetUrl))
  const raw = Array.isArray(noProxy) ? noProxy.join(',') : String(noProxy || '')
  const tokens = raw.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean)
  if (tokens.length === 0) return false
  const host = String(url.hostname || '').replace(/^\[|\]$/g, '').toLowerCase()
  const port = String(targetPort(url))
  for (const original of tokens) {
    if (original === '*') return true
    const parsed = hostAndPort(original)
    const wantedHost = parsed.host.replace(/^\*\./, '').replace(/^\./, '')
    if (!wantedHost) continue
    if (parsed.port && parsed.port !== port) continue
    if (host === wantedHost || host.endsWith('.' + wantedHost)) return true
  }
  return false
}

function shouldUseProxy(target, config) {
  return proxyUrlOf(config) !== null && !matchesNoProxy(target, config.noProxy)
}

function safeNetworkError(error) {
  const code = error && error.code ? String(error.code) : ''
  if (code === 'ABORT_ERR' || (error && error.name === 'AbortError')) {
    const normalized = new Error('proxy request aborted')
    normalized.code = 'ABORT_ERR'
    normalized.name = 'AbortError'
    return normalized
  }
  if (code) {
    const normalized = new Error('proxy request failed (' + code + ')')
    normalized.code = code
    return normalized
  }
  return new Error('proxy request failed')
}

function destroyAgent(agent) {
  try { agent?.destroy?.() } catch { /* ignore */ }
}

function abortError() {
  const error = new Error('proxy request aborted')
  error.code = 'ABORT_ERR'
  error.name = 'AbortError'
  return error
}

/**
 * Issue an HTTP(S) request and collect a bounded response body.
 * Redirect handling remains the caller's responsibility, matching the old
 * updater request behavior.
 */
export function requestTextWithProxy(target, options = {}, config = null) {
  return new Promise((resolve, reject) => {
    if (options.signal && options.signal.aborted) {
      reject(abortError())
      return
    }
    let url
    try { url = target instanceof URL ? target : new URL(String(target)) } catch { reject(new Error('invalid request URL')); return }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      reject(new Error('only HTTP and HTTPS request URLs are supported'))
      return
    }
    const lib = url.protocol === 'https:' ? https : http
    const proxy = shouldUseProxy(url, config) ? proxyUrlOf(config) : null
    let agent = null
    try {
      /* ProxyAgent's constructor takes options; supplying a callback keeps it
       * from consulting HTTP_PROXY/NO_PROXY in the host process. */
      agent = proxy ? new ProxyAgent({ getProxyForUrl: () => proxy }) : null
    } catch { reject(new Error('invalid proxy configuration')); return }
    const requestOptions = {
      ...options,
      protocol: url.protocol,
      hostname: hostnameForRequest(url.hostname),
      port: url.port || undefined,
      path: url.pathname + url.search,
      headers: { ...(options.headers || {}) },
      ...(agent ? { agent } : {}),
    }
    if (requestOptions.headers.host === undefined && requestOptions.headers.Host === undefined) {
      requestOptions.headers.host = url.host
    }
    let settled = false
    let deadline
    let abortListener
    const cleanup = () => {
      if (deadline) clearTimeout(deadline)
      if (options.signal && abortListener) {
        try { options.signal.removeEventListener('abort', abortListener) } catch { /* ignore */ }
      }
    }
    const finishReject = (error) => {
      if (settled) return
      settled = true
      cleanup()
      destroyAgent(agent)
      reject(safeNetworkError(error))
    }
    let req
    try {
      req = lib.request(requestOptions, (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          if (settled) return
          if (body.length + chunk.length > BODY_CAP) {
            req.destroy()
            finishReject(new Error('response too large'))
            return
          }
          body += chunk
        })
        res.on('error', finishReject)
        res.on('end', () => {
          if (settled) return
          settled = true
          cleanup()
          destroyAgent(agent)
          resolve({ statusCode: res.statusCode || 0, headers: res.headers, body })
        })
      })
      req.on('error', finishReject)
    } catch (error) {
      finishReject(error)
      return
    }
    const timeoutMs = Number(options.timeout)
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      deadline = setTimeout(() => {
        const timeout = new Error('timeout')
        timeout.code = 'ETIMEDOUT'
        /* Reject before waiting for an agent's CONNECT/TLS handshake to emit. */
        finishReject(timeout)
        try { req.destroy(timeout) } catch { /* ignore */ }
      }, timeoutMs)
    }
    if (options.signal) {
      abortListener = () => {
        const aborted = abortError()
        finishReject(aborted)
        try { req.destroy(aborted) } catch { /* ignore */ }
      }
      if (options.signal.aborted) abortListener()
      else options.signal.addEventListener('abort', abortListener, { once: true })
    }
    try {
      if (options.body !== undefined && options.body !== null) req.write(options.body)
      req.end()
    } catch (error) {
      finishReject(error)
    }
  })
}

export default {
  proxyUrlOf,
  matchesNoProxy,
  requestTextWithProxy,
}
