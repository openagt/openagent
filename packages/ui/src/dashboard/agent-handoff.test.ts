import { test } from 'node:test'
import { hostname } from 'node:os'
import assert from 'node:assert/strict'
import { readAgentHandoff, readRunHandoff, leftNothing } from './agent-handoff.js'
import type { BranchState, BranchesFor } from '../store/branches.js'
import type { AgentMeta } from '../store/index.js'

// What a finished run left on its branch, as the branches provider answers it (#1774): what the bar
// above the message box shows and when it is over. The next steps, a pull request among them, are
// the modules' own.

/** A branch with work on it, as the provider answers `show`. */
const state = (over: Partial<BranchState> = {}): BranchState => ({
  branch: 'openagent/work',
  exists: true,
  base: 'origin/main',
  commits: [
    { sha: 'abc1234567', subject: 'second: with spaces' },
    { sha: 'def4567890', subject: 'first' },
  ],
  files: [
    { path: 'src/app.ts', insertions: 3, deletions: 1, binary: false },
    { path: 'logo.png', insertions: 0, deletions: 0, binary: true },
  ],
  hasRemote: true,
  pushed: false,
  merged: false,
  ...over,
})

/** A fake branches provider over one call log: its `show` answers from `states`; a branch missing there is not answered. */
function fakeBranches(states: Record<string, BranchState | undefined>): { branches: BranchesFor; calls: unknown[][] } {
  const calls: unknown[][] = []
  const unused = () => Promise.reject(new Error('not asked here'))
  const branches: BranchesFor = async () => ({
    list: async () => [],
    ahead: async () => [],
    show: async (asked, from) => {
      calls.push(['show', ...asked, ...(from !== undefined ? [{ from }] : [])])
      return asked.flatMap(branch => {
        const answer = states[branch]
        return answer ? [answer] : []
      })
    },
    push: unused,
    remove: async () => ({ ok: true }),
  })
  return { branches, calls }
}

const noBranches: BranchesFor = async () => undefined

test('a project with no branches provider, or a branch the provider does not answer for, yields no handoff at all', async () => {
  assert.equal(await readAgentHandoff('/repo', 'b', { branches: noBranches }), undefined)
  const { branches } = fakeBranches({})
  assert.equal(await readAgentHandoff('/repo', 'b', { branches }), undefined)
})

test('a branch that no longer exists reports exists:false rather than failing, and still says whether there is a remote', async () => {
  const { base: _base, ...gone } = state({ branch: 'gone', exists: false, commits: [], files: [] })
  const { branches } = fakeBranches({ gone })
  const handoff = await readAgentHandoff('/repo', 'gone', { branches })
  assert.equal(handoff?.exists, false)
  assert.equal(handoff?.empty, true)
  assert.equal(handoff?.hasRemote, true)
  assert.equal(handoff?.base, undefined)
})

test('a session that changed nothing is reported empty, not as an empty branch', async () => {
  const { branches } = fakeBranches({ q: state({ branch: 'q', commits: [], files: [] }) })
  const handoff = await readAgentHandoff('/repo', 'q', { branches })
  assert.equal(handoff?.exists, true)
  assert.equal(handoff?.empty, true)
  assert.deepEqual(handoff?.commits, [])
  assert.equal(handoff?.insertions, 0)
  assert.equal(handoff?.deletions, 0)
  // Commits that net to no change leave nothing to hand off either.
  const { branches: netted } = fakeBranches({ q: state({ branch: 'q', files: [] }) })
  assert.equal((await readAgentHandoff('/repo', 'q', { branches: netted }))?.empty, true)
})

test('commits, files and line counts come back for a branch with work, as the provider answered them (#799)', async () => {
  const { branches, calls } = fakeBranches({ 'openagent/work': state() })
  const handoff = await readAgentHandoff('/repo', 'openagent/work', { branches })
  assert.deepEqual(calls, [['show', 'openagent/work']])
  assert.equal(handoff?.exists, true)
  assert.equal(handoff?.empty, false)
  assert.equal(handoff?.base, 'origin/main')
  assert.deepEqual(handoff?.commits, [
    { sha: 'abc1234567', short: 'abc1234', subject: 'second: with spaces' },
    { sha: 'def4567890', short: 'def4567', subject: 'first' },
  ])
  assert.deepEqual(handoff?.files, [
    { path: 'src/app.ts', insertions: 3, deletions: 1, binary: false },
    { path: 'logo.png', insertions: 0, deletions: 0, binary: true },
  ])
  assert.equal(handoff?.insertions, 3)
  assert.equal(handoff?.deletions, 1)
  assert.equal(handoff?.hasRemote, true)
  assert.equal(handoff?.pushed, false)
  assert.equal(handoff?.merged, false)
  assert.equal(handoff?.pendingFiles, undefined, 'no checkout on the branch: nobody asked about uncommitted work')
})

