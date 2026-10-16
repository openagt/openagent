import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import { findAgent, listAgents, loadAgentEvents, readAllAgents, readDoing, readFinishedDiary, readLiveMeta, readLiveMetas, type StoreFs } from './agent-store.js'
import { agentIdFromStartedAt, startedAtFromAgentId } from '../agent-id.js'
import { noRuns } from './runs.js'
import { testRuns } from './test-runs.js'
import { testBranches } from './test-branches.js'
import type { Checkout } from './branches.js'

// The store reads a project's runs from two places (#1774): a run's live card and diary in its own
// checkout, written by the run's tool, and the finished runs the project's runs provider answers.

/** An in-memory {@link StoreFs} so the store logic is tested without touching disk. */
function memFs(seed: Record<string, string> = {}): StoreFs & { files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(seed))
  return {
    files,
    async read(path) {
      const v = files.get(path)
      if (v === undefined) throw new Error(`ENOENT: ${path}`)
      return v
    },
    async write(path, contents) {
      files.set(path, contents)
    },
    async append(path, contents) {
      files.set(path, (files.get(path) ?? '') + contents)
    },
    async exists(path) {
      return files.has(path)
    },
    async mkdir() {
      // no-op: the memory fs has no directories
    },
    async readdir(dir) {
      // Derive children from the flat path map: file basenames whose dirname is `dir`, plus
      // the first segment of anything deeper.
      const prefix = dir.endsWith('/') ? dir : dir + '/'
      const names = new Set<string>()
      for (const p of files.keys()) {
        if (!p.startsWith(prefix)) continue
        const rest = p.slice(prefix.length)
        const head = rest.split('/')[0]
        if (head) names.add(head)
      }
      return [...names]
    },
  }
}

const AT = '2026-07-04T00:00:00.000Z'
const CWD = '/ws'

/** A run's checkout, as the project's branches provider lists it. */
const checkoutOf = (id: string, branch?: string): Checkout => ({ id, path: join(CWD, '.branches', `agent-${id}`), ...(branch ? { branch } : {}) })
/** A file of a run's live record, in the run's own checkout. */
const liveAt = (id: string, ext: string) => join(checkoutOf(id).path, '.openagent', `${id}.${ext}`)
/** The project's branches provider, listing the given checkouts. */
const branchesOf = (...checkouts: Checkout[]) => testBranches({ [CWD]: checkouts })
const card = (id: string, status: string, more: Record<string, unknown> = {}) => JSON.stringify({ id, startedAt: AT, status, ...more })

test('listAgents lists the finished runs the provider answers, newest first, each card unfolded into the meta', async () => {
  const runs = testRuns({
    [CWD]: [
      { card: { id: 'r1', status: 'done', intent: 'a blog', cost: 0.5, caller: { pid: 9, kind: 'build' } } },
      { card: { id: 'r3', status: 'failed' } },
      { card: { id: 'r2', status: 'waiting' } },
    ],
  })
  const listed = await listAgents(CWD, runs)
  assert.deepEqual(listed.map(agent => [agent.id, agent.status]), [['r3', 'failed'], ['r2', 'waiting'], ['r1', 'done']])
  const r1 = listed.find(agent => agent.id === 'r1')!
  assert.equal(r1.intent, 'a blog')
  assert.equal(r1.cost, 0.5)
  assert.equal(r1.pid, 9, 'caller unfolds into the meta')
  assert.deepEqual(await listAgents(CWD, noRuns), [], 'a project with no runs provider has no finished runs')
  assert.deepEqual(await listAgents(CWD, async () => ({ ...(await runs(CWD))!, list: () => Promise.reject(new Error('boom')) })), [], 'nor does one whose provider fails')
})

test('a `since` keeps the runs started at or after it (#1607)', async () => {
  const at = (iso: string) => ({ card: { id: agentIdFromStartedAt(iso), startedAt: iso, status: 'done' as const } })
  const recent = agentIdFromStartedAt('2026-07-06T00:00:00.000Z')
  const runs = testRuns({ [CWD]: [at('2026-07-04T00:00:00.000Z'), at('2026-07-06T00:00:00.000Z')] })
  assert.deepEqual((await listAgents(CWD, runs, { since: Date.parse('2026-07-05T00:00:00.000Z') })).map(agent => agent.id), [recent])
})

test('readLiveMeta reads a checkout\'s card as the meta; a checkout with no card and a card that does not parse are no run', async () => {
  const fs = memFs({
    [liveAt('r1', 'json')]: card('r1', 'running', { intent: 'a blog', caller: { pid: 4242, host: 'this-box' } }),
    [liveAt('r2', 'json')]: '{"id":',
  })
  const meta = await readLiveMeta(checkoutOf('r1'), fs)
  assert.equal(meta?.id, 'r1')
  assert.equal(meta?.status, 'running')
  assert.equal(meta?.pid, 4242)
  assert.equal(meta?.host, 'this-box')
  assert.equal(await readLiveMeta(checkoutOf('r2'), fs), undefined)
  assert.equal(await readLiveMeta(checkoutOf('r3'), fs), undefined)
})

