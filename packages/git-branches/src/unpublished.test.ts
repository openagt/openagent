import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { RunSummary } from '@openagt/hooks'
import type { BranchAhead } from './branch-ahead.js'
import { unpublishedItems, unpublishedRuns, withCopies, type AheadOf, type CopyWork } from './unpublished.js'

// #860: a finished run whose work never left this machine, as what waits on the person says it.

const run = (over: Partial<RunSummary> = {}): RunSummary => ({ id: 'r1', host: 'here', status: 'done', startedAt: '2026-07-16T00:00:00Z', endedAt: '2026-07-16T01:00:00Z', prompt: 'add the cart', branch: 'agent-add-cart', ...over })

/** A run's branch with work on it that never left the machine, as the read counts it. */
const ahead = (over: Partial<BranchAhead> = {}): BranchAhead => ({ branch: 'agent-add-cart', exists: true, agent: true, ahead: 1, hasRemote: true, pushed: false, gone: false, merged: false, uncommitted: 0, ...over })

/** A read answering from `state`, one answer per branch asked, recording what it was asked. */
const counting = (state: (branch: string, from?: string) => BranchAhead | undefined, asked: [string[], string | undefined][] = []): AheadOf => async (branches, from) => {
  asked.push([[...branches], from])
  return branches.flatMap(branch => state(branch, from) ?? [])
}

const itemsOf = async (runs: RunSummary[], read: AheadOf) => unpublishedItems(runs, await unpublishedRuns(runs, read))

test('a finished run with commits never pushed needs a push; one that left files uncommitted needs a commit first', async () => {
  assert.deepEqual(await itemsOf([run()], counting(branch => ahead({ branch, ahead: 2 }))), [
    { kind: 'waiting', scope: 'run', run: 'r1', id: 'unpushed:r1', words: 'Needs push', detail: '2 commits', mark: 'branch', title: 'add the cart', since: '2026-07-16T01:00:00Z' },
  ])
  assert.deepEqual(
    (await itemsOf([run()], counting(branch => ahead({ branch, ahead: 3, uncommitted: 1 })))).map(item => [item.id, item.words, item.detail, item.mark]),
    [['uncommitted:r1', 'Needs commit', '1 file', 'changes']],
  )
})

test('nothing waits when the work already went somewhere, or has nowhere to go, or is no run of its own', async () => {
  for (const state of [{ pushed: true }, { merged: true }, { gone: true }, { hasRemote: false }, { ahead: 0 }, { agent: false }, { exists: false }]) {
    assert.deepEqual(await itemsOf([run()], counting(branch => ahead({ branch, ...state }))), [], JSON.stringify(state))
  }
  // A run with a pull request: its request is what waits.
  assert.deepEqual(await itemsOf([run({ pr: { number: 4, url: 'u' } })], counting(branch => ahead({ branch }))), [])
})

test('a working run is still writing its branch; one waiting on its question leaves its files as they are', async () => {
  assert.deepEqual(await itemsOf([run({ status: 'working' })], counting(branch => ahead({ branch, uncommitted: 2 }))), [])
  assert.deepEqual((await itemsOf([run({ status: 'waiting' })], counting(branch => ahead({ branch, ahead: 1, uncommitted: 2 })))).map(item => item.id), ['unpushed:r1'])
})

test("a checkout's uncommitted files are the newest run's on its branch: a run continued on an earlier one's branch does not charge the earlier one", async () => {
  const earlier = run({ id: 'r1', startedAt: '2026-07-16T00:00:00Z' })
  const later = (status: RunSummary['status']) => run({ id: 'r2', startedAt: '2026-07-16T02:00:00Z', status })
  const read = counting(branch => ahead({ branch, ahead: 0, uncommitted: 2 }))
  assert.deepEqual((await itemsOf([earlier, later('done')], read)).map(item => item.id), ['uncommitted:r2'])
  assert.deepEqual(await itemsOf([earlier, later('working')], read), [], 'the newest is still at work there')
})

test('a run started from another branch is counted from the commit its own work begins at; the runs started from the default branch share one read', async () => {
  const asked: [string[], string | undefined][] = []
  const runs = [run({ id: 'a', branch: 'agent-a' }), run({ id: 'b', branch: 'agent-b' }), run({ id: 'c', branch: 'agent-c', options: { 'git-branches': { base: 'dev' } }, facts: { 'git-branches': { baseCommit: 'abc' } } })]
  await unpublishedRuns(runs, counting(branch => ahead({ branch }), asked))
  assert.deepEqual(asked, [[['agent-a', 'agent-b'], undefined], [['agent-c'], 'abc']])
})

test('a read that does not answer for every branch asked fails, never "nothing waits"', async () => {
  await assert.rejects(unpublishedRuns([run(), run({ id: 'r2', branch: 'agent-other' })], counting(branch => (branch === 'agent-other' ? undefined : ahead({ branch })))), /not all read/)
})

test("the item is titled by the run's own name, else what was asked, else the branch", async () => {
  const titled = async (over: Partial<RunSummary>) => (await itemsOf([run(over)], counting(branch => ahead({ branch }))))[0]?.title
  assert.equal(await titled({ title: 'Add the cart' }), 'Add the cart')
  assert.equal(await titled({}), 'add the cart')
  assert.equal(await titled({ prompt: '' }), 'agent-add-cart')
})

test("a session's mark counts its copies of other repositories too: their files left uncommitted and their commits never pushed, beside the project's", async () => {
  const withRepos = run({ options: { 'git-branches': { repos: [{ name: 'site', from: '/repos/site' }, { name: 'api', from: '/repos/api' }] } } })
  const work = { site: { pendingFiles: ['a.ts', 'b.ts'], commits: [], pushed: false, hasRemote: true, merged: false }, api: { pendingFiles: [], commits: [{}, {}, {}], pushed: false, hasRemote: true, merged: false } } as never as Record<string, CopyWork>
  const own = new Map([['r1', { branch: 'agent-add-cart', commits: 0, uncommitted: 1 }]])
  const summed = await withCopies(own, [withRepos], async () => ['site', 'api'], async (_run, repo) => work[repo])
  assert.deepEqual(summed.get('r1'), { branch: 'agent-add-cart', commits: 3, uncommitted: 3 })
  assert.deepEqual(unpublishedItems([withRepos], summed).map(item => [item.words, item.detail]), [['Needs commit', '3 files']])
  // A copy with a pull request waits on it, not on a push; a run with no copies, or still working, is not asked.
  const requested = { ...withRepos, copyPrs: [{ repo: 'api', number: 7, url: 'u7' }] }
  assert.deepEqual((await withCopies(new Map(), [requested], async () => ['api'], async (_run, repo) => work[repo])).get('r1'), undefined)
  let asked = 0
  await withCopies(new Map(), [run(), { ...withRepos, status: 'working' }], async () => (asked++, ['site']), async () => work.site)
  assert.equal(asked, 0)
})
