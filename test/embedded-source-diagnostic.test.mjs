import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
test('embedded Guide exposes an installed-source check', () => {
  for (const p of ['lib/redteam/client.js', 'client.js']) {
    const source = read(p)
    assert.match(source, /api\(\{ op: 'sourceStatus' \}\)/)
    assert.match(source, /检查实际安装副本/)
    assert.match(source, /实际插件目录/)
  }
})
test('source status is independent of update preflight', () => {
  assert.match(read('lib/redteam/ui.js'),
    /request\.op === 'sourceStatus'\) return \{ ok: true, source: await installedSourceStatus\(pkg, proxyRoot\) \}/)
})
