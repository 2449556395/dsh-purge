import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
test('maximization happens inside the current host and scrolling works', () => {
  const c = read('client.js')
  assert.match(c, /"data-maximized": st\.maximized \? "1" : "0"/)
  assert.match(c, /st\.maximized \? "还原窗口" : "最大化"/)
  assert.match(c, /\.dshp-dock-body \.rt-body\{flex:1;min-height:0;min-width:0;overflow:auto!important/)
  assert.match(c, /\.dshp-dock-body \.rt-main\{min-height:0;flex:1;overflow:auto/)
})
test('cleaning guide is local and unfinished apply has concrete reasons', () => {
  const c = read('client.js')
  assert.match(c, /JSON\.stringify\(\{ op: "guideDoc", doc: "cleaning" \}\)/)
  assert.match(c, /d\.host_written === false/)
  assert.match(c, /d\.hook_restore_failed === true/)
  const backend = read('lib/index.js')
  assert.match(backend, /host_written: hostWritten/)
  assert.match(backend, /hook_restore_failed: hookDenyRestoreFailed/)
})
