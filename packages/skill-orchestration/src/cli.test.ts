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
import { CHECK_MAX_OUTPUT } from './check.js'
import { landedRef, retryText, SUBAGENT_LINES, type SubagentDeps } from './subagents.js'
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

/** The command as the run `agent` calls it from `cwd`, at a fixed time, with a spawn that keeps what it was asked, a stop that keeps the pid, and checks that pass and are kept. */
async function run(cwd: string, agent: string | undefined, argv: string[], given: Partial<SubagentDeps> = {}): Promise<Ran & { started: Started[]; stopped: number[]; checks: string[] }> {
  const outLines: string[] = []
  const errLines: string[] = []
  const started: Started[] = []
  const stopped: number[] = []
  const checks: string[] = []
  const deps: Partial<SubagentDeps> = {
    host: HOST,
    isAlive: () => true,
    stop: pid => void stopped.push(pid),
    ready: async () => ({ problems: [], warnings: [] }),
    now: () => new Date('2026-10-01T10:01:00.000Z'),
    spawn: async (_repo, run) => void started.push(run),
    run: async command => (checks.push(command), { code: 0, output: '' }),
    ...given,
  }
  const code = await runCli(argv, { cwd, env: agent !== undefined ? { AGENT_ID: agent } : {}, stdout: line => outLines.push(line), stderr: line => errLines.push(line) }, deps)
  return { code, out: outLines.length ? JSON.parse(outLines.join('\n')) : undefined, err: errLines.join('\n'), started, stopped, checks }
}

