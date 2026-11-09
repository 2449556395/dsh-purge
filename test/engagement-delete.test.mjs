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
  assert.equal(deleted.archived, true)
  assert.ok(existsSync(join(deleted.archive_path, 'assets.db')))
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
  assert.equal(result.archived, true)
  assert.equal(readFileSync(join(result.archive_path, 'notes.txt'), 'utf8'), 'incomplete')
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

test('reusing an archived engagement id keeps all earlier archive copies', (t) => {
  const { store } = fixture(t)
  const id = store.openEngagement('repeat').id
  const first = dispatch(store, { op: 'deleteEngagement', id, confirm: id })
  assert.equal(first.archived, true)
  store.openEngagement('repeat')
  const second = dispatch(store, { op: 'deleteEngagement', id, confirm: id })
  assert.equal(second.archived, true)
  assert.notEqual(first.archive_path, second.archive_path)
  assert.ok(existsSync(join(first.archive_path, 'assets.db')))
  assert.ok(existsSync(join(second.archive_path, 'assets.db')))
})

test('archived workspaces can be listed and restored with their database and metadata intact', (t) => {
  const { store } = fixture(t)
  const id = store.openEngagement('restore-me').id
  const archived = dispatch(store, { op: 'deleteEngagement', id, confirm: id })
  assert.equal(archived.archived, true)
  const listed = dispatch(store, { op: 'listArchivedEngagements' })
  assert.equal(listed.ok, true)
  assert.equal(listed.items.length, 1)
  assert.equal(listed.items[0].id, id)
  assert.equal(dispatch(store, { op: 'restoreEngagement', archive: listed.items[0].archive, confirm: 'wrong' }).ok, false)
  const restored = dispatch(store, { op: 'restoreEngagement', archive: listed.items[0].archive, confirm: listed.items[0].archive })
  assert.equal(restored.ok, true)
  assert.equal(restored.restored, true)
  assert.ok(existsSync(store.dbPathOf(id)))
  assert.equal(existsSync(archived.archive_path), false)
  assert.equal(store.listEngagements()[0].id, id)
  assert.equal(dispatch(store, { op: 'listArchivedEngagements' }).items.length, 0)
})

test('restore rejects collisions, malformed names, and symlinked archive folders without overwriting', (t) => {
  const { store } = fixture(t)
  const id = store.openEngagement('collision').id
  const archived = dispatch(store, { op: 'deleteEngagement', id, confirm: id })
  store.openEngagement('collision')
  const result = dispatch(store, { op: 'restoreEngagement', archive: archived.archive_path.split(/[\\/]/).pop(),
    confirm: archived.archive_path.split(/[\\/]/).pop() })
  assert.equal(result.ok, false)
  assert.match(result.error, /already exists/)
  assert.ok(existsSync(archived.archive_path))
  assert.ok(existsSync(store.dbPathOf(id)))
  for (const archive of ['../collision', '..', 'not-an-archive']) {
    assert.equal(dispatch(store, { op: 'restoreEngagement', archive, confirm: archive }).ok, false)
  }
})

test('orphan archived workspaces can be restored without manufacturing an assets.db', (t) => {
  const { store } = fixture(t)
  const id = 'orphan-restore'
  mkdirSync(store.dirOf(id), { recursive: true })
  writeFileSync(join(store.dirOf(id), 'notes.txt'), 'preserve me')
  const archive = dispatch(store, { op: 'deleteEngagement', id, confirm: id })
  const result = dispatch(store, { op: 'restoreEngagement', archive: archive.archive_path.split(/[\\/]/).pop(),
    confirm: archive.archive_path.split(/[\\/]/).pop() })
  assert.equal(result.restored, true)
  assert.equal(readFileSync(join(store.dirOf(id), 'notes.txt'), 'utf8'), 'preserve me')
  assert.equal(existsSync(store.dbPathOf(id)), false)
})
