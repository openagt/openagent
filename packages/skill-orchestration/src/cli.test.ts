import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { appendFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isDeepStrictEqual, promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { continuationPrompt, logCardFile, logDiaryFile } from '@openagt/agent-driver'
import { DATA_BRANCH, withFileBranch } from '@openagt/agent-data'
import { addWorktree, agentBranchName, worktreePath } from '@openagt/skill-branches'
import { findRun, formatRunCard, type AnyDiaryLine, type RunCard, type RunStatus } from '@openagt/skill-logs'
import { liveDir, markerCard, recordRun, type RunnerMark } from '@openagt/agent-runner'
import { runCli } from './cli.js'
import { landedRef, SUBAGENT_LINES, type SubagentDeps } from './subagents.js'
import { git, removeRepo, testRepo } from './test-repo.js'

const HOST = 'this-machine'
const MAIN = '2026-10-01T10-00-00-000Z'
const FIRST = '2026-10-01T10-01-00-000Z'
const SECOND = '2026-10-01T10-02-00-000Z'
const OTHERS = '2026-10-01T10-03-00-000Z'

interface Ran {
  code: number
  out: any
  err: string
}

type Started = Parameters<SubagentDeps['spawn']>[1]

/** The command as the run `agent` calls it from `cwd`, at a fixed time, with a spawn that keeps what it was asked and a stop that keeps the pid. */
async function run(cwd: string, agent: string | undefined, argv: string[], given: Partial<SubagentDeps> = {}): Promise<Ran & { started: Started[]; stopped: number[] }> {
  const outLines: string[] = []
  const errLines: string[] = []
  const started: Started[] = []
  const stopped: number[] = []
  const deps: Partial<SubagentDeps> = {
    host: HOST,
    isAlive: () => true,
    stop: pid => void stopped.push(pid),
    ready: async () => ({ problems: [], warnings: [] }),
    now: () => new Date('2026-10-01T10:01:00.000Z'),
    spawn: async (_repo, run) => void started.push(run),
    ...given,
  }
  const code = await runCli(argv, { cwd, env: agent !== undefined ? { AGENT_ID: agent } : {}, stdout: line => outLines.push(line), stderr: line => errLines.push(line) }, deps)
  return { code, out: outLines.length ? JSON.parse(outLines.join('\n')) : undefined, err: errLines.join('\n'), started, stopped }
}

/** A run's record on the data branch. */
async function record(repo: string, id: string, opts: { status?: RunStatus; prompt?: string; driver?: string; model?: string; mark?: Partial<RunnerMark>; diary?: AnyDiaryLine[]; branch?: string } = {}): Promise<RunCard> {
  const marker = markerCard({ id, startedAt: '2026-10-01T10:00:00.000Z', prompt: opts.prompt ?? 'Do the work', driver: opts.driver ?? 'claude-code', ...(opts.model !== undefined ? { model: opts.model } : {}), mark: { host: HOST, ...opts.mark } })
  const card: RunCard = { ...marker, status: opts.status ?? 'running', ...(opts.branch !== undefined ? { branch: opts.branch } : {}) }
  const written = await recordRun(repo, card, opts.diary ?? [])
  assert.ok(written.ok || written.committed, 'the record is written')
  return card
}

/** The main agent: its record, and its checkout on its own branch. */
async function mainAgent(repo: string, opts: { driver?: string; model?: string; mark?: Partial<RunnerMark> } = {}): Promise<string> {
  await record(repo, MAIN, opts)
  return (await addWorktree(repo, { agentId: MAIN, branch: agentBranchName(MAIN) }, git)).path
}

/** A run's live card in its checkout, as the session keeps it while the agent works. */
async function liveCard(repo: string, card: RunCard): Promise<void> {
  const dir = liveDir(worktreePath(repo, card.id))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, logCardFile(card.id)), formatRunCard(card))
}

/** A prompt the run was given, as its session logs it in the run's checkout; the live directory is hidden from git, as the runner hides it. */
async function prompted(repo: string, agent: string, prompt: string, kind = 'start'): Promise<void> {
  const dir = liveDir(worktreePath(repo, agent))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, '.gitignore'), '*\n')
  await appendFile(join(dir, logDiaryFile(agent)), JSON.stringify({ kind, prompt, at: '2026-10-01T10:00:30.000Z' }) + '\n')
}

/** The caller's plan saved from a file outside its checkout; answers the question to ask. */
async function savePlan(repo: string, cwd: string, agent: string, text: string): Promise<string> {
  const file = join(dirname(repo), `plan-${agent}.md`)
  await writeFile(file, text)
  const saved = await run(cwd, agent, ['plan', file])
  assert.equal(saved.code, 0, saved.err)
  return saved.out.question
}

/** The context every task of PLAN is told, and the three tasks a subagent may take. */
const CONTEXT = 'Everything this plan touches is under src/.'
const PLAN = `# Split the work

${CONTEXT}

## 1. Add the tests

Level: simple
Files: src/a.test.ts, \`src/b.test.ts\`
Check: \`pnpm test\`
Uncertainty: 0

Cover the new code.

## 2. Add the docs

Level: hard
Needs: Add the tests
Uncertainty: 0

Write the README.

## 3. Fix the typo

Level: simple
Uncertainty: 0
`
const TESTS = 'add-the-tests'
const DOCS = 'add-the-docs'
const TYPO = 'fix-the-typo'

