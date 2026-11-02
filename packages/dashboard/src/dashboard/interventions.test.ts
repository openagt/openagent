import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { buildInterventions, interventionKey } from './interventions.js'
import type { OpenPr } from './pull-requests.js'
import type { BranchAhead, BranchesFor } from '../store/branches.js'
import type { ProjectSummary } from './projects.js'
import type { LiveAgent, AgentMeta } from '../store/index.js'
import type { OpenAgentEvent } from '../events.js'
import type { BridgeQuestion } from './bridge-question.js'

const project = (id: string, path: string): ProjectSummary => ({ id, path, name: id, activated: true, gitHost: false })

/** No paused run anywhere — keeps the PR-only tests hermetic (no disk read). */
const noAgents = async (): Promise<LiveAgent[]> => []

/** A live agent in its own worktree (#738), which is what the reader now returns. */
const live = (meta: AgentMeta, cwd = '/a/.openagent/worktrees/r1'): LiveAgent => ({ ...meta, cwd })

const runningAgentMeta = (over: Partial<AgentMeta> = {}): AgentMeta => ({
  status: 'running',
  id: 'r1',
  startedAt: '2026-07-16T00:00:00Z',
  updatedAt: '2026-07-16T00:00:00Z',
  ...over,
})

test('buildInterventions rolls up open non-draft PRs across projects, newest first', async () => {
  const prsByPath: Record<string, OpenPr[]> = {
    '/a': [
      { number: 7, title: 'add cart', url: 'u7', isDraft: false, createdAt: '2026-07-10T00:00:00Z' },
      { number: 8, title: 'wip spike', url: 'u8', isDraft: true, createdAt: '2026-07-12T00:00:00Z' }, // draft -> excluded
    ],
    '/b': [{ number: 3, title: 'fix login', url: 'u3', isDraft: false, createdAt: '2026-07-15T00:00:00Z' }],
    '/c': [], // no open PRs -> contributes nothing
  }
  const prs = async (cwd: string): Promise<OpenPr[]> => prsByPath[cwd] ?? []
  const { items } = await buildInterventions([project('a', '/a'), project('b', '/b'), project('c', '/c')], { prs, liveAgents: noAgents })

  // Newest PR first; the draft is gone.
  assert.deepEqual(
    items.map(i => ({ project: i.projectId, number: i.number, title: i.title })),
    [
      { project: 'b', number: 3, title: 'fix login' },
      { project: 'a', number: 7, title: 'add cart' },
    ],
  )
  assert.ok(items.every(i => i.kind === 'pr'))
})

test('buildInterventions skips a project whose PR lookup throws, and does not call it read (#1623)', async () => {
  const prs = async (cwd: string): Promise<OpenPr[]> => {
    if (cwd === '/boom') throw new Error('gh exploded')
    return [{ number: 1, title: 'ok', url: 'u1', isDraft: false }]
  }
  const { items, whole } = await buildInterventions([project('boom', '/boom'), project('ok', '/ok')], { prs, liveAgents: noAgents })
  assert.deepEqual(items.map(i => i.projectId), ['ok'])
  // Both projects contributed nothing visible about /boom; only `whole` says which silence was real.
  assert.deepEqual(whole, ['ok'])
})

test('buildInterventions calls a project read when it answers with nothing (#1623)', async () => {
  const prs = async (): Promise<OpenPr[]> => []
  const { items, whole } = await buildInterventions([project('quiet', '/quiet')], { prs, liveAgents: noAgents })
  assert.deepEqual(items, [])
  assert.deepEqual(whole, ['quiet'])
})

test('buildInterventions does not call a project read when its live-agent read throws (#1623)', async () => {
  const liveAgents = async (): Promise<LiveAgent[]> => {
    throw new Error('store unreadable')
  }
  const prs = async (): Promise<OpenPr[]> => [{ number: 7, title: 'open', url: 'u7', isDraft: false }]
  const { items, whole } = await buildInterventions([project('a', '/a')], { prs, liveAgents })
  // The PRs it did read are still shown — forgiving as ever — but the project is not a baseline.
  assert.deepEqual(items.map(i => i.number), [7])
  assert.deepEqual(whole, [])
})

