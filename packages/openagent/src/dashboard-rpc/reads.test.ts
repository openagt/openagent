import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { onProjectFiles, onAgentWorktree, asRecorded, markCloudWaiting, markMachine, markOtherHost, markSaving, withFollowed, withPrStates, withUnpublished } from './reads.js'
import { bridgeQuestions, resetBridgeQuestions } from '../dashboard/bridge-store.js'
import type { AgentMeta } from '../store/index.js'
import type { BranchAhead, BranchesFor, BranchesSource } from '../store/branches.js'
import { provideTestContext } from './test-context.js'

// A project id nobody registered has no local path, so these reads have no checkout to answer
// from. They must say so — an empty list, null — rather than throwing.

test('onProjectFiles for an unknown project returns an empty list', async () => {
  provideTestContext()
  assert.deepEqual(await onProjectFiles('project-that-does-not-exist'), [])
})

test('onAgentWorktree for an unknown project returns null', async () => {
  provideTestContext()
  assert.equal(await onAgentWorktree('project-that-does-not-exist', '2026-07-19T10-00-00-000Z'), null)
})

test('onAgentWorktree refuses a run id that could escape the worktrees dir', async () => {
  // The id names a directory, so it is guarded here as it is everywhere else it reaches a path.
  provideTestContext()
  assert.equal(await onAgentWorktree('project-that-does-not-exist', '../../etc'), null)
})

test('a web run whose session the bridge holds a question for is handed to the dashboard as waiting (#1668)', async () => {
  resetBridgeQuestions()
  bridgeQuestions().record({ sessionId: 'session_01Park', title: 'Where?', options: [{ label: 'Here' }], receivedAt: '' })
  const web = (sessionId: string): AgentMeta => ({ status: 'done', id: 'r', startedAt: '', updatedAt: '', target: 'web', sessionId }) as AgentMeta
  assert.equal(markCloudWaiting(web('session_01Park')).cloudWaiting, true)
  assert.equal(markCloudWaiting(web('session_01Other')).cloudWaiting, undefined)
  assert.equal(markCloudWaiting({ ...web('session_01Park'), target: 'local' }).cloudWaiting, undefined)
  resetBridgeQuestions()
})

test('a run another machine\'s daemon started is handed to the dashboard as from another host (#1648)', () => {
  const run = (host?: string): AgentMeta => ({ status: 'done', id: 'r', startedAt: '', updatedAt: '', ...(host ? { host } : {}) }) as AgentMeta
  assert.equal(markOtherHost(run('rom-thinkpad-x280'), 'suleiman-mbp').otherHost, true)
  assert.equal(markOtherHost(run('suleiman-mbp'), 'suleiman-mbp').otherHost, undefined)
  // A record from before the host field was written says nothing about where it ran.
  assert.equal(markOtherHost(run(), 'suleiman-mbp').otherHost, undefined)
})