/** What the subagent on the first task is given: the plan's context, the task's own words, its files and its check, then the lines every subagent is told. */
const TESTS_PROMPT = `${CONTEXT}

1. Add the tests

Cover the new code.

The files this task changes: src/a.test.ts, src/b.test.ts

Check your work with: pnpm test

${SUBAGENT_LINES}`
const DOCS_PROMPT = `${CONTEXT}\n\n2. Add the docs\n\nWrite the README.\n\n${SUBAGENT_LINES}`

/** A plan saved and approved by the person: their `Approve` to its question, as the runner sends an answer. */
async function approvedPlan(repo: string, cwd: string, agent: string = MAIN): Promise<void> {
  await prompted(repo, agent, continuationPrompt(await savePlan(repo, cwd, agent, PLAN), 'Approve'))
}

test('start: a run for the caller, on one task of the plan, from the caller\'s branch, on the coding agent and model set for the task\'s level, else the caller\'s own, told it is a subagent', async () => {
  const repo = await testRepo()
  try {
    const checkout = await mainAgent(repo, { driver: 'codex', model: 'gpt-5.5' })
    await approvedPlan(repo, checkout)
    // Nothing set: the caller's own coding agent and model.
    const plain = await run(checkout, MAIN, ['start', '--task', TESTS])
    assert.deepEqual([plain.code, plain.out, plain.err], [0, { ok: true, id: FIRST, task: TESTS, name: '1. Add the tests', level: 'simple', driver: 'codex', model: 'gpt-5.5', base: agentBranchName(MAIN) }, ''])
    // The task's words are the plan's: its context once, the task's own heading and body, the files it owns and its check.
    assert.deepEqual(plain.started, [{ id: FIRST, prompt: TESTS_PROMPT, parent: MAIN, base: agentBranchName(MAIN), driver: 'codex', model: 'gpt-5.5' }])
    // Its record is there before its process is, and it carries the task's name and its id: the
    // row a person reads is the heading, not the first line of the prompt.
    assert.deepEqual((await run(checkout, MAIN, ['list'])).out, [
      { id: FIRST, startedAt: '2026-10-01T10:01:00.000Z', status: 'running', intent: TESTS_PROMPT.slice(0, -SUBAGENT_LINES.length).trimEnd(), title: '1. Add the tests', driver: 'codex', model: 'gpt-5.5' },
    ])
    assert.equal((await findRun(repo, FIRST))?.caller?.['task'], TESTS)
    assert.equal((await run(checkout, MAIN, ['stop', FIRST])).out.reason, 'no-process')

    // The setting for the task's level wins; a setting with no model is that coding agent's own
    // default; the branch is the one the checkout is on now.
    assert.equal((await run(repo, undefined, ['settings', JSON.stringify({ hard: { driver: 'claude-code', model: 'opus' }, simple: { driver: 'claude-code' }, atOnce: 10 })])).code, 0)
    await git(['branch', '-m', 'split-the-work'], checkout)
    const hard = await run(checkout, MAIN, ['start', '--task', DOCS], { now: () => new Date('2026-10-01T10:02:00.000Z') })
    assert.deepEqual(hard.out, { ok: true, id: SECOND, task: DOCS, name: '2. Add the docs', level: 'hard', driver: 'claude-code', model: 'opus', base: 'split-the-work' })
    assert.deepEqual(hard.started, [{ id: SECOND, prompt: DOCS_PROMPT, parent: MAIN, base: 'split-the-work', driver: 'claude-code', model: 'opus' }])
    assert.deepEqual((await run(checkout, MAIN, ['read', SECOND])).out.model, 'opus')
    const simple = await run(checkout, MAIN, ['start', '--task', TYPO], { now: () => new Date('2026-10-01T10:02:30.000Z') })
    assert.deepEqual(simple.started.map(s => [s.driver, s.model]), [['claude-code', undefined]])
    // A task with no words of its own is its name alone, and nothing of the task's keys leaks into it.
    assert.equal(simple.started[0]?.prompt, `${CONTEXT}\n\n3. Fix the typo\n\n${SUBAGENT_LINES}`)
    // The readiness check is the level's coding agent's.
    const checked: string[] = []
    await run(checkout, MAIN, ['start', '--task', DOCS], { now: () => new Date('2026-10-01T10:02:40.000Z'), ready: async (_repo, driver) => (checked.push(driver), { problems: ['not logged in'], warnings: [] }) })
    assert.deepEqual(checked, ['claude-code'])

    // Uncommitted work is not on the branch the subagent starts from: said, and the subagent still starts.
    await writeFile(join(checkout, 'draft.md'), 'not committed\n')
    const dirty = await run(checkout, MAIN, ['start', '--task', TESTS], { now: () => new Date('2026-10-01T10:03:00.000Z') })
    assert.deepEqual([dirty.code, dirty.out.uncommitted, dirty.started.length], [0, true, 1])
    assert.match(dirty.err, /uncommitted changes: the subagent does not have them/)

    // A process that cannot be spawned leaves no record saying a subagent runs.
    const unspawned = await run(checkout, MAIN, ['start', '--task', TESTS], {
      now: () => new Date('2026-10-01T10:04:00.000Z'),
      spawn: async () => {
        throw new Error('spawn ENOENT')
      },
    })
    assert.deepEqual([unspawned.code, unspawned.out], [1, { ok: false, reason: 'failed', detail: 'spawn ENOENT' }])
    assert.deepEqual((await run(checkout, MAIN, ['list'])).out.map((card: { id: string }) => card.id), [OTHERS, '2026-10-01T10-02-30-000Z', SECOND, FIRST])
  } finally {
    await removeRepo(repo)
  }
})