test('buildInterventions returns [] when nothing is open anywhere', async () => {
  const prs = async (): Promise<OpenPr[]> => []
  assert.deepEqual((await buildInterventions([project('a', '/a')], { prs, liveAgents: noAgents })).items, [])
})

test('buildInterventions dedupes a PR shared by two registered projects (same repo), keeping one', async () => {
  const shared: OpenPr = { number: 285, title: 'release', url: 'https://gh/pr/285', isDraft: false, createdAt: '2026-07-05T00:00:00Z' }
  const prs = async (): Promise<OpenPr[]> => [shared] // both projects resolve to the same repo
  const { items } = await buildInterventions([project('root', '/repo'), project('sub', '/repo/packages/x')], { prs, liveAgents: noAgents })
  assert.deepEqual(items.map(i => i.number), [285])
})

const noPrs = async (): Promise<OpenPr[]> => []

/** A run that ended on a question: its meta says `waiting`, its diary holds the question. */
const waitingOn = (id: string, title: string): OpenAgentEvent[] => [
  { kind: 'choice', id, title, options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] },
  { kind: 'end', ok: false, waiting: true },
]

test('buildInterventions adds an awaiting item for a run waiting on the question it ended on (#636/#1774)', async () => {
  const liveAgents = async (cwd: string): Promise<LiveAgent[]> => (cwd === '/a' ? [live(runningAgentMeta({ status: 'waiting', title: 'Auth store caching' }))] : [])
  const read: string[] = []
  const events = async (cwd: string, agentId: string) => (read.push(`${cwd} ${agentId}`), waitingOn('gate-1', 'Cache the auth store?'))
  const { items } = await buildInterventions([project('a', '/a'), project('b', '/b')], { prs: noPrs, liveAgents, events })

  assert.equal(items.length, 1)
  assert.deepEqual(
    { kind: items[0]!.kind, project: items[0]!.projectId, title: items[0]!.title, question: items[0]!.question, awaitId: items[0]!.awaitId, agentId: items[0]!.agentId },
    { kind: 'awaiting', project: 'a', title: 'Auth store caching', question: 'Cache the auth store?', awaitId: 'gate-1', agentId: 'r1' },
  )
  assert.deepEqual(read, ['/a r1'], "only the waiting run's diary is read")
})

test('buildInterventions adds no awaiting item for a run that is not waiting, or whose diary shows no open question', async () => {
  const events = async () => waitingOn('gate-1', 'stale')
  const running = async (): Promise<LiveAgent[]> => [live(runningAgentMeta())]
  assert.deepEqual((await buildInterventions([project('a', '/a')], { prs: noPrs, liveAgents: running, events })).items, [])
  const waiting = async (): Promise<LiveAgent[]> => [live(runningAgentMeta({ status: 'waiting' }))]
  const answered = async (): Promise<OpenAgentEvent[]> => [...waitingOn('gate-1', 'q?'), { kind: 'driver', event: { type: 'start', prompt: 'Yes' } }]
  assert.deepEqual((await buildInterventions([project('a', '/a')], { prs: noPrs, liveAgents: waiting, events: answered })).items, [])
  const unreadable = async () => undefined
  assert.deepEqual((await buildInterventions([project('a', '/a')], { prs: noPrs, liveAgents: waiting, events: unreadable })).items, [])
})

test('buildInterventions surfaces PRs and awaiting runs together, newest first', async () => {
  const prs = async (cwd: string): Promise<OpenPr[]> =>
    cwd === '/a' ? [{ number: 5, title: 'pr', url: 'u5', isDraft: false, createdAt: '2026-07-10T00:00:00Z' }] : []
  const liveAgents = async (cwd: string): Promise<LiveAgent[]> =>
    cwd === '/b' ? [live(runningAgentMeta({ status: 'waiting', updatedAt: '2026-07-16T00:00:00Z' }))] : []
  const { items } = await buildInterventions([project('a', '/a'), project('b', '/b')], { prs, liveAgents, events: async () => waitingOn('g', 'q?') })
  assert.deepEqual(items.map(i => i.kind), ['awaiting', 'pr']) // awaiting is newer
})

