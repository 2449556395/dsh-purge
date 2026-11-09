import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseReportExportArgs, writeReportBundle } from '../lib/redteam/report-export.js'

test('shareable switch is explicit; legacy raw mode remains the default', () => {
  const cwd = process.cwd()
  assert.equal(parseReportExportArgs([], {}, cwd).shareable, undefined)
  assert.equal(parseReportExportArgs(['--shareable'], {}, cwd).shareable, true)
  assert.throws(() => parseReportExportArgs(['--shareable', '--shareable'], {}, cwd), /重复参数/)
  assert.throws(() => parseReportExportArgs(['--shareable=yes'], {}, cwd), /未知参数/)
})

test('shareable copy masks common secrets, hides target/IP and omits screenshots without mutating raw report', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-shareable-report-'))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))
  const root = path.join(base, 'store')
  const engagement = 'internal-test'
  const dir = path.join(root, 'engagements', engagement)
  const shots = path.join(dir, 'shots')
  fs.mkdirSync(shots, { recursive: true })
  fs.writeFileSync(path.join(shots, 'sample.png'), Buffer.from([1, 2, 3, 4]))
  const report = {
    target: 'Example Company',
    summary: { points: 8 },
    markdown: [
      '# Example Company',
      'Authorization: Bearer synthetic-credential',
      'Cookie: session=synthetic-cookie',
      'password=synthetic-password',
      'api_key: synthetic-api-key',
      '10.1.2.3 links to 10.1.2.3',
      '![Screenshot](shots/sample.png)',
      '-----BEGIN PRIVATE KEY-----',
      'synthetic-key-body',
      '-----END PRIVATE KEY-----',
    ].join('\n'),
    items: [{ shots: [{ url: 'shots/sample.png' }] }],
  }
  const original = report.markdown
  const output = path.join(base, 'out')
  const raw = writeReportBundle({ root, engagement, outDir: output, report })
  assert.equal(fs.readFileSync(raw.reportFile, 'utf8'), original)
  assert.equal(raw.manifest.summary.evidenceFiles, 1)
  const safe = writeReportBundle({ root, engagement, outDir: output, report, shareable: true })
  const markdown = fs.readFileSync(safe.reportFile, 'utf8')
  for (const secret of ['synthetic-credential', 'synthetic-cookie', 'synthetic-password',
    'synthetic-api-key', 'synthetic-key-body', 'Example Company', '10.1.2.3', 'shots/sample.png']) {
    assert.ok(!markdown.includes(secret), 'shareable markdown must not contain ' + secret)
  }
  assert.match(markdown, /Authorization: \[REDACTED_SECRET\]/)
  assert.match(markdown, /IP-01 links to IP-01/)
  assert.match(markdown, /\[EVIDENCE OMITTED\]/)
  assert.equal(safe.manifest.engagementId, '[REDACTED]')
  assert.equal(safe.manifest.privacy.mode, 'shareable')
  assert.equal(safe.manifest.privacy.manualReviewRequired, true)
  assert.equal(safe.manifest.summary.evidenceFiles, 0)
  assert.equal(fs.existsSync(path.join(safe.bundleDir, 'shots')), false)
  assert.equal(fs.readFileSync(raw.reportFile, 'utf8'), original)
  assert.equal(report.markdown, original)
})
