import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { RedteamStore } from '../lib/redteam/store-core.js'
import { reviewCandidateQueue, reviewScoring } from '../lib/redteam/score-triage.js'

function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec([
    'CREATE TABLE asset (id INTEGER PRIMARY KEY, ip TEXT, state TEXT, test_status TEXT, priority TEXT, segment_cidr TEXT)',
    'CREATE TABLE vuln (id INTEGER PRIMARY KEY, asset_id INTEGER, title TEXT, severity TEXT, status TEXT, evidence TEXT, gained TEXT, cve TEXT, target TEXT)',
    'CREATE TABLE http_evidence (id INTEGER PRIMARY KEY, vuln_id INTEGER, label TEXT, method TEXT, url TEXT, status INTEGER, request TEXT, response TEXT, note TEXT, captured_by TEXT, captured_at TEXT)',
    'CREATE INDEX idx_http_evidence_vuln ON http_evidence(vuln_id)',
  ].join(';') + ';')
  const addAsset = db.prepare("INSERT INTO asset(id, ip, state, test_status, priority) VALUES (?, ?, 'live', 'untested', 'medium')")
  const addVuln = db.prepare("INSERT INTO vuln(id, asset_id, title, severity, status, evidence) VALUES (?, ?, ?, 'low', 'candidate', '')")
  db.exec('BEGIN')
  try {
    for (let i = 1; i <= 2105; i++) addAsset.run(i, '192.0.2.' + i)
    for (let i = 1; i <= 1103; i++) addVuln.run(i, i === 1 ? 2105 : 1, 'finding-' + i)
    db.exec("INSERT INTO http_evidence(vuln_id, note) VALUES (1, 'actual observation'), (2, '')")
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    db.close()
    throw error
  }
  return { db, store: { db: () => db } }
}

test('planning snapshot includes entries past previous 2000/1000 caps without loading raw HTTP data', () => {
  const { db, store } = fixture()
  try {
    const view = RedteamStore.prototype.planningSnapshot.call(store, 'lab')
    assert.equal(view.assetCount, 2105)
    assert.equal(view.vulnCount, 1103)
    assert.equal(view.assets.length, 2105)
    assert.equal(view.vulns.length, 1103)
    assert.equal(view.assets.some((asset) => asset.id === 2105), true)

    const last = view.vulns.find((v) => v.id === 1)
    assert.equal(last.asset_id, 2105)
    assert.equal(last.has_http_evidence, 1)
    assert.equal(Object.hasOwn(last, 'http_evidence'), false)
    assert.equal(view.vulns.find((v) => v.id === 2).has_http_evidence, 0)
    const queue = reviewCandidateQueue(view.vulns, view.assets)
    assert.deepEqual(queue.ready.map((v) => v.vuln_id), [1])
    assert.equal(queue.needs_evidence.length, 1102)
    assert.equal(queue.needs_scope.length, 0)

    const review = reviewScoring([{
      ...last, status: 'confirmed', gained: '服务器权限',
    }], { items: [{ code: 'server-host', enabled: true, points: 50, hits: [] }] },
    [{ code: 'server-host', re: /服务器权限/ }])
    assert.equal(review.review_ready, 1)
  } finally {
    db.close()
  }
})

test('vulnerability offset pagination reaches rows past 1000 and reports true continuation', () => {
  const { db, store } = fixture()
  try {
    const page = RedteamStore.prototype.listVulns.call(store, 'lab', { limit: 200, offset: 1000 })
    assert.equal(page.total, 1103)
    assert.equal(page.items.length, 103)
    assert.equal(page.items[0].id, 103)
    assert.equal(page.items.at(-1).id, 1)
    assert.equal(page.offset, 1000)
    assert.equal(page.returned, 103)
    assert.equal(page.hasMore, false)
    assert.equal(page.nextOffset, null)

    const first = RedteamStore.prototype.listVulns.call(store, 'lab', { limit: 200, offset: 0 })
    assert.equal(first.nextOffset, 200)
    assert.equal(first.hasMore, true)
    assert.throws(() => RedteamStore.prototype.listVulns.call(store, 'lab', { offset: -1 }), /offset/)
  } finally {
    db.close()
  }
})