test('interventionKey is the url for a PR and project+agent+gate for an awaiting run', () => {
  assert.equal(
    interventionKey({ projectId: 'a', projectName: 'a', kind: 'pr', title: 't', url: 'https://gh/pr/1', number: 1 }),
    'https://gh/pr/1',
  )
  assert.equal(
    interventionKey({ projectId: 'a', projectName: 'a', kind: 'awaiting', title: 't', url: '', awaitId: 'g1', agentId: 'r1' }),
    'awaiting:a:r1:g1',
  )
  // Every agent's first gate is `await-choices`, so two agents parked in one project would share
  // an identity without the run in the key — and the dedupe would announce only one of them.
  const parked = { projectId: 'a', projectName: 'a', kind: 'awaiting', title: 't', url: '', awaitId: 'await-choices' } as const
  assert.notEqual(interventionKey({ ...parked, agentId: 'r1' }), interventionKey({ ...parked, agentId: 'r2' }))
})

// #860: a finished agent whose branch still holds unpushed, unmerged commits.

const doneMeta = (over: Partial<AgentMeta> = {}): AgentMeta => ({
  status: 'done',
  id: 'r1',
  startedAt: '2026-07-16T00:00:00Z',
  updatedAt: '2026-07-16T01:00:00Z',
  branch: 'agent-add-cart',
  intent: 'add the cart',
  ...over,
})

/** A run's branch with work on it that never left the machine, as the branches provider counts it. */
const waiting = (over: Partial<BranchAhead> = {}): BranchAhead => ({
  branch: 'agent-add-cart',
  exists: true,
  agent: true,
  ahead: 1,
  hasRemote: true,
  pushed: false,
  gone: false,
  merged: false,
  uncommitted: 0,
  ...over,
})

/** A branches provider answering `ahead` from `state`, one answer per branch asked, recording what it was asked. */
const counting = (state: (branch: string, from?: string) => BranchAhead | undefined, asked: string[][] = [], askedFrom: (string | undefined)[] = []): BranchesFor => {
  const unused = () => Promise.reject(new Error('not asked here'))
  return async () => ({
    list: unused,
    show: unused,
    ahead: async (branches, from) => {
      asked.push([...branches])
      askedFrom.push(from)
      return branches.flatMap(branch => {
        const answer = state(branch, from)
        return answer ? [answer] : []
      })
    },
    push: unused,
    merge: unused,
    remove: unused,
  })
}

/** Only the unpushed source: no PRs, no paused runs. */
const onlyUnpushed = (agents: AgentMeta[], branches: BranchesFor) => ({
  prs: async () => [],
  liveAgents: noAgents,
  agents: async () => agents,
  branches,
})

test('a finished run with unpushed commits lands on the queue (#860)', async () => {
  const { items } = await buildInterventions(
    [project('a', '/a')],
    onlyUnpushed([doneMeta()], counting(branch => waiting({ branch, ahead: 2 }))),
  )

  assert.equal(items.length, 1)
  assert.equal(items[0]?.kind, 'unpushed')
  assert.equal(items[0]?.title, 'add the cart', 'what was asked, not the branch name')
  assert.equal(items[0]?.branch, 'agent-add-cart')
  assert.equal(items[0]?.commits, 2)
  assert.equal(items[0]?.agentId, 'r1')
})

