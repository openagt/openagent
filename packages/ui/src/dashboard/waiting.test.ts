import { strict as assert } from 'node:assert'
import { beforeEach, test } from 'node:test'
import { createHooks, defineModule, type AttentionItem, type Hooks, type WaitingRun } from '@openagt/hooks'
import { memoryStore } from '@openagt/hooks/testing'
import ask from '@openagt/ask/module'
import { buildWaiting, waitingKey, type Waiting, type WaitingDeps } from './waiting.js'
import { forgetPullRequestStates } from './pr-states.js'
import { pendingChoices } from '../open-choices.js'
import { eventsOf, type AnyDiaryLine } from '@openagt/agent-driver'
import { githubModule, type OpenPr } from '@openagt/github/module'
import type { BranchAhead, BranchesFor } from '../store/branches.js'
import type { ProjectSummary } from './projects.js'
import type { AgentMeta } from '../store/index.js'
import type { RunEvent } from '@openagt/hooks'

const project = (id: string, path: string): ProjectSummary => ({ id, path, name: id, activated: true, gitHost: false })

// What a test's modules read of pull requests is that test's alone.
beforeEach(forgetPullRequestStates)

/** A distribution with no module that says anything waits: only the shell's own sources. */
const noModules = async (): Promise<Hooks> => createHooks([])

/** A distribution where ask is on, as it starts: a run waiting on its question is ask's to say. */
const withAsk = async (): Promise<Hooks> => createHooks([{ module: defineModule({ name: 'memory', hooks: { 'store.backend': memoryStore() } }) }, { module: ask, on: true }], { onError: () => {} })

/**
 * A project's runs as a test has them, by the project's folder: the ones at work in a checkout
 * (`liveAgents`) and the recorded ones (`agents`), the first winning for a run that is both, as
 * a host says a run that works again. A run's events by the project's folder too. With `prs`, the
 * projects' open pull requests by their folder, github's on, its projects all on GitHub.
 */
type TestDeps = Omit<WaitingDeps, 'agents' | 'events'> & {
  liveAgents?: (cwd: string) => Promise<AgentMeta[]>
  agents?: (cwd: string) => Promise<AgentMeta[]>
  events?: (cwd: string, agentId: string) => Promise<RunEvent[] | undefined>
  prs?: (cwd: string) => Promise<OpenPr[]>
}

/** The folder of the sessions with no project, in these tests. */
const SESSIONS = '/sessions'

/** The deps a test gives, as {@link buildWaiting} takes them. */
function waitingDeps({ liveAgents, agents, events, prs, ...deps }: TestDeps): WaitingDeps {
  const runs = async (project: ProjectSummary | undefined): Promise<AgentMeta[]> => {
    const cwd = project?.path ?? SESSIONS
    const [live, recorded] = await Promise.all([(liveAgents ?? noAgents)(cwd), (agents ?? noAgents)(cwd)])
    return [...live, ...recorded.filter(run => !live.some(other => other.id === run.id))]
  }
  return { ...deps, ...(prs ? { hooks: withGithub(prs, deps.hooks) } : {}), agents: runs, ...(events ? { events: (project, agentId) => events(project?.path ?? SESSIONS, agentId) } : {}) }
}

/**
 * The modules of `base`, with github's on, its projects all on GitHub, their open pull requests
 * `prs`'s: what waits on a pull request is its to say.
 */
const withGithub = (prs: (cwd: string) => Promise<OpenPr[]>, base: () => Promise<Hooks> = noModules) => async (): Promise<Hooks> =>
  createHooks(
    [
      // A plugin of `base` stays on; github is a core module, on with no row.
      ...(await base()).modules.map(module => (module.plugin ? { module, on: true } : { module })),
      { module: githubModule({ onGithub: async () => true, openRequests: prs, requestStates: async () => undefined, accounts: async () => ({ installed: true, accounts: [] }) }) },
    ],
    { onError: () => {} },
  )

/** What waits on the person in `projects`, with the modules of `deps.hooks`, none unless said, and github's with `deps.prs`. */
const build = (projects: ProjectSummary[], deps: TestDeps = {}) => buildWaiting(projects, { hooks: noModules, ...waitingDeps(deps) })

/** No paused run anywhere — keeps the PR-only tests hermetic (no disk read). */
const noAgents = async (): Promise<AgentMeta[]> => []

