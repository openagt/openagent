import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { logCardFile } from '../session-log.js'
import { patchRun } from '../record-store.js'
import { PLUGINS_WITHOUT_ENV, PROFILE_ENV, PROJECT_SKILLS_ENV, sessionFolder, sessionsHome } from '@openagt/agent-data'
import { LOCAL_HOST, type ProjectRef, type RunHost, type RunReadiness, type InboxLine } from '@openagt/hooks'
import { worktreePath } from '@openagt/git-branches'
import { localHost, type LocalHostDeps } from './host.js'
import { inboxPath, liveDir } from './live-card.js'
import { markerCard, writeMarker } from './records.js'
import { GIT_ACCOUNT_ENV, runArgs, type SpawnedResume, type SpawnedRun } from './runner.js'
import { NAME_FILE_ENV } from './title.js'
import { git, removeRepo, testRepo } from './test-repo.js'
import { NOW } from './run-test-support.js'

// This computer's host, with the runs' processes stood in for: what each is spawned with, what a
// person says to a run reaching it or resuming it, a Stop's signal, the runs it lists, and where a
// run's work is.

const NOTHING_WRONG: RunReadiness = { problems: [], warnings: [] }
const HERE = 'this-box'

function host(deps: LocalHostDeps = {}): { host: RunHost; runs: SpawnedRun[]; resumes: SpawnedResume[] } {
  const runs: SpawnedRun[] = []
  const resumes: SpawnedResume[] = []
  return {
    runs,
    resumes,
    host: localHost({
      spawnRun: async (_repo, run) => void runs.push(run),
      spawnResume: async (_repo, run) => void resumes.push(run),
      ready: async () => NOTHING_WRONG,
      loginFor: async () => undefined,
      host: HERE,
      startingMs: 0,
      ...deps,
    }),
  }
}

const projectAt = (dir: string): ProjectRef => ({ id: 'shop', name: 'shop', dir })

/** A run's live card in its checkout, as its process keeps it while it works. */
async function liveCard(repo: string, id: string, status: string, caller: Record<string, unknown>): Promise<void> {
  const dir = liveDir(worktreePath(repo, id))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, logCardFile(id)), JSON.stringify({ id, startedAt: NOW.toISOString(), status, intent: 'fix it', caller }))
}

test("a start is this computer's: the run's process is spawned with what it was asked, on its command line and in its environment, and answers its id", async () => {
  const repo = await testRepo()
  try {
    const { host: here, runs } = host()
    assert.equal(here.id, LOCAL_HOST)
    const project = projectAt(repo)
    const { id } = await here.start({
      project,
      prompt: 'fix the login',
      options: {
        'agent-driver': { driver: 'codex', model: 'gpt-5', effort: 'high' },
        profiles: { profile: 'reviewer' },
        publish: 'pr',
        'git-branches': { base: 'origin/develop' },
        github: { prBase: 'develop', account: 'octo-bot' },
        skills: { project: 'none' },
        plugins: { without: ['ask', 'tickets'] },
      },
      title: false,
    })
    const [run] = runs
    assert.equal(run?.id, id)
    assert.deepEqual(runArgs(run!).slice(0, 2), ['run', 'fix the login'])
    assert.deepEqual(
      { driver: run?.driver, model: run?.model, effort: run?.effort, publish: run?.publish, base: run?.base, prBase: run?.prBase, mark: run?.mark },
      { driver: 'codex', model: 'gpt-5', effort: 'high', publish: 'pr', base: 'origin/develop', prBase: 'develop', mark: true },
    )
    assert.deepEqual(run?.env, {
      [GIT_ACCOUNT_ENV]: 'octo-bot',
      [PROFILE_ENV]: 'reviewer',
      [PLUGINS_WITHOUT_ENV]: 'ask,tickets',
      [PROJECT_SKILLS_ENV]: 'none',
      OPENAGENT_NAME_RUN: '0',
    })
    // None of them, over a profile that leaves some out: the variable is set, to nothing.
    await here.start({ project, prompt: 'fix the logout', options: { plugins: { without: [] } }, title: false })
    assert.equal(runs[1]?.env?.[PLUGINS_WITHOUT_ENV], '')
  } finally {
    await removeRepo(repo)
  }
})

