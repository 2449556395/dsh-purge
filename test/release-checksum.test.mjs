import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')

test('published zip has a checksum generated from exactly the uploaded file', () => {
  assert.match(workflow, /sha256sum "\$zip" > SHA256SUMS\.txt/)
  assert.match(workflow, /gh release upload "\$tag" "\$zip" SHA256SUMS\.txt --clobber/)
})

test('fork only permits manual release dispatch on master', () => {
  assert.match(workflow, /github\.repository == 'wxcvm\/dsh-purge' && github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/master'/)
  assert.doesNotMatch(workflow, /startsWith\(github\.event\.head_commit\.message/)
})