test('start is refused for a caller that is no run, for a subagent, and when the coding agent cannot start', async () => {
  const repo = await testRepo()
  try {
    const none = await run(repo, undefined, ['start', '--task', TESTS])
    assert.deepEqual([none.code, none.out, none.started], [1, { ok: false, reason: 'not-a-run' }, []])
    assert.match(none.err, /AGENT_ID is not set/)
    const unknown = await run(repo, MAIN, ['start', '--task', TESTS])
    assert.deepEqual([unknown.code, unknown.out, unknown.started], [1, { ok: false, reason: 'not-a-run', id: MAIN }, []])
    assert.match(unknown.err, /do the task yourself/)

    // A main agent whose first record has not reached the branch yet is known by its live card; a
    // coding agent the runner cannot start is not passed on.
    const early = (await addWorktree(repo, { agentId: OTHERS, branch: agentBranchName(OTHERS) }, git)).path
    await liveCard(repo, { ...markerCard({ id: OTHERS, startedAt: '2026-10-01T10:03:00.000Z', prompt: 'Split it', driver: 'pi', mark: { host: HOST, pid: 1 } }) })
    await approvedPlan(repo, early, OTHERS)
    const fromLive = await run(early, OTHERS, ['start', '--task', TESTS])
    assert.deepEqual([fromLive.code, fromLive.started.map(s => [s.parent, s.driver])], [0, [[OTHERS, 'claude-code']]])

    const checkout = await mainAgent(repo)
    await approvedPlan(repo, checkout)
    const notReady = await run(checkout, MAIN, ['start', '--task', TESTS], { ready: async () => ({ problems: ['claude is not logged in.'], warnings: [] }) })
    assert.deepEqual([notReady.code, notReady.out, notReady.started], [1, { ok: false, reason: 'not-ready', problems: ['claude is not logged in.'], warnings: [] }, []])
    assert.equal(notReady.err, 'claude is not logged in.')

    await git(['checkout', '-q', '--detach'], checkout)
    const detached = await run(checkout, MAIN, ['start', '--task', TESTS])
    assert.deepEqual([detached.code, detached.out.reason, detached.started], [1, 'no-branch', []])

    // A run whose directory is no checkout of its own never borrows the project's branch.
    await record(repo, SECOND)
    await mkdir(liveDir(worktreePath(repo, SECOND)), { recursive: true })
    const noCheckout = await run(repo, SECOND, ['start', '--task', TESTS])
    assert.deepEqual([noCheckout.out.reason, noCheckout.started], ['no-branch', []])

    // A run started for another run starts none of its own.
    await record(repo, FIRST, { mark: { parent: MAIN } })
    await addWorktree(repo, { agentId: FIRST, branch: agentBranchName(FIRST) }, git)
    const nested = await run(checkout, FIRST, ['start', '--task', TESTS])
    assert.deepEqual([nested.code, nested.out, nested.started], [1, { ok: false, reason: 'subagent' }, []])
  } finally {
    await removeRepo(repo)
  }
})

/** A plan whose tasks a subagent may take, `Task 0` to `Task 6`, and three a subagent may not. */
const MANY = `# Split the work

${Array.from({ length: 7 }, (_, n) => `## Task ${n}\n\nLevel: simple\nUncertainty: 0\n`).join('\n')}
## Weigh the options

Level: simple
Uncertainty: 4

## Unrated

Level: simple

## Levelless

