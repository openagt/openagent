import { test } from 'node:test'
import { hostname } from 'node:os'
import assert from 'node:assert/strict'
import { readAgentHandoff, readRunHandoff, leftNothing, resolveAgentPr, mergeAgentPr, agentBranchFor, openAgentPullRequest, openRemoteBranchPullRequest, pushAgentBranch, mergeAgentBranch, type HandoffAgent } from './agent-handoff.js'
import { pickAgentPr, type LinkedPr } from './pull-requests.js'
import type { BranchState, BranchesFor, BranchesSource } from '../store/branches.js'
import type { GitHostFor, GitHostSource } from '../store/git-host.js'
import type { AgentMeta } from '../store/index.js'

// The handoff over the two providers (#1774, #1820): the branch's facts come from the branches
// provider's `show` and its push from `push`; every pull request goes through the git host provider's
// `open` and `merge`; and what is tested here is what OpenAgent decides on top: which PR is
// the run's, when an existing PR is the answer, what the PR says, and what each button refuses.

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

/** The two fake providers over one call log: the branches provider's `show` answers from `states` (a branch missing there is not answered) and its `push` as told; the git host's `open` and `merge` answer as told. */
function fakeBranches(
  states: Record<string, BranchState | undefined>,
  answers: { push?: Awaited<ReturnType<BranchesSource['push']>>; mergeBranch?: Awaited<ReturnType<BranchesSource['merge']>>; open?: Awaited<ReturnType<GitHostSource['open']>>; merge?: Awaited<ReturnType<GitHostSource['merge']>> } = {},
): { branches: BranchesFor; gitHost: GitHostFor; calls: unknown[][] } {
  const calls: unknown[][] = []
  const branches: BranchesFor = async () => ({
    list: async () => [],
    show: async (asked, from) => {
      calls.push(['show', ...asked, ...(from !== undefined ? [{ from }] : [])])
      return asked.flatMap(branch => {
        const answer = states[branch]
        return answer ? [answer] : []
      })
    },
    push: async branch => {
      calls.push(['push', branch])
      return answers.push ?? { ok: true, pushed: true }
    },
    merge: async branch => {
      calls.push(['merge-branch', branch])
      return answers.mergeBranch ?? { ok: true, into: 'main', commit: 'c'.repeat(40), from: 'b'.repeat(40), deleted: true }
    },
    remove: async () => ({ ok: true }),
  })
  const gitHost: GitHostFor = async () => ({
    requests: async () => ({ ok: true, requests: [] }),
    open: async (branch, opts) => {
      calls.push(['open', branch, opts])
      return answers.open ?? { ok: true, request: { number: 9, url: 'https://github.com/o/r/pull/9' }, existing: false }
    },
    merge: async number => {
      calls.push(['merge', number])
      return answers.merge ?? { ok: true, outcome: 'auto-armed' }
    },
    home: async () => undefined,
  })
  return { branches, gitHost, calls }
}

const noPr = async (): Promise<LinkedPr | undefined> => undefined
const noBranches: BranchesFor = async () => undefined
const noGitHost: GitHostFor = async () => undefined

test('the branch an agent\'s work is on is the one its record carries, and nothing else (#799/#1725)', () => {
  assert.equal(agentBranchFor({ id: 'r1', branch: 'feat/mine' }), 'feat/mine')
  assert.equal(agentBranchFor({ id: 'r1', branch: 'agent-named' }), 'agent-named')
  assert.equal(agentBranchFor({ id: 'r1' }), undefined)
})

test('a project with no branches provider, or a branch the provider does not answer for, yields no handoff at all', async () => {
  assert.equal(await readAgentHandoff('/repo', 'b', { branches: noBranches, pr: noPr }), undefined)
  const { branches } = fakeBranches({})
  assert.equal(await readAgentHandoff('/repo', 'b', { branches, pr: noPr }), undefined)
})

