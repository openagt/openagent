import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { LOCAL_HOST, type RunEvent, type RunHost, type RunSummary } from '@openagt/hooks'
import { fakeHost } from '@openagt/hooks/testing'
import { eventsOf, type AnyDiaryLine } from '@openagt/agent-driver'
import { doingOf, metaOf, readRun, readRunEvents, readRuns, type RunHosts } from './runs.js'
import { agentIdFromStartedAt, startedAtFromAgentId } from '../agent-id.js'

const summary = (id: string, over: Partial<RunSummary> = {}): RunSummary => ({ id, host: LOCAL_HOST, status: 'done', startedAt: '2026-07-04T00:00:00.000Z', prompt: 'fix it', ...over })

/** A host that lists `runs`. */
function listing(id: string, runs: RunSummary[]): RunHost {
  return { ...fakeHost({ id }), list: async (_project, wanted = {}) => runs.filter(run => !wanted.ids || wanted.ids.includes(run.id)) }
}

const hostsOf = (...hosts: RunHost[]): RunHosts => ({ local: LOCAL_HOST, of: async () => hosts })

test('a run as its host says it, in the page shape: its record\'s facts and options where the pages read them, its agent session\'s command, the host beside this computer\'s it is on', () => {
  const run = summary('r1', {
    status: 'working',
    endedAt: undefined as never,
    computer: 'laptop',
    person: 'me@x.org',
    agent: { id: 'claude-code', model: 'opus', effort: 'high' },
    options: { publish: 'pr', 'git-branches': { base: 'origin/develop', repos: [{ name: 'app', from: '/me/app' }] }, github: { prBase: 'main', account: 'me' } },
    facts: { 'git-branches': { branch: 'agent-x', baseCommit: 'c0ffee', landed: 'beef' }, github: { pr: { number: 7, url: 'u7' }, earlierPrs: [{ number: 6, url: 'u6' }] } },
    session: { id: 's-1', resume: 'claude --resume s-1' },
    saving: true,
    cost: 0.5,
    contextTokens: 1000,
    title: 'Fix the login',
    naming: true,
  })
  const { endedAt: _, ...working } = run
  assert.deepEqual(metaOf(working, LOCAL_HOST), {
    id: 'r1',
    status: 'running',
    startedAt: '2026-07-04T00:00:00.000Z',
    updatedAt: '2026-07-04T00:00:00.000Z',
    cost: 0.5,
    host: 'laptop',
    person: 'me@x.org',
    intent: 'fix it',
    title: 'Fix the login',
    naming: true,
    base: 'develop',
    baseCommit: 'c0ffee',
    gitAccount: 'me',
    prBase: 'main',
    publish: 'pr',
    landed: 'beef',
    options: run.options,
    driver: 'claude-code',
    model: 'opus',
    effort: 'high',
    contextTokens: 1000,
    branch: 'agent-x',
    pr: { number: 7, url: 'u7' },
    earlierPrs: [{ number: 6, url: 'u6' }],
    resumeCommand: 'claude --resume s-1',
    saving: true,
  })
  // On a host beside this computer's: it says which. Ended: it changed when it ended.
  assert.deepEqual(metaOf(summary('r2', { host: 'web', endedAt: '2026-07-04T01:00:00.000Z' }), LOCAL_HOST), { id: 'r2', status: 'done', startedAt: '2026-07-04T00:00:00.000Z', updatedAt: '2026-07-04T01:00:00.000Z', endedAt: '2026-07-04T01:00:00.000Z', intent: 'fix it', target: 'web' })
})

test("a project's runs are every host's, newest first, one row per run: the first host that has it keeps it; a host that cannot answer has none", async () => {
  const here = listing(LOCAL_HOST, [summary('2026-07-04T00-00-02-000Z'), summary('2026-07-04T00-00-01-000Z', { prompt: 'here' })])
  const web = listing('web', [summary('2026-07-04T00-00-03-000Z', { host: 'web' }), summary('2026-07-04T00-00-01-000Z', { host: 'web', prompt: 'there' })])
  const down: RunHost = { ...fakeHost({ id: 'actions' }), list: async () => Promise.reject(new Error('offline')) }
  const runs = await readRuns(hostsOf(here, web, down), undefined)
  assert.deepEqual(runs.map(run => [run.id, run.intent, run.target]), [
    ['2026-07-04T00-00-03-000Z', 'fix it', 'web'],
    ['2026-07-04T00-00-02-000Z', 'fix it', undefined],
    ['2026-07-04T00-00-01-000Z', 'here', undefined],
  ])
  assert.equal((await readRun(hostsOf(here, web), undefined, '2026-07-04T00-00-03-000Z'))?.target, 'web')
  assert.equal(await readRun(hostsOf(here, web), undefined, 'gone'), undefined)
})

test("a run's events as they are now: what its host streams up to the end-of-replay marker, without the message being written; none from a host that streams none", async () => {
  const host = fakeHost()
  const { id } = await host.start({ prompt: 'p', options: {} })
  host.emit(id, { kind: 'log', message: 'one' })
  host.emit(id, { kind: 'partial', text: 'wri' })
  host.emit(id, { kind: 'stream-sync' })
  host.emit(id, { kind: 'log', message: 'after' })
  assert.deepEqual(await readRunEvents(host, { id }), [{ kind: 'log', message: 'one' }])
  const { events: _, ...silent } = fakeHost()
  assert.equal(await readRunEvents(silent as RunHost, { id }), undefined)
})

test('what a working run is doing, by its events: the last tool it used with what, or the last thing it said, on one line; the last tool, and how many calls it made', () => {
  const doing = (lines: AnyDiaryLine[]) => doingOf(eventsOf(lines) as RunEvent[])
  assert.deepEqual(doing([{ kind: 'start', prompt: 'do it' }, { kind: 'action', label: 'Read', detail: 'a.ts' }, { kind: 'action', label: 'Edit', detail: 'src/\n  login.ts' }, { kind: 'cost', usd: 1 }]), { doing: 'Edit src/ login.ts', tool: 'Edit', calls: 2 })
  assert.deepEqual(doing([{ kind: 'action', label: 'Bash' }, { kind: 'said', text: 'x'.repeat(200) }]), { doing: 'x'.repeat(139) + '…', tool: 'Bash', calls: 1 }, 'the last thing said, cut to a line')
  assert.equal(doing([{ kind: 'start', prompt: 'do it' }]), undefined, 'nothing done yet')
})

test('startedAtFromAgentId inverts agentIdFromStartedAt, and refuses foreign ids (#1251)', () => {
  const startedAt = '2026-07-26T21:17:39.507Z'
  assert.equal(startedAtFromAgentId(agentIdFromStartedAt(startedAt)), startedAt)
  assert.equal(startedAtFromAgentId('not-a-run-id'), undefined)
  assert.equal(startedAtFromAgentId(''), undefined)
})