test("a start hands the run the name its starter is asking for, in a file the run's process waits on", async () => {
  const repo = await testRepo()
  try {
    const { host: here, runs } = host()
    let name!: (title: string | undefined) => void
    await here.start({ project: projectAt(repo), prompt: 'fix the login', options: {}, title: new Promise(resolve => (name = resolve)) })
    const file = runs[0]?.env?.[NAME_FILE_ENV]
    assert.ok(file, 'the run is told where its name comes')
    name('Login fix')
    for (let tries = 0; ; tries++) {
      const raw = await readFile(file, 'utf8').catch(() => undefined)
      if (raw !== undefined) {
        assert.deepEqual(JSON.parse(raw), { title: 'Login fix' })
        break
      }
      assert.ok(tries < 100, 'the name is handed over')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  } finally {
    await removeRepo(repo)
  }
})

test('a start that cannot make a run is refused before anything is spawned: a pick that has no place, a coding agent that cannot start', async () => {
  const repo = await testRepo()
  try {
    const { host: here, runs } = host({ ready: async (_dir, driver) => (driver === 'codex' ? { problems: ['Codex is not logged in.'], warnings: [] } : NOTHING_WRONG) })
    const project = projectAt(repo)
    await assert.rejects(here.start({ prompt: 'x', options: { 'git-branches': { base: 'main' } } }), /A session with no project has no git/)
    await assert.rejects(here.start({ project, prompt: 'x', options: { profiles: { profile: '../me' } } }), /A profile is named by its id/)
    await assert.rejects(here.start({ project, prompt: 'x', options: { skills: { project: ['a skill'] } } }), /Skills are named by their names/)
    await assert.rejects(here.start({ project, prompt: 'x', options: { plugins: { without: ['A Plugin'] } } }), /Plugins are named by their names/)
    await assert.rejects(here.start({ project, prompt: 'x', options: { 'agent-driver': { driver: 'codex' } } }), /^Error: Codex is not logged in\.$/)
    assert.equal(runs.length, 0)
    assert.deepEqual(await here.check!({ project, options: { 'agent-driver': { driver: 'codex' } } }), { problems: ['Codex is not logged in.'], warnings: [] })
  } finally {
    await removeRepo(repo)
  }
})

test('a line said to a working run goes to its inbox; one to a run that ended resumes it; a resume needs a run of the project', async () => {
  const repo = await testRepo()
  try {
    const project = projectAt(repo)
    const { host: here, resumes } = host({ isAlive: pid => pid === 4242 })
    const working = '2026-09-16T14-01-00-000Z'
    const ended = '2026-09-16T14-02-00-000Z'
    await liveCard(repo, working, 'running', { pid: 4242, host: HERE })
    await writeMarker(repo, markerCard({ id: ended, startedAt: NOW.toISOString(), prompt: 'fix it', driver: 'claude-code', mark: { host: HERE } }))
    const line: InboxLine = { kind: 'message', text: 'the docs too', id: 'm1', later: true }
    await here.steer({ id: working, project }, line)
    assert.equal(await readFile(inboxPath(worktreePath(repo, working)), 'utf8'), JSON.stringify(line) + '\n')
    assert.equal(resumes.length, 0)
    await here.steer({ id: ended, project }, { kind: 'message', text: 'ship it', publish: 'pr' })
    await here.steer({ id: ended, project }, { kind: 'answer', question: 'Which way?', answer: 'Left' })
    // A take-back or a Send now acts on a turn that runs: with none, it is done.
    await here.steer({ id: ended, project }, { kind: 'now' })
    assert.deepEqual(resumes, [{ id: ended, text: 'ship it', publish: 'pr' }, { id: ended, answer: 'Left' }])
    await assert.rejects(here.resume({ id: 'no-such-run', project }, { text: 'go on' }), /no run no-such-run in this project/)
    await assert.rejects(here.resume({ id: ended, project }, {}), /A run goes on with a message or an answer/)
  } finally {
    await removeRepo(repo)
  }
})

test('a line that reaches a run as it ends resumes it with what is left in its inbox', async () => {
  const repo = await testRepo()
  try {
    const project = projectAt(repo)
    const id = '2026-09-16T14-01-00-000Z'
    await liveCard(repo, id, 'running', { pid: 4242, host: HERE })
    await writeMarker(repo, markerCard({ id, startedAt: NOW.toISOString(), prompt: 'fix it', driver: 'claude-code', mark: { host: HERE } }))
    // Alive at the first look, gone at the second: the run ended while the line was written.
    let looks = 0
    const { host: here, resumes } = host({ isAlive: () => looks++ === 0 })
    await here.steer({ id, project }, { kind: 'message', text: 'the docs too' })
    assert.deepEqual(resumes, [{ id, text: 'the docs too' }])
    assert.equal(await readFile(inboxPath(worktreePath(repo, id)), 'utf8').catch(() => ''), '', 'the line was taken back')
  } finally {
    await removeRepo(repo)
  }
})

test("a Stop signals the process the run's card names, here; a run that ended, or that is elsewhere, is answered why", async () => {
  const repo = await testRepo()
  // A run's process: it says which signals reached it, and ends after the second.
  const child = spawn(process.execPath, ['-e', "let n = 0; const on = s => { process.stdout.write(s + '\\n'); if (++n === 2) process.exit(0) }; process.on('SIGINT', on); process.on('SIGTERM', on); setInterval(() => {}, 1000); process.stdout.write('up\\n')"], { stdio: ['ignore', 'pipe', 'ignore'] })
  try {
    let said = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => (said += chunk))
    while (!said.includes('up')) await new Promise(resolve => setTimeout(resolve, 10))
    const project = projectAt(repo)
    const { host: here } = host()
    const id = '2026-09-16T14-01-00-000Z'
    await liveCard(repo, id, 'running', { pid: child.pid, host: HERE })
    await here.stop({ id, project }, { force: true })
    await new Promise(resolve => child.once('exit', resolve))
    // The run's process takes either signal as the next one (`run.ts`): two, of two kinds so that neither is lost to the other, in whatever order they land.
    assert.deepEqual(said.split('\n').filter(Boolean).sort(), ['SIGINT', 'SIGTERM', 'up'], 'asked to end its turn, then ended at once')

    await assert.rejects(here.stop({ id, project }), /Its process had already ended/)
    await liveCard(repo, id, 'done', { pid: child.pid, host: HERE })
    await assert.rejects(here.stop({ id, project }), /It had already ended/)
    await liveCard(repo, id, 'running', { pid: 4242, host: 'laptop' })
    await assert.rejects(here.stop({ id, project }), /This run is on laptop/)
    await assert.rejects(here.stop({ id: '2026-09-16T15-00-00-000Z', project }), /It has not started yet/)
  } finally {
    child.kill('SIGKILL')
    await removeRepo(repo)
  }
})