/** A run at work in its own worktree (#738). */
const live = (meta: AgentMeta): AgentMeta => meta

const runningAgentMeta = (over: Partial<AgentMeta> = {}): AgentMeta => ({
  status: 'running',
  id: 'r1',
  startedAt: '2026-07-16T00:00:00Z',
  updatedAt: '2026-07-16T00:00:00Z',
  ...over,
})

test('build rolls up open non-draft PRs across projects, newest first', async () => {
  const prsByPath: Record<string, OpenPr[]> = {
    '/a': [
      { number: 7, title: 'add cart', url: 'u7', isDraft: false, createdAt: '2026-07-10T00:00:00Z' },
      { number: 8, title: 'wip spike', url: 'u8', isDraft: true, createdAt: '2026-07-12T00:00:00Z' }, // draft -> excluded
    ],
    '/b': [{ number: 3, title: 'fix login', url: 'u3', isDraft: false, createdAt: '2026-07-15T00:00:00Z' }],
    '/c': [], // no open PRs -> contributes nothing
  }
  const prs = async (cwd: string): Promise<OpenPr[]> => prsByPath[cwd] ?? []
  const { items } = await build([project('a', '/a'), project('b', '/b'), project('c', '/c')], { prs, liveAgents: noAgents })

  // Newest PR first; the draft is gone.
  assert.deepEqual(
    items.map(i => ({ project: i.projectId, detail: i.detail, title: i.title })),
    [
      { project: 'b', detail: '#3', title: 'fix login' },
      { project: 'a', detail: '#7', title: 'add cart' },
    ],
  )
  // Each is github's, about its project (no run here opened it): it needs merging, and its page on the git host fixes it.
  assert.deepEqual(items[0], { kind: 'waiting', module: 'github', scope: 'project', id: 'u3', words: 'Needs merge', title: 'fix login', detail: '#3', mark: 'pull-request', since: '2026-07-15T00:00:00Z', fix: { label: 'Open PR #3', href: 'u3' }, projectId: 'b', projectName: 'b' })
})

test('build skips a project whose PR lookup throws, and does not call it read (#1623)', async () => {
  const prs = async (cwd: string): Promise<OpenPr[]> => {
    if (cwd === '/boom') throw new Error('gh exploded')
    return [{ number: 1, title: 'ok', url: 'u1', isDraft: false }]
  }
  const { items, whole } = await build([project('boom', '/boom'), project('ok', '/ok')], { prs, liveAgents: noAgents })
  assert.deepEqual(items.map(i => i.projectId), ['ok'])
  // Both projects contributed nothing visible about /boom; only `whole` says which silence was real.
  assert.deepEqual(whole, ['ok'])
})

test('build calls a project read when it answers with nothing (#1623)', async () => {
  const prs = async (): Promise<OpenPr[]> => []
  const { items, whole } = await build([project('quiet', '/quiet')], { prs, liveAgents: noAgents })
  assert.deepEqual(items, [])
  assert.deepEqual(whole, ['quiet'])
})

test('build does not call a project read when its live-agent read throws (#1623)', async () => {
  const liveAgents = async (): Promise<AgentMeta[]> => {
    throw new Error('store unreadable')
  }
  const prs = async (): Promise<OpenPr[]> => [{ number: 7, title: 'open', url: 'u7', isDraft: false }]
  const { items, whole } = await build([project('a', '/a')], { prs, liveAgents })
  // The PRs it did read are still shown — forgiving as ever — but the project is not a baseline.
  assert.deepEqual(items.map(i => i.detail), ['#7'])
  assert.deepEqual(whole, [])
})

test('build returns [] when nothing is open anywhere', async () => {
  const prs = async (): Promise<OpenPr[]> => []
  assert.deepEqual((await build([project('a', '/a')], { prs, liveAgents: noAgents })).items, [])
})

test('build dedupes a PR shared by two registered projects (same repo), keeping one', async () => {
  const shared: OpenPr = { number: 285, title: 'release', url: 'https://gh/pr/285', isDraft: false, createdAt: '2026-07-05T00:00:00Z' }
  const prs = async (): Promise<OpenPr[]> => [shared] // both projects resolve to the same repo
  const { items } = await build([project('root', '/repo'), project('sub', '/repo/packages/x')], { prs, liveAgents: noAgents })
  assert.deepEqual(items.map(i => i.detail), ['#285'])
})