Uncertainty: 0
`

test('start: refused for a task the plan has not got, for one that is uncertain, unrated or at no level, and while as many of the caller\'s subagents run as the setting allows, 4 when unset', async () => {
  const repo = await testRepo()
  try {
    const checkout = await mainAgent(repo)
    await prompted(repo, MAIN, continuationPrompt(await savePlan(repo, checkout, MAIN, MANY), 'Approve'))

    // A task the plan does not name: the caller is told which tasks it has.
    const unknown = await run(checkout, MAIN, ['start', '--task', 'add-the-tests'])
    assert.deepEqual([unknown.code, unknown.out.reason, unknown.out.task, unknown.started], [1, 'no-task', 'add-the-tests', []])
    assert.deepEqual(unknown.out.tasks, ['task-0', 'task-1', 'task-2', 'task-3', 'task-4', 'task-5', 'task-6', 'weigh-the-options', 'unrated', 'levelless'])

    // Nobody answers a subagent, so a task with real alternatives in it stays with the caller, and
    // one nobody rated is not quietly taken for a rated 0.
    const uncertain = await run(checkout, MAIN, ['start', '--task', 'weigh-the-options'])
    assert.deepEqual([uncertain.code, uncertain.out, uncertain.started], [1, { ok: false, reason: 'uncertain', task: 'weigh-the-options', uncertainty: 4 }, []])
    assert.match(uncertain.err, /do this task yourself/)
    const unrated = await run(checkout, MAIN, ['start', '--task', 'unrated'])
    assert.deepEqual([unrated.code, unrated.out, unrated.started], [1, { ok: false, reason: 'no-uncertainty', task: 'unrated' }, []])
    assert.match(unrated.err, /rate it 0 to 10 in the plan/)

    // The level comes from the plan and from nowhere else: a task without one is refused, as a
    // start without one was.
    const unsaid = await run(checkout, MAIN, ['start', '--task', 'levelless'])
    assert.deepEqual([unsaid.code, unsaid.out, unsaid.started], [1, { ok: false, reason: 'no-level', task: 'levelless' }, []])
    assert.match(unsaid.err, /simple or hard/)
    assert.equal((await run(checkout, MAIN, ['start', '--level', 'simple', '--task', 'task-0'])).code, 2, 'the plan says the level; the command line cannot')

    // Another main agent's subagent and an ended one of the caller's take no place.
    await record(repo, '2026-10-01T09-00-00-000Z', { mark: { parent: OTHERS } })
    await record(repo, '2026-10-01T09-00-01-000Z', { status: 'done', mark: { parent: MAIN } })
    const at = (n: number) => ({ now: () => new Date(Date.parse('2026-10-01T10:10:00.000Z') + n * 1000) })
    for (let n = 0; n < 4; n++) assert.equal((await run(checkout, MAIN, ['start', '--task', `task-${n}`], at(n))).code, 0, `start ${n}`)
    const fifth = await run(checkout, MAIN, ['start', '--task', 'task-4'], at(4))
    assert.deepEqual([fifth.code, fifth.out, fifth.started], [1, { ok: false, reason: 'limit', running: 4, atOnce: 4 }, []])
    assert.match(fifth.err, /end your reply/)

    // The person's setting moves the limit both ways.
    assert.equal((await run(repo, undefined, ['settings', JSON.stringify({ atOnce: 5 })])).code, 0)
    assert.equal((await run(checkout, MAIN, ['start', '--task', 'task-4'], at(5))).code, 0)
    assert.equal((await run(checkout, MAIN, ['start', '--task', 'task-5'], at(6))).out.reason, 'limit')
    assert.equal((await run(repo, undefined, ['settings', JSON.stringify({ atOnce: 1 })])).code, 0)
    assert.deepEqual((await run(checkout, MAIN, ['start', '--task', 'task-5'], at(7))).out, { ok: false, reason: 'limit', running: 5, atOnce: 1 })
  } finally {
    await removeRepo(repo)
  }
})

test('settings: saved whole on this machine, hidden from git, read back; settings that are not settings are refused and change nothing', async () => {
  const repo = await testRepo()
  try {
    assert.deepEqual((await run(repo, undefined, ['settings'])).out, { ok: true })
    const given = { simple: { driver: 'codex', model: 'gpt-5.5' }, hard: { driver: 'claude-code', model: 'opus' }, atOnce: 3 }
    assert.deepEqual((await run(repo, undefined, ['settings', JSON.stringify(given)])).out, { ok: true, ...given })
    assert.deepEqual((await run(repo, undefined, ['settings'])).out, { ok: true, ...given })
    assert.deepEqual(JSON.parse(await readFile(join(repo, '.orchestration', 'settings.json'), 'utf8')), given)
    assert.equal((await git(['status', '--porcelain'], repo)).trim(), '')
    // Whole: what is left out is unset again; null is unset too.
    assert.deepEqual((await run(repo, undefined, ['settings', JSON.stringify({ hard: { driver: 'codex' }, simple: null })])).out, { ok: true, hard: { driver: 'codex' } })
    for (const bad of ['nope', '[]', '{"medium": {"driver": "codex"}}', '{"hard": {"driver": "pi"}}', '{"hard": "opus"}', '{"hard": {"driver": "codex", "model": " "}}', '{"atOnce": 0}', '{"atOnce": 2.5}', '{"atOnce": "4"}']) {
      const refused = await run(repo, undefined, ['settings', bad])
      assert.equal(refused.code, 2, bad)
    }
    assert.deepEqual((await run(repo, undefined, ['settings'])).out, { ok: true, hard: { driver: 'codex' } })

    // A save replaces the file whole, never writes into it: a reader, or a second save, never meets half of one.
    const before = (await stat(join(repo, '.orchestration', 'settings.json'))).ino
    assert.equal((await run(repo, undefined, ['settings', JSON.stringify({ atOnce: 2 })])).code, 0)
    assert.notEqual((await stat(join(repo, '.orchestration', 'settings.json'))).ino, before)

    // Saves at once, each its own process as the dashboard runs them, leave one of them whole,
    // never several mixed, and nothing beside the file.
    const many = Array.from({ length: 12 }, (_, n) => ({ atOnce: n + 1, ...(n % 2 ? { simple: { driver: 'codex', model: `m${'x'.repeat(n * 400)}` } } : {}) }))
    const bin = fileURLToPath(new URL('../bin/orchestration', import.meta.url))
    await Promise.all(many.map(settings => promisify(execFile)(process.execPath, [bin, 'settings', JSON.stringify(settings)], { cwd: repo })))
    const after = JSON.parse(await readFile(join(repo, '.orchestration', 'settings.json'), 'utf8'))
    assert.ok(many.some(settings => isDeepStrictEqual(settings, after)), JSON.stringify(after))
    assert.deepEqual(await readdir(join(repo, '.orchestration')), ['settings.json'])
  } finally {
    await removeRepo(repo)
  }
})

test('list: the caller\'s subagents only, newest first, the task without the added lines, nothing of the runner\'s', async () => {
  const repo = await testRepo()
  try {
    await record(repo, MAIN)
    assert.deepEqual((await run(repo, MAIN, ['list'])).out, [])
    await record(repo, FIRST, { status: 'done', prompt: `Add the tests\n\n${SUBAGENT_LINES}`, mark: { parent: MAIN }, branch: 'tests' })
    await record(repo, SECOND, { prompt: `Add the docs\n\n${SUBAGENT_LINES}`, mark: { parent: MAIN, pid: 4242 } })
    await record(repo, OTHERS, { mark: { parent: FIRST } })
    const listed = await run(repo, MAIN, ['list'])
    assert.equal(listed.code, 0)
    assert.deepEqual(listed.out, [
      { id: SECOND, startedAt: '2026-10-01T10:00:00.000Z', status: 'running', intent: 'Add the docs', driver: 'claude-code' },
      { id: FIRST, startedAt: '2026-10-01T10:00:00.000Z', status: 'done', intent: 'Add the tests', driver: 'claude-code', branch: 'tests' },
    ])
    assert.equal((await run(repo, undefined, ['list'])).out.reason, 'not-a-run')
  } finally {
    await removeRepo(repo)
  }
})

test('read: one subagent with its last reply; a run that is not the caller\'s subagent is refused', async () => {
  const repo = await testRepo()
  try {
    await record(repo, MAIN)
    await record(repo, FIRST, {
      status: 'done',
      prompt: `Add the tests\n\n${SUBAGENT_LINES}`,
      mark: { parent: MAIN },
      branch: 'tests',
      diary: [{ kind: 'result', text: 'Looking.' }, { kind: 'said', text: 'Writing them.' }, { kind: 'result', text: 'Three tests added.' }, { kind: 'ended', status: 'done' }],
    })
    await record(repo, SECOND, { mark: { parent: MAIN } })
    await record(repo, OTHERS, { mark: { parent: FIRST } })
    const done = await run(repo, MAIN, ['read', FIRST])
    assert.deepEqual([done.code, done.out], [0, { ok: true, id: FIRST, startedAt: '2026-10-01T10:00:00.000Z', status: 'done', intent: 'Add the tests', driver: 'claude-code', branch: 'tests', result: 'Three tests added.' }])
    const running = await run(repo, MAIN, ['read', SECOND])
    assert.deepEqual([running.out.status, 'result' in running.out], ['running', false])
    for (const id of [OTHERS, MAIN, '2026-10-01T11-00-00-000Z']) {
      const refused = await run(repo, MAIN, ['read', id])
      assert.deepEqual([refused.code, refused.out], [1, { ok: false, reason: 'not-yours', id }])
    }
  } finally {
    await removeRepo(repo)
  }
})

test('stop: the signal goes to the process on the subagent\'s live card, and only to a subagent running here', async () => {
  const repo = await testRepo()
  try {
    await record(repo, MAIN)
    const running = await record(repo, FIRST, { mark: { parent: MAIN } })
    // No live card yet: the run's process is still starting.
    const starting = await run(repo, MAIN, ['stop', FIRST])
    assert.deepEqual([starting.code, starting.out, starting.stopped], [1, { ok: false, reason: 'no-process', id: FIRST }, []])

    await liveCard(repo, { ...running, caller: { runner: { host: HOST, pid: 4242, parent: MAIN } } })
    const dead = await run(repo, MAIN, ['stop', FIRST], { isAlive: () => false })
    assert.deepEqual([dead.out.reason, dead.stopped], ['no-process', []])
    // A live card that says ended names a pid that is no longer the run's.
    await liveCard(repo, { ...running, status: 'done', caller: { runner: { host: HOST, pid: 4242, parent: MAIN } } })
    assert.deepEqual((await run(repo, MAIN, ['stop', FIRST])).stopped, [])
    await liveCard(repo, { ...running, caller: { runner: { host: HOST, pid: 4242, parent: MAIN } } })
    const stopped = await run(repo, MAIN, ['stop', FIRST])
    assert.deepEqual([stopped.code, stopped.out, stopped.stopped], [0, { ok: true, id: FIRST }, [4242]])

    await record(repo, SECOND, { status: 'done', mark: { parent: MAIN } })
    const ended = await run(repo, MAIN, ['stop', SECOND])
    assert.deepEqual([ended.code, ended.out, ended.stopped], [1, { ok: false, reason: 'not-running', id: SECOND, status: 'done' }, []])

    const elsewhere = await run(repo, MAIN, ['stop', FIRST], { host: 'another-machine' })
    assert.deepEqual([elsewhere.out, elsewhere.stopped], [{ ok: false, reason: 'other-machine', id: FIRST }, []])

    await record(repo, OTHERS, { mark: { parent: SECOND } })
    await liveCard(repo, { ...running, id: OTHERS, caller: { runner: { host: HOST, pid: 777, parent: SECOND } } })
    const notMine = await run(repo, MAIN, ['stop', OTHERS])
    assert.deepEqual([notMine.out, notMine.stopped], [{ ok: false, reason: 'not-yours', id: OTHERS }, []])
  } finally {
    await removeRepo(repo)
  }
})

test('plan: saved beside the run\'s record, read back, and no subagent starts until the person approved the plan as it is saved', async () => {
  const repo = await testRepo()
  try {
    const checkout = await mainAgent(repo)
    const unplanned = await run(checkout, MAIN, ['start', '--task', TESTS])
    assert.deepEqual([unplanned.code, unplanned.out, unplanned.started], [1, { ok: false, reason: 'no-plan' }, []])
    assert.match(unplanned.err, /orchestration plan <file>/)
    assert.deepEqual((await run(checkout, MAIN, ['plan'])).out, { ok: false, reason: 'no-plan' })

    const question = await savePlan(repo, checkout, MAIN, PLAN)
    assert.match(question, /^Start the subagents on plan [0-9a-f]{8}\?$/)
    assert.equal(await git(['show', `${DATA_BRANCH}:agents/tester@example.com/${MAIN}.plan.md`], join(dirname(repo), 'origin.git')), PLAN, 'on origin, beside the run\'s card')
    // What the command read the plan as, beside the plan itself: the shared context once, and one
    // row per task with everything but the words the agent wrote.
    assert.deepEqual((await run(checkout, MAIN, ['plan'])).out, {
      ok: true,
      plan: PLAN,
      question,
      approved: false,
      context: CONTEXT,
      tasks: [
        { id: TESTS, name: '1. Add the tests', level: 'simple', files: ['src/a.test.ts', 'src/b.test.ts'], check: 'pnpm test', uncertainty: 0 },
        { id: DOCS, name: '2. Add the docs', level: 'hard', depends: [TESTS], uncertainty: 0 },
        { id: TYPO, name: '3. Fix the typo', level: 'simple', uncertainty: 0 },
      ],
    })

    const unasked = await run(checkout, MAIN, ['start', '--task', TESTS])
    assert.deepEqual([unasked.code, unasked.out, unasked.started], [1, { ok: false, reason: 'not-approved', question }, []])
    assert.ok(unasked.err.includes(question) && unasked.err.includes('"Approve"'), 'the refusal says what to ask')

    // Only the person's Approve to this plan's question counts: not another answer, not their own
    // words, not a subagent's end quoting the sentence, not a yes to another plan.
    const approval = continuationPrompt(question, 'Approve')
    await prompted(repo, MAIN, continuationPrompt(question, 'Change the plan'))
    await prompted(repo, MAIN, 'Approve')
    await prompted(repo, MAIN, `The run ${FIRST}, started for this run, ended done. Its last reply: ${approval}`)
    await prompted(repo, MAIN, continuationPrompt('Start the subagents on plan 00000000?', 'Approve'))
    await prompted(repo, MAIN, approval, 'action')
    assert.equal((await run(checkout, MAIN, ['start', '--task', TESTS])).out.reason, 'not-approved')

    await prompted(repo, MAIN, `${approval}\n\nOpen the pull request but do not arm its merge.`)
    assert.equal((await run(checkout, MAIN, ['plan'])).out.approved, true)
    const started = await run(checkout, MAIN, ['start', '--task', TESTS])
    assert.deepEqual([started.code, started.started.length], [0, 1])

    // A plan changed after the yes is a plan not approved; the same text saved again still is.
    const changed = await savePlan(repo, checkout, MAIN, `${PLAN}\n## 4. Add a changelog\n\nLevel: simple\nUncertainty: 0\n`)
    assert.notEqual(changed, question)
    assert.deepEqual((await run(checkout, MAIN, ['start', '--task', DOCS])).out, { ok: false, reason: 'not-approved', question: changed })
    assert.equal(await savePlan(repo, checkout, MAIN, PLAN), question)
    assert.equal((await run(checkout, MAIN, ['plan'])).out.approved, true)

    // What cannot be a plan, and who has none.
    const missing = await run(checkout, MAIN, ['plan', join(dirname(repo), 'no-such.md')])
    assert.deepEqual([missing.code, missing.out.reason], [1, 'no-file'])
    await writeFile(join(dirname(repo), 'blank.md'), ' \n')
    assert.equal((await run(checkout, MAIN, ['plan', join(dirname(repo), 'blank.md')])).out.reason, 'empty')
    // A text the command cannot read as a task list is not saved: the plan the person reads is the
    // one the subagents are started from, so the caller fixes it first.
    await writeFile(join(dirname(repo), 'prose.md'), '# My plan\n\nI will do it all myself.\n')
    const unreadable = await run(checkout, MAIN, ['plan', join(dirname(repo), 'prose.md')])
    assert.deepEqual([unreadable.code, unreadable.out.reason], [1, 'unreadable'])
    assert.match(unreadable.out.problems.join(' '), /the plan has no task/)
    assert.equal((await run(checkout, MAIN, ['plan'])).out.plan, PLAN, 'the plan that was there is still there')
    await record(repo, FIRST, { mark: { parent: MAIN } })
    assert.equal((await run(checkout, FIRST, ['plan', join(dirname(repo), `plan-${MAIN}.md`)])).out.reason, 'subagent')
    assert.equal((await run(checkout, undefined, ['plan'])).out.reason, 'not-a-run')

    // A run recorded under another person keeps its plan beside its card.
    await record(repo, OTHERS)
    await withFileBranch(repo, DATA_BRANCH, 'recorded by someone else', async dir => {
      await mkdir(join(dir, 'agents', 'someone@example.com'))
      for (const ext of ['json', 'jsonl']) await rename(join(dir, 'agents', 'tester@example.com', `${OTHERS}.${ext}`), join(dir, 'agents', 'someone@example.com', `${OTHERS}.${ext}`))
    })
    await savePlan(repo, checkout, OTHERS, PLAN)
    assert.equal(await git(['show', `${DATA_BRANCH}:agents/someone@example.com/${OTHERS}.plan.md`], join(dirname(repo), 'origin.git')), PLAN)
  } finally {
    await removeRepo(repo)
  }
})

