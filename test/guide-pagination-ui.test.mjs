import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (name) => readFileSync(new URL('../' + name, import.meta.url), 'utf8')
test('asset and finding views page through the existing store API', () => {
  for (const name of ['lib/redteam/client.js','client.js']) {
    const src = read(name)
    assert.match(src, /state: assetState \|\| undefined, sort: sort, limit: pageSize, offset: page \* pageSize/, name)
    assert.match(src, /status: status \|\| undefined, q: qApplied \|\| undefined, limit: pageSize, offset: page \* pageSize/, name)
    assert.match(src, /view === 'list' \? pageControls\(state\.total, page, pageSize, setPage\)/, name)
    assert.match(src, /subTab === 'vulns' \? pageControls\(state\.total, page, pageSize, setPage\)/, name)
  }
})
test('guide is opened inside the existing panel', () => {
  for (const name of ['lib/redteam/client.js','client.js']) {
    const src = read(name)
    assert.match(src, /api\(\{ op: 'guideDoc', doc: 'operations' \}\)/)
    assert.match(src, /'在当前窗口阅读完整中文指南'/)
  }
  const host = read('lib/redteam/ui.js')
  assert.match(host, /if \(request\.op === 'guideDoc'\)/)
  assert.match(host, /OPERATIONS_GUIDE\.zh-CN\.md/)
})