const noPrs = async (): Promise<OpenPr[]> => []

/** A run that ended on a question: its meta says `waiting`, its diary holds the question. */
const waitingOn = (id: string, title: string): RunEvent[] => [
  { kind: 'choice', id, title, options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] },
  { kind: 'end', ok: false, waiting: true },
]

test("a run waiting on the question it ended on is ask's to say, given the project's runs that wait (#636/#1774)", async () => {
  const liveAgents = async (cwd: string): Promise<AgentMeta[]> => (cwd === '/a' ? [live(runningAgentMeta({ status: 'waiting', title: 'Auth store caching' }))] : [])
  const read: string[] = []
  const events = async (cwd: string, agentId: string) => (read.push(`${cwd} ${agentId}`), waitingOn('gate-1', 'Cache the auth store?'))
  const { items } = await build([project('a', '/a'), project('b', '/b')], { prs: noPrs, liveAgents, events, hooks: withAsk })

  assert.equal(items.length, 1)
  assert.deepEqual(items[0], {
    kind: 'waiting',
    module: 'ask',
    scope: 'run',
    run: 'r1',
    id: 'r1:gate-1',
    words: 'Needs answer',
    title: 'Auth store caching',
    detail: 'Cache the auth store?',
    mark: 'question',
    since: '2026-07-16T00:00:00Z',
    projectId: 'a',
    projectName: 'a',
  })
  assert.deepEqual(read, ['/a r1'], "only the waiting run's diary is read")
  // Where ask is off, nothing says it: the run just ended, and the person replies with a message.
  assert.deepEqual((await build([project('a', '/a')], { prs: noPrs, liveAgents, events })).items, [])
})

test('a session with no project that waits on its question is in the list too, and its sessions are read whole', async () => {
  const liveAgents = async (cwd: string): Promise<AgentMeta[]> => (cwd === '/sessions' ? [live(runningAgentMeta({ id: 's1', status: 'waiting', title: 'Greeting exchange' }))] : [])
  const events = async () => waitingOn('gate-1', 'What would you like to do?')
  const { items, whole } = await buildWaiting([project('a', '/a')], waitingDeps({ prs: noPrs, liveAgents, events, hooks: withAsk }), SESSIONS)

  assert.deepEqual(items, [
    { kind: 'waiting', module: 'ask', scope: 'run', run: 's1', id: 's1:gate-1', words: 'Needs answer', title: 'Greeting exchange', detail: 'What would you like to do?', mark: 'question', since: '2026-07-16T00:00:00Z', projectId: 'session', projectName: '' },
  ])
  // Read whole, so a notification says a session's question as it says a project's.
  assert.deepEqual(whole, ['a', 'session'])
  // No sessions home named: the projects alone.
  assert.deepEqual((await buildWaiting([project('a', '/a')], waitingDeps({ prs: noPrs, liveAgents, events, hooks: withAsk }))).items, [])
})

test('a module is given the runs of its project that wait, newest first, each with its name, when it ended and the questions it still waits on; their diaries read only when it asks', async () => {
  const given: WaitingRun[][] = []
  const asking = (read: boolean) => async (): Promise<Hooks> =>
    createHooks([{ module: defineModule({ name: 'watcher', hooks: { 'app.attention': async ({ waiting }) => (read && given.push(await waiting!()), []) } }) }], { onError: () => {} })
  const liveAgents = async (): Promise<AgentMeta[]> => [
    live(runningAgentMeta({ id: 'r1', status: 'waiting', title: 'Older', startedAt: '2026-07-15T00:00:00Z', endedAt: '2026-07-15T01:00:00Z' })),
    live(runningAgentMeta({ id: 'r2', status: 'running' })),
    live(runningAgentMeta({ id: 'r3', status: 'waiting', startedAt: '2026-07-16T00:00:00Z', updatedAt: '2026-07-16T02:00:00Z' })),
  ]
  const read: string[] = []
  const events = async (_: string, agentId: string) => (read.push(agentId), agentId === 'r1' ? waitingOn('gate-1', 'Ship it?') : undefined)
  await build([project('a', '/a')], { prs: noPrs, liveAgents, events, hooks: asking(true) })
  assert.deepEqual(given, [
    [
      // No name yet, and a diary that cannot be read: it waits on no question it can be asked; it ended when its record last changed.
      { id: 'r3', endedAt: '2026-07-16T02:00:00Z', questions: [] },
      { id: 'r1', name: 'Older', endedAt: '2026-07-15T01:00:00Z', questions: [{ id: 'gate-1', title: 'Ship it?', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] }] },
    ],
  ])
  read.length = 0
  await build([project('a', '/a')], { prs: noPrs, liveAgents, events, hooks: asking(false) })
  assert.deepEqual(read, [], 'a module that does not ask reads no diary')
})