/** A subagent that ended: its record, and its branch one commit past the main agent's, on this machine as a subagent's is. */
async function endedSubagent(repo: string, id: string, file: string, opts: { status?: RunStatus; branch?: string } = {}): Promise<string> {
  const branch = opts.branch ?? agentBranchName(id)
  const path = (await addWorktree(repo, { agentId: id, branch, base: agentBranchName(MAIN) }, git)).path
  await writeFile(join(path, file), `${id}\n`)
  await git(['add', '-A'], path)
  await git(['commit', '-q', '-m', `Add ${file}`], path)
  await git(['worktree', 'remove', '--force', path], repo)
  await record(repo, id, { status: opts.status ?? 'done', mark: { parent: MAIN, base: agentBranchName(MAIN) }, branch })
  return branch
}

const hasRef = (repo: string, ref: string) => git(['rev-parse', '--verify', '--quiet', ref], repo).then(() => true, () => false)

test('land: the subagent\'s branch merged into the caller\'s, then gone, here and from its record, and nothing reaches origin', async () => {
  const repo = await testRepo()
  const origin = join(dirname(repo), 'origin.git')
  try {
    const checkout = await mainAgent(repo)
    const branch = await endedSubagent(repo, FIRST, 'tests.txt')
    // A second one from the same start.
    const second = await endedSubagent(repo, SECOND, 'docs.txt')
    const landed = await run(checkout, MAIN, ['land', FIRST])
    assert.deepEqual([landed.code, landed.out, landed.err], [0, { ok: true, id: FIRST, branch, merged: true }, ''])
    assert.equal(await readFile(join(checkout, 'tests.txt'), 'utf8'), `${FIRST}\n`, 'the work is on the main agent\'s branch')
    assert.equal(await hasRef(repo, `refs/heads/${branch}`), false)
    const card = await findRun(repo, FIRST)
    assert.equal(card?.branch, undefined, 'the record names no branch that is gone')
    // Its last commit outlives the branch: kept under a ref on this machine, and named on the record.
    const tip = (await git(['rev-parse', 'HEAD'], checkout)).trim()
    assert.equal((await git(['log', '-1', '--format=%s', tip], repo)).trim(), 'Add tests.txt')
    assert.equal((await git(['rev-parse', landedRef(FIRST)], repo)).trim(), tip)
    assert.equal(card?.caller?.['landed'], tip)
    assert.deepEqual(card?.caller?.['runner'], { host: HOST, parent: MAIN, base: agentBranchName(MAIN) }, 'the rest of the record is as it was')
    const again = await run(checkout, MAIN, ['land', FIRST])
    assert.deepEqual([again.code, again.out], [1, { ok: false, reason: 'nothing-to-land', id: FIRST }])

    // The next is landed as a merge: the main agent's branch has moved on.
    assert.deepEqual((await run(checkout, MAIN, ['land', SECOND])).out, { ok: true, id: SECOND, branch: second, merged: true })
    assert.equal(await readFile(join(checkout, 'docs.txt'), 'utf8'), `${SECOND}\n`)
    assert.equal((await git(['log', '-1', '--format=%s'], checkout)).trim(), `Merge branch '${second}'`)

    // One the main agent merged by hand is only deleted.
    const byHand = await endedSubagent(repo, OTHERS, 'notes.txt')
    await git(['merge', '-q', '--no-edit', byHand], checkout)
    assert.deepEqual((await run(checkout, MAIN, ['land', OTHERS])).out, { ok: true, id: OTHERS, branch: byHand, merged: false })
    assert.equal(await hasRef(repo, `refs/heads/${byHand}`), false)
    assert.equal((await findRun(repo, OTHERS))?.caller?.['landed'], (await git(['rev-parse', landedRef(OTHERS)], repo)).trim(), 'merged by hand, its last commit is kept all the same')
    assert.equal((await git(['log', '-1', '--format=%s', landedRef(OTHERS)], repo)).trim(), 'Add notes.txt')

    // Landing is this machine's: no branch and no landed ref was ever written to origin.
    assert.equal((await git(['for-each-ref', '--format=%(refname)', 'refs/heads/agent-2*', 'refs/landed'], origin)).trim(), '')
  } finally {
    await removeRepo(repo)
  }
})

