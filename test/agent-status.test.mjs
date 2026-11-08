import test from 'node:test'
import assert from 'node:assert/strict'
import { collectAgentStatus } from '../lib/redteam/agent-status.js'

const session = (id) => ({ id, header: {} })
const context = (rows, children, agents) => ({
  get(name) {
    if (name === 'sessions') return { list: async () => rows }
    if (name === 'subagents') return { listChildren: async (id) => children(id) }
    if (name === 'agents') return { get: async (id) => agents?.[id] }
  },
})

test('legacy child activity returns accurate usage and free slots for one session', async () => {
  const result = await collectAgentStatus(context([session('root')], () => [
    { id: 'one', kind: 'child', activity: 'running' },
    { id: 'two', kind: 'child', activity: 'idle' },
  ]))
  assert.equal(result.ok, true)
  assert.equal(result.available, true)
  assert.equal(result.used, 1)
  assert.equal(result.free, 2)
  assert.equal(result.per_root[0].owner, 'root')
})

test('modern Agent.status fallback is used rather than assuming idle', async () => {
  const result = await collectAgentStatus(context([session('root')], () => [
    { id: 'a' }, { id: 'b' },
  ], { a: { status: 'running' }, b: { status: 'idle' } }))
  assert.equal(result.available, true)
  assert.equal(result.used, 1)
  assert.equal(result.free, 2)
})

test('unknown child and failed root leave free slots unknown', async () => {
  const unknown = await collectAgentStatus(context([session('root')], () => [
    { id: 'a', activity: 'running' }, { id: 'b' },
  ]))
  assert.equal(unknown.used, 1)
  assert.equal(unknown.free, null)
  assert.equal(unknown.available, false)
  assert.equal(unknown.used_is_lower_bound, true)
  const failed = await collectAgentStatus(context([session('a'), session('b')], (id) => {
    if (id === 'b') throw Error('registry unavailable')
    return [{ id: 'only', activity: 'running' }]
  }))
  assert.equal(failed.used, 1)
  assert.equal(failed.free, null)
  assert.equal(failed.available, false)
  assert.match(failed.per_root[1].error, /registry unavailable/)
})

test('multiple roots report per-root free but not fake global capacity', async () => {
  const result = await collectAgentStatus(context([session('a'), session('b')], (id) =>
    [{ id: id + '1', activity: 'running' }, { id: id + '2', activity: 'running' }]))
  assert.equal(result.used, 4)
  assert.equal(result.available, true)
  assert.equal(result.free, null)
  assert.deepEqual(result.per_root.map(x => x.free), [1, 1])
})

test('missing registries and malformed lists never report zero as confirmed free capacity', async () => {
  const absent = await collectAgentStatus({ get() { throw Error('missing') } })
  assert.equal(absent.ok, false)
  assert.equal(absent.free, null)
  const empty = await collectAgentStatus(context([], () => []))
  assert.equal(empty.available, false)
  assert.equal(empty.free, null)
  const malformed = await collectAgentStatus(context([{ id: 'bad' }], () => []))
  assert.equal(malformed.available, false)
  const fallback = await collectAgentStatus({
    get: () => undefined,
    sessions: { list: () => [session('fallback')] },
    subagents: { listChildren: () => [] },
  })
  assert.equal(fallback.available, true)
  assert.equal(fallback.free, 3)
})