test('a branch that no longer exists reports exists:false rather than failing, and still says whether there is a remote', async () => {
  const { base: _base, ...gone } = state({ branch: 'gone', exists: false, commits: [], files: [] })
  const { branches } = fakeBranches({ gone })
  const handoff = await readAgentHandoff('/repo', 'gone', { branches, pr: noPr })
  assert.equal(handoff?.exists, false)
  assert.equal(handoff?.empty, true)
  assert.equal(handoff?.hasRemote, true)
  assert.equal(handoff?.base, undefined)
})

test('a session that changed nothing is reported empty, not as an empty branch', async () => {
  const { branches } = fakeBranches({ q: state({ branch: 'q', commits: [], files: [] }) })
  const handoff = await readAgentHandoff('/repo', 'q', { branches, pr: noPr })
  assert.equal(handoff?.exists, true)
  assert.equal(handoff?.empty, true)
  assert.deepEqual(handoff?.commits, [])
  assert.equal(handoff?.insertions, 0)
  assert.equal(handoff?.deletions, 0)
  // Commits that net to no change leave nothing to hand off either.
  const { branches: netted } = fakeBranches({ q: state({ branch: 'q', files: [] }) })
  assert.equal((await readAgentHandoff('/repo', 'q', { branches: netted, pr: noPr }))?.empty, true)
})

test('commits, files and line counts come back for a branch with work, as the provider answered them (#799)', async () => {
  const { branches, calls } = fakeBranches({ 'openagent/work': state() })
  const handoff = await readAgentHandoff('/repo', 'openagent/work', { branches, pr: noPr })
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
  assert.equal((await readAgentHandoff('/repo', 'pushed', { branches, pr: noPr }))?.pushed, true)
  assert.equal((await readAgentHandoff('/repo', 'merged', { branches, pr: noPr }))?.merged, true)
  assert.equal((await readAgentHandoff('/repo', 'local', { branches, pr: noPr }))?.hasRemote, false)
  // The branch really is empty; the work is real and sitting next to it. Both are true at once,
  // which is the whole of #1173 — and the paths are what the bar names instead of a dead button.
  const dirty = await readAgentHandoff('/repo', 'dirty', { branches, pr: noPr })
  assert.equal(dirty?.empty, true)
  assert.deepEqual(dirty?.pendingFiles, ['src/app.ts', 'src/new.ts'])
})

test('the PR is looked up for the session branch (#799), and a gone branch still reports its PR: it is a remote question (#1255)', async () => {
  const { branches } = fakeBranches({ 'openagent/x': state({ branch: 'openagent/x' }), gone: state({ branch: 'gone', exists: false, commits: [], files: [] }) })
  const asked: string[] = []
  const handoff = await readAgentHandoff('/repo', 'openagent/x', {
    branches,
    pr: async (_cwd, branch) => {
      asked.push(branch)
      return { number: 7, url: 'https://example.test/7', state: 'OPEN', title: 'the pr' }
    },
  })
  assert.deepEqual(asked, ['openagent/x'])
  assert.equal(handoff?.pr?.number, 7)
  const goneHandoff = await readAgentHandoff('/repo', 'gone', {
    branches,
    pr: async () => ({ number: 1254, url: 'u1254', state: 'MERGED', title: 'web run', createdAt: '2026-07-26T21:52:58Z' }),
  })
  assert.equal(goneHandoff?.exists, false)
  assert.equal(goneHandoff?.pr?.number, 1254)
})

const agent = (over: Partial<AgentMeta> = {}): AgentMeta => ({ id: 'r1', status: 'done', startedAt: '2026-07-26T00:00:00Z', updatedAt: '2026-07-26T01:00:00Z', branch: 'openagent/work', intent: 'fix it', ...over })
const { branch: _branch, ...unbranched } = agent()

test('the Open PR button pushes the branch through the branches provider, then opens its pull request through the git host, with the title and body the run gives it', async () => {
  const { branches, gitHost, calls } = fakeBranches({ 'openagent/work': state() })
  const result = await openAgentPullRequest('/repo', agent(), { branches, gitHost })
  assert.deepEqual(result, { ok: true, url: 'https://github.com/o/r/pull/9', number: 9 })
  assert.deepEqual(calls.slice(-2), [
    ['push', 'openagent/work'],
    ['open', 'openagent/work', { title: 'openagent/work', body: 'fix it\n\nOpened from OpenAgent session `r1`.' }],
  ])
  // A caller not asking for review opens a draft.
  await openAgentPullRequest('/repo', agent(), { branches, gitHost, draft: true })
  assert.deepEqual((calls.at(-1) as unknown[])[2], { title: 'openagent/work', body: 'fix it\n\nOpened from OpenAgent session `r1`.', draft: true })
})