test('land is refused, and nothing deleted, on a conflict, a running subagent, uncommitted work, and a run that is not the caller\'s', async () => {
  const repo = await testRepo()
  try {
    const checkout = await mainAgent(repo)
    const branch = await endedSubagent(repo, FIRST, 'shared.txt')
    await writeFile(join(checkout, 'shared.txt'), 'the main agent\'s own\n')
    const dirty = await run(checkout, MAIN, ['land', FIRST])
    assert.deepEqual([dirty.code, dirty.out], [1, { ok: false, reason: 'uncommitted' }])

    await git(['add', '-A'], checkout)
    await git(['commit', '-q', '-m', 'Mine'], checkout)
    const head = (await git(['rev-parse', 'HEAD'], checkout)).trim()
    const conflict = await run(checkout, MAIN, ['land', FIRST])
    assert.deepEqual([conflict.code, conflict.out], [1, { ok: false, reason: 'conflict', id: FIRST, branch, files: ['shared.txt'] }])
    assert.match(conflict.err, new RegExp(`git merge ${branch}`))
    assert.deepEqual([(await git(['rev-parse', 'HEAD'], checkout)).trim(), (await git(['status', '--porcelain'], checkout)).trim()], [head, ''], 'the merge is undone')
    assert.equal(await hasRef(repo, `refs/heads/${branch}`), true, 'and the branch is still there')
    assert.equal((await findRun(repo, FIRST))?.branch, branch)
    assert.deepEqual([await hasRef(repo, landedRef(FIRST)), (await findRun(repo, FIRST))?.caller?.['landed']], [false, undefined], 'not landed: nothing says it is')

    await record(repo, SECOND, { mark: { parent: MAIN }, branch: agentBranchName(SECOND) })
    assert.deepEqual((await run(checkout, MAIN, ['land', SECOND])).out, { ok: false, reason: 'running', id: SECOND })
    await record(repo, SECOND, { status: 'done', mark: { parent: MAIN } })
    assert.deepEqual((await run(checkout, MAIN, ['land', SECOND])).out, { ok: false, reason: 'nothing-to-land', id: SECOND })
    await record(repo, SECOND, { status: 'done', mark: { parent: MAIN }, branch: 'agent-never-made' })
    assert.deepEqual((await run(checkout, MAIN, ['land', SECOND])).out, { ok: false, reason: 'nothing-to-land', id: SECOND })
    await record(repo, OTHERS, { status: 'done', mark: { parent: FIRST }, branch })
    assert.deepEqual((await run(checkout, MAIN, ['land', OTHERS])).out, { ok: false, reason: 'not-yours', id: OTHERS })
  } finally {
    await removeRepo(repo)
  }
})

