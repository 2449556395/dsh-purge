import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, writeFileSync, unlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  flagPath, isInjectionOff, primeInjectionState, setInjectionOff, toggleInjection,
} from '../lib/inject-switch.js'
import { anchorTextFor, childAnchorTextFor, setInjectionOffProbe } from '../lib/anchor.js'

test('persistent switch writes and clears the shared flag, CLI/desktop see the same state', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-inject-'))
  try {
    assert.equal(flagPath(home), join(home, '.inject-off'))
    assert.equal(primeInjectionState(home), false)
    assert.equal(setInjectionOff(home, true), true)
    assert.equal(existsSync(flagPath(home)), true)
    assert.equal(isInjectionOff(home), true)
    assert.equal(toggleInjection(home), false)
    assert.equal(existsSync(flagPath(home)), false)
    assert.equal(isInjectionOff(home), false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('external file changes take effect without resetting a sticky in-process override', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-inject-ext-'))
  try {
    assert.equal(primeInjectionState(home), false)
    writeFileSync(flagPath(home), 'disabled')
    // Even before the read cache expires, an explicit toggle must read the file.
    assert.equal(toggleInjection(home), false)
    assert.equal(existsSync(flagPath(home)), false)
    writeFileSync(flagPath(home), 'disabled')
    await new Promise((resolve) => setTimeout(resolve, 550))
    assert.equal(isInjectionOff(home), true)
    unlinkSync(flagPath(home))
    await new Promise((resolve) => setTimeout(resolve, 550))
    assert.equal(isInjectionOff(home), false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('failed disk writes never report a successful state change', () => {
  assert.throws(() => setInjectionOff('', true), /DSH_HOME/)
  const missing = join(tmpdir(), 'dsh-inject-no-such-parent-' + process.pid, 'child')
  assert.throws(() => setInjectionOff(missing, true), /ENOENT/)
})

test('anchors and child anchors obey the independent prompt switch', () => {
  const config = { enabled: true, anchorMode: 'on' }
  const child = { agent: { session: { header: { origin: 'subagent' } } } }
  try {
    setInjectionOffProbe(() => false)
    assert.ok(anchorTextFor(config))
    assert.ok(childAnchorTextFor(config, child))
    setInjectionOffProbe(() => true)
    assert.equal(anchorTextFor(config), '')
    assert.equal(childAnchorTextFor(config, child), '')
  } finally {
    setInjectionOffProbe(null)
  }
})