test('a run started from another branch is read from the commit its own work begins at; a subagent is never opened a pull request', async () => {
  const { branches, gitHost, calls } = fakeBranches({ 'openagent/work': state() })
  const read = await readAgentHandoff('/repo', 'openagent/work', { branches, gitHost, pr: async () => undefined, from: 'b'.repeat(40) })
  assert.equal(read?.exists, true)
  assert.deepEqual(calls, [['show', 'openagent/work', { from: 'b'.repeat(40) }]])

  // The button's own read measures the same way, so "nothing to open" is judged on the run's own commits.
  calls.length = 0
  await openAgentPullRequest('/repo', agent({ baseCommit: 'b'.repeat(40) }), { branches, gitHost })
  assert.deepEqual(calls[0], ['show', 'openagent/work', { from: 'b'.repeat(40) }])

  calls.length = 0
  assert.deepEqual(await openAgentPullRequest('/repo', agent({ parent: 'r0' }), { branches, gitHost }), { ok: false, error: 'this run is a subagent: its main agent lands its work and opens the pull request' })
  assert.deepEqual(calls, [], 'nothing pushed, nothing opened')
})

test('a run’s handoff off its record: its branch from where its own work begins; a landed run by the commit its record kept; a run with neither has none', async () => {
  const start = 'b'.repeat(40)
  const tip = 'c'.repeat(40)
  const { branches, gitHost, calls } = fakeBranches({ 'agent-sub': state({ branch: 'agent-sub' }), [tip]: state({ branch: tip }), gone: state({ branch: 'gone', exists: false, commits: [], files: [] }) })
  const deps = { branches, gitHost, pr: async () => undefined }
  const run = (over: Partial<AgentMeta>) => ({ id: 'r1', startedAt: '2026-10-01T00:00:00Z', status: 'done' as const, host: hostname(), ...over })

  const onBranch = await readRunHandoff('/repo', run({ branch: 'agent-sub', baseCommit: start }), deps)
  assert.deepEqual([onBranch?.exists, onBranch?.landed], [true, undefined])
  const landed = await readRunHandoff('/repo', run({ baseCommit: start, landed: tip }), deps)
  assert.deepEqual([landed?.exists, landed?.landed, landed?.commits.length], [true, true, 2])
  // The run started from another branch, so its branch is read twice: its own work from where that
  // work begins, and again from the default branch, for what a pull request would carry (both
  // answers are the same here, so it says nothing). A landed run has no branch and is read once.
  assert.deepEqual(calls, [['show', 'agent-sub', { from: start }], ['show', 'agent-sub'], ['show', tip, { from: start }]])

  // A commit has no pull request: none is looked up for it, whatever the lookup would answer.
  let asked = 0
  const lookup = async () => (asked++, { number: 7, url: 'u', state: 'OPEN', title: '' })
  assert.equal((await readRunHandoff('/repo', run({ branch: 'agent-sub', baseCommit: start }), { branches, gitHost, pr: lookup }))?.pr?.number, 7)
  assert.equal((await readRunHandoff('/repo', run({ baseCommit: start, landed: tip }), { branches, gitHost, pr: lookup }))?.pr, undefined)
  assert.equal(asked, 1)

  // Landed, its commit not on this machine: landed is the answer, never "changed nothing".
  const elsewhere = await readRunHandoff('/repo', run({ landed: 'gone' }), deps)
  assert.deepEqual([elsewhere?.exists, elsewhere?.landed, elsewhere?.unchanged], [false, true, undefined])
  // Not landed, the branch gone with its checkout: it changed nothing.
  assert.equal((await readRunHandoff('/repo', run({ branch: 'gone' }), deps))?.unchanged, true)
  assert.equal(await readRunHandoff('/repo', run({}), deps), undefined)
})