test('land: a subagent whose checkout is still there loses it only when it holds nothing uncommitted; a branch that is not an agent\'s is merged and kept', async () => {
  const repo = await testRepo()
  try {
    const checkout = await mainAgent(repo)
    // A subagent that ended waiting keeps its checkout.
    const branch = agentBranchName(FIRST)
    const theirs = (await addWorktree(repo, { agentId: FIRST, branch, base: agentBranchName(MAIN) }, git)).path
    await writeFile(join(theirs, 'tests.txt'), 'tests\n')
    await git(['add', '-A'], theirs)
    await git(['commit', '-q', '-m', 'Add tests'], theirs)
    await record(repo, FIRST, { status: 'waiting', mark: { parent: MAIN }, branch })
    await writeFile(join(theirs, 'half-done.txt'), 'not committed\n')
    const unfinished = await run(checkout, MAIN, ['land', FIRST])
    assert.deepEqual([unfinished.code, unfinished.out], [1, { ok: false, reason: 'uncommitted-there', id: FIRST, path: theirs }])
    assert.equal(await stat(join(checkout, 'tests.txt')).then(() => true, () => false), false, 'nothing merged')

    await rm(join(theirs, 'half-done.txt'))
    assert.deepEqual((await run(checkout, MAIN, ['land', FIRST])).out, { ok: true, id: FIRST, branch, merged: true })
    assert.deepEqual([await stat(theirs).then(() => true, () => false), await hasRef(repo, `refs/heads/${branch}`)], [false, false])

    const named = await endedSubagent(repo, SECOND, 'docs.txt', { branch: 'docs' })
    assert.deepEqual((await run(checkout, MAIN, ['land', SECOND])).out, { ok: true, id: SECOND, branch: named, merged: true })
    assert.equal(await hasRef(repo, 'refs/heads/docs'), true, 'only an agent\'s branch is deleted')
    const kept = await findRun(repo, SECOND)
    assert.equal(kept?.branch, 'docs')
    assert.equal(kept?.caller?.['landed'], (await git(['rev-parse', 'refs/heads/docs'], repo)).trim(), 'landed all the same')
  } finally {
    await removeRepo(repo)
  }
})

