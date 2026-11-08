import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../', import.meta.url))

test('npm tarball contains the installed skills and documented maintenance sources', () => {
  const packed = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: repo, encoding: 'utf8', shell: process.platform === 'win32',
    })
  assert.equal(packed.status, 0, packed.error?.message || packed.stderr)
  const [manifest] = JSON.parse(packed.stdout)
  const files = new Set(manifest.files.map(file => file.path))
  for (const required of [
    'lib/redteam/index.js',
    'scripts/redteam-setup.sh',
    'skills/redteam/active-scan.md',
    'maintenance/inject-switch/Build.ps1',
  ]) {
    assert.ok(files.has(required), `npm package omits ${required}`)
  }
  assert.ok([...files].filter(file => file.startsWith('skills/redteam/')).length > 20,
    'most of the bundled skill library is missing')
  assert.ok(![...files].some(file => file.startsWith('maintenance/') && file.includes('/dist/')),
    'built maintenance binaries must be release artifacts, not bundled npm payload')
})
