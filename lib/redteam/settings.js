/**
 * 插件级设置（零依赖）：目前只有一项 —— **并发执行智能体上限**。
 *
 * 为什么不用环境变量：`REDTEAM_MAX_AGENTS` 只能启动前设，改完得重启 dsh web；
 * 而"同时派几个执行智能体"是使用中最常调的一项，面板上应该能直接改。
 * 所以落一份 JSON 到事实库根目录：`$DSH_HOME/redteam/settings.json`。
 *
 * 生效顺序：settings.json → 环境变量 `REDTEAM_MAX_AGENTS` → 默认 3。
 * 工具侧（redteam_agent_slot 闸门）与面板侧（「智能体」页）读的是同一份，避免两处口径漂移。
 */
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteFileSync } from './atomic-write.js'

/** 默认并发上限（用户口径：整个项目默认 3 个执行智能体）。 */
export const DEFAULT_MAX_AGENTS = 3

/**
 * 【内部限制已解除】并发硬上限取消（原为 10，超出部分会被 clamp 静默压回）。
 * 现在只保留下限 1：填多少就用多少，由用户自己对 API Key 的并发/速率负责。
 */
export const MAX_AGENTS_LIMIT = Number.MAX_SAFE_INTEGER

/** 设置文件路径（跟事实库同一个根，随事实库一起备份/迁移）。 */
export function settingsPathOf(root) {
  return join(String(root || '.'), 'settings.json')
}

const isSettingsObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** 读全部设置（读不到/坏了都当空对象，绝不抛）。 */
export function readSettings(root) {
  try {
    if (!existsSync(settingsPathOf(root))) return {}
    const parsed = JSON.parse(readFileSync(settingsPathOf(root), 'utf8'))
    return isSettingsObject(parsed) ? parsed : {}
  } catch { return {} }
}

/** 合并写入若干项设置，返回写入后的完整设置。 */
export function writeSettings(root, patch) {
  if (!isSettingsObject(patch)) throw new TypeError('settings patch: expected an object')
  mkdirSync(String(root || '.'), { recursive: true })
  const file = settingsPathOf(root)
  const lock = file + '.lock'
  const lockFd = openSync(lock, 'wx', 0o600)
  try {
    let current = {}
    if (existsSync(file)) {
      const stat = lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new TypeError('settings path must be a regular file')
      }
      current = JSON.parse(readFileSync(file, 'utf8'))
      if (!isSettingsObject(current)) {
        throw new TypeError('existing settings: expected a JSON object')
      }
    }
    // Spread preserves own "__proto__" keys without changing the result prototype.
    const next = { ...current, ...patch }
    const serialized = JSON.stringify(next, null, 2) + '\n'
    atomicWriteFileSync(file, serialized)
    return next
  } finally {
    try { closeSync(lockFd) } finally { unlinkSync(lock) }
  }
}

/** 把任意输入收敛到 ≥1 的整数（【内部限制已解除】不再有上封顶）。 */
export function clampMaxAgents(value) {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n)) return DEFAULT_MAX_AGENTS
  return Math.max(n, 1)
}

/**
 * 当前生效的并发上限。
 * @param root - 事实库根目录（`ctx.redteam.root`）。
 * @param env - 环境变量表（便于测试注入）。
 * @returns 生效的整数上限。
 */
export function maxAgentsOf(root, env = process.env) {
  const fromFile = Number(readSettings(root).maxAgents)
  if (Number.isFinite(fromFile) && fromFile > 0) return clampMaxAgents(fromFile)
  const fromEnv = Number(env && env.REDTEAM_MAX_AGENTS)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return clampMaxAgents(fromEnv)
  return DEFAULT_MAX_AGENTS
}

/** 保存并发上限，返回实际生效值。 */
export function saveMaxAgents(root, value) {
  const applied = clampMaxAgents(value)
  writeSettings(root, { maxAgents: applied })
  return applied
}

/** 当前设置是从哪来的（面板上要如实说明，避免"我改了没生效"的错觉）。 */
export function maxAgentsSourceOf(root, env = process.env) {
  const fromFile = Number(readSettings(root).maxAgents)
  if (Number.isFinite(fromFile) && fromFile > 0) return 'settings'
  const fromEnv = Number(env && env.REDTEAM_MAX_AGENTS)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return 'env'
  return 'default'
}
