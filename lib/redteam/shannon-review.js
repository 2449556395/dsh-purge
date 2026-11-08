/**
 * Read-only bridge for Shannon 3.x SARIF 2.1.0 and optional 'shannon status --json'.
 * This project does not import Shannon AGPL source code or execute any tests.
 * External reports never create DSH confirmed vulnerabilities or score hits.
 */
const SCAN_STATES = new Set([
  'running', 'completed', 'partial', 'failed', 'stopped', 'cancelled', 'timed_out',
])

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function plain(value, limit = 200) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

function severityBand(level) {
  if (level === 'error') return 'high-or-critical'
  if (level === 'warning') return 'medium'
  if (level === 'note') return 'low-or-informational'
  return 'unknown'
}

function reportedStatus(result) {
  return record(result.properties).status === 'exploited'
    ? 'reported-exploited' : 'unverified'
}

function scanSummary(statusSnapshot) {
  if (statusSnapshot === undefined || statusSnapshot === null) {
    return { status: 'unknown', complete: false, note: 'No Shannon status --json snapshot supplied' }
  }
  const status = record(statusSnapshot).status
  if (!SCAN_STATES.has(status)) throw new Error('invalid Shannon status --json snapshot')
  return {
    status,
    complete: status === 'completed',
    note: status === 'completed'
      ? 'The Shannon scan reports completion, not independent verification by DSH'
      : 'The Shannon scan is incomplete or did not finish successfully; absence of findings proves nothing',
  }
}

export function reviewShannonSarif(sarif, statusSnapshot, limit = 50) {
  const doc = record(sarif)
  if (doc.version !== '2.1.0' || !Array.isArray(doc.runs)) {
    throw new Error('expected SARIF 2.1.0 with runs[]')
  }
  const scan = scanSummary(statusSnapshot)
  const max = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)))
  const items = []
  let sourceRuns = 0
  const seen = new Set()
  let duplicates = 0
  for (const [runIndex, run] of doc.runs.entries()) {
    if (record(record(run.tool).driver).name !== 'Shannon') continue
    sourceRuns++
    if (!Array.isArray(run.results)) throw new Error('Shannon run missing results[]')
    for (const result of run.results) {
      const r = record(result)
      const props = record(r.properties)
      const loc = record((Array.isArray(r.locations) ? r.locations : [])[0])
      const physical = record(loc.physicalLocation)
      const location = record(physical.artifactLocation)
      const region = record(physical.region)
      const request = record(r.webRequest)
      const findingId = plain(props.findingId, 80)
      const rule = plain(r.ruleId, 100)
      const path = plain(location.uri, 260)
      const target = plain(request.target, 260)
      const dedupKey = JSON.stringify([runIndex, findingId, rule, path, target])
      if (seen.has(dedupKey)) { duplicates++; continue }
      seen.add(dedupKey)

      const reported = reportedStatus(r)
      const rawMessage = plain(record(r.message).text, 180)
      items.push({
        source: 'Shannon SARIF',
        run_id: plain(record(run.automationDetails).id, 120) || 'run-' + runIndex,
        finding_id: findingId || null,
        rule_id: rule || null,
        severity_band: severityBand(r.level),
        sarif_level: plain(r.level, 24) || null,
        reported_status: reported,
        // Never call externally produced SARIF proof of DSH-local confirmation.
        dsh_status: 'candidate',
        code_location: path ? { path, line: Number.isInteger(region.startLine) ? region.startLine : null } : null,
        http_entry: target ? { method: plain(request.method, 16), url: target } : null,
        summary: rawMessage,
        proof_included: false,
        independent_review_required: true,
      })
    }
  }
  if (!sourceRuns) throw new Error('SARIF contains no Shannon tool runs')
  items.sort((a, b) => {
    const score = (x) => x.reported_status === 'reported-exploited' ? 0 : 1
    return score(a) - score(b)
  })
  return {
    source: 'Shannon SARIF 2.1.0',
    read_only: true,
    assessment: scan,
    shannon_runs: sourceRuns,
    unique_findings: items.length,
    duplicates_skipped: duplicates,
    reported_exploited: items.filter((x) => x.reported_status === 'reported-exploited').length,
    independently_confirmed_by_dsh: 0,
    items: items.slice(0, max),
    omitted: Math.max(0, items.length - max),
    note: 'This is a report review, not an execution, validation, database import, or score. SARIF excludes complete reproduction evidence; inspect original PDF/JSON and verify scope before changing DSH status.',
  }
}