test('nothing is waiting when the work already went somewhere (#860)', async () => {
  // Each of these is a reason it is NOT waiting on a human.
  const cases: [string, Partial<BranchAhead>][] = [
    ['already pushed', { pushed: true }],
    ['pushed, and its copy on the remote deleted since, as a merged pull request\'s is', { gone: true }],
    ['already merged', { merged: true }],
    ['the session wrote nothing', { ahead: 0 }],
    ['the branch is gone', { exists: false }],
    ['there is nowhere to push', { hasRemote: false }],
    ["a branch of the person's own, or one from before the history was rewritten", { agent: false }],
    ['the provider did not answer for the branch', undefined as unknown as Partial<BranchAhead>],
  ]
  for (const [why, over] of cases) {
    const { items } = await buildInterventions(
      [project('a', '/a')],
      onlyUnpushed([doneMeta()], counting(branch => (over ? waiting({ branch, ...over }) : undefined))),
    )
    assert.deepEqual(items, [], `should not be surfaced: ${why}`)
  }
})

test('a subagent is never unpushed work: its branch is its main agent’s to land', async () => {
  const asked: string[][] = []
  const { items } = await buildInterventions(
    [project('a', '/a')],
    onlyUnpushed([doneMeta({ parent: 'r0' })], counting(branch => waiting({ branch }), asked)),
  )
  assert.deepEqual(items, [])
  assert.deepEqual(asked, [], 'its branch is not even read')
})

test('a still-running run is not unpushed work (#860)', async () => {
  // It is still writing; the overview already shows it.
  const { items } = await buildInterventions(
    [project('a', '/a')],
    onlyUnpushed([doneMeta({ status: 'running' })], counting(branch => waiting({ branch }))),
  )
  assert.deepEqual(items, [])
})

test('an unreadable branch state is skipped rather than throwing, and the project does not count as read whole (#860)', async () => {
  const failing: BranchesFor = async () => ({
    list: async () => [],
    show: async () => [],
    ahead: async () => {
      throw new Error('not a repo')
    },
    push: async () => ({ ok: false, error: 'no' }),
    merge: async () => ({ ok: false, error: 'no' }),
    remove: async () => ({ ok: false, error: 'no' }),
  })
  const { items, whole } = await buildInterventions([project('a', '/a')], onlyUnpushed([doneMeta()], failing))
  assert.deepEqual(items, [])
  assert.deepEqual(whole, [])
})

test('a project with no branches provider has nothing unpushed (#1774)', async () => {
  const { items, whole } = await buildInterventions([project('a', '/a')], onlyUnpushed([doneMeta()], async () => undefined))
  assert.deepEqual(items, [])
  assert.deepEqual(whole, ['a'])
})

test('every finished run is asked, the oldest too, in one read (#860)', async () => {
  // The read counts commits and lists no file, so the whole history fits in one process on a poll.
  const agents = Array.from({ length: 12 }, (_, i) =>
    doneMeta({ id: `r${i}`, startedAt: `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00Z`, branch: `agent-b${i}` }),
  )
  const asked: string[][] = []
  const { items } = await buildInterventions([project('a', '/a')], onlyUnpushed(agents, counting(branch => waiting({ branch }), asked)))

  assert.equal(asked.length, 1, 'one read')
  assert.equal(asked[0]!.length, 12)
  assert.equal(items.length, 12)
})

test('a run started from another branch is counted from the commit its own work begins at; the runs started from the default branch share one read', async () => {
  // Measured from the default branch, its branch holds the other branch's commits too: "2 commits" for 1.
  const asked: string[][] = []
  const askedFrom: (string | undefined)[] = []
  const agents = [
    doneMeta({ id: 'r1', branch: 'agent-based', base: 'feature', baseCommit: 'c0ffee', startedAt: '2026-07-16T02:00:00Z' }),
    // Started from the default branch: the commit it started at changes nothing, so it shares the one read.
    doneMeta({ id: 'r2', branch: 'agent-plain-1', baseCommit: 'beef', startedAt: '2026-07-16T01:00:00Z' }),
    doneMeta({ id: 'r3', branch: 'agent-plain-2', startedAt: '2026-07-16T00:00:00Z' }),
  ]
  const { items } = await buildInterventions(
    [project('a', '/a')],
    onlyUnpushed(agents, counting((branch, from) => waiting({ branch, ahead: from === 'c0ffee' || branch !== 'agent-based' ? 1 : 2 }), asked, askedFrom)),
  )
  assert.deepEqual(new Map(asked.map((branches, i) => [askedFrom[i], branches])), new Map([['c0ffee', ['agent-based']], [undefined, ['agent-plain-1', 'agent-plain-2']]]), 'the based run asked on its own, the others in one read')
  assert.deepEqual(items.map(i => [i.agentId, i.commits]).sort(), [['r1', 1], ['r2', 1], ['r3', 1]])
})

