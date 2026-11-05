/** Host-side proxy settings operations exposed through /redteam/api. */
import {
  importProxyYaml,
  loadProxyConfig,
  proxyConfigPublic,
  resolveProxyConfig,
  saveProxyConfig,
} from './proxy-config.js'
import { matchesNoProxy, requestTextWithProxy } from './proxy-network.js'
import {
  proxyPoolSnapshot,
  proxyPoolSave,
  proxyProfileSave,
  proxyProfileDelete,
  proxyPoolImport,
  proxyPoolConnect,
  proxyPoolTest,
  proxyPoolDisconnect,
  proxyProfileConnect,
  proxyProfileTest,
  proxyProfilesDelete,
  clearProxyPoolState,
} from './proxy-pool.js'

export const PROXY_SCOPE = '插件 GitHub 版本查询与代理连接测试（测试地址：api.github.com）；不修改系统、浏览器或模型 API 的代理设置。'
export const DEFAULT_PROXY_TEST_URL = 'https://api.github.com/'

function isProxyOp(op) {
  return op === 'proxyConfigGet'
    || op === 'proxyConfigSave'
    || op === 'proxyConfigImport'
    || op === 'proxyConfigTest'
    || op === 'proxyPoolGet'
    || op === 'proxyPoolSave'
    || op === 'proxyPoolImport'
    || op === 'proxyPoolConnect'
    || op === 'proxyPoolTest'
    || op === 'proxyPoolDisconnect'
    || op === 'proxyProfileSave'
    || op === 'proxyProfileDelete'
    || op === 'proxyProfilesDelete'
    || op === 'proxyProfileConnect'
    || op === 'proxyProfileTest'
}

function safeError(error, fallback = '代理操作失败') {
  const message = error && error.message ? String(error.message) : ''
  if (/代理地址|代理主机|代理协议|主机和端口|代理池|代理节点|代理超时|直连列表|未回退|活动代理|密码|endpoint changed|host and port|protocol|password must/i.test(message)) return message
  return fallback
}

function poolResult(root, result = {}, extra = {}) {
  return {
    ok: true,
    scope: PROXY_SCOPE,
    ...result,
    ...extra,
  }
}

/**
 * Handle only proxy operations.  Returning undefined for other operations lets
 * the existing redteam API dispatcher continue with its normal routing.
 * `options.testUrl` is intended for deterministic host-side tests only.
 */
