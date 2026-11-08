import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicWriteFileSync } from '../lib/redteam/atomic-write.js'
import { readSettings, writeSettings } from '../lib/redteam/settings.js'
import { loadPlatformConfig, savePlatformConfig } from '../lib/redteam/platform-config.js'

function withTemp(fn) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-atomic-config-'))
  try { fn(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

test('atomic replacement preserves complete JSON and leaves no staging files', () => withTemp((root) => {
  const file = join(root, 'config.json')
  atomicWriteFileSync(file, '{"version":1}\n')
  atomicWriteFileSync(file, '{"version":2}\n')
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { version: 2 })
  assert.deepEqual(readdirSync(root), ['config.json'])
  if (process.platform !== 'win32') {
    assert.equal(statSync(file).mode & 0o777, 0o600)
  }
}))

test('a failed replacement cleans up staging and keeps the original target', () => withTemp((root) => {
  const file = join(root, 'config.json')
  mkdirSync(file)
  assert.throws(() => atomicWriteFileSync(file, '{"version":2}'))
  assert.equal(statSync(file).isDirectory(), true)
  assert.deepEqual(readdirSync(root), ['config.json'])
}))

test('agent limits and toolkit settings save complete JSON across updates', () => withTemp((root) => {
  writeSettings(root, { maxAgents: 4 })
  writeSettings(root, { otherSetting: 'preserved' })
  assert.deepEqual(readSettings(root), { maxAgents: 4, otherSetting: 'preserved' })

  savePlatformConfig({ toolkitDir: '/test/toolkit', notes: 'keep me' }, root)
  savePlatformConfig({ envAdaptConfigured: true }, root)
  const platform = loadPlatformConfig(root)
  assert.equal(platform.toolkitDir, '/test/toolkit')
  assert.equal(platform.notes, 'keep me')
  assert.equal(platform.envAdaptConfigured, true)

  for (const file of ['settings.json', 'config.json']) {
    assert.doesNotThrow(() => JSON.parse(readFileSync(join(root, file), 'utf8')))
  }
  assert.equal(readdirSync(root).filter((name) => name.includes('.tmp-')).length, 0)
  if (process.platform !== 'win32') {
    assert.equal(statSync(join(root, 'config.json')).mode & 0o777, 0o600)
  }
}))