/** A run's record on the data branch; `task` is the task of the plan a subagent was started on, as `start` writes it. */
async function record(repo: string, id: string, opts: { status?: RunStatus; prompt?: string; driver?: string; model?: string; mark?: Partial<RunnerMark>; diary?: AnyDiaryLine[]; branch?: string; task?: string } = {}): Promise<RunCard> {
  const marker = markerCard({ id, startedAt: '2026-10-01T10:00:00.000Z', prompt: opts.prompt ?? 'Do the work', driver: opts.driver ?? 'claude-code', ...(opts.model !== undefined ? { model: opts.model } : {}), mark: { host: HOST, ...opts.mark } })
  const card: RunCard = { ...marker, status: opts.status ?? 'running', ...(opts.branch !== undefined ? { branch: opts.branch } : {}), ...(opts.task !== undefined ? { caller: { ...marker.caller, task: opts.task } } : {}) }
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

/** The context every task of PLAN is told, the project's own check, and the three tasks a subagent may take. */
const CONTEXT = 'Everything this plan touches is under src/.'
const PROJECT_CHECK = 'pnpm verify'
const PLAN = `# Split the work

${CONTEXT}

Check: ${PROJECT_CHECK}

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
/** The first task's words alone, without the lines every subagent is told. */
const TESTS_WORDS = TESTS_PROMPT.slice(0, -SUBAGENT_LINES.length).trimEnd()

/** A subagent whose work is on the main agent's branch, as `land` records it: its task is landed. */
async function markLanded(repo: string, id: string): Promise<void> {
  await again(repo, id, card => ({ ...card, status: 'done', caller: { ...card.caller, landed: 'c0ffee1' } }))
}

/** A subagent that ended, keeping everything its record carries: the task it was started on above all. */
async function ended(repo: string, id: string, status: RunStatus): Promise<void> {
  await again(repo, id, card => ({ ...card, status }))
}

/** A run's record written again, out of the one that is there. */
async function again(repo: string, id: string, change: (card: RunCard) => RunCard): Promise<void> {
  const card = await findRun(repo, id)
  assert.ok(card, `the record of ${id}`)
  const written = await recordRun(repo, change(card), [])
  assert.ok(written.ok || written.committed, 'the record is written')
}

/** The command run `seconds` after the start of the clock, so each start of a test gets an id of its own. */
const later = (seconds: number) => ({ now: () => new Date(Date.parse('2026-10-01T10:01:00.000Z') + seconds * 1000) })

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

    // The second task needs the first: it starts once that one is landed.
    await markLanded(repo, FIRST)
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

test('start: refused for a task whose `Needs:` tasks are not landed, saying what each one stands at', async () => {
  const repo = await testRepo()
  try {
    const checkout = await mainAgent(repo)
    await approvedPlan(repo, checkout)

    // Nobody started what it needs.
    const nobody = await run(checkout, MAIN, ['start', '--task', DOCS])
    assert.deepEqual([nobody.code, nobody.out, nobody.started], [1, { ok: false, reason: 'needs', task: DOCS, waiting: [{ task: TESTS, state: 'unstarted' }] }, []])
    assert.match(nobody.err, /the task "2\. Add the docs" needs work that is not on your branch yet: add-the-tests \(nobody started it, and you have not marked it done\)/)
    assert.match(nobody.err, /start this task once every one of them is landed/)

    // One that is running is one to wait for; one that ended unlanded is one to land.
    assert.equal((await run(checkout, MAIN, ['start', '--task', TESTS])).code, 0)
    const running = await run(checkout, MAIN, ['start', '--task', DOCS], later(60))
    assert.deepEqual([running.out.reason, running.out.waiting, running.started], ['needs', [{ task: TESTS, state: 'running', id: FIRST }], []])
    assert.match(running.err, new RegExp(`add-the-tests \\(${FIRST} is running it\\)`))
    await ended(repo, FIRST, 'failed')
    const unlanded = await run(checkout, MAIN, ['start', '--task', DOCS], later(120))
    assert.deepEqual([unlanded.out.reason, unlanded.out.waiting], ['needs', [{ task: TESTS, state: 'ended', id: FIRST, status: 'failed' }]])
    assert.match(unlanded.err, new RegExp(`add-the-tests \\(${FIRST} ended failed and is not landed\\)`))

    // Landed, and it starts; a task that needs nothing never waited.
    await markLanded(repo, FIRST)
    const started = await run(checkout, MAIN, ['start', '--task', DOCS], later(180))
    assert.deepEqual([started.code, started.out.task, started.started.length], [0, DOCS, 1], started.err)
    assert.equal((await run(checkout, MAIN, ['start', '--task', TYPO], later(240))).code, 0)
  } finally {
    await removeRepo(repo)
  }
})

/** Two tasks that write one file, and one that writes its own. */
const SHARED = `# Split the work

Everything this plan touches is under src/.

## 1. Write the parser

Level: simple
Files: src/parse.ts, src/parse.test.ts
Uncertainty: 0

## 2. Use the parser

Level: simple
Files: src/parse.ts, src/use.ts
Uncertainty: 0

## 3. Write the docs

Level: simple
Files: README.md
Uncertainty: 0
`

test('start: a task owning a file a running subagent\'s task owns too is said, and starts all the same', async () => {
  const repo = await testRepo()
  try {
    const checkout = await mainAgent(repo)
    await prompted(repo, MAIN, continuationPrompt(await savePlan(repo, checkout, MAIN, SHARED), 'Approve'))
    assert.equal((await run(checkout, MAIN, ['start', '--task', 'write-the-parser'])).code, 0)

    // The person's plan says two tasks write src/parse.ts: the main agent may have meant it, so the
    // second one starts, and it is told which run is in the same file.
    const second = await run(checkout, MAIN, ['start', '--task', 'use-the-parser'], later(60))
    assert.deepEqual([second.code, second.out.sharedFiles, second.started.length], [0, [{ id: FIRST, task: '1. Write the parser', files: ['src/parse.ts'] }], 1])
    assert.match(second.err, new RegExp(`${FIRST} is running "1\\. Write the parser", which owns src/parse\\.ts too: two agents writing one file conflict`))

    // A task that owns no file of a running one's is started with nothing said.
    const docs = await run(checkout, MAIN, ['start', '--task', 'write-the-docs'], later(120))
    assert.deepEqual([docs.code, 'sharedFiles' in docs.out, docs.err], [0, false, ''])

    // A subagent that ended is writing nothing any more.
    await ended(repo, FIRST, 'done')
    await ended(repo, SECOND, 'failed')
    const after = await run(checkout, MAIN, ['start', '--task', 'use-the-parser'], later(180))
    assert.deepEqual([after.code, 'sharedFiles' in after.out, after.err], [0, false, ''])
  } finally {
    await removeRepo(repo)
  }
})

/** A plan with one task in every state `next` can answer. */
const STATES = `# Every state

## 1. Add the tests

Level: simple
Files: src/a.test.ts
Uncertainty: 0

## 2. Add the docs

Level: hard
Needs: Add the tests
Uncertainty: 0

## 3. Fix the typo

Level: simple
Uncertainty: 0

## 4. Polish the CSS

Level: simple
Needs: Fix the typo
Uncertainty: 0

## 5. Rename the package

Level: simple
Uncertainty: 0

## 6. Weigh the options

Level: simple
Uncertainty: 4

## 7. Unrated

Level: simple

## 8. Levelless

Uncertainty: 0
`

test('next: every task of the plan, where its work stands, and how many more subagents may run at once', async () => {
  const repo = await testRepo()
  try {
    const checkout = await mainAgent(repo)
    const unplanned = await run(checkout, MAIN, ['next'])
    assert.deepEqual([unplanned.code, unplanned.out], [1, { ok: false, reason: 'no-plan' }])
    const question = await savePlan(repo, checkout, MAIN, STATES)
    assert.deepEqual((await run(checkout, MAIN, ['next'])).out, { ok: false, reason: 'not-approved', question })
    await prompted(repo, MAIN, continuationPrompt(question, 'Approve'))

    // One landed, one running, one that ended and was not landed.
    assert.equal((await run(checkout, MAIN, ['start', '--task', 'add-the-tests'])).code, 0)
    assert.equal((await run(checkout, MAIN, ['start', '--task', 'fix-the-typo'], later(60))).code, 0)
    assert.equal((await run(checkout, MAIN, ['start', '--task', 'rename-the-package'], later(120))).code, 0)
    await markLanded(repo, FIRST)
    await ended(repo, OTHERS, 'failed')

    const next = await run(checkout, MAIN, ['next'])
    assert.deepEqual(next.out, {
      ok: true,
      atOnce: 4,
      running: 1,
      places: 3,
      tasks: [
        { id: 'add-the-tests', name: '1. Add the tests', level: 'simple', files: ['src/a.test.ts'], state: 'landed', runs: [FIRST] },
        { id: 'add-the-docs', name: '2. Add the docs', level: 'hard', state: 'startable' },
        { id: 'fix-the-typo', name: '3. Fix the typo', level: 'simple', state: 'running', runs: [SECOND] },
        { id: 'polish-the-css', name: '4. Polish the CSS', level: 'simple', state: 'waiting', needs: ['fix-the-typo'] },
        { id: 'rename-the-package', name: '5. Rename the package', level: 'simple', state: 'ended', runs: [OTHERS] },
        { id: 'weigh-the-options', name: '6. Weigh the options', level: 'simple', state: 'yours' },
        { id: 'unrated', name: '7. Unrated', level: 'simple', state: 'yours' },
        { id: 'levelless', name: '8. Levelless', state: 'yours' },
      ],
    })
    // What `next` calls startable is what `start` takes, and what it calls the main agent's own is refused.
    assert.equal((await run(checkout, MAIN, ['start', '--task', 'add-the-docs'], later(180))).code, 0)
    for (const task of ['weigh-the-options', 'unrated', 'levelless']) assert.equal((await run(checkout, MAIN, ['start', '--task', task], later(240))).code, 1, task)

    // A startable task still waits while no place is left.
    assert.equal((await run(repo, undefined, ['settings', JSON.stringify({ atOnce: 2 })])).code, 0)
    const full = await run(checkout, MAIN, ['next'])
    assert.deepEqual([full.out.atOnce, full.out.running, full.out.places], [2, 2, 0])
    assert.equal((await run(repo, undefined, ['settings', JSON.stringify({ atOnce: 1 })])).code, 0)
    assert.equal((await run(checkout, MAIN, ['next'])).out.places, 0, 'never below none')
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
      check: PROJECT_CHECK,
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
async function endedSubagent(repo: string, id: string, file: string, opts: { status?: RunStatus; branch?: string; task?: string } = {}): Promise<string> {
  const branch = opts.branch ?? agentBranchName(id)
  const path = (await addWorktree(repo, { agentId: id, branch, base: agentBranchName(MAIN) }, git)).path
  await writeFile(join(path, file), `${id}\n`)
  await git(['add', '-A'], path)
  await git(['commit', '-q', '-m', `Add ${file}`], path)
  await git(['worktree', 'remove', '--force', path], repo)
  await record(repo, id, { status: opts.status ?? 'done', mark: { parent: MAIN, base: agentBranchName(MAIN) }, branch, ...(opts.task !== undefined ? { task: opts.task } : {}) })
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
    // No plan is saved in this test, so there is no task check to run and the land says so.
    assert.deepEqual([landed.code, landed.out, landed.err], [0, { ok: true, id: FIRST, branch, merged: true, unchecked: 'no-plan' }, ''])
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
    assert.deepEqual((await run(checkout, MAIN, ['land', SECOND])).out, { ok: true, id: SECOND, branch: second, merged: true, unchecked: 'no-plan' })
    assert.equal(await readFile(join(checkout, 'docs.txt'), 'utf8'), `${SECOND}\n`)
    assert.equal((await git(['log', '-1', '--format=%s'], checkout)).trim(), `Merge branch '${second}'`)

    // One the main agent merged by hand is only deleted.
    const byHand = await endedSubagent(repo, OTHERS, 'notes.txt')
    await git(['merge', '-q', '--no-edit', byHand], checkout)
    assert.deepEqual((await run(checkout, MAIN, ['land', OTHERS])).out, { ok: true, id: OTHERS, branch: byHand, merged: false, unchecked: 'no-plan' })
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
    assert.deepEqual((await run(checkout, MAIN, ['land', FIRST])).out, { ok: true, id: FIRST, branch, merged: true, unchecked: 'no-plan' })
    assert.deepEqual([await stat(theirs).then(() => true, () => false), await hasRef(repo, `refs/heads/${branch}`)], [false, false])

    const named = await endedSubagent(repo, SECOND, 'docs.txt', { branch: 'docs' })
    assert.deepEqual((await run(checkout, MAIN, ['land', SECOND])).out, { ok: true, id: SECOND, branch: named, merged: true, unchecked: 'no-plan' })
    assert.equal(await hasRef(repo, 'refs/heads/docs'), true, 'only an agent\'s branch is deleted')
    const kept = await findRun(repo, SECOND)
    assert.equal(kept?.branch, 'docs')
    assert.equal(kept?.caller?.['landed'], (await git(['rev-parse', 'refs/heads/docs'], repo)).trim(), 'landed all the same')
  } finally {
    await removeRepo(repo)
  }
})

test('land: the task\'s own `Check:` line runs on the merged work, and a check that fails leaves the merge in and the branch alive', async () => {
  const repo = await testRepo()
  try {
    const checkout = await mainAgent(repo)
    await approvedPlan(repo, checkout)
    const branch = await endedSubagent(repo, FIRST, 'tests.txt', { task: TESTS })

    const failed = await run(checkout, MAIN, ['land', FIRST], { run: async () => ({ code: 2, output: 'FAIL src/a.test.ts\n1 test failed\n' }) })
    assert.deepEqual([failed.code, failed.out.ok, failed.out.reason, failed.out.task, failed.out.command, failed.out.code], [1, false, 'check', TESTS, 'pnpm test', 2])
    assert.deepEqual([failed.out.output, failed.out.cut], ['FAIL src/a.test.ts\n1 test failed', undefined], 'what the check printed, as it printed it')
    assert.match(failed.err, /the check of "1\. Add the tests", `pnpm test`, failed in your checkout with exit 2/)
    assert.match(failed.err, new RegExp(`land ${FIRST} again, which only runs the check`))
    // The work is merged and the branch is there: the main agent fixes it and lands again.
    assert.equal(await readFile(join(checkout, 'tests.txt'), 'utf8'), `${FIRST}\n`)
    assert.equal(await hasRef(repo, `refs/heads/${branch}`), true)
    assert.deepEqual([await hasRef(repo, landedRef(FIRST)), (await findRun(repo, FIRST))?.caller?.['landed']], [false, undefined], 'nothing says it landed')

    // The second land only runs the check; it passes, and the land finishes.
    const again = await run(checkout, MAIN, ['land', FIRST])
    assert.deepEqual([again.code, again.out, again.checks], [0, { ok: true, id: FIRST, branch, merged: false, check: 'pnpm test' }, ['pnpm test']])
    assert.equal(await hasRef(repo, `refs/heads/${branch}`), false)
    assert.equal((await findRun(repo, FIRST))?.caller?.['landed'], (await git(['rev-parse', landedRef(FIRST)], repo)).trim())

    // A subagent whose record never said which task it did: the same silence, named apart, since
    // this is what a run started by an older copy of the command leaves behind — and what a run
    // whose record lost the task looks like, which is how a land once reported checks it never ran.
    const nameless = await endedSubagent(repo, '2026-10-01T10-05-00-000Z', 'nameless.txt')
    const unknown = await run(checkout, MAIN, ['land', '2026-10-01T10-05-00-000Z'])
    assert.deepEqual([unknown.out, unknown.checks], [{ ok: true, id: '2026-10-01T10-05-00-000Z', branch: nameless, merged: true, unchecked: 'no-task-on-record' }, []])

    // A task with no check of its own has nothing to run, and the plan's own check waits for the last task.
    const docs = await endedSubagent(repo, SECOND, 'docs.txt', { task: DOCS })
    const second = await run(checkout, MAIN, ['land', SECOND])
    // That task names no `Check:` line, so nothing ran and the answer says which kind of nothing.
    assert.deepEqual([second.out, second.checks], [{ ok: true, id: SECOND, branch: docs, merged: true, unchecked: 'no-check-line' }, []])

    // The last land runs the plan's own check, the project's: it fails, and nothing is landed.
    const typo = await endedSubagent(repo, OTHERS, 'typo.txt', { task: TYPO })
    const broken = await run(checkout, MAIN, ['land', OTHERS], { run: async () => ({ code: 1, output: 'src/a.ts(3,1): error TS2322' }) })
    assert.deepEqual([broken.code, broken.out.reason, broken.out.command, broken.out.output], [1, 'project-check', PROJECT_CHECK, 'src/a.ts(3,1): error TS2322'])
    assert.match(broken.err, /every task of the plan is landed or done and the plan's own check, `pnpm verify`, failed with exit 1/)
    assert.equal(await hasRef(repo, `refs/heads/${typo}`), true)
    const last = await run(checkout, MAIN, ['land', OTHERS])
    // The last land runs the project's check; this task names no `Check:` line of its own, and the
    // answer says that rather than leaving a land that checked nothing reading as one that passed.
    assert.deepEqual([last.out, last.checks], [{ ok: true, id: OTHERS, branch: typo, merged: false, projectCheck: PROJECT_CHECK, unchecked: 'no-check-line' }, [PROJECT_CHECK]])

    // A check that printed more than a refusal carries keeps its end, where a command that stopped says why.
    await endedSubagent(repo, '2026-10-01T10-05-00-000Z', 'more.txt', { task: TESTS })
    const loud = await run(checkout, MAIN, ['land', '2026-10-01T10-05-00-000Z'], { run: async () => ({ code: 1, output: `${'x'.repeat(9000)}\nthe last line` }) })
    assert.deepEqual([loud.out.reason, loud.out.cut, loud.out.output.length, loud.out.output.endsWith('\nthe last line')], ['check', true, CHECK_MAX_OUTPUT, true])

    // A subagent whose task is no task of the plan has no check of its own to run; the plan's own
    // runs, since every task of the plan is landed.
    const byHand = await endedSubagent(repo, '2026-10-01T10-06-00-000Z', 'notes.txt', { task: 'gone-from-the-plan' })
    const nothing = await run(checkout, MAIN, ['land', '2026-10-01T10-06-00-000Z'])
    // Its task is no longer in the plan, so there is no check of its own to run: said, not silent.
    assert.deepEqual([nothing.code, nothing.out, nothing.checks], [0, { ok: true, id: '2026-10-01T10-06-00-000Z', branch: byHand, merged: true, projectCheck: PROJECT_CHECK, unchecked: 'task-gone' }, [PROJECT_CHECK]])
  } finally {
    await removeRepo(repo)
  }
})

/** A plan with a task the main agent keeps, since it is uncertain, and a task that needs it. */
const KEPT = `# Split the work

${CONTEXT}

Check: ${PROJECT_CHECK}

## 1. Add the tests

Level: simple
Check: pnpm test
Uncertainty: 0

## 2. Change the deploy

Check: pnpm deploy:check
Uncertainty: 1

## 3. Add the docs

Level: simple
Needs: Change the deploy
Uncertainty: 0
`
const DEPLOY = 'change-the-deploy'

/** Work committed on the main agent's branch, in its checkout. */
async function commitIn(checkout: string, file: string): Promise<void> {
  await writeFile(join(checkout, file), `${file}\n`)
  await git(['add', '-A'], checkout)
  await git(['commit', '-q', '-m', `Add ${file}`], checkout)
}

/** The tasks the main agent marked done, as its own log holds them. */
async function marks(repo: string): Promise<string[]> {
  const log = await readFile(join(liveDir(worktreePath(repo, MAIN)), logDiaryFile(MAIN)), 'utf8')
  return log.split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(line => line.kind === 'task-done').map(line => line.task)
}

test('done: the main agent\'s own task, marked in its log once committed and checked, is finished for `next`, for `Needs:` and for the last land', async () => {
  const repo = await testRepo()
  try {
    const checkout = await mainAgent(repo)
    const question = await savePlan(repo, checkout, MAIN, KEPT)
    assert.deepEqual((await run(checkout, MAIN, ['done', DEPLOY])).out, { ok: false, reason: 'not-approved', question }, 'nothing is done of a plan the person did not approve')
    await prompted(repo, MAIN, continuationPrompt(question, 'Approve'))

    // Kept, and the task that needs it waits for it, saying it is the main agent's to mark.
    const before = await run(checkout, MAIN, ['next'])
    assert.deepEqual(before.out.tasks.map((task: { state: string }) => task.state), ['startable', 'yours', 'waiting'])
    const waiting = await run(checkout, MAIN, ['start', '--task', DOCS])
    assert.deepEqual([waiting.out.reason, waiting.out.waiting], ['needs', [{ task: DEPLOY, state: 'unstarted' }]])
    assert.match(waiting.err, /change-the-deploy \(nobody started it, and you have not marked it done\)/)
    assert.match(waiting.err, /do it yourself and mark it with `done <task>`/)

    // Not committed is not done, and a check that fails marks nothing.
    await writeFile(join(checkout, 'deploy.yml'), 'on: push\n')
    const uncommitted = await run(checkout, MAIN, ['done', DEPLOY])
    assert.deepEqual([uncommitted.code, uncommitted.out, uncommitted.checks], [1, { ok: false, reason: 'uncommitted' }, []])
    await git(['add', '-A'], checkout)
    await git(['commit', '-q', '-m', 'Change the deploy'], checkout)
    const failed = await run(checkout, MAIN, ['done', DEPLOY], { run: async () => ({ code: 3, output: 'the deploy is broken\n' }) })
    assert.deepEqual([failed.code, failed.out], [1, { ok: false, reason: 'check', task: DEPLOY, command: 'pnpm deploy:check', code: 3, output: 'the deploy is broken' }])
    assert.match(failed.err, /the check of "2\. Change the deploy", `pnpm deploy:check`, failed in your checkout with exit 3/)
    assert.match(failed.err, /mark it with `done change-the-deploy` again; nothing is marked yet/)
    assert.deepEqual(await marks(repo), [])

    // Checked and marked: in the main agent's own log, where its record's lines come from.
    const done = await run(checkout, MAIN, ['done', DEPLOY])
    assert.deepEqual([done.code, done.out, done.checks], [0, { ok: true, task: DEPLOY, name: '2. Change the deploy', check: 'pnpm deploy:check' }, ['pnpm deploy:check']], done.err)
    assert.deepEqual(await marks(repo), [DEPLOY])
    assert.deepEqual((await run(checkout, MAIN, ['next'])).out.tasks.map((task: { id: string; state: string }) => [task.id, task.state]), [[TESTS, 'startable'], [DEPLOY, 'done'], [DOCS, 'startable']])
    assert.deepEqual((await run(checkout, MAIN, ['done', DEPLOY])).out, { ok: false, reason: 'done', task: DEPLOY })

    // What needed it starts now; a task a subagent runs, or landed, is no task to mark.
    const docs = await run(checkout, MAIN, ['start', '--task', DOCS])
    assert.equal(docs.code, 0, docs.err)
    assert.deepEqual((await run(checkout, MAIN, ['done', DOCS])).out, { ok: false, reason: 'running', task: DOCS, id: FIRST })
    assert.deepEqual((await run(checkout, MAIN, ['done', 'no-such-task'])).out, { ok: false, reason: 'no-task', task: 'no-such-task', tasks: [TESTS, DEPLOY, DOCS] })
    const tests = await endedSubagent(repo, SECOND, 'tests.txt', { task: TESTS })
    const first = await run(checkout, MAIN, ['land', SECOND])
    assert.deepEqual([first.out, first.checks], [{ ok: true, id: SECOND, branch: tests, merged: true, check: 'pnpm test' }, ['pnpm test']], 'the docs are not landed yet: no project check')
    assert.deepEqual((await run(checkout, MAIN, ['done', TESTS])).out, { ok: false, reason: 'landed', task: TESTS, id: SECOND })

    // The last land counts the task the main agent did: the plan's own check runs.
    const branch = await endedSubagent(repo, FIRST, 'docs.txt', { task: DOCS })
    const last = await run(checkout, MAIN, ['land', FIRST])
    assert.deepEqual([last.out, last.checks], [{ ok: true, id: FIRST, branch, merged: true, projectCheck: PROJECT_CHECK, unchecked: 'no-check-line' }, [PROJECT_CHECK]])
  } finally {
    await removeRepo(repo)
  }
})

test('done: the mark that finishes the plan runs the plan\'s own check, and marks nothing when it fails', async () => {
  const repo = await testRepo()
  try {
    const checkout = await mainAgent(repo)
    await prompted(repo, MAIN, continuationPrompt(await savePlan(repo, checkout, MAIN, KEPT), 'Approve'))
    await endedSubagent(repo, FIRST, 'tests.txt', { task: TESTS })
    await endedSubagent(repo, SECOND, 'docs.txt', { task: DOCS })
    assert.equal((await run(checkout, MAIN, ['land', FIRST])).code, 0)
    assert.equal((await run(checkout, MAIN, ['land', SECOND])).checks.length, 0, 'the deploy is not done: no project check yet')
    await commitIn(checkout, 'deploy.yml')

    const broken = await run(checkout, MAIN, ['done', DEPLOY], { run: async command => ({ code: command === PROJECT_CHECK ? 1 : 0, output: command === PROJECT_CHECK ? 'src/a.ts(3,1): error TS2322' : '' }) })
    assert.deepEqual([broken.code, broken.out], [1, { ok: false, reason: 'project-check', task: DEPLOY, command: PROJECT_CHECK, code: 1, output: 'src/a.ts(3,1): error TS2322' }])
    assert.match(broken.err, /every task of the plan is landed or done and the plan's own check, `pnpm verify`, failed with exit 1/)
    assert.deepEqual(await marks(repo), [], 'nothing is marked')

    const done = await run(checkout, MAIN, ['done', DEPLOY])
    assert.deepEqual([done.out, done.checks], [{ ok: true, task: DEPLOY, name: '2. Change the deploy', check: 'pnpm deploy:check', projectCheck: PROJECT_CHECK }, ['pnpm deploy:check', PROJECT_CHECK]])
    assert.deepEqual(await marks(repo), [DEPLOY])

    // A subagent has no plan to mark a task of.
    await record(repo, OTHERS, { mark: { parent: MAIN } })
    assert.deepEqual((await run(checkout, OTHERS, ['done', DEPLOY])).out, { ok: false, reason: 'subagent' })
  } finally {
    await removeRepo(repo)
  }
})

test('retry: a new subagent on the same task, from the caller\'s branch, told what to do differently, naming the run it retries', async () => {
  const repo = await testRepo()
  try {
    const checkout = await mainAgent(repo)
    await approvedPlan(repo, checkout)
    assert.equal((await run(checkout, MAIN, ['start', '--task', TESTS])).code, 0)

    // Nothing to retry while it runs.
    const running = await run(checkout, MAIN, ['retry', FIRST, 'cover the error case'])
    assert.deepEqual([running.code, running.out, running.started], [1, { ok: false, reason: 'running', id: FIRST }, []])
    assert.match(running.err, /retry it once it has ended/)

    // One that ended `done` is retried too: its check failing on `land` is how it turns out to have failed.
    await ended(repo, FIRST, 'done')
    const feedback = '--force nothing: cover the error case, which is the one that failed'
    const retried = await run(checkout, MAIN, ['retry', FIRST, feedback], later(60))
    assert.deepEqual(retried.out, { ok: true, id: SECOND, task: TESTS, name: '1. Add the tests', level: 'simple', driver: 'claude-code', base: agentBranchName(MAIN), retries: FIRST })
    assert.deepEqual(retried.started, [{ id: SECOND, prompt: `${retryText(TESTS_WORDS, feedback)}\n\n${SUBAGENT_LINES}`, parent: MAIN, base: agentBranchName(MAIN), driver: 'claude-code' }])
    assert.match(retried.started[0]!.prompt, /Another agent tried this task before you/)
    assert.match(retried.started[0]!.prompt, /What to do differently: --force nothing: cover the error case/)
    const card = await findRun(repo, SECOND)
    assert.deepEqual([card?.caller?.['task'], card?.caller?.['retries'], card?.title], [TESTS, FIRST, '1. Add the tests'])

    // Only the caller's own subagents, and only one started on a task.
    await record(repo, OTHERS, { status: 'done', mark: { parent: FIRST } })
    assert.deepEqual((await run(checkout, MAIN, ['retry', OTHERS, 'again'])).out, { ok: false, reason: 'not-yours', id: OTHERS })
    await record(repo, '2026-10-01T09-00-00-000Z', { status: 'failed', mark: { parent: MAIN } })
    const taskless = await run(checkout, MAIN, ['retry', '2026-10-01T09-00-00-000Z', 'again'])
    assert.deepEqual([taskless.code, taskless.out, taskless.started], [1, { ok: false, reason: 'no-task', id: '2026-10-01T09-00-00-000Z' }, []])

    // Every rule `start` holds to holds for a retry: the dependencies, then the places.
    await record(repo, '2026-10-01T09-00-01-000Z', { status: 'failed', mark: { parent: MAIN }, task: DOCS })
    const needs = await run(checkout, MAIN, ['retry', '2026-10-01T09-00-01-000Z', 'again'], later(120))
    assert.deepEqual([needs.out.reason, needs.out.task, needs.started], ['needs', DOCS, []])
    assert.equal((await run(repo, undefined, ['settings', JSON.stringify({ atOnce: 1 })])).code, 0)
    const full = await run(checkout, MAIN, ['retry', FIRST, 'again'], later(180))
    assert.deepEqual([full.out.reason, full.started], ['limit', []])
  } finally {
    await removeRepo(repo)
  }
})

test('a command line that cannot be read exits 2 with the usage and starts nothing; outside a repository is a refusal', async () => {
  const repo = await testRepo()
  const elsewhere = await mkdtemp(join(tmpdir(), 'not-a-repo-'))
  try {
    await mainAgent(repo)
    for (const argv of [[], ['nope'], ['start'], ['start', ' '], ['start', '--task'], ['start', '--task', ' '], ['start', 'a', 'b'], ['start', 'a', '--driver', 'pi'], ['list', 'extra'], ['read'], ['stop'], ['stop', FIRST, '--force'], ['plan', 'a', 'b'], ['plan', '--nope'], ['land'], ['land', FIRST, SECOND], ['next', 'extra'], ['retry'], ['retry', FIRST], ['retry', FIRST, 'why', 'and'], ['retry', FIRST, ' '], ['retry', '--help'], ['start', '--level', 'simple', 'a', '--model', 'opus'], ['start', '--level', 'simple', 'a', '--driver', 'codex'], ['start', '--level'], ['settings', '{}', '{}']]) {
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
