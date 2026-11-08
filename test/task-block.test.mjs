import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DDL, RedteamStore } from '../lib/redteam/store-core.js'
import { nextTaskCard, planUntestedAssetTasks, unblockedTaskWindow } from '../lib/redteam/score-triage.js'

const methods = {
  db(id) { return this.databases[id] },
  recordTaskBlock: RedteamStore.prototype.recordTaskBlock,
  blockedTaskKeys: RedteamStore.prototype.blockedTaskKeys,
  listTaskBlocks: RedteamStore.prototype.listTaskBlocks,
  clearTaskBlock: RedteamStore.prototype.clearTaskBlock,
}

test('confirmed blocked keys persist across database reopen and do not cross engagements', () => {
  const root = mkdtempSync(join(tmpdir(), 'redteam-task-blocks-'))
  const labPath = join(root, 'lab.db')
  const otherPath = join(root, 'other.db')
  let lab = new DatabaseSync(labPath)
  const other = new DatabaseSync(otherPath)
  const store = { ...methods, databases: { lab, other } }
  const key = '漏洞发现:asset #8'
  try {
    lab.exec(DDL)
    other.exec(DDL)
    lab.exec(DDL) // DDL must be reentrant for an existing engagement
    store.recordTaskBlock('lab', key, 'waiting for permission')
    assert.deepEqual(store.blockedTaskKeys('lab'), [key])
    assert.deepEqual(store.blockedTaskKeys('other'), [])

    // Second write updates the reason without creating another block.
    store.recordTaskBlock('lab', key, 'access approval still pending')
    const page = store.listTaskBlocks('lab')
    assert.equal(page.total, 1)
    assert.equal(page.items[0].task_key, key)
    assert.equal(page.items[0].reason, 'access approval still pending')
    assert.match(page.items[0].blocked_at, /^\d{4}-\d\d-/)

    lab.close()
    lab = new DatabaseSync(labPath)
    store.databases.lab = lab
    lab.exec(DDL)
    assert.deepEqual(store.blockedTaskKeys('lab'), [key])

    const assets = Array.from({ length: 70 }, (_, index) => ({
      id: index + 1, ip: '192.0.2.' + (index + 1), state: 'live', test_status: 'untested',
    }))
    for (const asset of assets.slice(0, 39)) {
      store.recordTaskBlock('lab', '漏洞发现:asset #' + asset.id, 'test environment unavailable')
    }
    const picked = unblockedTaskWindow(assets, '漏洞发现', 'asset', store.blockedTaskKeys('lab'))
    assert.equal(picked.skipped.length, 39)
    assert.deepEqual(picked.items.map((asset) => asset.id),
      Array.from({ length: 30 }, (_, index) => index + 40))
    assert.equal(nextTaskCard(planUntestedAssetTasks(picked.items)).target, 'asset #40')

    const first = store.listTaskBlocks('lab', { limit: 10 })
    assert.equal(first.total, 39)
    assert.equal(first.items.length, 10)
    assert.equal(first.hasMore, true)
    assert.equal(first.nextOffset, 10)
    assert.equal(store.listTaskBlocks('lab', { limit: 10, offset: 35 }).items.length, 4)

    assert.deepEqual(store.clearTaskBlock('lab', key), { task_key: key, cleared: true })
    assert.deepEqual(store.clearTaskBlock('lab', key), { task_key: key, cleared: false })
    const recovered = unblockedTaskWindow(assets, '漏洞发现', 'asset', store.blockedTaskKeys('lab'))
    assert.equal(recovered.items[0].id, 8)
    assert.deepEqual(store.blockedTaskKeys('other'), [])
  } finally {
    lab.close()
    other.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('a task block requires an explicit task key and real reason; invalid pagination is rejected', () => {
  const db = new DatabaseSync(':memory:')
  const store = { ...methods, databases: { lab: db } }
  try {
    db.exec(DDL)
    for (const key of ['', 'asset #8', ':asset #8', '漏洞发现:', 'a'.repeat(510) + ':asset #8']) {
      assert.throws(() => store.recordTaskBlock('lab', key, 'blocked'), /task_key/)
    }
    assert.throws(() => store.recordTaskBlock('lab', '漏洞发现:asset #8', ''), /reason/)
    assert.throws(() => store.recordTaskBlock('lab', '漏洞发现:asset #8', 'x'.repeat(1001)), /reason/)
    assert.throws(() => store.clearTaskBlock('lab', ''), /task_key/)
    assert.throws(() => store.listTaskBlocks('lab', { offset: -1 }), /offset/)
    assert.throws(() => store.listTaskBlocks('lab', { limit: 0 }), /limit/)
    assert.deepEqual(store.blockedTaskKeys('lab'), [])
  } finally {
    db.close()
  }
})