test('runs that cannot be read are no runs that wait: the module asking about them fails, and its project is not read whole', async () => {
  const liveAgents = async (): Promise<AgentMeta[]> => {
    throw new Error('disk gone')
  }
  const { items, whole } = await build([project('a', '/a')], { prs: noPrs, liveAgents, hooks: withAsk })
  assert.deepEqual(items, [])
  assert.deepEqual(whole, [])
})

test('build adds no awaiting item for a run that is not waiting, or whose diary shows no open question', async () => {
  const events = async () => waitingOn('gate-1', 'stale')
  const running = async (): Promise<AgentMeta[]> => [live(runningAgentMeta())]
  assert.deepEqual((await build([project('a', '/a')], { prs: noPrs, liveAgents: running, events, hooks: withAsk })).items, [])
  const waiting = async (): Promise<AgentMeta[]> => [live(runningAgentMeta({ status: 'waiting' }))]
  const answered = async (): Promise<RunEvent[]> => [...waitingOn('gate-1', 'q?'), { kind: 'driver', event: { type: 'start', prompt: 'Yes' } }]
  assert.deepEqual((await build([project('a', '/a')], { prs: noPrs, liveAgents: waiting, events: answered, hooks: withAsk })).items, [])
  const unreadable = async () => undefined
  assert.deepEqual((await build([project('a', '/a')], { prs: noPrs, liveAgents: waiting, events: unreadable, hooks: withAsk })).items, [])
})

test('build surfaces PRs and awaiting runs together, newest first', async () => {
  const prs = async (cwd: string): Promise<OpenPr[]> =>
    cwd === '/a' ? [{ number: 5, title: 'pr', url: 'u5', isDraft: false, createdAt: '2026-07-10T00:00:00Z' }] : []
  const liveAgents = async (cwd: string): Promise<AgentMeta[]> =>
    cwd === '/b' ? [live(runningAgentMeta({ status: 'waiting', updatedAt: '2026-07-16T00:00:00Z' }))] : []
  const { items } = await build([project('a', '/a'), project('b', '/b')], { prs, liveAgents, events: async () => waitingOn('g', 'q?'), hooks: withAsk })
  assert.deepEqual(items.map(i => i.words), ['Needs answer', 'Needs merge']) // the question is newer
})

test("an item's key is its project, its module, and its own id there, else what it is about", () => {
  const item = (over: Partial<Waiting>): Waiting => ({ kind: 'waiting', module: 'github', scope: 'project', words: 'Needs merge', projectId: 'a', projectName: 'a', ...over })
  assert.equal(waitingKey(item({ id: 'https://gh/pr/1' })), 'a:github:https://gh/pr/1')
  assert.equal(waitingKey(item({ module: 'tickets', scope: 'run', run: 'r1' })), 'a:tickets:run:r1')
  // A question with no time of its own has the id `question` in every run, so two agents parked in one project would share
  // an identity without the run in the question's id — and the dedupe would announce only one of them.
  const parked = item({ module: 'ask', scope: 'run' })
  assert.notEqual(waitingKey({ ...parked, run: 'r1', id: 'r1:question' }), waitingKey({ ...parked, run: 'r2', id: 'r2:question' }))
})

