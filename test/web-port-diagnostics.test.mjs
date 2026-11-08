import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseNetstatListeners, parseLsofPids, parseSsListeners, looksLikeDshWeb,
  webPortNumber, recordPath, writeWebRecord, readWebRecord,
} from '../lib/web-port-diagnostics.js'

test('Windows netstat identifies only the requested listening port, IPv4 and IPv6', () => {
  const sample = [
    '  TCP    0.0.0.0:43120      0.0.0.0:0      LISTENING      700',
    '  TCP    [::]:43120         [::]:0         LISTENING      701',
    '  TCP    0.0.0.0:43121      0.0.0.0:0      LISTENING      702',
    '  TCP    127.0.0.1:43120   0.0.0.0:0      ESTABLISHED    703',
    '  TCP    127.0.0.1:43120   0.0.0.0:0      LISTENING      700',
  ].join('\n')
  assert.deepEqual(parseNetstatListeners(sample, 43120), [700, 701])
})

test('Unix lsof and ss outputs deduplicate the actual listener PIDs', () => {
  assert.deepEqual(parseLsofPids('400\n401\n400\nx\n'), [400, 401])
  const ss = [
    'LISTEN 0 128 0.0.0.0:43120 0.0.0.0:* users:(("node",pid=321,fd=7))',
    'LISTEN 0 128 [::]:43120 [::]:* users:(("node",pid=322,fd=8))',
    'LISTEN 0 128 0.0.0.0:431200 0.0.0.0:* users:(("node",pid=323,fd=9))',
  ].join('\n')
  assert.deepEqual(parseSsListeners(ss, 43120), [321, 322])
})

test('only the real DSH web entry matches; a node process alone is insufficient', () => {
  assert.equal(looksLikeDshWeb('node "C:\\app\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" web --port 43120'), true)
  assert.equal(looksLikeDshWeb('node /work/node_modules/@deepseek-ai/dsh/lib/bin.js web --port=43120'), true)
  assert.equal(looksLikeDshWeb('node /work/node_modules/@deepseek-ai/dsh/lib/bin.js desktop'), false)
  assert.equal(looksLikeDshWeb('node /work/other/bin.js web'), false)
  assert.equal(looksLikeDshWeb(''), false)
})

test('PID record is advisory and read-only; malformed records are ignored', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-web-record-'))
  try {
    const file = writeWebRecord(43120, 12345, home)
    assert.equal(file, recordPath(home, 43120))
    const record = readWebRecord(home, 43120)
    assert.equal(record.pid, 12345)
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).port, 43120)
    assert.equal(readWebRecord(home, 43121), null)
    writeFileSync(file, '{"pid":null,"port":43120}')
    assert.equal(readWebRecord(home, 43120), null)
    assert.throws(() => writeWebRecord(70000, 1, home), /port/)
    assert.throws(() => writeWebRecord(43120, 0, home), /pid/)
    assert.throws(() => webPortNumber(0), /port/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