test('a finished run that left files uncommitted is "not committed", even with commits or a pull request; one waiting on its question is not', async () => {
  const left = (over: Partial<AgentMeta> = {}) =>
    buildInterventions([project('a', '/a')], onlyUnpushed([doneMeta(over)], counting(branch => waiting({ branch, ahead: 3, uncommitted: 2 }))))
  const { items } = await left()
  assert.deepEqual(items.map(i => [i.kind, i.files, i.commits, i.agentId]), [['uncommitted', 2, undefined, 'r1']], 'committing is the next step, so it is the one item')
  const withPr = await left({ pr: { number: 7, url: 'u7' } })
  assert.deepEqual(withPr.items.map(i => i.kind), ['uncommitted'])
  const parked = await left({ status: 'waiting' })
  assert.deepEqual(parked.items.map(i => i.kind), ['unpushed'], 'its question is its next step; its commits still wait')
})

test('an open request a run opened opens that run: by the request its record names, else by its branch; one opened anywhere else names no run', async () => {
  const prs = async (): Promise<OpenPr[]> => [
    { number: 6, title: 'recorded', url: 'u6', isDraft: false, headRefName: 'agent-other-name' },
    { number: 7, title: 'by branch', url: 'u7', isDraft: false, headRefName: 'agent-seven' },
    { number: 8, title: 'elsewhere', url: 'u8', isDraft: false, headRefName: 'claude/elegant-maxwell' },
  ]
  const agents = [doneMeta({ id: 'r6', branch: 'agent-six', pr: { number: 6, url: 'u6' } }), doneMeta({ id: 'r7', branch: 'agent-seven' })]
  const { items } = await buildInterventions([project('a', '/a')], { prs, liveAgents: noAgents, agents: async () => agents, branches: async () => undefined })
  assert.deepEqual(items.map(i => [i.number, i.agentId]), [[6, 'r6'], [7, 'r7'], [8, undefined]])
})

test('the projects are read at once, not one after the other', async () => {
  let started = 0
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => (release = resolve))
  const prs = async (): Promise<OpenPr[]> => {
    started++
    if (started === 2) release()
    await gate
    return []
  }
  const read = buildInterventions([project('a', '/a'), project('b', '/b')], { prs, liveAgents: noAgents, agents: async () => [] })
  await Promise.race([read, new Promise((_, reject) => setTimeout(() => reject(new Error('the second project waited for the first')), 1000))])
  assert.equal(started, 2)
})

test('a checkout\'s uncommitted files are the newest run\'s on its branch: a run continued on an earlier one\'s branch does not charge the earlier one', async () => {
  const earlier = doneMeta({ id: 'r1', startedAt: '2026-07-16T00:00:00Z' })
  const later = (status: AgentMeta['status']) => doneMeta({ id: 'r2', status, startedAt: '2026-07-16T02:00:00Z' })
  const read = (agents: AgentMeta[]) => buildInterventions([project('a', '/a')], onlyUnpushed(agents, counting(branch => waiting({ branch, ahead: 0, uncommitted: 2 }))))
  assert.deepEqual((await read([earlier, later('running')])).items, [], 'the later run is still working in it')
  assert.deepEqual((await read([earlier, later('done')])).items.map(i => [i.kind, i.agentId]), [['uncommitted', 'r2']])
})

test('a provider that does not answer for every branch asked is a read that failed, never "nothing waits"', async () => {
  const { items, whole } = await buildInterventions([project('a', '/a')], onlyUnpushed([doneMeta()], counting(() => undefined)))
  assert.deepEqual(items, [])
  assert.deepEqual(whole, [], 'so the notifier does not take it for a baseline')
})

