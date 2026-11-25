import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { asRecorded, markOtherHost, markSaving, withPrStates, withUnpublished } from './run-rows.js'
import type { AgentMeta } from '../store/index.js'
import type { BranchAhead, BranchesFor, BranchesSource } from '../store/branches.js'

test('a run another machine\'s daemon started is handed to the dashboard as from another host (#1648)', () => {
  const run = (host?: string): AgentMeta => ({ status: 'done', id: 'r', startedAt: '', updatedAt: '', ...(host ? { host } : {}) }) as AgentMeta
  assert.equal(markOtherHost(run('rom-thinkpad-x280'), 'suleiman-mbp').otherHost, true)
  assert.equal(markOtherHost(run('suleiman-mbp'), 'suleiman-mbp').otherHost, undefined)
  // A record from before the host field was written says nothing about where it ran.
  assert.equal(markOtherHost(run(), 'suleiman-mbp').otherHost, undefined)
})

test('a run that ended clean while its process is still alive on this host is handed to the dashboard as saving', () => {
  const run = (over: Partial<AgentMeta> = {}): AgentMeta => ({ status: 'done', id: 'r', startedAt: '', updatedAt: '', pid: 42, host: 'suleiman-mbp', ...over }) as AgentMeta
  const alive = (pid: number) => pid === 42
  assert.equal(markSaving(run(), 'suleiman-mbp', alive).saving, true)
  // The process is gone: saved and cleaned up, nothing more is coming.
  assert.equal(markSaving(run({ pid: 43 }), 'suleiman-mbp', alive).saving, undefined)
  // Still working, or ended any other way: not saving.
  for (const status of ['running', 'waiting', 'stopped', 'failed'] as const) {
    assert.equal(markSaving(run({ status }), 'suleiman-mbp', alive).saving, undefined, status)
  }
  // A pid is only this host's to probe; a run with no recorded process says nothing.
  assert.equal(markSaving(run({ host: 'rom-thinkpad-x280' }), 'suleiman-mbp', alive).saving, undefined)
  const { pid: _pid, ...noPid } = run()
  assert.equal(markSaving(noPid as AgentMeta, 'suleiman-mbp', alive).saving, undefined)
})

test('a record cannot say of its run what only this daemon says: that it is another computer\'s, that it is being saved', () => {
  const written = { status: 'done', id: 'r', startedAt: '', updatedAt: '', host: 'their-laptop', otherHost: false, saving: true } as AgentMeta
  assert.deepEqual(asRecorded(written), { status: 'done', id: 'r', startedAt: '', updatedAt: '', host: 'their-laptop' })
  // So it reads as what it is: another computer's run.
  assert.equal(markOtherHost(asRecorded(written), 'suleiman-mbp').otherHost, true)
  // Where a run runs otherwise, the cloud or GitHub Actions, is the record's to say; a computer's name that is no name is none.
  assert.equal(asRecorded({ ...written, target: 'web' }).target, 'web')
  assert.equal(asRecorded({ ...written, host: { name: 'x' } } as unknown as AgentMeta).host, undefined)
})

test('each run with a pull request is marked with how it stands and its title, as its module last read it; one with no request, or one no module read, is left as it was', () => {
  const run = (id: string, pr?: number): AgentMeta => ({ id, status: 'done', startedAt: '2026-10-18T13:00:00.000Z', updatedAt: '2026-10-18T13:00:00.000Z', ...(pr !== undefined ? { pr: { number: pr, url: `https://example.com/pull/${pr}` } } : {}) })
  const read = new Map([['https://example.com/pull/7', { state: 'merged' as const, title: 'Dark mode' }], ['https://example.com/pull/8', { state: 'draft' as const, title: 'Login page' }]])
  const states = { get: (url: string) => read.get(url) }
  const marked = withPrStates([run('a', 7), run('b', 8), run('c'), run('d', 99)], states)
  assert.deepEqual(marked.map(agent => [agent.id, agent.prState, agent.prTitle]), [['a', 'merged', 'Dark mode'], ['b', 'draft', 'Login page'], ['c', undefined, undefined], ['d', undefined, undefined]])
  assert.ok(!('prState' in marked[2]!) && !('prState' in marked[3]!))
  // The requests a run opened before its last one are marked the same way.
  const [moved] = withPrStates([{ ...run('f', 8), earlierPrs: [{ number: 7, url: 'https://example.com/pull/7' }, { number: 99, url: 'https://example.com/pull/99' }] }], states)
  assert.deepEqual(moved!.earlierPrs, [{ number: 7, url: 'https://example.com/pull/7', state: 'merged' }, { number: 99, url: 'https://example.com/pull/99' }])
})

test('each finished run whose work never left the machine is marked with its commits, by the Human Queue\'s rule; a provider that cannot be read marks none', async () => {
  const run = (id: string, branch: string, over: Partial<AgentMeta> = {}): AgentMeta => ({ id, status: 'done', startedAt: '2026-10-18T13:00:00.000Z', updatedAt: '2026-10-18T13:00:00.000Z', branch, ...over })
  const counts: Record<string, Partial<BranchAhead>> = { 'agent-a': { ahead: 2 }, 'agent-left': { ahead: 0, merged: true, uncommitted: 3 }, 'agent-pushed': { pushed: true }, 'agent-gone': { gone: true }, 'agent-running': {}, 'the-framework/old': { agent: false, ahead: 1173 } }
  const answering = (ahead: BranchesSource['ahead']): BranchesFor => async () => ({ list: async () => [], show: async () => [], ahead, push: async () => ({ ok: true, pushed: true }), merge: async () => ({ ok: false, error: 'no' }), bring: async () => ({ ok: false, error: 'no' }), remove: async () => ({ ok: true }) })
  const branches = answering(async asked =>
    asked.map(branch => ({ branch, exists: true, agent: true, ahead: 1, hasRemote: true, pushed: false, gone: false, merged: false, uncommitted: 0, ...counts[branch] })),
  )
  // A run with a pull request published, even on a branch that reads as never pushed: one pushed without an upstream whose copy the merge deleted.
  const withPr = run('q', 'agent-a', { pr: { number: 9, url: 'https://example.com/pull/9' } })
  const agents = [run('l', 'agent-left'), run('a', 'agent-a'), run('p', 'agent-pushed'), run('g', 'agent-gone'), run('r', 'agent-running', { status: 'running' }), run('o', 'the-framework/old'), withPr]
  const marked = await withUnpublished('/repo', agents, branches)
  assert.deepEqual(marked[0]!.uncommitted, 3, 'files left uncommitted, and no commits to say')
  assert.ok(!('unpublished' in marked[0]!))
  assert.deepEqual(marked.slice(1).map(agent => [agent.id, agent.unpublished]), [['a', 2], ['p', undefined], ['g', undefined], ['r', undefined], ['o', undefined], ['q', undefined]])
  assert.ok(!('unpublished' in marked[2]!) && !('uncommitted' in marked[1]!))
  const failing = answering(async () => {
    throw new Error('not a repo')
  })
  assert.deepEqual(await withUnpublished('/repo', agents, failing), agents)
})
