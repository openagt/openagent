import { strict as assert } from 'node:assert'
import { mock, test } from 'node:test'
import { join } from 'node:path'
import { mkdtemp, rm, mkdir, writeFile, readFile, realpath, stat } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { sendStop, sendMessage } from './control.js'
import { callModule } from './module-calls.js'
import { onAgents, onWaiting } from './reads.js'
import { listTestProject } from '../test-projects.js'
import { DATA_BRANCH, fileBranchPath, nodeGitRunner, projectId as idFor } from '@openagt/agent-data'
import { worktreePath, addWorktree, agentBranchName } from '@openagt/git-branches'
import { OPENAGENT_DIR } from '../openagent-dir.js'
import { INBOX_FILE, writeRun } from '@openagt/agent-driver'
import { RESUMED_FILE, provideTestContext } from './test-context.js'
import { testPackagesBut, withDistribution } from '../test-distribution.js'
import { STARTING_AT_MOST_MS } from '../starting.js'

// #749, #1774: what is addressed at a RUN has to resolve the run's own checkout, not the project:
// the run's card is there, and so is the inbox its tool reads. Addressed at the project root, a
// message reaches a file nobody reads.
//
// These run against the real registry, pointed at a temp $XDG_CONFIG_HOME so the user's own
// registry is never touched.

const QUESTION = { kind: 'question', title: 'Which way?', options: [{ id: 'a', label: 'Left' }, { id: 'b', label: 'Right' }] }

/**
 * The answer ask's card sends to a run's question, called as the page calls it: done, or why not,
 * in the words ask's server part or the call said it.
 */
async function answer(run: { projectId: string; agentId: string }, question: string, picked: string | string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const called = await callModule(run.projectId, '@openagt/ask', 'answer', { agentId: run.agentId, question, picked })
  if (!called.ok) return called
  const answered = called.output as { ok: true } | { ok: false; error: string }
  return answered.ok ? { ok: true } : answered
}

/** A project with one run in a checkout of its own, and its record unless `record` is false. Returns its ids and the two candidate inbox paths. */
async function projectWithWorktreeAgent(
  owner: { pid: number; host: string } = { pid: 0, host: 'elsewhere' },
  run: { status?: string; diary?: unknown[]; record?: boolean } = {},
): Promise<{
  dir: string
  projectId: string
  agentId: string
  agentInbox: string
  rootInbox: string
  restore: () => void
}> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'openagent-addressing-')))
  const agentId = '2026-07-19T10-00-00-000Z'
  // A real repository with a real checkout: the project's branches provider lists the checkouts (#1774).
  const git = nodeGitRunner()
  await git(['init', '-q'], dir)
  await git(['config', 'user.email', 't@t'], dir)
  await git(['config', 'user.name', 't'], dir)
  await writeFile(join(dir, 'index.html'), '<h1>Hello, world!</h1>\n')
  await git(['add', '-A'], dir)
  await git(['commit', '-q', '-m', 'init'], dir)
  await addWorktree(dir, { agentId, branch: agentBranchName(agentId) }, git)
  const worktree = worktreePath(dir, agentId)
  await mkdir(join(worktree, OPENAGENT_DIR), { recursive: true })
  // The run's card is what readLiveMetas discovers, and its id is what the caller addresses.
  const card = { id: agentId, startedAt: '2026-07-19T10:00:00.000Z', status: run.status ?? 'running', caller: owner }
  await writeFile(join(worktree, OPENAGENT_DIR, `${agentId}.json`), JSON.stringify(card))
  await writeFile(join(worktree, OPENAGENT_DIR, `${agentId}.jsonl`), (run.diary ?? []).map(line => JSON.stringify(line) + '\n').join(''))

  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true })
  // Its record, as its tool keeps it, in the project's data under this config home: what a resume is refused without.
  if (run.record !== false) assert.ok((await writeRun(dir, card as Parameters<typeof writeRun>[1], [])).ok, 'the record landed')
  await listTestProject(dir, new Date().toISOString())
  // The context every RPC reads (D3). In tests it is a global that outlives an await,
  // unlike the request-scoped one a real serve() provides.
  provideTestContext()

  return {
    dir,
    projectId: idFor(dir),
    agentId,
    agentInbox: join(worktree, OPENAGENT_DIR, INBOX_FILE),
    rootInbox: join(dir, OPENAGENT_DIR, INBOX_FILE),
    restore: () => {
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = previous
    },
  }
}

