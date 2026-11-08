import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectRuntime } from '../lib/redteam/runtime-diagnostics.js'

const sqlite = async () => ({ DatabaseSync: class {} })
const skill = (name, description = 'Fixture Skill') =>
  '---\nname: ' + name + '\ndescription: ' + description + '\n---\n\n# body\n'

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'purge-runtime-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const home = join(root, 'home')
  const bundledDir = join(root, 'bundled')
  mkdirSync(home)
  mkdirSync(bundledDir)
  return { root, home, bundledDir, installed: join(home, 'redteam', 'skills'),
    preset: join(home, '.agent-presets', 'redteam', 'agent.cordis.yml') }
}

test('diagnostic reports missing install without creating files or claiming host registration', async t => {
  const { home, bundledDir, installed } = setup(t)
  writeFileSync(join(bundledDir, 'example-skill.md'), skill('example-skill'))
  const initial = readdirSync(home)
  const report = await inspectRuntime({ home, bundledDir, sqliteProbe: async () => { throw Object.assign(new Error('missing'), { code: 'ERR_UNKNOWN_BUILTIN_MODULE' }) } })
  assert.equal(report.readOnly, true)
  assert.equal(report.runtime.sqliteAvailable, false)
  assert.equal(report.runtime.sqliteError, 'ERR_UNKNOWN_BUILTIN_MODULE')
  assert.equal(report.skills.bundledCount, 1)
  assert.deepEqual(report.skills.missing, ['example-skill.md'])
  assert.equal(report.skills.installedCount, 0)
  assert.equal(report.skills.filesReady, false)
  assert.equal(report.skills.hostRegistryChecked, false)
  assert.equal(report.skills.hostInvocable, null)
  assert.deepEqual(readdirSync(home), initial)
})

test('matching flat Skills and preset path are reported ready without claiming model invocation', async t => {
  const { home, bundledDir, installed, preset } = setup(t)
  mkdirSync(installed, { recursive: true })
  mkdirSync(join(home, '.agent-presets', 'redteam'), { recursive: true })
  for (const name of ['alpha', 'beta-skill']) {
    writeFileSync(join(bundledDir, name + '.md'), skill(name))
    writeFileSync(join(installed, name + '.md'), skill(name))
  }
  writeFileSync(preset, "customSkillDirs:\n  - !!js dshHomePath('skills')\n# - !!js dshHomePath('redteam/skills')\n  - !!js dshHomePath('redteam/skills')\n")
  const before = readFileSync(preset, 'utf8')
  const report = await inspectRuntime({ home, bundledDir, sqliteProbe: sqlite })
  assert.equal(report.runtime.sqliteAvailable, true)
  assert.equal(report.skills.bundledCount, 2)
  assert.equal(report.skills.installedCount, 2)
  assert.equal(report.skills.presetFound, true)
  assert.equal(report.skills.presetPointsToUser, true)
  assert.equal(report.skills.presetPointsToBundle, true)
  assert.equal(report.skills.filesReady, true)
  assert.equal(report.skills.hostRegistryChecked, false)
  assert.equal(report.skills.hostInvocable, null)
  assert.equal(readFileSync(preset, 'utf8'), before)
})

test('invalid metadata and stale copied Skills are explicitly identified', async t => {
  const { home, bundledDir, installed, preset } = setup(t)
  mkdirSync(installed, { recursive: true })
  mkdirSync(join(home, '.agent-presets', 'redteam'), { recursive: true })
  writeFileSync(join(bundledDir, 'wrong.md'), skill('different'))
  writeFileSync(join(installed, 'wrong.md'), skill('wrong'))
  writeFileSync(join(bundledDir, 'invalid.md'), '# no frontmatter')
  writeFileSync(preset, "customSkillDirs:\n  - !!js dshHomePath('skills')\n# - !!js dshHomePath('redteam/skills')\n")
  const result = await inspectRuntime({ home, bundledDir, sqliteProbe: sqlite })
  assert.equal(result.skills.filesReady, false)
  assert.deepEqual(result.skills.invalid, [
    { file: 'invalid.md', reason: 'missing frontmatter' },
    { file: 'wrong.md', reason: 'name/filename mismatch' },
  ])
  assert.deepEqual(result.skills.different, ['wrong.md'])
  assert.equal(result.skills.presetPointsToBundle, false)
})

test('all packaged flat Skill files have host-readable name and description frontmatter', async t => {
  const { home } = setup(t)
  const report = await inspectRuntime({ home, sqliteProbe: sqlite })
  assert.ok(report.skills.bundledCount >= 1)
  assert.deepEqual(report.skills.invalid, [])
  assert.equal(report.skills.missing.length, report.skills.bundledCount)
})