test("a run's second question is a new key: each question is the one asked at its own line", () => {
  // As ask says it: the run, and the question it asks now.
  const keys = (lines: AnyDiaryLine[]): string[] =>
    pendingChoices(eventsOf(lines)).map(choice => waitingKey({ projectId: 'p', module: 'ask', scope: 'run', run: 'r1', id: `r1:${choice.id}` }))
  const first = { kind: 'question', title: 'Which way?', options: [{ id: 'a', label: 'Left' }], at: '2026-11-15T10:00:00.000Z' }
  const second = { kind: 'question', title: 'Which colour?', options: [{ id: 'b', label: 'Blue' }], at: '2026-11-15T10:05:00.000Z' }
  const answered = [first, { kind: 'said', text: 'Going left.', at: '2026-11-15T10:01:00.000Z' }]
  const asked = keys([first])
  assert.equal(asked.length, 1)
  assert.deepEqual(keys(answered), [])
  const again = keys([...answered, second])
  assert.equal(again.length, 1)
  assert.notEqual(again[0], asked[0])
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
    bring: unused,
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
  const { items } = await build(
    [project('a', '/a')],
    onlyUnpushed([doneMeta()], counting(branch => waiting({ branch, ahead: 2 }))),
  )

  assert.equal(items.length, 1)
  assert.deepEqual(items[0], {
    kind: 'waiting',
    module: 'git-branches',
    scope: 'run',
    run: 'r1',
    id: 'unpushed:r1',
    // The project has no git host: its next step is a push.
    words: 'Needs push',
    detail: '2 commits',
    mark: 'branch',
    title: 'add the cart',
    since: '2026-07-16T01:00:00Z',
    projectId: 'a',
    projectName: 'a',
  })
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
    const { items } = await build(
      [project('a', '/a')],
      onlyUnpushed([doneMeta()], counting(branch => (over ? waiting({ branch, ...over }) : undefined))),
    )
    assert.deepEqual(items, [], `should not be surfaced: ${why}`)
  }
})

test('a still-running run is not unpushed work (#860)', async () => {
  // It is still writing; the overview already shows it.
  const { items } = await build(
    [project('a', '/a')],
    onlyUnpushed([doneMeta({ status: 'running' })], counting(branch => waiting({ branch }))),
  )
  assert.deepEqual(items, [])
})

test('a finished run continued, working again in its checkout, is not unpushed work until its turn ends (#768)', async () => {
  // Its record still says how its first leg ended; its checkout's card says it works again, as the list of runs shows it.
  const recorded = doneMeta()
  const read = (status: AgentMeta['status']) =>
    build([project('a', '/a')], { ...onlyUnpushed([recorded], counting(branch => waiting({ branch }))), liveAgents: async () => [{ ...recorded, status }] })
  assert.deepEqual((await read('running')).items, [])
  assert.deepEqual((await read('done')).items.map(i => [i.id, i.run]), [['unpushed:r1', 'r1']], 'and listed once, ended again')
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
    bring: async () => ({ ok: false, error: 'no' }),
    remove: async () => ({ ok: false, error: 'no' }),
  })
  const { items, whole } = await build([project('a', '/a')], onlyUnpushed([doneMeta()], failing))
  assert.deepEqual(items, [])
  assert.deepEqual(whole, [])
})

test('a project with no branches provider has nothing unpushed (#1774)', async () => {
  const { items, whole } = await build([project('a', '/a')], onlyUnpushed([doneMeta()], async () => undefined))
  assert.deepEqual(items, [])
  assert.deepEqual(whole, ['a'])
})

test('every finished run is asked, the oldest too, in one read (#860)', async () => {
  // The read counts commits and lists no file, so the whole history fits in one process on a poll.
  const agents = Array.from({ length: 12 }, (_, i) =>
    doneMeta({ id: `r${i}`, startedAt: `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00Z`, branch: `agent-b${i}` }),
  )
  const asked: string[][] = []
  const { items } = await build([project('a', '/a')], onlyUnpushed(agents, counting(branch => waiting({ branch }), asked)))

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
  const { items } = await build(
    [project('a', '/a')],
    onlyUnpushed(agents, counting((branch, from) => waiting({ branch, ahead: from === 'c0ffee' || branch !== 'agent-based' ? 1 : 2 }), asked, askedFrom)),
  )
  assert.deepEqual(new Map(asked.map((branches, i) => [askedFrom[i], branches])), new Map([['c0ffee', ['agent-based']], [undefined, ['agent-plain-1', 'agent-plain-2']]]), 'the based run asked on its own, the others in one read')
  assert.deepEqual(items.map(i => [i.run, i.detail]).sort(), [['r1', '1 commit'], ['r2', '1 commit'], ['r3', '1 commit']])
})