test('readLiveMeta gives a checkout\'s run the branch the checkout is on now, as the provider lists it: the agent renames it while the card keeps the first name', async () => {
  const fs = memFs({ [liveAt('r1', 'json')]: card('r1', 'running', { branch: 'agent-r1' }) })
  assert.equal((await readLiveMeta(checkoutOf('r1', 'agent-add-comments'), fs))?.branch, 'agent-add-comments')
  // A checkout the provider lists on no branch leaves the card's branch.
  assert.equal((await readLiveMeta(checkoutOf('r1'), fs))?.branch, 'agent-r1')
})

test('readLiveMeta never ends a run whose process is gone: the tool that started it sweeps its own', async () => {
  const fs = memFs({ [liveAt('r1', 'json')]: card('r1', 'running', { caller: { pid: 2 ** 22 - 1, host: 'this-box' } }) })
  const before = fs.files.get(liveAt('r1', 'json'))
  assert.equal((await readLiveMeta(checkoutOf('r1'), fs))?.status, 'running')
  assert.equal(fs.files.get(liveAt('r1', 'json')), before, 'a read writes nothing')
  assert.equal(fs.files.size, 1)
})

test('readLiveMetas finds the run in each checkout the branches provider lists, newest first, a waiting one too; a checkout with no card is skipped (#738/#1774)', async () => {
  const fs = memFs({
    [liveAt('r1', 'json')]: card('r1', 'running'),
    [liveAt('r2', 'json')]: card('r2', 'waiting'),
  })
  // The provider lists a third checkout whose tool has not written the card yet: not a run to show.
  const branches = branchesOf(checkoutOf('r1', 'agent-r1'), checkoutOf('r2'), checkoutOf('r3'))
  assert.deepEqual(
    (await readLiveMetas(CWD, fs, branches)).map(r => ({ id: r.id, status: r.status, cwd: r.cwd, branch: r.branch })),
    [
      { id: 'r2', status: 'waiting', cwd: join(CWD, '.branches', 'agent-r2'), branch: undefined },
      { id: 'r1', status: 'running', cwd: join(CWD, '.branches', 'agent-r1'), branch: 'agent-r1' },
    ],
  )
  assert.deepEqual(await readLiveMetas(CWD, fs, branchesOf()), [], 'a provider listing no checkout')
  assert.deepEqual(await readLiveMetas(CWD, fs, testBranches({})), [], 'a project with no branches provider has no checkouts, whatever is on disk')
})

test('readAllAgents and findAgent: the checkout\'s card wins over the record of the same run (#768)', async () => {
  // A resumed run has a record from its first leg and is going again in its checkout.
  const fs = memFs({ [liveAt('r1', 'json')]: card('r1', 'running') })
  const branches = branchesOf(checkoutOf('r1'))
  const runs = testRuns({ [CWD]: [{ card: { id: 'r1', status: 'waiting', pr: { number: 7, url: 'https://x/pull/7' } } }, { card: { id: 'r0', status: 'done' } }] })
  assert.deepEqual((await readAllAgents(CWD, fs, runs, branches)).map(agent => [agent.id, agent.status]), [['r1', 'running'], ['r0', 'done']])
  assert.equal((await findAgent(CWD, 'r1', fs, runs, branches))?.status, 'running')
  // The record's pull request rides onto the checkout's card: the dashboard's Open PR writes it there, never on the card.
  assert.deepEqual((await findAgent(CWD, 'r1', fs, runs, branches))?.pr, { number: 7, url: 'https://x/pull/7' })
  assert.equal((await findAgent(CWD, 'r0', fs, runs, branches))?.status, 'done')
  assert.equal(await findAgent(CWD, 'nope', fs, runs, branches), undefined)
  // No runs provider: only the runs with a checkout.
  assert.deepEqual((await readAllAgents(CWD, fs, noRuns, branches)).map(agent => agent.id), ['r1'])
})