const entries = async (path: string): Promise<unknown[]> =>
  (await readFile(path, 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as unknown)

// Stop is a signal to the process the run's card names, whoever runs the agent. The card here
// names this test process, whose handler catches it.
test('sendStop signals the pid the run\'s card names, and writes nothing', async () => {
  const ctx = await projectWithWorktreeAgent({ pid: process.pid, host: hostname() })
  // A signal watcher does not keep the event loop alive: a bound timer holds it open until the
  // signal lands, and fails the test rather than letting the process drain with the wait pending.
  let signalled!: () => void
  const caught = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no SIGINT within 5s')), 5000)
    signalled = () => {
      clearTimeout(timer)
      resolve()
    }
  })
  const onSignal = (): void => signalled()
  process.on('SIGINT', onSignal)
  try {
    assert.deepEqual(await sendStop(ctx.projectId, ctx.agentId), { ok: true })
    await caught
    assert.deepEqual(await entries(ctx.agentInbox), [], 'a stop is not an inbox line')
    assert.deepEqual(await entries(ctx.rootInbox), [])
  } finally {
    process.off('SIGINT', onSignal)
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('sendStop leaves an agent alone that has ended, whose process is not this machine\'s, or is gone, and says why', async () => {
  const onSignal = (): void => assert.fail('signalled a run that was not this machine\'s live one')
  process.on('SIGINT', onSignal)
  try {
    const ended = await projectWithWorktreeAgent({ pid: process.pid, host: hostname() }, { status: 'done' })
    try {
      assert.deepEqual(await sendStop(ended.projectId, ended.agentId), { ok: false, error: 'It had already ended.' })
    } finally {
      ended.restore()
      await rm(ended.dir, { recursive: true, force: true })
    }
    const elsewhere = await projectWithWorktreeAgent({ pid: process.pid, host: 'another-box' })
    try {
      assert.deepEqual(await sendStop(elsewhere.projectId, elsewhere.agentId), { ok: false, error: 'This run is on another-box.' })
    } finally {
      elsewhere.restore()
      await rm(elsewhere.dir, { recursive: true, force: true })
    }
    // A dead pid on this host: nothing to signal, and nothing thrown.
    const dead = await projectWithWorktreeAgent({ pid: 2 ** 22 - 1, host: hostname() })
    try {
      assert.deepEqual(await sendStop(dead.projectId, dead.agentId), { ok: false, error: 'Its process had already ended.' })
    } finally {
      dead.restore()
      await rm(dead.dir, { recursive: true, force: true })
    }
    await new Promise(r => setTimeout(r, 50))
  } finally {
    process.off('SIGINT', onSignal)
  }
})

// The clock is the test's: the Stop's wait is ticked through, a quarter second at a time, while the
// checkout is read for real between the ticks.
test('sendStop for a run that never writes its card waits as long as a start may take, then returns and signals nothing', async () => {
  const ctx = await projectWithWorktreeAgent({ pid: process.pid, host: hostname() })
  const onSignal = (): void => assert.fail('signalled a run that never wrote a card')
  process.on('SIGINT', onSignal)
  const realTimeout = setTimeout
  const pause = (ms: number) => new Promise(resolve => realTimeout(resolve, ms))
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
  try {
    const pressed = Date.now()
    let returnedAfter: number | undefined
    let answered: unknown
    void sendStop(ctx.projectId, '2026-07-19T11-00-00-000Z').then(said => ((answered = said), (returnedAfter = Date.now() - pressed)))
    // Ticked until it returns, for as long as the real clock allows: each of the host's looks reads git, however long that takes.
    const ticking = performance.now()
    while (returnedAfter === undefined && performance.now() - ticking < 30_000) {
      await pause(20)
      mock.timers.tick(250)
    }
    assert.ok(returnedAfter !== undefined, 'the Stop returned')
    assert.ok(returnedAfter >= STARTING_AT_MOST_MS, `returned after ${returnedAfter} ms, before a start may have ended`)
    assert.deepEqual(answered, { ok: false, error: 'It has not started yet.' })
  } finally {
    mock.timers.reset()
    process.off('SIGINT', onSignal)
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('a message and an answer to a working run are lines in the inbox of the run\'s own checkout (#749/#1774)', async () => {
  // The card names this test process, so the run reads as working; its diary holds the question.
  const ctx = await projectWithWorktreeAgent({ pid: process.pid, host: hostname() }, { diary: [QUESTION] })
  try {
    assert.deepEqual(await sendMessage(ctx.projectId, '  also add tests ', ctx.agentId), { ok: true })
    assert.deepEqual(await answer(ctx, 'question', 'b'), { ok: true })
    assert.deepEqual(await entries(ctx.agentInbox), [
      { kind: 'message', text: 'also add tests' },
      { kind: 'answer', question: 'Which way?', answer: 'Right' },
    ])
    assert.deepEqual(await entries(ctx.rootInbox), [])
    assert.equal(await readFile(join(ctx.dir, RESUMED_FILE), 'utf8').catch(() => ''), '', 'a working run is not resumed')
    assert.deepEqual(await sendMessage(ctx.projectId, '   ', ctx.agentId), { ok: true }, 'an empty message is dropped')
    assert.equal((await entries(ctx.agentInbox)).length, 2)
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test("a message and an answer to an ended run resume it through this computer's host; a run this project has no record of is refused in words", async () => {
  const waiting = await projectWithWorktreeAgent({ pid: 2 ** 22 - 1, host: hostname() }, { status: 'waiting', diary: [QUESTION, { kind: 'ended', status: 'waiting' }] })
  try {
    assert.deepEqual(await answer(waiting, 'question', 'a'), { ok: true })
    assert.deepEqual(await sendMessage(waiting.projectId, 'go on', waiting.agentId), { ok: true })
    assert.equal(await readFile(join(waiting.dir, RESUMED_FILE), 'utf8'), `${waiting.agentId}||Left\n${waiting.agentId}|go on|\n`)
    assert.deepEqual(await entries(waiting.agentInbox), [], 'nothing waits in an inbox nobody reads')
  } finally {
    waiting.restore()
    await rm(waiting.dir, { recursive: true, force: true })
  }
  const noRecord = await projectWithWorktreeAgent({ pid: 2 ** 22 - 1, host: hostname() }, { status: 'done', record: false })
  try {
    assert.deepEqual(await sendMessage(noRecord.projectId, 'go on', noRecord.agentId), { ok: false, error: `no run ${noRecord.agentId} in this project` })
  } finally {
    noRecord.restore()
    await rm(noRecord.dir, { recursive: true, force: true })
  }
})

test('a question takes one answer: a second, pressed at once in another tab, is refused with the one taken', async () => {
  const asked = { ...QUESTION, at: '2026-07-19T10:01:00.000Z' }
  const ctx = await projectWithWorktreeAgent({ pid: process.pid, host: hostname() }, { diary: [asked] })
  try {
    // Whichever reaches the run first is taken.
    const [left, right] = await Promise.all([answer(ctx, asked.at, 'a'), answer(ctx, asked.at, 'b')])
    const taken = left.ok ? 'Left' : 'Right'
    assert.deepEqual([left, right].filter(one => one.ok), [{ ok: true }])
    assert.deepEqual([left, right].find(one => !one.ok), { ok: false, error: `Already answered: ${taken}` })
    assert.deepEqual(await answer(ctx, asked.at, 'b'), { ok: false, error: `Already answered: ${taken}` })
    assert.deepEqual(await entries(ctx.agentInbox), [{ kind: 'answer', question: 'Which way?', answer: taken }])
    // The run went on and asked again: the new question is its own, and takes its answer.
    const again = { ...QUESTION, title: 'Which colour?', at: '2026-07-19T10:05:00.000Z' }
    await writeFile(join(worktreePath(ctx.dir, ctx.agentId), OPENAGENT_DIR, `${ctx.agentId}.jsonl`), [asked, { kind: 'said', text: 'Going left.' }, again].map(line => JSON.stringify(line) + '\n').join(''))
    assert.deepEqual(await answer(ctx, asked.at, 'b'), { ok: false, error: 'that question is no longer open' })
    assert.deepEqual(await answer(ctx, again.at, 'b'), { ok: true })
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('an answer must be to the question the run\'s diary holds open, by its own options (#1774)', async () => {
  const ctx = await projectWithWorktreeAgent({ pid: process.pid, host: hostname() }, { diary: [QUESTION, { kind: 'said', text: 'going on' }] })
  try {
    // The agent went on after the question: it is no longer open.
    assert.deepEqual(await answer(ctx, 'question', 'a'), { ok: false, error: 'that question is no longer open' })
    await writeFile(join(worktreePath(ctx.dir, ctx.agentId), OPENAGENT_DIR, `${ctx.agentId}.jsonl`), JSON.stringify(QUESTION) + '\n')
    assert.deepEqual(await answer(ctx, 'question', 'zzz'), { ok: false, error: 'every pick must be one of the question\'s options' })
    assert.deepEqual(await answer(ctx, 'question', ['a', 'b']), { ok: false, error: 'pick exactly one option' })
    assert.deepEqual(await entries(ctx.agentInbox), [])
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('a message with no run, or an unsafe run id, is refused (#749)', async () => {
  const ctx = await projectWithWorktreeAgent()
  try {
    assert.deepEqual(await sendMessage(ctx.projectId, 'one'), { ok: false, error: 'unknown session' })
    assert.deepEqual(await sendMessage(ctx.projectId, 'two', '../escape'), { ok: false, error: 'unknown session' })
    assert.deepEqual(await sendMessage('no-such-project', 'three', ctx.agentId), { ok: false, error: 'unknown session' })
    assert.deepEqual(await entries(ctx.rootInbox), [])
    assert.deepEqual(await entries(ctx.agentInbox), [], 'the run is left alone')
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

// #768: a resumed run has a record from its first leg AND is going again in its checkout. The
// dedup used to keep the record and drop the live copy, so the dashboard showed a running agent as
// finished.
test('a resumed run reads as running, not as its recorded first leg (#768)', async () => {
  const ctx = await projectWithWorktreeAgent() // its checkout's card says `running`
  try {
    // Its first leg was recorded on the data branch when it ended.
    const recorded = join(await fileBranchPath(ctx.dir, DATA_BRANCH), 'agents', 'someone@example.com')
    await mkdir(recorded, { recursive: true })
    await writeFile(join(recorded, `${ctx.agentId}.json`), JSON.stringify({ id: ctx.agentId, startedAt: '2026-07-19T10:00:00.000Z', status: 'waiting' }))
    const agents = (await onAgents(ctx.projectId)) as { id: string; status: string }[]
    const mine = agents.filter(agent => agent.id === ctx.agentId)
    assert.equal(mine.length, 1, 'still one row, not two')
    assert.equal(mine[0]?.status, 'running', 'and it reads as live, not as the recorded first leg')
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('a run another computer started is not continued from here: a message and an answer are refused with where it runs, and nothing is resumed', async () => {
  const ctx = await projectWithWorktreeAgent({ pid: 0, host: 'ubuntu-s-1vcpu-2gb-fra1' }, { status: 'waiting', diary: [QUESTION, { kind: 'ended', status: 'waiting' }] })
  try {
    const refused = { ok: false, error: 'This run is on ubuntu-s-1vcpu-2gb-fra1. Continue it there.' }
    assert.deepEqual(await sendMessage(ctx.projectId, 'go on', ctx.agentId), refused)
    assert.deepEqual(await answer(ctx, 'question', 'a'), refused)
    await assert.rejects(stat(join(ctx.dir, RESUMED_FILE)), { code: 'ENOENT' })
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test("work a run left uncommitted is what waits on the person, as the module that keeps its checkout says it", async () => {
  const ctx = await projectWithWorktreeAgent({ pid: 0, host: hostname() }, { status: 'done' })
  try {
    // Ended, its branch recorded on its card, a file it never committed left in its checkout.
    const card = join(worktreePath(ctx.dir, ctx.agentId), OPENAGENT_DIR, `${ctx.agentId}.json`)
    await writeFile(card, JSON.stringify({ ...JSON.parse(await readFile(card, 'utf8')), branch: agentBranchName(ctx.agentId) }))
    await writeFile(join(worktreePath(ctx.dir, ctx.agentId), 'draft.md'), 'not committed\n')
    const items = (await onWaiting()).items.filter(item => item.run === ctx.agentId)
    assert.deepEqual(items.map(item => [item.module, item.id, item.words]), [['git-branches', `uncommitted:${ctx.agentId}`, 'Needs commit']])
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})