test('a finished run that left files uncommitted is "not committed", even with commits or a pull request; one waiting on its question is not', async () => {
  const left = (over: Partial<AgentMeta> = {}) =>
    build([project('a', '/a')], onlyUnpushed([doneMeta(over)], counting(branch => waiting({ branch, ahead: 3, uncommitted: 2 }))))
  const { items } = await left()
  assert.deepEqual(items.map(i => [i.id, i.words, i.detail, i.mark, i.run]), [['uncommitted:r1', 'Needs commit', '2 files', 'changes', 'r1']], 'committing is the next step, so it is the one item')
  const withPr = await left({ pr: { number: 7, url: 'u7' } })
  assert.deepEqual(withPr.items.map(i => i.words), ['Needs commit'])
  const parked = await left({ status: 'waiting' })
  assert.deepEqual(parked.items.map(i => i.words), ['Needs push'], 'its question is its next step; its commits still wait')
})

test('a run waits on one step at a time: files left uncommitted after its request opened, then its merge', async () => {
  const open = async (): Promise<OpenPr[]> => [{ number: 4, title: 'Add the cart', url: 'u4', isDraft: false, headRefName: 'agent-add-cart', createdAt: '2026-07-16T00:30:00Z' }]
  const left = (uncommitted: number) => build([project('a', '/a')], { ...onlyUnpushed([doneMeta({ pr: { number: 4, url: 'u4' } })], counting(branch => waiting({ branch, ahead: 0, pushed: true, uncommitted }))), prs: open })
  assert.deepEqual((await left(3)).items.map(i => [i.run, i.words, i.detail]), [['r1', 'Needs commit', '3 files']], 'one row, and the notification of it says what the row says')
  assert.deepEqual((await left(0)).items.map(i => [i.run, i.words, i.detail]), [['r1', 'Needs merge', '#4']])
})

test('a run waiting on its question waits on that first, though its request is open', async () => {
  const liveAgents = async (): Promise<AgentMeta[]> => [live(runningAgentMeta({ status: 'waiting', branch: 'agent-add-cart' }))]
  const prs = async (): Promise<OpenPr[]> => [{ number: 4, title: 'Add the cart', url: 'u4', isDraft: false, headRefName: 'agent-add-cart' }]
  const { items } = await build([project('a', '/a')], { prs, liveAgents, events: async () => waitingOn('gate-1', 'q?'), hooks: withAsk, branches: async () => undefined })
  assert.deepEqual(items.map(i => [i.run, i.words]), [['r1', 'Needs answer']])
})

test('an open request a run opened opens that run: by the request its record names, else by its branch; one opened anywhere else names no run', async () => {
  const prs = async (): Promise<OpenPr[]> => [
    { number: 6, title: 'recorded', url: 'u6', isDraft: false, headRefName: 'agent-other-name' },
    { number: 7, title: 'by branch', url: 'u7', isDraft: false, headRefName: 'agent-seven' },
    { number: 8, title: 'elsewhere', url: 'u8', isDraft: false, headRefName: 'claude/elegant-maxwell' },
  ]
  const agents = [doneMeta({ id: 'r6', branch: 'agent-six', pr: { number: 6, url: 'u6' } }), doneMeta({ id: 'r7', branch: 'agent-seven' })]
  const { items } = await build([project('a', '/a')], { prs, liveAgents: noAgents, agents: async () => agents, branches: async () => undefined })
  assert.deepEqual(items.map(i => [i.detail, i.scope, i.run]), [['#6', 'run', 'r6'], ['#7', 'run', 'r7'], ['#8', 'project', undefined]])
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
  const read = build([project('a', '/a'), project('b', '/b')], { prs, liveAgents: noAgents, agents: async () => [] })
  await Promise.race([read, new Promise((_, reject) => setTimeout(() => reject(new Error('the second project waited for the first')), 1000))])
  assert.equal(started, 2)
})

test('a checkout\'s uncommitted files are the newest run\'s on its branch: a run continued on an earlier one\'s branch does not charge the earlier one', async () => {
  const earlier = doneMeta({ id: 'r1', startedAt: '2026-07-16T00:00:00Z' })
  const later = (status: AgentMeta['status']) => doneMeta({ id: 'r2', status, startedAt: '2026-07-16T02:00:00Z' })
  const read = (agents: AgentMeta[]) => build([project('a', '/a')], onlyUnpushed(agents, counting(branch => waiting({ branch, ahead: 0, uncommitted: 2 }))))
  assert.deepEqual((await read([earlier, later('running')])).items, [], 'the later run is still working in it')
  assert.deepEqual((await read([earlier, later('done')])).items.map(i => [i.id, i.run]), [['uncommitted:r2', 'r2']])
})