test('pushed, merged, no remote, and uncommitted work in the checkout are carried through (#1173)', async () => {
  const { branches } = fakeBranches({
    pushed: state({ branch: 'pushed', pushed: true }),
    merged: state({ branch: 'merged', merged: true }),
    local: state({ branch: 'local', hasRemote: false }),
    dirty: state({ branch: 'dirty', commits: [], files: [], pendingFiles: ['src/app.ts', 'src/new.ts'] }),
  })
  assert.equal((await readAgentHandoff('/repo', 'pushed', { branches }))?.pushed, true)
  assert.equal((await readAgentHandoff('/repo', 'merged', { branches }))?.merged, true)
  assert.equal((await readAgentHandoff('/repo', 'local', { branches }))?.hasRemote, false)
  // The branch really is empty; the work is real and sitting next to it. Both are true at once,
  // which is the whole of #1173 — and the paths are what the bar names instead of a dead button.
  const dirty = await readAgentHandoff('/repo', 'dirty', { branches })
  assert.equal(dirty?.empty, true)
  assert.deepEqual(dirty?.pendingFiles, ['src/app.ts', 'src/new.ts'])
})

test('a run started from another branch is read from the commit its own work begins at', async () => {
  const { branches, calls } = fakeBranches({ 'openagent/work': state() })
  const read = await readAgentHandoff('/repo', 'openagent/work', { branches, from: 'b'.repeat(40) })
  assert.equal(read?.exists, true)
  assert.deepEqual(calls, [['show', 'openagent/work', { from: 'b'.repeat(40) }]])
})

test('a run’s handoff off its record: its branch from where its own work begins; a landed run by the commit its record kept; a run with neither has none', async () => {
  const start = 'b'.repeat(40)
  const tip = 'c'.repeat(40)
  const { branches, calls } = fakeBranches({ 'agent-sub': state({ branch: 'agent-sub' }), [tip]: state({ branch: tip }), gone: state({ branch: 'gone', exists: false, commits: [], files: [] }) })
  const deps = { branches }
  const run = (over: Partial<AgentMeta>) => ({ id: 'r1', startedAt: '2026-10-01T00:00:00Z', status: 'done' as const, host: hostname(), ...over })

  const onBranch = await readRunHandoff('/repo', run({ branch: 'agent-sub', baseCommit: start }), deps)
  assert.deepEqual([onBranch?.exists, onBranch?.landed], [true, undefined])
  const landed = await readRunHandoff('/repo', run({ baseCommit: start, landed: tip }), deps)
  assert.deepEqual([landed?.exists, landed?.landed, landed?.commits.length], [true, true, 2])
  // Each is read from where the run's own work begins: a landed run, which has no branch, by its commit.
  assert.deepEqual(calls, [['show', 'agent-sub', { from: start }], ['show', tip, { from: start }]])

  // Landed, its commit not on this machine: landed is the answer, never "changed nothing".
  const elsewhere = await readRunHandoff('/repo', run({ landed: 'gone' }), deps)
  assert.deepEqual([elsewhere?.exists, elsewhere?.landed, elsewhere?.unchanged], [false, true, undefined])
  // Not landed, the branch gone with its checkout: it changed nothing.
  assert.equal((await readRunHandoff('/repo', run({ branch: 'gone' }), deps))?.unchanged, true)
  assert.equal(await readRunHandoff('/repo', run({}), deps), undefined)
})

test('a run changed nothing when its own tool ended it here, done or failed, with no pull request', () => {
  assert.equal(leftNothing({ status: 'done', host: 'here' }, 'here'), true)
  assert.equal(leftNothing({ status: 'failed', host: 'here' }, 'here'), true)
  // A Stop records the branch's last name; the sweep marks a dead run `stopped` only when it left no checkout.
  assert.equal(leftNothing({ status: 'stopped', host: 'here' }, 'here'), true)
  assert.equal(leftNothing({ status: 'waiting', host: 'here' }, 'here'), false, 'a waiting run keeps its checkout')
  assert.equal(leftNothing({ status: 'done', host: 'there' }, 'here'), false, 'another machine may hold its branch')
  assert.equal(leftNothing({ status: 'done' }, 'here'), false, 'a record that names no machine')
  assert.equal(leftNothing({ status: 'done', host: 'here', pr: { number: 7 } }, 'here'), false, 'its work is on a pull request')
  assert.equal(leftNothing({ status: 'done', host: 'here', landed: 'c'.repeat(40) }, 'here'), false, 'its work was landed on its main agent’s branch')
})