test('a run started from a local branch says what a pull request would carry over the default branch', async () => {
  // His test-project: the skills are committed on a local branch, not on main. A run started from
  // that branch did one file of its own, and a pull request against main takes the skills too.
  const start = 'b'.repeat(40)
  const own = state({ branch: 'agent-x', base: start, commits: [{ sha: 'a'.repeat(40), subject: 'say hello' }], files: [{ path: 'hello.sh', insertions: 5, deletions: 0, binary: false }] })
  let overDefault = state({
    branch: 'agent-x',
    base: 'origin/main',
    commits: [own.commits[0]!, { sha: 'd'.repeat(40), subject: 'the skills' }],
    files: [own.files[0]!, ...Array.from({ length: 42 }, (_, i) => ({ path: `.claude/skills/skill-${i}/SKILL.md`, insertions: 12, deletions: 0, binary: false }))],
  })
  const asked: (string | undefined)[] = []
  const branches: BranchesFor = async () => ({
    list: async () => [],
    show: async (_branches, from) => (asked.push(from), [from === undefined ? overDefault : own]),
    push: async () => ({ ok: true, pushed: true }),
    merge: async () => ({ ok: true, into: 'main', commit: 'c'.repeat(40), from: start, deleted: true }),
    remove: async () => ({ ok: true }),
  })
  const run = { id: 'r1', startedAt: '2026-10-01T00:00:00Z', status: 'done' as const, host: hostname(), branch: 'agent-x' }

  const read = await readRunHandoff('/repo', { ...run, baseCommit: start }, { branches, gitHost: noGitHost, pr: noPr })
  // The run's own work is still counted from where that work begins: one file, five lines.
  assert.deepEqual([read?.files.length, read?.insertions], [1, 5])
  // And what a pull request would take is the whole stack the branch sits on, said beside the button.
  assert.deepEqual(read?.carries, { base: 'origin/main', commits: 2, files: 43, insertions: 509, deletions: 0 })
  assert.deepEqual(asked, [start, undefined])

  // Both reads agreeing means a pull request takes exactly this run's work: nothing to say.
  overDefault = own
  assert.equal((await readRunHandoff('/repo', { ...run, baseCommit: start }, { branches, gitHost: noGitHost, pr: noPr }))?.carries, undefined)

  // A run started from the branch the project starts from is measured there already: nothing to
  // say, and nothing read a second time.
  asked.length = 0
  assert.equal((await readRunHandoff('/repo', run, { branches, gitHost: noGitHost, pr: noPr }))?.carries, undefined)
  assert.deepEqual(asked, [undefined])
})

test('the Open PR button refuses a session with no branch, a gone branch, an empty branch, a merged branch, a project with no branches provider, and one with no git host', async () => {
  const { branches, gitHost } = fakeBranches({ gone: state({ branch: 'gone', exists: false, commits: [], files: [] }), empty: state({ branch: 'empty', commits: [], files: [] }), merged: state({ branch: 'merged', merged: true }), 'openagent/work': state() })
  assert.deepEqual(await openAgentPullRequest('/repo', agent({ branch: 'merged' }), { branches, gitHost }), { ok: false, error: 'this session’s work is already merged' })
  assert.deepEqual(await openAgentPullRequest('/repo', unbranched, { branches, gitHost }), { ok: false, error: 'this session recorded no branch to open a PR from' })
  assert.deepEqual(await openAgentPullRequest('/repo', agent({ branch: 'gone' }), { branches, gitHost }), { ok: false, error: 'branch gone no longer exists' })
  assert.deepEqual(await openAgentPullRequest('/repo', agent({ branch: 'empty' }), { branches, gitHost }), { ok: false, error: 'this session produced no commits to open a PR for' })
  assert.deepEqual(await openAgentPullRequest('/repo', agent(), { branches: noBranches, gitHost }), { ok: false, error: 'this project has no branches provider to push with' })
  assert.deepEqual(await openAgentPullRequest('/repo', agent(), { branches, gitHost: noGitHost }), { ok: false, error: 'this project has no git host package to open a pull request with' })
})