test('a run whose record names a saved machine\'s computer runs on that machine, by the name the machine was given, and is not someone else\'s', () => {
  const run = (host?: string): AgentMeta => ({ status: 'done', id: 'r', startedAt: '', updatedAt: '', ...(host ? { host } : {}) }) as AgentMeta
  const machineOf = (host: string): { label: string; url: string } | undefined =>
    host === 'ubuntu-fra1' ? { label: '203.0.113.5', url: 'https://203.0.113.5' } : host === 'suleimans-macbook-pro' ? { label: 'MacBook', url: 'http://127.0.0.1:4210' } : undefined
  const onServer = markMachine(run('ubuntu-fra1'), machineOf, 'suleiman-mbp')
  assert.deepEqual([onServer.target, onServer.remoteLabel, onServer.remoteByLine], ['remote', '203.0.113.5', undefined])
  // A saved machine at an address on this computer is a person's own computer, reached by the line it keeps open here: the row says so.
  const onComputer = markMachine(run('suleimans-macbook-pro'), machineOf, 'ubuntu-fra1')
  assert.deepEqual([onComputer.target, onComputer.remoteLabel, onComputer.remoteByLine], ['remote', 'MacBook', true])
  assert.equal(markOtherHost(onServer, 'suleiman-mbp').otherHost, undefined)
  // A computer that is no saved machine: the run stays someone else's, and is not asked of any machine.
  const elsewhere = markMachine(run('rom-thinkpad-x280'), machineOf, 'suleiman-mbp')
  assert.deepEqual([elsewhere.target, elsewhere.remoteLabel], [undefined, undefined])
  assert.equal(markOtherHost(elsewhere, 'suleiman-mbp').otherHost, true)
  // This computer's own run, also when a saved machine has the same name, and a record with no computer in it.
  assert.equal(markMachine(run('ubuntu-fra1'), machineOf, 'ubuntu-fra1').remoteLabel, undefined)
  assert.equal(markMachine(run(), machineOf, 'suleiman-mbp').remoteLabel, undefined)
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

test('a record cannot say of its run what only this daemon says: that it runs on a saved machine, that it is another computer\'s, that it is being saved', () => {
  const written = { status: 'done', id: 'r', startedAt: '', updatedAt: '', host: 'their-laptop', target: 'remote', remoteLabel: 'My server', remoteByLine: true, otherHost: false, saving: true, cloudWaiting: true } as AgentMeta
  assert.deepEqual(asRecorded(written), { status: 'done', id: 'r', startedAt: '', updatedAt: '', host: 'their-laptop' })
  // So it reads as what it is: a run of a computer that is no saved machine.
  const row = markOtherHost(markMachine(asRecorded(written), () => undefined, 'suleiman-mbp'), 'suleiman-mbp')
  assert.deepEqual([row.target, row.remoteLabel, row.otherHost], [undefined, undefined, true])
  // Where a run runs otherwise, the cloud or GitHub Actions, is the record's to say; a computer's name that is no name is none.
  assert.equal(asRecorded({ ...written, target: 'web' }).target, 'web')
  assert.equal(asRecorded({ ...written, host: { name: 'x' } } as unknown as AgentMeta).host, undefined)
})

test('a followed run that has a record keeps the record\'s row, in its place, and takes what the machine said since; one with no record is listed only when this computer sent it', () => {
  const mine = { status: 'done', id: 'c', startedAt: '5', updatedAt: '5' } as AgentMeta
  const record = { status: 'waiting', id: 'a', startedAt: '1', updatedAt: '1', host: 'server-box', target: 'remote', remoteLabel: 'Server', branch: 'agent-a', pr: { number: 7 }, parent: 'p' } as unknown as AgentMeta
  const followed = [
    { status: 'running', id: 'a', startedAt: '1', updatedAt: '2', target: 'remote', remoteLabel: 'Server', sessionId: 's-2' },
    { status: 'running', id: 'b', startedAt: '3', updatedAt: '3', target: 'remote', remoteLabel: 'Server' },
    { status: 'running', id: 'gone', startedAt: '4', updatedAt: '4', target: 'remote', remoteLabel: 'Server' },
  ] as AgentMeta[]
  const sent = (id: string): boolean => id === 'b'
  assert.deepEqual(withFollowed([], [mine, record], sent), [mine, record])
  // `b` was sent from here and has no record yet: first. `a` stays where its record is. `gone` was followed by a record that is deleted: not listed.
  assert.deepEqual(withFollowed(followed, [mine, record], sent), [followed[1], mine, { ...record, status: 'running', updatedAt: '2', sessionId: 's-2' }])
  // That the machine is a person's own computer, reached by its line, comes with the machine's name.
  assert.equal(withFollowed([{ ...followed[0]!, remoteByLine: true }], [record], sent)[0]!.remoteByLine, true)
})

test('each run with a pull request is marked with how it stands; one with no request, or one the git host did not list, is left as it was; no request among the runs, nothing is read', async () => {
  const run = (id: string, pr?: number): AgentMeta => ({ id, status: 'done', startedAt: '2026-10-18T13:00:00.000Z', updatedAt: '2026-10-18T13:00:00.000Z', ...(pr !== undefined ? { pr: { number: pr, url: `https://example.com/pull/${pr}` } } : {}) })
  const read: string[] = []
  const states = async (cwd: string) => {
    read.push(cwd)
    return new Map([['https://example.com/pull/7', 'merged' as const], ['https://example.com/pull/8', 'draft' as const]])
  }
  const marked = await withPrStates('/repo', [run('a', 7), run('b', 8), run('c'), run('d', 99)], states)
  assert.deepEqual(marked.map(agent => [agent.id, agent.prState]), [['a', 'merged'], ['b', 'draft'], ['c', undefined], ['d', undefined]])
  assert.ok(!('prState' in marked[2]!) && !('prState' in marked[3]!))
  assert.deepEqual(read, ['/repo'])
  await withPrStates('/repo', [run('e')], states)
  assert.deepEqual(read, ['/repo'], 'no run has a request: the git host is not asked')
})

test('each finished run whose work never left the machine is marked with its commits, by the Human Queue\'s rule; a provider that cannot be read marks none', async () => {
  const run = (id: string, branch: string, over: Partial<AgentMeta> = {}): AgentMeta => ({ id, status: 'done', startedAt: '2026-10-18T13:00:00.000Z', updatedAt: '2026-10-18T13:00:00.000Z', branch, ...over })
  const counts: Record<string, Partial<BranchAhead>> = { 'agent-a': { ahead: 2 }, 'agent-left': { ahead: 0, merged: true, uncommitted: 3 }, 'agent-pushed': { pushed: true }, 'agent-gone': { gone: true }, 'agent-running': {}, 'the-framework/old': { agent: false, ahead: 1173 } }
  const answering = (ahead: BranchesSource['ahead']): BranchesFor => async () => ({ list: async () => [], show: async () => [], ahead, push: async () => ({ ok: true, pushed: true }), merge: async () => ({ ok: false, error: 'no' }), remove: async () => ({ ok: true }) })
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
