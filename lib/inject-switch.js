/** Live prompt-injection switch shared by the plugin, CLI and optional desktop switch.
 * The existence of $DSH_HOME/.inject-off is the sole source of truth.
 * This does NOT disable tools, host patches, approvals or the drill console.
 */
import { existsSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

export const FLAG_NAME = '.inject-off'
const CACHE_MS = 500
let cache = { home: '', at: 0, off: false }

export function flagPath(dshHome) {
  return dshHome ? join(String(dshHome), FLAG_NAME) : ''
}

function diskOff(home) {
  return !!home && existsSync(flagPath(home))
}

/** Fast cached read; external desktop/PowerShell edits become visible within 500ms. */
export function isInjectionOff(dshHome) {
  const home = String(dshHome || '')
  const now = Date.now()
  if (home === cache.home && now >= cache.at && now - cache.at < CACHE_MS) return cache.off
  const off = diskOff(home)
  cache = { home, at: now, off }
  return off
}

/** Force one fresh read at startup (or in tests), not a permanent in-memory override. */
export function primeInjectionState(dshHome) {
  const home = String(dshHome || '')
  const off = diskOff(home)
  cache = { home, at: Date.now(), off }
  return off
}

/** Change the file first; never report success if persistence failed. */
export function setInjectionOff(dshHome, off) {
  const home = String(dshHome || '')
  if (!home) throw new Error('DSH_HOME is required for the injection switch')
  const file = flagPath(home)
  if (off) writeFileSync(file, new Date().toISOString() + '\n', 'utf8')
  else if (existsSync(file)) unlinkSync(file)
  cache = { home, at: Date.now(), off: Boolean(off) }
  return cache.off
}

export function toggleInjection(dshHome) {
  // A toggle must consult the file freshly: an external desktop app may have
  // flipped it inside the 500ms read cache window.
  return setInjectionOff(dshHome, !diskOff(String(dshHome || '')))
}