test('unpushed items key on the run, so each notifies once (#860)', () => {
  const base = { projectId: 'p', projectName: 'p', kind: 'unpushed' as const, title: 't', url: '' }
  assert.equal(interventionKey({ ...base, agentId: 'r1' }), 'unpushed:p:r1')
  assert.notEqual(interventionKey({ ...base, agentId: 'r1' }), interventionKey({ ...base, agentId: 'r2' }))
  // And never collides with the other kinds, whose url is the same shared dashboard URL.
  assert.notEqual(
    interventionKey({ ...base, agentId: 'r1' }),
    interventionKey({ ...base, kind: 'awaiting', awaitId: 'r1' }),
  )
})

test("a session's own draft PR still reaches the queue; a hand-made draft does not (#1102)", async () => {
  // Auto-handoff opens a draft precisely so it does not ping reviewers. If the queue then dropped
  // it too, nothing would tell anyone the work exists, which is #860 all over again.
  const prs = async (): Promise<OpenPr[]> => [
    { number: 9, title: 'session work', url: 'u9', isDraft: true, headRefName: 'agent-x', createdAt: '2026-07-16T00:00:00Z' },
    { number: 10, title: 'my own wip', url: 'u10', isDraft: true, headRefName: 'feat/mine', createdAt: '2026-07-17T00:00:00Z' },
  ]
  // A draft is a run's when its head is the branch a run's record, or a run's checkout, names (#1774).
  const recorded: AgentMeta = { id: 'x', status: 'done', startedAt: '2026-07-16T00:00:00Z', updatedAt: '2026-07-16T01:00:00Z', branch: 'agent-x' }
  const { items } = await buildInterventions([project('a', '/a')], { prs, liveAgents: noAgents, agents: async () => [recorded] })
  assert.deepEqual(items.map(i => i.number), [9])
  const { items: live } = await buildInterventions([project('a', '/a')], { prs, liveAgents: async () => [{ ...recorded, status: 'running', cwd: '/a/.branches/agent-x' }], agents: async () => [] })
  assert.deepEqual(live.map(i => i.number), [9], 'a running agent\'s draft counts too')
  const { items: nobody } = await buildInterventions([project('a', '/a')], { prs, liveAgents: noAgents, agents: async () => [] })
  assert.deepEqual(nobody, [], 'a draft on a branch no run names is hand-made')
})

test('a draft with no branch recorded is still treated as hand-made (#1102)', async () => {
  // `headRefName` is new: an older gh, or a lookup that did not ask for it, must not turn every
  // draft in the repo into a "needs you".
  const prs = async (): Promise<OpenPr[]> => [{ number: 11, title: 'wip', url: 'u11', isDraft: true }]
  const { items } = await buildInterventions([project('a', '/a')], { prs, liveAgents: noAgents, agents: async () => [] })
  assert.deepEqual(items, [])
})

test('unpushed work is titled by the run\'s own name, else what was asked, else the branch', async () => {
  const both = await buildInterventions([project('p', '/p')], onlyUnpushed([doneMeta({ title: 'Cart page' })], counting(branch => waiting({ branch }))))
  assert.deepEqual(both.items.map(i => i.title), ['Cart page'], 'the name the sidebar shows, not the prompt')
  const { intent: _intent, ...unasked } = doneMeta({ branch: 'agent-fix-login' })
  const named = await buildInterventions([project('p', '/p')], onlyUnpushed([{ ...unasked, title: 'Fix the login' }], counting(branch => waiting({ branch }))))
  assert.deepEqual(named.items.map(i => [i.kind, i.title, i.branch]), [['unpushed', 'Fix the login', 'agent-fix-login']])
  const plain = await buildInterventions([project('p', '/p')], onlyUnpushed([unasked], counting(branch => waiting({ branch }))))
  assert.deepEqual(plain.items.map(i => i.title), ['agent-fix-login'], 'no name: the branch as it is')
})