test("the runs it lists are the project's records, newest first", async () => {
  const repo = await testRepo()
  try {
    const project = projectAt(repo)
    const { host: here } = host()
    await writeMarker(repo, markerCard({ id: '2026-09-16T14-01-00-000Z', startedAt: '2026-09-16T14:01:00.000Z', prompt: 'first', driver: 'claude-code', mark: { host: HERE } }))
    await writeMarker(repo, markerCard({ id: '2026-09-16T14-05-00-000Z', startedAt: '2026-09-16T14:05:00.000Z', prompt: 'second', driver: 'claude-code', mark: { host: HERE } }))
    assert.deepEqual(await here.list(project), [
      { id: '2026-09-16T14-05-00-000Z', project: 'shop', status: 'working', startedAt: '2026-09-16T14:05:00.000Z', prompt: 'second' },
      { id: '2026-09-16T14-01-00-000Z', project: 'shop', status: 'working', startedAt: '2026-09-16T14:01:00.000Z', prompt: 'first' },
    ])
  } finally {
    await removeRepo(repo)
  }
})

test("where a run's work is: its checkout while it has one, at the branch it has out, with its live card's facts over its record's; else its record alone", async () => {
  const repo = await testRepo()
  try {
    const project = projectAt(repo)
    const { host: here } = host()
    const start = (await git(['rev-parse', 'HEAD'], repo)).trim()

    // Working, in its checkout: the agent renamed its branch, which its card learns at the end; a dashboard wrote its pull request on the record.
    const working = '2026-09-16T14-01-00-000Z'
    const checkout = worktreePath(repo, working)
    await git(['worktree', 'add', '-q', '-b', 'agent-login-fix', checkout, 'main'], repo)
    await writeMarker(repo, { ...markerCard({ id: working, startedAt: NOW.toISOString(), prompt: 'fix it', driver: 'claude-code', mark: { host: HERE, base: 'develop', baseCommit: start } }), status: 'waiting', branch: 'agent-old-name' })
    await patchRun(repo, working, { pr: { number: 7, url: 'https://github.com/o/r/pull/7' } })
    await liveCard(repo, working, 'running', { pid: 4242, host: HERE, base: 'develop', baseCommit: start })
    assert.deepEqual(await here.find({ id: working, project }), {
      checkout,
      record: { status: 'running', host: HERE, branch: 'agent-login-fix', pr: { number: 7 }, base: 'develop', baseCommit: start },
      changedNothing: false,
    })

    // Ended here, its checkout gone, with no pull request and nothing landed: it changed nothing. Landed, or another computer's, it did not say so.
    const ended = '2026-09-16T14-05-00-000Z'
    await writeMarker(repo, { ...markerCard({ id: ended, startedAt: NOW.toISOString(), prompt: 'tidy', driver: 'claude-code', mark: { host: HERE } }), status: 'done', endedAt: NOW.toISOString(), branch: 'agent-tidy' })
    assert.deepEqual(await here.find({ id: ended, project }), { record: { status: 'done', host: HERE, branch: 'agent-tidy' }, changedNothing: true })
    await patchRun(repo, ended, { landed: { commit: start, from: start } })
    assert.deepEqual(await here.find({ id: ended, project }), { record: { status: 'done', host: HERE, baseCommit: start, landed: start }, changedNothing: false })
    const elsewhere = '2026-09-16T14-06-00-000Z'
    await writeMarker(repo, { ...markerCard({ id: elsewhere, startedAt: NOW.toISOString(), prompt: 'tidy', driver: 'claude-code', mark: { host: 'laptop' } }), status: 'done', endedAt: NOW.toISOString() })
    assert.deepEqual(await here.find({ id: elsewhere, project }), { record: { status: 'done', host: 'laptop' }, changedNothing: false })

    // A checkout with no card yet: a run just started, found with nothing known of it. A folder that is no checkout of its own is no run's, and neither is a name that is no run's.
    const starting = '2026-09-16T14-07-00-000Z'
    await git(['worktree', 'add', '-q', '-b', 'agent-starting', worktreePath(repo, starting), 'main'], repo)
    assert.deepEqual(await here.find({ id: starting, project }), { checkout: worktreePath(repo, starting), changedNothing: false })
    const stray = '2026-09-16T14-08-00-000Z'
    await mkdir(worktreePath(repo, stray), { recursive: true })
    assert.equal(await here.find({ id: stray, project }), undefined)
    assert.equal(await here.find({ id: '../escape', project }), undefined)
  } finally {
    await removeRepo(repo)
  }
})

test("a session with no project works in a folder of its own, with no git of its own: that folder is where its work is", async () => {
  const config = await realpath(await mkdtemp(join(tmpdir(), 'agent-runner-sessions-')))
  const before = process.env['XDG_CONFIG_HOME']
  process.env['XDG_CONFIG_HOME'] = config
  try {
    const { host: here } = host()
    const id = '2026-09-16T14-01-00-000Z'
    assert.equal(await here.find({ id }), undefined, 'no folder yet, and no record')
    const folder = sessionFolder(sessionsHome(), id)
    await mkdir(folder, { recursive: true })
    assert.deepEqual(await here.find({ id }), { checkout: folder, changedNothing: false })
  } finally {
    if (before === undefined) delete process.env['XDG_CONFIG_HOME']
    else process.env['XDG_CONFIG_HOME'] = before
    await rm(config, { recursive: true, force: true })
  }
})