test('loadAgentEvents replays a run\'s diary as OpenAgent\'s events: the checkout\'s while it has one, else the finished run\'s (#1769)', async () => {
  const diary = [{ kind: 'said', text: 'Reading.' }, { kind: 'result', text: 'Done.', sessionId: 's1' }, { kind: 'cost', usd: 0.5 }, { kind: 'ended', status: 'failed', detail: 'API 500' }]
  const recorded = diary.map(line => JSON.stringify(line)).join('\n') + '\n'
  const fs = memFs()
  const branches = branchesOf(checkoutOf('r1'))
  const runs = testRuns({ [CWD]: [{ card: { id: 'r1', status: 'failed' }, diary }] })
  assert.deepEqual(await loadAgentEvents(CWD, 'r1', fs, runs, branches), [
    { kind: 'driver', event: { type: 'text', text: 'Reading.' } },
    { kind: 'driver', event: { type: 'result', text: 'Done.', sessionId: 's1' } },
    { kind: 'usage', costUsd: 0.5 },
    { kind: 'end', ok: false, detail: 'API 500' },
  ])

  // The same run going again: its checkout holds the newer diary, a question a turn ended on and a
  // line torn by a write in flight, which is dropped.
  fs.files.set(liveAt('r1', 'json'), card('r1', 'running'))
  fs.files.set(liveAt('r1', 'jsonl'), recorded + '{"kind":"question","title":"Which way?","options":[{"id":"a","label":"Left"}]}\n{"kind":"ended","status":"waiting"}\n{"kind":"sa')
  const live = await loadAgentEvents(CWD, 'r1', fs, runs, branches)
  assert.deepEqual(live?.slice(4), [
    { kind: 'choice', id: 'await-choices', title: 'Which way?', options: [{ id: 'a', label: 'Left' }] },
    { kind: 'end', ok: false, waiting: true },
  ])

  assert.equal(await loadAgentEvents(CWD, 'unknown', fs, runs, branches), undefined)
  assert.equal(await loadAgentEvents(CWD, '../escape', fs, runs, branches), undefined)
  assert.equal(await loadAgentEvents(CWD, 'r0', memFs(), noRuns, branches), undefined, 'no provider: a finished run has no diary')
})

test('readFinishedDiary is the finished run\'s whole diary, and nothing for an unknown run, an unsafe id or a project with no provider', async () => {
  const runs = testRuns({ [CWD]: [{ card: { id: 'r1', status: 'done' }, diary: [{ kind: 'session', driver: 'claude-code' }, { kind: 'said', text: 'hi' }] }] })
  assert.deepEqual(await readFinishedDiary(CWD, 'r1', runs), [{ kind: 'session', driver: 'claude-code' }, { kind: 'said', text: 'hi' }])
  assert.equal(await readFinishedDiary(CWD, 'r2', runs), undefined)
  assert.equal(await readFinishedDiary(CWD, '../escape', runs), undefined)
  assert.equal(await readFinishedDiary(CWD, 'r1', noRuns), undefined)
})

test('startedAtFromAgentId inverts agentIdFromStartedAt, and refuses foreign ids (#1251)', () => {
  const startedAt = '2026-07-26T21:17:39.507Z'
  assert.equal(startedAtFromAgentId(agentIdFromStartedAt(startedAt)), startedAt)
  assert.equal(startedAtFromAgentId('not-a-run-id'), undefined)
  assert.equal(startedAtFromAgentId(''), undefined)
})

test('readDoing says what each named working run is doing: the last tool its diary names, or the last thing it said, on one line, and the last tool and how many calls it made', async () => {
  const line = (value: object) => JSON.stringify(value) + '\n'
  const fs = memFs({
    [liveAt('r1', 'json')]: card('r1', 'running'),
    [liveAt('r1', 'jsonl')]: line({ kind: 'start', prompt: 'do it' }) + line({ kind: 'action', label: 'Read', detail: 'a.ts' }) + line({ kind: 'action', label: 'Edit', detail: 'src/\n  login.ts' }) + line({ kind: 'cost', usd: 1 }),
    [liveAt('r2', 'json')]: card('r2', 'running'),
    [liveAt('r2', 'jsonl')]: line({ kind: 'action', label: 'Bash' }) + line({ kind: 'said', text: 'x'.repeat(200) }) + '{"kind":"action","la',
    [liveAt('r3', 'json')]: card('r3', 'waiting'),
    [liveAt('r3', 'jsonl')]: line({ kind: 'action', label: 'Read', detail: 'b.ts' }),
    [liveAt('r4', 'json')]: card('r4', 'running'),
    [liveAt('r4', 'jsonl')]: line({ kind: 'action', label: 'Read', detail: 'c.ts' }),
    [liveAt('r5', 'json')]: card('r5', 'running'),
    [liveAt('r6', 'json')]: card('r6', 'running'),
    [liveAt('r6', 'jsonl')]: line({ kind: 'start', prompt: 'do it' }),
  })
  const branches = branchesOf(checkoutOf('r1'), checkoutOf('r2'), checkoutOf('r3'), checkoutOf('r4'), checkoutOf('r5'), checkoutOf('r6'))
  const doing = await readDoing(CWD, ['r1', 'r2', 'r3', 'r5', 'r6', 'gone'], fs, branches)
  assert.deepEqual(Object.keys(doing).sort(), ['r1', 'r2'], 'not a run that is not working, one not asked for, one with no diary, or one that did nothing yet')
  assert.deepEqual(doing['r1'], { doing: 'Edit src/ login.ts', tool: 'Edit', calls: 2 }, 'the last tool, with what, on one line; the last tool alone; and how many calls')
  assert.deepEqual(doing['r2'], { doing: 'x'.repeat(139) + '…', tool: 'Bash', calls: 1 }, 'the last thing said, cut to a line; a torn last line is passed over')
  assert.deepEqual(await readDoing(CWD, [], fs, branches), {})
})
