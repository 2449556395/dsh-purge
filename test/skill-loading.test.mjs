import test from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundledSkillSummaries, checkSkill, readFrontmatter, readSkillFromRoot } from '../lib/redteam/skill-availability.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const bundled = join(root, 'skills', 'redteam')
const preset = join(root, 'presets', 'redteam', 'agent.cordis.yml')
const filenames = () => readdirSync(bundled).filter(name => name.endsWith('.md')).sort()

test('frontmatter parser supports CRLF and removes only matching quote pairs', () => {
  const metadata = readFrontmatter('---\r\nname: example\r\ndescription: "带有\\"环境\\"字样的说明"\r\n'
    + "whenToUse: '需要展示时'\r\nrole: review\r\nenabled: true\r\n---\r\n# Other")
  assert.equal(metadata.name, 'example')
  assert.equal(metadata.description, '带有\\"环境\\"字样的说明')
  assert.equal(metadata.whenToUse, '需要展示时')
  assert.equal(metadata.role, 'review')
  assert.equal(metadata.enabled, 'true')
  assert.equal(readFrontmatter('---\ndescription: 段落以"环境没配好"结尾\n---\n').description, '段落以"环境没配好"结尾')
  assert.equal(readFrontmatter('---\ndescription: "引号没有闭合\n---\n').description, '"引号没有闭合')
  assert.deepEqual(readFrontmatter('# No metadata'), {})
})

test('every packaged Skill has matching filename and frontmatter description', () => {
  const files = filenames()
  assert.ok(files.length > 0)
  for (const file of files) {
    const metadata = readFrontmatter(readFileSync(join(bundled, file), 'utf8'))
    assert.equal(metadata.name + '.md', file)
    assert.ok(metadata.description?.trim(), file + ' missing description')
  }
})

test('all packaged Skill bodies are readable and availability-checkable', () => {
  for (const file of filenames()) {
    const name = basename(file, '.md')
    const read = readSkillFromRoot(bundled, name)
    assert.ok(read, name)
    assert.equal(read.content, readFileSync(join(bundled, file), 'utf8'))
    assert.equal(checkSkill({ name, ...read }, { env: {} }).status, 'available')
  }
})

test('copied flat Skills retain identical bytes', t => {
  const copy = mkdtempSync(join(tmpdir(), 'purge-skill-copy-'))
  t.after(() => rmSync(copy, { recursive: true, force: true }))
  for (const file of filenames()) {
    copyFileSync(join(bundled, file), join(copy, file))
    assert.deepEqual(readFileSync(join(copy, file)), readFileSync(join(bundled, file)), file)
  }
})

test('Skill summaries use frontmatter description, not filename or H1 heading', () => {
  const summaries = bundledSkillSummaries()
  const names = filenames().map(file => basename(file, '.md'))
  const primary = summaries.filter(x => x.path.startsWith(bundled))
  assert.equal(primary.length, names.length)
  assert.deepEqual(primary.map(x => x.name).sort(), names)
  for (const entry of primary) {
    const metadata = readFrontmatter(entry.content)
    assert.equal(entry.description, metadata.description, entry.name)
    if (metadata.whenToUse) assert.equal(entry.whenToUse, metadata.whenToUse)
    if (metadata.role) assert.equal(entry.role, metadata.role)
    if (metadata.enabled === 'true') assert.equal(entry.enabled, true)
    if (metadata.enabled === 'false') assert.equal(entry.enabled, false)
  }
  assert.notEqual(primary.find(x => x.name === 'active-scan')?.description, 'active-scan')
  assert.notEqual(primary.find(x => x.name === 'ad-attack')?.description, 'Active Directory')
})

test('preset wires native skill-file and skill tools with user root taking precedence', () => {
  const text = readFileSync(preset, 'utf8')
  assert.match(text, /name:\s*'@deepseek-ai\/dsh-skill-filesystem'/)
  assert.match(text, /name:\s*'@deepseek-ai\/dsh-tool-skill'/)
  const userRoot = text.indexOf("- !!js dshHomePath('skills')")
  const bundledRoot = text.indexOf("- !!js dshHomePath('redteam/skills')")
  assert.ok(userRoot !== -1)
  assert.ok(bundledRoot > userRoot)
})