test('a provider that does not answer for every branch asked is a read that failed, never "nothing waits"', async () => {
  const { items, whole } = await build([project('a', '/a')], onlyUnpushed([doneMeta()], counting(() => undefined)))
  assert.deepEqual(items, [])
  assert.deepEqual(whole, [], 'so the notifier does not take it for a baseline')
})

test('work left on the machine keys on the run and on what it needs, so each notifies once, and anew once committed (#860)', async () => {
  const read = (uncommitted: number) => build([project('p', '/p')], onlyUnpushed([doneMeta()], counting(branch => waiting({ branch, uncommitted }))))
  const [left] = (await read(2)).items
  const [committed] = (await read(0)).items
  assert.equal(waitingKey(left!), 'p:git-branches:uncommitted:r1')
  assert.equal(waitingKey(committed!), 'p:git-branches:unpushed:r1')
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
  const { items } = await build([project('a', '/a')], { prs, liveAgents: noAgents, agents: async () => [recorded] })
  assert.deepEqual(items.map(i => i.detail), ['#9'])
  const { items: live } = await build([project('a', '/a')], { prs, liveAgents: async () => [{ ...recorded, status: 'running' }], agents: async () => [] })
  assert.deepEqual(live.map(i => i.detail), ['#9'], 'a running agent\'s draft counts too')
  const { items: nobody } = await build([project('a', '/a')], { prs, liveAgents: noAgents, agents: async () => [] })
  assert.deepEqual(nobody, [], 'a draft on a branch no run names is hand-made')
})

test('a draft with no branch recorded is still treated as hand-made (#1102)', async () => {
  // `headRefName` is new: an older gh, or a lookup that did not ask for it, must not turn every
  // draft in the repo into a "needs you".
  const prs = async (): Promise<OpenPr[]> => [{ number: 11, title: 'wip', url: 'u11', isDraft: true }]
  const { items } = await build([project('a', '/a')], { prs, liveAgents: noAgents, agents: async () => [] })
  assert.deepEqual(items, [])
})

test('unpushed work is titled by the run\'s own name, else what was asked, else the branch', async () => {
  const both = await build([project('p', '/p')], onlyUnpushed([doneMeta({ title: 'Cart page' })], counting(branch => waiting({ branch }))))
  assert.deepEqual(both.items.map(i => i.title), ['Cart page'], 'the name the sidebar shows, not the prompt')
  const { intent: _intent, ...unasked } = doneMeta({ branch: 'agent-fix-login' })
  const named = await build([project('p', '/p')], onlyUnpushed([{ ...unasked, title: 'Fix the login' }], counting(branch => waiting({ branch }))))
  assert.deepEqual(named.items.map(i => [i.words, i.title]), [['Needs push', 'Fix the login']])
  const plain = await build([project('p', '/p')], onlyUnpushed([unasked], counting(branch => waiting({ branch }))))
  assert.deepEqual(plain.items.map(i => i.title), ['agent-fix-login'], 'no name: the branch as it is')
})

test('every row goes by the name the sidebar shows: a request a run opened by that run\'s, one opened elsewhere by its own title', async () => {
  const prs = async (): Promise<OpenPr[]> => [
    { number: 6, title: 'Add the cart page', url: 'u6', isDraft: false },
    { number: 8, title: 'Bump deps', url: 'u8', isDraft: false },
  ]
  const agents = [doneMeta({ id: 'r6', title: 'Cart page', pr: { number: 6, url: 'u6' } })]
  const { items } = await build([project('a', '/a')], { prs, liveAgents: noAgents, agents: async () => agents, branches: async () => undefined })
  assert.deepEqual(items.map(i => [i.detail, i.title]), [['#6', 'Cart page'], ['#8', 'Bump deps']])
})

test('unpushed work says whether the project can open a pull request, so the row asks for one or for a push', async () => {
  const withHost = await build([{ ...project('p', '/p'), gitHost: true }], onlyUnpushed([doneMeta()], counting(branch => waiting({ branch }))))
  assert.deepEqual(withHost.items.map(i => i.words), ['Needs PR'])
  const without = await build([project('p', '/p')], onlyUnpushed([doneMeta()], counting(branch => waiting({ branch }))))
  assert.deepEqual(without.items.map(i => i.words), ['Needs push'])
})