test("a provider's refusal is the button's answer, never a throw: a dirty checkout stops before the git host is asked, a refused open is the git host's line", async () => {
  const dirty = fakeBranches({ 'openagent/work': state() }, { push: { ok: false, error: 'openagent/work has uncommitted work; commit or delete it, then push' } })
  assert.deepEqual(await openAgentPullRequest('/repo', agent(), { branches: dirty.branches, gitHost: dirty.gitHost }), { ok: false, error: 'openagent/work has uncommitted work; commit or delete it, then push' })
  assert.deepEqual(await openRemoteBranchPullRequest('/repo', agent(), 'claude/x', { branches: dirty.branches, gitHost: dirty.gitHost }), { ok: false, error: 'openagent/work has uncommitted work; commit or delete it, then push' })
  assert.deepEqual(dirty.calls.filter(call => call[0] === 'open'), [], 'nothing asked of the git host')
  const refused = fakeBranches({ 'openagent/work': state() }, { open: { ok: false, error: 'gh: not logged in' } })
  assert.deepEqual(await openAgentPullRequest('/repo', agent(), { branches: refused.branches, gitHost: refused.gitHost }), { ok: false, error: 'gh: not logged in' })
})

test('a remote-only branch gets its draft PR through the two providers, and the body says what was asked (#1601)', async () => {
  const { branches, gitHost, calls } = fakeBranches({})
  const result = await openRemoteBranchPullRequest('/repo', { id: 'r1', branch: 'agent-x', intent: 'fix it' }, 'claude/x', { branches, gitHost })
  assert.deepEqual(result, { ok: true, url: 'https://github.com/o/r/pull/9', number: 9 })
  assert.deepEqual(calls, [['push', 'claude/x'], ['open', 'claude/x', { title: 'agent-x', body: 'fix it\n\nOpened from OpenAgent session `r1`.', draft: true }]])
})

test('the Push button pushes a finished session\'s branch through the branches provider: the last step where the project has no git host (#1820)', async () => {
  const { branches, gitHost, calls } = fakeBranches({ 'openagent/work': state() })
  assert.deepEqual(await pushAgentBranch('/repo', agent(), { branches }), { ok: true })
  assert.deepEqual(calls, [['push', 'openagent/work']])
  assert.deepEqual(await pushAgentBranch('/repo', unbranched, { branches }), { ok: false, error: 'this session recorded no branch to push' })
  assert.deepEqual(await pushAgentBranch('/repo', agent(), { branches: noBranches }), { ok: false, error: 'this project has no branches provider to push with' })
  const handoff = await readAgentHandoff('/repo', 'openagent/work', { branches, gitHost: noGitHost, pr: noPr })
  assert.equal(handoff?.gitHost, false, 'the handoff says the project has no git host, so the bar offers Push')
  assert.equal((await readAgentHandoff('/repo', 'openagent/work', { branches, gitHost, pr: noPr }))?.gitHost, true)
})

test('pickAgentPr trusts an open PR, and otherwise only one created after the run started (#1251)', () => {
  const older = { number: 1, url: 'u1', state: 'MERGED', title: 'old', createdAt: '2026-07-01T00:00:00Z' }
  const newer = { number: 2, url: 'u2', state: 'MERGED', title: 'new', createdAt: '2026-07-03T00:00:00Z' }
  const newest = { number: 3, url: 'u3', state: 'CLOSED', title: 'newest', createdAt: '2026-07-04T00:00:00Z' }
  const open = { number: 4, url: 'u4', state: 'OPEN', title: 'open', createdAt: '2026-06-01T00:00:00Z' }
  assert.equal(pickAgentPr([older, newer, open], '2026-07-02T00:00:00Z')?.number, 4, 'an open PR counts whatever its age')
  assert.equal(pickAgentPr([older, newer], '2026-07-02T00:00:00Z')?.number, 2, 'a predecessor\'s merged PR never does')
  assert.equal(pickAgentPr([older, newer, newest], '2026-07-02T00:00:00Z')?.number, 2, 'identity: the oldest of the run\'s own')
  assert.equal(pickAgentPr([older, newer, newest], '2026-07-02T00:00:00Z', 'latest')?.number, 3, 'the handoff decision: the last that saw the branch')
  assert.equal(pickAgentPr([older, newer]), undefined, 'without a start time only an open PR is trusted')
})

