import test from 'node:test'
import assert from 'node:assert/strict'
import { reviewShannonSarif } from '../lib/redteam/shannon-review.js'

const sample = {
  version: '2.1.0',
  runs: [{
    tool: { driver: { name: 'Shannon' } },
    automationDetails: { id: 'shannon/exploit/demo' },
    results: [
      {
        ruleId: 'shannon/injection',
        level: 'error',
        message: { text: 'Injection finding. Full details go in original report', markdown: 'Sensitive original proof' },
        locations: [{ physicalLocation: { artifactLocation: { uri: 'src/api.js' }, region: { startLine: 17 } } }],
        webRequest: { method: 'GET', target: 'http://127.0.0.1:8000/api/items' },
        properties: { findingId: 'INJ-01', status: 'exploited' },
      },
      {
        ruleId: 'shannon/auth',
        level: 'warning',
        message: { text: 'Needs validation' },
        locations: [{ physicalLocation: { artifactLocation: { uri: 'src/auth.js' } } }],
        properties: { findingId: 'AUTH-01', status: 'blocked_by_constraints' },
      },
    ],
  }],
}

test('Shannon SARIF results are review candidates, not DSH-confirmed vulnerabilities or scores', () => {
  const out = reviewShannonSarif(sample, { status: 'completed' })
  assert.equal(out.assessment.complete, true)
  assert.equal(out.shannon_runs, 1)
  assert.equal(out.unique_findings, 2)
  assert.equal(out.reported_exploited, 1)
  assert.equal(out.independently_confirmed_by_dsh, 0)
  assert.equal(out.items[0].dsh_status, 'candidate')
  assert.equal(out.items[0].reported_status, 'reported-exploited')
  assert.equal(out.items[0].severity_band, 'high-or-critical')
  assert.deepEqual(out.items[0].code_location, { path: 'src/api.js', line: 17 })
  assert.equal(out.items[0].proof_included, false)
  assert.equal(out.items[0].summary.includes('Sensitive original proof'), false)
  assert.equal(out.items[1].severity_band, 'medium')
  assert.equal(out.items[1].reported_status, 'unverified')
})

test('partial and missing status snapshots never become an all-clear result', () => {
  for (const state of ['running', 'partial', 'failed', 'stopped', 'cancelled', 'timed_out']) {
    assert.equal(reviewShannonSarif(sample, { status: state }).assessment.complete, false)
  }
  const empty = { version: '2.1.0', runs: [{
    tool: { driver: { name: 'Shannon' } }, results: [],
  }] }
  assert.equal(reviewShannonSarif(empty, { status: 'partial' }).unique_findings, 0)
  assert.equal(reviewShannonSarif(empty, { status: 'partial' }).assessment.complete, false)
  assert.equal(reviewShannonSarif(empty).assessment.status, 'unknown')
})

test('deduplicates identical Shannon rows without suppressing separate findings', () => {
  const copy = structuredClone(sample)
  copy.runs[0].results.push({ ...copy.runs[0].results[0] })
  const out = reviewShannonSarif(copy, { status: 'completed' }, 1)
  assert.equal(out.unique_findings, 2)
  assert.equal(out.duplicates_skipped, 1)
  assert.equal(out.items.length, 1)
  assert.equal(out.omitted, 1)
})

test('non-Shannon and malformed reports are rejected, not mistaken for valid zero findings', () => {
  assert.throws(() => reviewShannonSarif({}), /SARIF 2.1.0/)
  assert.throws(() => reviewShannonSarif({ version: '2.1.0', runs: [] }), /no Shannon/)
  assert.throws(() => reviewShannonSarif({
    version: '2.1.0', runs: [{ tool: { driver: { name: 'Other' } }, results: [] }],
  }), /no Shannon/)
  assert.throws(() => reviewShannonSarif(sample, { status: 'success' }), /invalid Shannon status/)
  assert.throws(() => reviewShannonSarif({
    version: '2.1.0', runs: [{ tool: { driver: { name: 'Shannon' } } }],
  }), /missing results/)
})