test('a pushed branch with no pull request still needs one where the project opens pull requests', async () => {
  const pushed = counting(branch => waiting({ branch, ahead: 2, pushed: true }))
  const host = { ...project('p', '/p'), gitHost: true }
  const read = (over: { gitHost?: boolean; prs?: () => Promise<OpenPr[]>; meta?: Partial<AgentMeta> }) =>
    build([over.gitHost === false ? project('p', '/p') : host], { ...onlyUnpushed([doneMeta(over.meta)], pushed), ...(over.prs ? { prs: over.prs } : {}) })
  assert.deepEqual((await read({})).items.map(i => [i.words, i.detail]), [['Needs PR', '2 commits']], 'Open PR pushed it, then the request failed')
  const open = async (): Promise<OpenPr[]> => [{ number: 4, title: 'Add the cart', url: 'u4', isDraft: false, headRefName: 'agent-add-cart' }]
  assert.deepEqual((await read({ prs: open })).items.map(i => i.words), ['Needs merge'], 'its open request is what waits')
  assert.deepEqual((await read({ meta: { publish: 'branch' } })).items, [], 'started to go no further than its branch')
  assert.deepEqual((await read({ gitHost: false })).items, [], 'no git host: the push was the last step')
  const unreadable = await read({ prs: () => Promise.reject(new Error('gh: not logged in')) })
  assert.deepEqual([unreadable.items, unreadable.whole], [[], []], 'the requests could not be read: nothing is said of the branch')
})

// What the modules say waits on the person (`app.attention`), beside what the shell finds itself (#2394).

/** A distribution of one module whose `app.attention` answers `say` for a project. */
const saying = (say: (project: string | undefined) => AttentionItem[] | Promise<AttentionItem[]>): (() => Promise<Hooks>) => {
  const hooks = createHooks([{ module: defineModule({ name: 'tickets', hooks: { 'app.attention': ({ project }) => say(project?.id) } }) }], { onError: () => {} })
  return async () => hooks
}

test("a module's waiting items join the shell's, each in its project; what is to set up is not waiting", async () => {
  const hooks = saying(project => [
    { kind: 'waiting', scope: 'project', id: 'triage', words: 'Needs triage', title: `New tickets in ${project}`, since: '2026-07-20T00:00:00Z' },
    { kind: 'setup', scope: 'computer', words: 'Chrome is missing' },
  ])
  const prs = async (): Promise<OpenPr[]> => [{ number: 5, title: 'pr', url: 'u5', isDraft: false, createdAt: '2026-07-10T00:00:00Z' }]
  const { items, whole } = await build([project('a', '/a')], { prs, liveAgents: noAgents, hooks })
  assert.deepEqual(
    items.map(i => [i.module, i.words, i.title, i.projectId]),
    [
      ['tickets', 'Needs triage', 'New tickets in a', 'a'],
      ['github', 'Needs merge', 'pr', 'a'],
    ],
  )
  assert.deepEqual(whole, ['a'])
})

test('a module that cannot say what waits leaves its project not read whole, and the rest is still listed', async () => {
  const hooks = saying(() => {
    throw new Error('no tickets today')
  })
  const prs = async (): Promise<OpenPr[]> => [{ number: 5, title: 'pr', url: 'u5', isDraft: false }]
  const { items, whole } = await build([project('a', '/a')], { prs, liveAgents: noAgents, hooks })
  assert.deepEqual(items.map(i => i.detail), ['#5'])
  assert.deepEqual(whole, [], 'so the notifier does not take its silence for a baseline')
})

test('two checkouts of one repository list what waits on a run once, and what waits on each project in each (#1554, #2394)', async () => {
  // They share the records, so a module that reads them finds the same run in both.
  const hooks = saying(project => [
    { kind: 'waiting', scope: 'run', run: 'run-web', id: 'run-web:Where?', words: 'Needs answer', title: 'CI checks', since: '2026-11-19T10:00:00Z' },
    { kind: 'waiting', scope: 'project', id: 'triage', words: 'Needs triage', title: `New tickets in ${project}`, since: '2026-11-19T09:00:00Z' },
  ])
  const { items } = await build([project('p1', '/one'), project('p2', '/two')], { prs: async () => [], liveAgents: noAgents, hooks })
  assert.deepEqual(
    items.map(i => [i.title, i.projectId]),
    [
      ['CI checks', 'p1'],
      ['New tickets in p1', 'p1'],
      ['New tickets in p2', 'p2'],
    ],
  )
})