test('an existing PR is the Open PR answer, unless the session kept committing after it closed (#1255/#1512)', async () => {
  const { branches, gitHost, calls } = fakeBranches({ 'openagent/work': state({ commits: [{ sha: 'tip0000000', subject: 'more' }] }), gone: state({ branch: 'gone', exists: false, commits: [], files: [] }) })
  const open = { number: 5, url: 'u5', state: 'OPEN', title: 'open' }
  assert.deepEqual(await openAgentPullRequest('/repo', agent(), { branches, pr: async () => open }), { ok: true, url: 'u5', number: 5 }, 'an open PR is the answer')
  // A hands-off web agent's branch only ever existed on the remote: its PR is still the answer.
  assert.deepEqual(await openAgentPullRequest('/repo', agent({ branch: 'gone' }), { branches, pr: async () => open }), { ok: true, url: 'u5', number: 5 })
  const landedHere = { number: 6, url: 'u6', state: 'MERGED', title: 'landed', createdAt: '2026-07-27T00:00:00Z', headRefOid: 'tip0000000' }
  assert.deepEqual(await openAgentPullRequest('/repo', agent(), { branches, pr: async () => landedHere }), { ok: true, url: 'u6', number: 6 }, 'a landed PR whose head is the tip: everything already landed')
  assert.deepEqual(calls.filter(call => call[0] === 'open'), [], 'nothing was opened for those')
  const landedBefore = { ...landedHere, headRefOid: 'older00000' }
  const opened = await openAgentPullRequest('/repo', agent(), { branches, gitHost, pr: async () => landedBefore })
  assert.deepEqual(opened, { ok: true, url: 'https://github.com/o/r/pull/9', number: 9 }, 'the session kept committing after its PR closed: the new work gets its own')
  assert.equal(calls.filter(call => call[0] === 'open').length, 1)
})

test('the handoff says when the session kept committing after its PR merged or closed, so the bar offers the next one (#1512)', async () => {
  const { branches } = fakeBranches({ 'openagent/work': state({ commits: [{ sha: 'tip0000000', subject: 'more' }, { sha: 'older00000', subject: 'first' }] }) })
  // The repository knows `older00000` as a commit the tip builds on, and no other.
  const git = async (args: string[]) => {
    if (args.join(' ') === 'merge-base --is-ancestor older00000 tip0000000') return ''
    throw new Error('exit 1')
  }
  const read = (pr: LinkedPr) => readAgentHandoff('/repo', 'openagent/work', { branches, git, pr: async () => pr })
  const merged = { number: 6, url: 'u6', state: 'MERGED', title: 'landed', createdAt: '2026-07-27T00:00:00Z' }
  assert.equal((await read({ ...merged, headRefOid: 'older00000' }))?.movedPastPr, true, 'the tip builds on the merged PR\'s head')
  assert.equal((await read({ ...merged, headRefOid: 'tip0000000' }))?.movedPastPr, undefined, 'the merged PR covers the tip: everything landed')
  assert.equal((await read({ ...merged, state: 'OPEN', headRefOid: 'older00000' }))?.movedPastPr, undefined, 'an open PR takes pushed commits itself')
  assert.equal((await read(merged))?.movedPastPr, undefined, 'a PR read without its head: no guess')
  assert.equal((await read({ ...merged, headRefOid: 'elsewhere0' }))?.movedPastPr, undefined, 'a PR updated on the git host: the tip does not build on its head, and nothing here is past it')
})

test('resolveAgentPr reads the PR the run recorded, and asks gh only for its state (E6)', async () => {
  const asked: (string | undefined)[] = []
  const live = { number: 41, url: 'https://github.com/o/r/pull/41', state: 'MERGED', title: 'the work' }
  const result = await resolveAgentPr('/repo', { id: 'r1', branch: 'agent-x', pr: { number: 41, url: 'https://github.com/o/r/pull/41' } }, async (_cwd, branch) => {
    asked.push(branch)
    return { value: live, pending: false }
  })
  assert.deepEqual(asked, ['agent-x'])
  assert.deepEqual(result, { value: live, pending: false })
})