test('every row goes by the name the sidebar shows: a request a run opened by that run\'s, one opened elsewhere by its own title', async () => {
  const prs = async (): Promise<OpenPr[]> => [
    { number: 6, title: 'Add the cart page', url: 'u6', isDraft: false },
    { number: 8, title: 'Bump deps', url: 'u8', isDraft: false },
  ]
  const agents = [doneMeta({ id: 'r6', title: 'Cart page', pr: { number: 6, url: 'u6' } })]
  const { items } = await buildInterventions([project('a', '/a')], { prs, liveAgents: noAgents, agents: async () => agents, branches: async () => undefined })
  assert.deepEqual(items.map(i => [i.number, i.title]), [[6, 'Cart page'], [8, 'Bump deps']])
})

test('unpushed work says whether the project can open a pull request, so the row asks for one or for a push', async () => {
  const withHost = await buildInterventions([{ ...project('p', '/p'), gitHost: true }], onlyUnpushed([doneMeta()], counting(branch => waiting({ branch }))))
  assert.deepEqual(withHost.items.map(i => [i.kind, i.gitHost]), [['unpushed', true]])
  const without = await buildInterventions([project('p', '/p')], onlyUnpushed([doneMeta()], counting(branch => waiting({ branch }))))
  assert.deepEqual(without.items.map(i => [i.kind, i.gitHost]), [['unpushed', false]])
})

// A Claude Code web session's question (#1554): the browser bridge holds it, not the run's diary.

/** Only the bridged source: the given records, no requests, no checkouts, no branches. */
const onlyBridged = (agents: AgentMeta[], bridged: BridgeQuestion[]) => ({
  prs: async () => [],
  liveAgents: noAgents,
  agents: async () => agents,
  branches: async () => undefined,
  bridged: () => bridged,
})

test('a web session\'s question arrives from the bridge and is listed under its run, waiting since the bridge saw it (#1554)', async () => {
  const { items } = await buildInterventions(
    [project('p1', '/one')],
    onlyBridged(
      [
        // The records, not the checkouts: a web run is done at its hand-off and its checkout may be gone.
        { status: 'done', id: 'run-web', startedAt: '2026-08-23T09:00:00.000Z', updatedAt: '2026-08-23T09:01:00.000Z', target: 'web', sessionId: 'session_01Web', title: 'CI checks' },
        { status: 'done', id: 'run-other', startedAt: '2026-08-23T08:00:00.000Z', updatedAt: '2026-08-23T08:01:00.000Z', target: 'web', sessionId: 'session_01Other' },
      ],
      [{ sessionId: 'session_01Web', title: 'Which checks should run?', options: [{ label: 'Lint' }], receivedAt: '2026-08-23T09:30:00.000Z' }],
    ),
  )
  assert.deepEqual(items, [
    { projectId: 'p1', projectName: 'p1', kind: 'awaiting', title: 'CI checks', question: 'Which checks should run?', awaitId: 'bridge:session_01Web', agentId: 'run-web', createdAt: '2026-08-23T09:30:00.000Z' },
  ])
})

test('two checkouts of one repository list a bridged question once, not twice (#1554)', async () => {
  // They share the records, so the same web run is in both projects' lists.
  const run: AgentMeta = { status: 'done', id: 'run-web', startedAt: '', updatedAt: '', target: 'web', sessionId: 'session_01Web' }
  const { items } = await buildInterventions([project('p1', '/one'), project('p2', '/two')], onlyBridged([run], [{ sessionId: 'session_01Web', title: 'Where?', options: [{ label: 'Here' }], receivedAt: '' }]))
  assert.deepEqual(items.map(i => i.projectId), ['p1'])
})

test('a bridged question whose run is unknown here is not listed (#1554)', async () => {
  const { items } = await buildInterventions([project('p1', '/one')], onlyBridged([], [{ sessionId: 'session_01Gone', title: 'Still there?', options: [{ label: 'Yes' }], receivedAt: '' }]))
  assert.deepEqual(items, [])
})
