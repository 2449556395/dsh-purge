#!/usr/bin/env node
/** Offline Shannon SARIF review for DSH: no network, scan execution or DB writes. */
import { readFileSync, statSync } from 'node:fs'
import { reviewShannonSarif } from '../lib/redteam/shannon-review.js'

function usage() {
  return 'Usage: node scripts/review-shannon-report.mjs --sarif <report.sarif> [--status <status.json>] [--limit 50]\n'
}

function options(args) {
  const parsed = {}
  for (let i = 0; i < args.length; i++) {
    const name = args[i]
    if (name === '--help' || name === '-h') return { help: true }
    if (!['--sarif', '--status', '--limit'].includes(name) || Object.hasOwn(parsed, name)) {
      throw new Error('invalid or duplicate option: ' + name)
    }
    if (typeof args[i + 1] !== 'string' || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error('missing value for ' + name)
    }
    parsed[name] = args[++i]
  }
  if (!parsed['--sarif']) throw new Error('--sarif is required')
  const limit = parsed['--limit'] === undefined ? 50 : Number(parsed['--limit'])
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('--limit must be 1..200')
  return { sarif: parsed['--sarif'], status: parsed['--status'], limit }
}

function jsonFile(filename) {
  if (statSync(filename).size > 10 * 1024 * 1024) throw new Error('report exceeds 10 MiB')
  return JSON.parse(readFileSync(filename, 'utf8'))
}

try {
  const args = options(process.argv.slice(2))
  if (args.help) process.stdout.write(usage())
  else {
    const sarif = jsonFile(args.sarif)
    const status = args.status ? jsonFile(args.status) : undefined
    process.stdout.write(JSON.stringify(reviewShannonSarif(sarif, status, args.limit), null, 2) + '\n')
  }
} catch (error) {
  process.stderr.write('Shannon report review: ' + String(error?.message || error) + '\n' + usage())
  process.exitCode = 1
}