test('resolveAgentPr answers nothing for a run that recorded no PR (E6)', async () => {
  let reads = 0
  const result = await resolveAgentPr('/repo', { id: 'r1', branch: 'agent-x' }, async () => (reads++, { value: undefined, pending: false }))
  assert.deepEqual(result, { value: undefined, pending: false })
  assert.equal(reads, 0, 'no PR recorded, no gh read')
})

test('a recorded PR the live read cannot confirm still answers with its number and url (E6)', async () => {
  const result = await resolveAgentPr('/repo', { id: 'r1', branch: 'agent-x', pr: { number: 41, url: 'u41' } }, async () => ({ value: undefined, pending: false }))
  assert.deepEqual(result, { value: { number: 41, url: 'u41', state: 'UNKNOWN', title: '' }, pending: false })
  const warming = await resolveAgentPr('/repo', { id: 'r1', branch: 'agent-x', pr: { number: 41, url: 'u41' } }, async () => ({ value: undefined, pending: true }))
  assert.deepEqual(warming, { value: { number: 41, url: 'u41', state: 'OPEN', title: '' }, pending: true })
})

test('a different PR on the branch is not this run’s answer (E6)', async () => {
  const other = { number: 40, url: 'u40', state: 'OPEN', title: 'someone else' }
  const result = await resolveAgentPr('/repo', { id: 'r1', branch: 'agent-x', pr: { number: 41, url: 'u41' } }, async () => ({ value: other, pending: false }))
  assert.deepEqual(result.value, { number: 41, url: 'u41', state: 'UNKNOWN', title: '' })
})

async function titleOf(handoffAgent: HandoffAgent): Promise<string | undefined> {
  const { branches, gitHost, calls } = fakeBranches({})
  await openRemoteBranchPullRequest('/repo', handoffAgent, 'claude/x', { branches, gitHost })
  return (calls.find(call => call[0] === 'open')?.[2] as { title: string } | undefined)?.title
}

test('a session with no branch gets its id as the title, not the prompt it was given (#1618)', async () => {
  // The prompt used to be the middle rung, cut to 72 characters. The squash merge made that a
  // permanent commit subject: an instruction, truncated mid-sentence, standing in for a
  // description of the change. The session id says less and misleads nobody.
  const intent = 'Open TODO_AGENTS.md and work on the FIRST open entry only. When the work is done, close the ticket it links to.'
  assert.equal(await titleOf({ id: 'r1', intent }), 'Session r1')
})

test("the Merge action lands the session's open PR through the git host (#1391)", async () => {
  const { gitHost, calls } = fakeBranches({})
  const result = await mergeAgentPr(
    '/repo',
    { id: 'r1', branch: 'openagent/x', pr: { number: 7, url: 'https://github.com/o/r/pull/7' } },
    { gitHost, prs: async () => ({ value: { number: 7, url: 'https://github.com/o/r/pull/7', state: 'OPEN', title: 'x' }, pending: false }) },
  )
  assert.deepEqual(calls, [['merge', 7]])
  assert.deepEqual(result, { ok: true, url: 'https://github.com/o/r/pull/7', number: 7 })
})

test('the Merge action refuses a session with no PR, one already landed, and a project with no git host (#1391)', async () => {
  const { gitHost } = fakeBranches({})
  const none = await mergeAgentPr('/repo', { id: 'r1' }, { gitHost, prs: async () => ({ value: undefined, pending: false }) })
  assert.deepEqual(none, { ok: false, error: 'this session has no pull request to merge' })
  // A closed/merged PR is an answer, not an action: nothing to press twice.
  const open = { value: { number: 7, url: 'u', state: 'OPEN', title: 'x' }, pending: false }
  const landed = await mergeAgentPr('/repo', { id: 'r1', branch: 'openagent/x', pr: { number: 7, url: 'u' } }, { gitHost, prs: async () => ({ ...open, value: { ...open.value, state: 'MERGED' } }) })
  assert.deepEqual(landed, { ok: false, error: "this session's PR is already merged" })
  const unprovided = await mergeAgentPr('/repo', { id: 'r1', branch: 'openagent/x', pr: { number: 7, url: 'u' } }, { gitHost: noGitHost, prs: async () => open })
  assert.deepEqual(unprovided, { ok: false, error: 'this project has no git host package to merge with' })
})

