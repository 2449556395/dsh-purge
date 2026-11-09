import test from 'node:test'
import assert from 'node:assert/strict'
import { versionLess } from '../lib/redteam/version-compare.js'

test('fork build revision changes are visible even when the base version stays the same', () => {
  assert.equal(versionLess('1.1.92-wxcvm.1', '1.1.92-wxcvm.2'), true)
  assert.equal(versionLess('v1.1.92-wxcvm.1', 'v1.1.92-wxcvm.2'), true)
  assert.equal(versionLess('1.1.92-wxcvm.2', '1.1.92-wxcvm.1'), false)
  assert.equal(versionLess('1.1.92-wxcvm.2', '1.1.92-wxcvm.2'), false)
  assert.equal(versionLess('1.1.92-wxcvm.2', '1.1.93'), true)
  assert.equal(versionLess('1.1.93', '1.1.92-wxcvm.3'), false)
  assert.equal(versionLess('1.1.92-wxcvm.2', '1.1.92'), true)
  assert.equal(versionLess('1.1.92', '1.1.92-wxcvm.2'), false)
})
