import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

test('unknown or stale environment status is not treated as a confirmed missing setup', () => {
  assert.match(client, /const cacheRef = useRef\(\{ at: 0, ready: null \}\)/)
  assert.match(client, /if \(!cached\.at \|\| Date\.now\(\) - cached\.at > 2500\) \{[\s\S]{0,100}return false;/)
  assert.match(client, /if \(cached\.ready !== false\) return false;/)
})

test('ready environment closes stale setup prompt; skip failures cannot claim success', () => {
  assert.match(client, /if \(r\.ready\) \{\s*setOpen\(false\);/)
  assert.match(client, /if \(!r \|\| r\.ok !== true \|\| r\.ready !== true\)/)
  assert.doesNotMatch(client, /\.catch\(\(\) => \{\s*setBusy\(false\);\s*cacheRef\.current = \{ at: Date\.now\(\), ready: true/)
})

test('late environment status responses cannot overwrite a newer result or a successful skip', () => {
  assert.match(client, /const refreshId = useRef\(0\)/)
  assert.match(client, /const requestId = \+\+refreshId\.current;/)
  assert.match(client, /if \(requestId !== refreshId\.current\) return null;/)
  assert.match(client, /refreshId\.current \+= 1;[\s\S]{0,160}cacheRef\.current = \{ at: Date\.now\(\), ready: true, skipped: true \};/)
})