test('a Merge the git host refuses comes back as the error, not a success (#1391)', async () => {
  const { gitHost } = fakeBranches({}, { merge: { ok: false, error: 'Pull request is not mergeable: the base branch requires review' } })
  const result = await mergeAgentPr(
    '/repo',
    { id: 'r1', branch: 'openagent/x', pr: { number: 7, url: 'u' } },
    { gitHost, prs: async () => ({ value: { number: 7, url: 'u', state: 'OPEN', title: 'x' }, pending: false }) },
  )
  assert.deepEqual(result, { ok: false, error: 'Pull request is not mergeable: the base branch requires review' })
})

test("the Open PR button titles the request by the name the provider answers for the branch, before the branch itself", async () => {
  const { branches, gitHost, calls } = fakeBranches({ 'agent-fix-login': state({ branch: 'agent-fix-login', name: 'fix-login' }), 'agent-r1': state({ branch: 'agent-r1' }) })
  await openAgentPullRequest('/repo', agent({ branch: 'agent-fix-login' }), { branches, gitHost })
  assert.equal((calls.at(-1)![2] as { title: string }).title, 'fix-login')
  await openAgentPullRequest('/repo', agent({ branch: 'agent-r1' }), { branches, gitHost })
  assert.equal((calls.at(-1)![2] as { title: string }).title, 'agent-r1', 'no name answered: the branch as it is')
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

test('"Merge into main" merges a finished session\'s branch through the branches provider and records the two commits on its run; a refusal is the provider\'s own line', async () => {
  const { branches, calls } = fakeBranches({})
  const patches: unknown[][] = []
  const runs = async () => ({ list: async () => [], show: async () => undefined, remove: async () => ({ ok: true as const }), patch: async (id: string, patch: unknown) => (patches.push([id, patch]), { ok: true as const }) })
  assert.deepEqual(await mergeAgentBranch('/repo', agent(), { branches, runs }), { ok: true })
  assert.deepEqual(calls, [['merge-branch', 'openagent/work']])
  assert.deepEqual(patches, [[agent().id, { landed: { commit: 'c'.repeat(40), from: 'b'.repeat(40) } }]], 'the branch is gone: the record keeps where its work began and ended')

  // A branch the provider merged and kept (no agent's branch) still has its branch: nothing to record.
  const kept = fakeBranches({}, { mergeBranch: { ok: true, into: 'main', commit: 'c'.repeat(40), from: 'b'.repeat(40), deleted: false } })
  patches.length = 0
  assert.deepEqual(await mergeAgentBranch('/repo', agent(), { branches: kept.branches, runs }), { ok: true })
  assert.deepEqual(patches, [])

  const conflict = fakeBranches({}, { mergeBranch: { ok: false, error: 'agent-x does not merge cleanly into main: it conflicts in a.ts; nothing was changed' } })
  assert.deepEqual(await mergeAgentBranch('/repo', agent(), { branches: conflict.branches, runs }), { ok: false, error: 'agent-x does not merge cleanly into main: it conflicts in a.ts; nothing was changed' })
  assert.deepEqual(patches, [], 'a merge that did not happen records nothing')
  assert.deepEqual(await mergeAgentBranch('/repo', unbranched, { branches, runs }), { ok: false, error: 'this session recorded no branch to merge' })
  assert.deepEqual(await mergeAgentBranch('/repo', agent(), { branches: noBranches, runs }), { ok: false, error: 'this project has no branches provider to merge with' })

  const unrecorded = async () => ({ list: async () => [], show: async () => undefined, remove: async () => ({ ok: true as const }), patch: async () => ({ ok: false as const, error: 'no such run' }) })
  assert.deepEqual(await mergeAgentBranch('/repo', agent(), { branches, runs: unrecorded }), { ok: false, error: 'merged into main, but the record was not updated: no such run' })
})
