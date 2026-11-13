import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { purgePnpmBuildSpecs } from '../lib/profile-insert.js'

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8')
const fork = '2449556395/dsh-purge'
const version = JSON.parse(read('../package.json')).version
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
  assert.ok(updater.includes('const REPO = "2449556395/dsh-purge";'))
  assert.ok(!updater.includes('YuJunZhiXue/dsh-purge'))
  assert.ok(profile.includes('pkg?.dsh?.install?.tarball'))
  assert.ok(!profile.includes('YuJunZhiXue/dsh-purge'))
})

test('English and Chinese installation instructions select this fork without deleting upstream attribution', () => {
  const version = JSON.parse(read('../package.json')).version
  for (const name of ['README.md', 'README.zh-CN.md']) {
    const content = read('../' + name)
    assert.match(content, /https:\/\/codeload\.github\.com\/2449556395\/dsh-purge\/tar\.gz\/refs\/heads\/master/)
    assert.doesNotMatch(content, /https:\/\/codeload\.github\.com\/YuJunZhiXue\/dsh-purge\//)
    assert.match(content, /git clone https:\/\/github\.com\/2449556395\/dsh-purge\.git/)
    assert.match(content, /repo=2449556395%2Fdsh-purge/)
    assert.ok(content.includes('version=' + version + '&repo='))
    assert.ok(content.includes('downloadUrl=https%3A%2F%2Fcodeload.github.com%2F2449556395%2Fdsh-purge%2Ftar.gz%2Frefs%2Fheads%2Fmaster'))
    assert.ok(content.includes('YuJunZhiXue/dsh-purge'), 'original attribution retained')
  }
})

test('Windows Desktop installer pins the current release and supports rollback', () => {
  const version = JSON.parse(read('../package.json')).version
  const script = read('../scripts/update-desktop-fork.ps1')
  assert.ok(script.includes("$version = '" + version + "'"))
  assert.ok(script.includes('https://codeload.github.com/2449556395/dsh-purge/tar.gz/refs/heads/master'))
  assert.match(script, /pnpm install --frozen-lockfile --ignore-scripts/)
  assert.match(script, /\[switch\]\$CheckOnly/)
})
