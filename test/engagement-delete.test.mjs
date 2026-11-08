import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RedteamStore, dispatch } from '../lib/redteam/store-core.js'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'redteam-delete-target-'))
  const store = new RedteamStore(root)
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
  return { root, store }
}

test('deleting selected target closes SQLite and switches to a surviving target', (t) => {
  const { store } = fixture(t)
  const first = store.openEngagement('alpha').id
  const second = store.openEngagement('bravo').id
  assert.equal(store.activeEngagementId(), second)
  assert.ok(store.handles.has(second))
  const deleted = dispatch(store, { op: 'deleteEngagement', id: second, confirm: second })
  assert.equal(deleted.ok, true)
  assert.equal(deleted.deleted, true)
  assert.equal(deleted.current, first)
  assert.equal(store.handles.has(second), false)
  assert.equal(existsSync(store.dirOf(second)), false)
  assert.equal(store.activeEngagementId(), first)
  assert.equal(readFileSync(store.currentPath(), 'utf8'), first)
  assert.equal(store.listEngagements().length, 1)
  assert.ok(existsSync(store.dbPathOf(first)))
})

test('orphan directory without assets.db can be deleted without creating a database', (t) => {
  const { store } = fixture(t)
  const orphan = 'ghost-target'
  mkdirSync(store.dirOf(orphan), { recursive: true })
  writeFileSync(join(store.dirOf(orphan), 'notes.txt'), 'incomplete')
  assert.equal(store.activeEngagementId(), undefined)
  assert.equal(store.listEngagements()[0].id, orphan)
  const result = dispatch(store, { op: 'deleteEngagement', id: orphan, confirm: orphan })
  assert.equal(result.ok, true)
  assert.equal(result.deleted, true)
  assert.equal(result.current, null)
  assert.equal(existsSync(store.dirOf(orphan)), false)
  assert.equal(store.handles.size, 0)
})

test('missing target is an idempotent no-op, including a stale current pointer', (t) => {
  const { store } = fixture(t)
  writeFileSync(store.currentPath(), 'missing-target')
  const result = dispatch(store, { op: 'deleteEngagement', id: 'missing-target', confirm: 'missing-target' })
  assert.equal(result.ok, true)
  assert.equal(result.deleted, false)
  assert.equal(result.not_found, true)
  assert.equal(result.current, null)
  assert.equal(existsSync(store.dirOf('missing-target')), false)
  assert.equal(readFileSync(store.currentPath(), 'utf8'), '')
})

test('delete requires exact confirmation and refuses path traversal', (t) => {
  const { root, store } = fixture(t)
  const id = store.openEngagement('keep').id
  for (const req of [
    { op: 'deleteEngagement', id },
    { op: 'deleteEngagement', id, confirm: 'other' },
    { op: 'deleteEngagement', id: '../keep', confirm: '../keep' },
    { op: 'deleteEngagement', id: '..', confirm: '..' },
    { op: 'deleteEngagement', id: '/tmp', confirm: '/tmp' },
  ]) {
    const result = dispatch(store, req)
    assert.equal(result.ok, false)
  }
  assert.ok(existsSync(store.dbPathOf(id)))
  assert.ok(existsSync(root))
})