test('a command line that cannot be read exits 2 with the usage and starts nothing; outside a repository is a refusal', async () => {
  const repo = await testRepo()
  const elsewhere = await mkdtemp(join(tmpdir(), 'not-a-repo-'))
  try {
    await mainAgent(repo)
    for (const argv of [[], ['nope'], ['start'], ['start', ' '], ['start', '--task'], ['start', '--task', ' '], ['start', 'a', 'b'], ['start', 'a', '--driver', 'pi'], ['list', 'extra'], ['read'], ['stop'], ['stop', FIRST, '--force'], ['plan', 'a', 'b'], ['plan', '--nope'], ['land'], ['land', FIRST, SECOND], ['start', '--level', 'simple', 'a', '--model', 'opus'], ['start', '--level', 'simple', 'a', '--driver', 'codex'], ['start', '--level'], ['settings', '{}', '{}']]) {
      const bad = await run(repo, MAIN, argv)
      assert.deepEqual([bad.code, bad.out, bad.started, bad.stopped], [2, undefined, [], []], argv.join(' '))
      assert.match(bad.err, /usage: orchestration/)
    }
    const outside = await run(elsewhere, MAIN, ['list'])
    assert.deepEqual([outside.code, outside.out], [1, { ok: false, reason: 'not-a-repo' }])
  } finally {
    await removeRepo(repo)
    await rm(elsewhere, { recursive: true, force: true })
  }
})
