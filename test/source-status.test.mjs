import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { gitBlobSha, compareInstalledSources } from '../lib/redteam/source-status.js'

test('Git blob hashes match the actual Git framing', () => {
  assert.equal(gitBlobSha('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a')
})

test('installed source status distinguishes matching, different and incomplete trees', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-source-status-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'lib', 'redteam'), { recursive: true })
  const files = ['client.js', 'lib/redteam/ui.js', 'lib/redteam/client.js']
  for (const file of files) writeFileSync(join(root, ...file.split('/')), file)
  const tree = files.map((path) => ({ path, type: 'blob', sha: gitBlobSha(path) }))
  assert.deepEqual(compareInstalledSources(root, tree), {
    state: 'match', compared: 3, different: [], unavailable: [],
  })
  writeFileSync(join(root, 'client.js'), 'old installed UI')
  assert.deepEqual(compareInstalledSources(root, tree), {
    state: 'different', compared: 3, different: ['client.js'], unavailable: [],
  })
  assert.equal(compareInstalledSources(root, tree.slice(1)).state, 'unknown')
  assert.equal(compareInstalledSources(root, null).state, 'unknown')
})