export async function handleProxyOp(root, request, options = {}) {
  const op = request && request.op
  if (!isProxyOp(op)) return undefined
  const configRoot = String(root || '.')
  if (op === 'proxyPoolGet') {
    try { return poolResult(configRoot, proxyPoolSnapshot(configRoot)) }
    catch (error) { return { ok: false, error: safeError(error, '代理池读取失败') } }
  }
  if (op === 'proxyPoolSave') {
    try {
      const result = await proxyPoolSave(configRoot, request && request.settings, options)
      return poolResult(configRoot, result)
    } catch (error) {
      return { ok: false, error: safeError(error, '代理池设置无效') }
    }
  }
  if (op === 'proxyProfileSave') {
    try {
      const result = await proxyProfileSave(configRoot, request && request.profile)
      return poolResult(configRoot, result)
    } catch (error) {
      return { ok: false, error: safeError(error, '代理节点设置无效') }
    }
  }
  if (op === 'proxyProfileDelete') {
    try {
      const result = await proxyProfileDelete(configRoot, request && request.id)
      return poolResult(configRoot, result)
    } catch (error) {
      return { ok: false, error: safeError(error, '代理节点删除失败') }
    }
  }
  if (op === 'proxyProfilesDelete') {
    try {
      const result = await proxyProfilesDelete(configRoot, request && request.ids)
      return poolResult(configRoot, result)
    } catch (error) {
      return { ok: false, error: safeError(error, '代理节点批量删除失败') }
    }
  }
  if (op === 'proxyPoolImport') {
    try {
      const result = await proxyPoolImport(configRoot, request && request.yaml)
      if (result && result.ok === false) return result
      return poolResult(configRoot, result)
    } catch (error) {
      return { ok: false, error: safeError(error, '代理节点导入失败') }
    }
  }
  if (op === 'proxyPoolConnect') {
    try {
      const result = await proxyPoolConnect(configRoot, options)
      return { ...poolResult(configRoot, result), ok: result.ok !== false, ...(result.error ? { error: result.error } : {}) }
    } catch (error) {
      return { ...poolResult(configRoot, proxyPoolSnapshot(configRoot)), ok: false, error: safeError(error, '代理池连接失败') }
    }
  }
  if (op === 'proxyPoolTest') {
    try {
      const result = await proxyPoolTest(configRoot, request && request.ids, options)
      return { ...poolResult(configRoot, result), ok: result.ok !== false, ...(result.error ? { error: result.error } : {}) }
    } catch (error) {
      return { ok: false, error: safeError(error, '代理节点批量测试失败') }
    }
  }
  if (op === 'proxyPoolDisconnect') {
    try {
      const result = await proxyPoolDisconnect(configRoot, request && request.id)
      return poolResult(configRoot, result)
    } catch (error) {
      return { ok: false, error: safeError(error, '代理池断开失败') }
    }
  }
  if (op === 'proxyProfileConnect') {
    try {
      const result = await proxyProfileConnect(configRoot, request && request.id, options)
      return { ...poolResult(configRoot, result), ok: result.ok !== false, ...(result.error ? { error: result.error } : {}) }
    } catch (error) {
      return { ...poolResult(configRoot, proxyPoolSnapshot(configRoot)), ok: false, error: safeError(error, '代理节点连接失败') }
    }
  }
  if (op === 'proxyProfileTest') {
    try {
      const result = await proxyProfileTest(configRoot, request && request.profile, options)
      return poolResult(configRoot, { ...proxyPoolSnapshot(configRoot), ...result })
    } catch (error) {
      return { ...poolResult(configRoot, proxyPoolSnapshot(configRoot)), ok: false, error: safeError(error, '代理节点测试失败') }
    }
  }
  if (op === 'proxyConfigGet') {
    try {
      return {
        ok: true,
        scope: PROXY_SCOPE,
        config: proxyConfigPublic(loadProxyConfig(configRoot)),
      }
    } catch (error) {
      return { ok: false, error: safeError(error, '代理配置读取失败') }
    }
  }
  if (op === 'proxyConfigImport') {
    const result = importProxyYaml(request && request.yaml)
    return result
  }
  if (op === 'proxyConfigSave') {
    try {
      const result = {
        ok: true,
        scope: PROXY_SCOPE,
        config: saveProxyConfig(request && request.config, configRoot),
      }
      /* If the pool had been read before a legacy save, let its next read
         perform the one-time migration.  An existing proxy-pool.json remains
         authoritative and is simply reloaded. */
      clearProxyPoolState(configRoot)
      return result
    } catch (error) {
      return { ok: false, error: safeError(error, '代理设置无效') }
    }
  }
  try {
    const config = resolveProxyConfig(request && request.config, configRoot)
    if (!config.enabled) return { ok: false, error: '请先启用插件代理再测试连接' }
    const url = typeof options.testUrl === 'string' && options.testUrl.trim()
      ? options.testUrl.trim()
      : DEFAULT_PROXY_TEST_URL
    if (matchesNoProxy(url, config.noProxy)) {
      return { ok: false, error: '测试地址命中直连列表，请移除 api.github.com 后再测试代理' }
    }
    const started = Date.now()
    const result = requestTextWithProxy(url, {
      method: 'GET',
      timeout: 10000,
      headers: {
        'user-agent': 'dsh-purge-proxy-test',
        accept: 'application/json,text/plain;q=0.8,*/*;q=0.5',
      },
    }, config)
    return Promise.resolve(result).then((response) => {
      if (response.statusCode < 200 || response.statusCode >= 400) {
        return { ok: false, error: '代理返回 HTTP ' + response.statusCode }
      }
      return { ok: true, latencyMs: Date.now() - started, message: '代理连接成功' }
    }).catch((error) => ({ ok: false, error: safeError(error, '代理连接失败') }))
  } catch (error) {
    return { ok: false, error: safeError(error, '代理设置无效') }
  }
}

export default { handleProxyOp, PROXY_SCOPE, DEFAULT_PROXY_TEST_URL }
