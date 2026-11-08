import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSettings, settingsPathOf, writeSettings } from '../lib/redteam/settings.js'

function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-settings-integrity-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('settings merge preserves unrelated nested keys and own __proto__ values', t => {
  const root = temporary(t)
  const initial = JSON.parse('{"nested":{"enabled":false,"values":[1,null,"x"]},"__proto__":{"x":1},"maxAgents":3}')
  writeFileSync(settingsPathOf(root), JSON.stringify(initial))
  const next = writeSettings(root, { maxAgents: 9 })
  assert.deepEqual(next, { ...initial, maxAgents: 9 })
  assert.deepEqual(readSettings(root), next)
  assert.equal(Object.getPrototypeOf(next), Object.prototype)
  assert.deepEqual(readdirSync(root), ['settings.json'])
})

test('malformed or non-object existing JSON must never be overwritten', t => {
  const root = temporary(t)
  for (const raw of ['{broken', '[]', '[{"maxAgents":8}]', 'null', '42', '"string"']) {
    writeFileSync(settingsPathOf(root), raw)
    assert.deepEqual(readSettings(root), {})
    assert.throws(() => writeSettings(root, { maxAgents: 8 }))
    assert.equal(readFileSync(settingsPathOf(root), 'utf8'), raw)
    assert.deepEqual(readdirSync(root), ['settings.json'])
  }
})

test('invalid patch, failed serialization, or competing writer lock preserve settings', t => {
  const root = temporary(t)
  writeSettings(root, { custom: 'keep' })
  const before = readFileSync(settingsPathOf(root), 'utf8')
  assert.throws(() => writeSettings(root, []), /expected an object/)
  assert.throws(() => writeSettings(root, { invalid: 1n }), /BigInt/)
  assert.equal(readFileSync(settingsPathOf(root), 'utf8'), before)
  assert.deepEqual(readdirSync(root), ['settings.json'])
  const lock = settingsPathOf(root) + '.lock'
  writeFileSync(lock, 'another owner')
  assert.throws(() => writeSettings(root, { maxAgents: 10 }), { code: 'EEXIST' })
  assert.equal(readFileSync(lock, 'utf8'), 'another owner')
  assert.equal(readFileSync(settingsPathOf(root), 'utf8'), before)
})

test('existing directory is not silently replaced and owned write lock is cleaned', t => {
  const root = temporary(t)
  mkdirSync(settingsPathOf(root))
  assert.throws(() => writeSettings(root, { maxAgents: 8 }), /regular file/)
  assert.equal(existsSync(settingsPathOf(root) + '.lock'), false)
})
