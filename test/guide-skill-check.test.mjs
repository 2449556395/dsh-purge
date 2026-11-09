import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('guide skill inspection uses the existing catalog API and reports real status', () => {
  for (const path of ['lib/redteam/client.js', 'client.js']) {
    const source = read(path)
    assert.match(source, /api\(\{ op: 'skillCatalog', refresh: true \}\)/, path)
    assert.doesNotMatch(source, /api\(\{ op: 'preflight' \}\)/, path)
    assert.match(source, /pf\.registryState === 'listed'/, path)
    assert.match(source, /if \(!r \|\| r\.ok === false\)/, path)
  }
})

test('host fallback cannot claim skills are loaded when the registry failed', () => {
  const host = read('lib/redteam/ui.js')
  assert.match(host, /skillResult = request\.op === 'skillCatalog'\s*\? markLocalSkillCatalog\(withBothLibraries\(handleSkillOpFromPluginDir\(request\)\), 'unavailable'\)/)
})

test('manual status updates show returned business errors rather than silently refreshing', () => {
  for (const path of ['lib/redteam/client.js', 'client.js']) {
    const source = read(path)
    assert.match(source, /'更新通道失败'/, path)
    assert.match(source, /'更新 WebShell 失败'/, path)
    assert.doesNotMatch(source, /\.then\(\(\) => load\(\), \(e\) => setMsg\(/, path)
  }
})
