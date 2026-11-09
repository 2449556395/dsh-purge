import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')

test('published zip has a checksum generated from exactly the uploaded file', () => {
  assert.match(workflow, /sha256sum "\$zip" > SHA256SUMS\.txt/)
  assert.match(workflow, /gh release upload "\$tag" "\$zip" SHA256SUMS\.txt --clobber/)
})

test('fork release requires manual dispatch except the explicitly pinned one-off publish commit', () => {
  assert.match(workflow, /github\.repository == 'wxcvm\/dsh-purge'/)
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/)
  const oneOff = workflow.match(/startsWith\(github\.event\.head_commit\.message, 'release: ([^']+)'\)/)
  if (oneOff) {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    assert.equal(oneOff[1], 'v' + pkg.version)
    assert.match(workflow, /github\.event_name == 'push'/)
  }
})
