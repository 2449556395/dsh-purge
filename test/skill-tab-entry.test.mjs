import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('skill catalog has a visible tab and routes to SkillsTab, not EnvTab', () => {
  for (const path of ['lib/redteam/client.js', 'client.js']) {
    const source = read(path)
    assert.match(source, /\['skills', '技能库'\]/, path + ' missing skills navigation')
    assert.match(source, /st\.tab === 'skills'\) body = h\(SkillsTab,/, path + ' skills route missing')
    assert.doesNotMatch(source, /st\.tab === 'env' \|\| st\.tab === 'knowledge' \|\| st\.tab === 'skills'/,
      path + ' incorrectly routes skills to EnvTab')
  }
})
