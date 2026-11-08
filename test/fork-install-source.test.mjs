import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { purgePnpmBuildSpecs } from '../lib/profile-insert.js'

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8')
const fork = 'wxcvm/dsh-purge'
const tarball = `https://codeload.github.com/${fork}/tar.gz/refs/heads/master`

test('fork package metadata installs from its own maintained repository', () => {
  const pkg = JSON.parse(read('../package.json'))
  assert.equal(pkg.repository.url, `git+https://github.com/${fork}.git`)
  assert.equal(pkg.homepage, `https://github.com/${fork}#readme`)
  assert.equal(pkg.bugs.url, `https://github.com/${fork}/issues`)
  assert.equal(pkg.dsh.install.tarball, tarball)
  assert.equal(pkg.dsh.install.zip, `https://codeload.github.com/${fork}/zip/refs/heads/master`)
  assert.equal(pkg.dsh.install.git, `https://github.com/${fork}.git`)
  assert.ok(purgePnpmBuildSpecs().includes(`dsh-purge@${tarball}`))
})

test('built-in updater and profile fallback no longer point at the original repository', () => {
  const updater = read('../lib/update.js')
  const profile = read('../lib/profile-insert.js')
  assert.ok(updater.includes('const REPO = "wxcvm/dsh-purge";'))
  assert.ok(!updater.includes('YuJunZhiXue/dsh-purge'))
  assert.ok(profile.includes(tarball))
  assert.ok(!profile.includes('YuJunZhiXue/dsh-purge'))
})
