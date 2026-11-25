import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { logCardFile } from '../session-log.js'
import { patchRun } from '../record-store.js'
import { PLUGINS_WITHOUT_ENV, PROFILE_ENV, PROJECT_SKILLS_ENV } from './names.js'
import { sessionFolder, worktreePath } from '@openagt/git-branches'
import { sessionsHome, LOCAL_HOST, NAME_RUNS, PICKED_AGENT, PROFILES, type ProjectRef, type RunHost, type RunReadiness, type InboxLine } from '@openagt/hooks'
import { localHost, type LocalHostDeps } from './host.js'
import { inboxPath, liveDir } from './live-card.js'
import { markerCard, writeMarker } from './records.js'
import { GIT_ACCOUNT_ENV, runArgs, type SpawnedResume, type SpawnedRun } from './runner.js'
import { NAME_FILE_ENV } from './title.js'
import { git, removeRepo, testRepo } from './test-repo.js'
import { NOW } from './run-test-support.js'
import { memorySettings } from '@openagt/hooks/testing'

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
      takesRequests: async () => true,
      hasOrigin: async () => true,
      host: HERE,
      startingMs: 0,
      naming: { names: () => false, name: async () => undefined, prepare: async () => {} },
      ...deps,
    }),
  }
}

const projectAt = (dir: string): ProjectRef => ({ id: 'shop', name: 'shop', dir, remote: 'git.example.com/me/shop' })

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

test('a run whose options name no coding agent is on its profile\'s, else on the one picked for every next run, with that pick\'s model and effort', async () => {
  const repo = await testRepo()
  try {
    const settings = memorySettings()
    await settings.set(PICKED_AGENT, { driver: 'codex', model: 'gpt-5', effort: 'high' })
    await settings.set(PROFILES, [{ id: 'opus', name: 'Opus', options: { 'agent-driver': { driver: 'claude-code', model: 'opus' } } }])
    const checked: (string | undefined)[] = []
    const { host: here, runs } = host({ settings: async () => settings, ready: async (_dir, driver) => (checked.push(driver), NOTHING_WRONG) })
    const project = projectAt(repo)
    await here.start({ project, prompt: 'x', options: {}, title: false })
    await here.start({ project, prompt: 'x', options: { 'agent-driver': { driver: 'claude-code' } }, title: false })
    await here.start({ project, prompt: 'x', options: { profiles: { profile: 'opus' } }, title: false })
    assert.deepEqual(
      runs.map(run => [run.driver, run.model, run.effort]),
      [
        ['codex', 'gpt-5', 'high'],
        ['claude-code', undefined, undefined],
        ['claude-code', 'opus', undefined],
      ],
    )
    await here.check!({ project, options: {} })
    assert.equal(checked.at(-1), 'codex', 'a check is asked of the agent the picks would run')
  } finally {
    await removeRepo(repo)
  }
})

test('a run whose Start brings no name is named as it starts, where the person names runs, and listed by that name until the record has it', async () => {
  const repo = await testRepo()
  try {
    const settings = memorySettings()
    const asked: string[] = []
    const prepared: string[] = []
    const naming = { names: () => true, name: async (_dir: string, prompt: string, driver: string) => (asked.push(`${driver}: ${prompt}`), 'Login fix'), prepare: async (_dir: string, driver: string) => void prepared.push(driver) }
    await settings.set(PICKED_AGENT, { driver: 'codex' })
    const { host: here, runs } = host({ settings: async () => settings, naming })
    const project = projectAt(repo)
    const { id } = await here.start({ project, prompt: 'fix the login', options: {} })
    assert.deepEqual(asked, ['codex: fix the login'])
    assert.ok(runs[0]?.env?.[NAME_FILE_ENV], 'the run is told where its name comes')
    await liveCard(repo, id, 'running', { pid: process.pid, host: HERE })
    assert.equal((await here.list(project)).find(run => run.id === id)?.title, 'Login fix')
    await here.check!({ project, options: {} })
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.deepEqual(prepared, ['codex'], 'a check readies the naming session the next run takes')
    await settings.set(NAME_RUNS, false)
    await here.start({ project, prompt: 'fix the logout', options: {} })
    assert.equal(runs[1]?.env?.['OPENAGENT_NAME_RUN'], '0', 'named by no one: the run keeps the words it was asked')
    assert.equal(asked.length, 1)
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

test("a run goes no further than its project can reach: with no remote the commit, the branch where no module has an account of OpenAgent's at the remote's host; with no project the pick as made", async () => {
  const repo = await testRepo()
  try {
    const asked: string[] = []
    let origin = false
    const { host: here, runs } = host({ takesRequests: async remote => (asked.push(remote), remote.startsWith('git.example.com/')), hasOrigin: async () => origin, settings: async () => memorySettings() })
    const level = async (project: ProjectRef | undefined, publish: 'commit' | 'branch' | 'pr' | 'merge'): Promise<string | undefined> => {
      await here.start({ ...(project ? { project } : {}), prompt: 'x', options: { publish, 'git-branches': { repos: [{ name: 'app', from: '/me/app' }] } }, title: false })
      return runs.at(-1)?.publish
    }
    const { remote: _none, ...local } = projectAt(repo)
    assert.equal(await level(projectAt(repo), 'merge'), 'commit', 'no origin: the commit')
    assert.equal(await level(local, 'commit'), 'commit')
    origin = true
    assert.equal(await level({ ...local, remote: 'elsewhere.dev/me/shop' }, 'pr'), 'branch')
    assert.equal(await level({ ...local, remote: 'elsewhere.dev/me/shop' }, 'branch'), 'branch')
    assert.equal(await level(local, 'merge'), 'branch', 'an origin with no address a host answers for: the branch')
    assert.equal(await level(projectAt(repo), 'merge'), 'merge')
    assert.equal(await level(undefined, 'merge'), 'merge')
    assert.deepEqual(asked, ['elsewhere.dev/me/shop', 'git.example.com/me/shop'], 'a level that is reached anyway asks nothing')
  } finally {
    await removeRepo(repo)
  }
})

test('a session with no project and no repo starts with no Auto level: it has nothing to publish; with a repo the level goes', async () => {
  const { host: here, runs } = host({ settings: async () => memorySettings() })
  await here.start({ prompt: 'x', options: { publish: 'pr' } })
  assert.equal(runs[0]?.publish, undefined)
  await here.start({ prompt: 'x', options: { publish: 'pr', 'git-branches': { repos: [{ name: 'app', from: '/me/app' }] } } })
  assert.equal(runs[1]?.publish, 'pr')
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
    // The repos a message gives the session go with its resume, by their folders.
    await here.steer({ id: ended, project }, { kind: 'message', text: 'compare with the blog', options: { 'git-branches': { repos: [{ name: 'blog', from: '/w/blog' }] } } })
    assert.deepEqual(resumes, [{ id: ended, text: 'ship it', publish: 'pr' }, { id: ended, answer: 'Left' }, { id: ended, text: 'compare with the blog', repos: ['/w/blog'] }])
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

test("the runs it lists are the project's records and its runs at work, newest first, each as it stands: the working run's live card over its record, fact by fact", async () => {
  const repo = await testRepo()
  try {
    const project = projectAt(repo)
    const agents = async () => [{ id: 'claude-code', label: 'Claude Code', ready: async () => NOTHING_WRONG, driver: () => { throw new Error('no driver here') }, resumeCommand: ({ id }: { id: string }) => `claude --resume ${id}` }]
    const { host: here } = host({ agents, isAlive: pid => pid === 4242 })
    const first = '2026-09-16T14-01-00-000Z'
    const second = '2026-09-16T14-05-00-000Z'
    await writeMarker(repo, { ...markerCard({ id: first, startedAt: '2026-09-16T14:01:00.000Z', prompt: 'first', driver: 'claude-code', model: 'opus', mark: { host: HERE, publish: 'pr' } }), status: 'done', endedAt: '2026-09-16T14:02:00.000Z', cost: 0.5 })
    await writeMarker(repo, markerCard({ id: second, startedAt: '2026-09-16T14:05:00.000Z', prompt: 'second', driver: 'claude-code', mark: { host: HERE } }))
    const listed = await here.list(project)
    assert.deepEqual(listed.map(run => [run.id, run.status, run.prompt]), [[second, 'working', 'second'], [first, 'done', 'first']])
    const done = listed[1]!
    assert.deepEqual(
      [done.host, done.project, done.computer, done.cost, done.agent, done.options?.publish, done.endedAt],
      [LOCAL_HOST, 'shop', HERE, 0.5, { id: 'claude-code', model: 'opus' }, 'pr', '2026-09-16T14:02:00.000Z'],
    )
    assert.ok(done.person, 'kept under the person its record is filed under')

    // Resumed in its checkout: its live card says it works, on the branch the checkout has out, its session's command said by its coding agent; the pull request a press wrote on the record stays.
    await patchRun(repo, first, { pr: { number: 7, url: 'https://github.com/o/r/pull/7' } })
    await git(['worktree', 'add', '-q', '-b', 'agent-first', worktreePath(repo, first), 'main'], repo)
    await liveCard(repo, first, 'running', { pid: 4242, host: HERE, sessionId: 's-1', workspace: '/w' })
    const [, again] = await here.list(project)
    assert.deepEqual([again!.status, again!.branch, again!.pr?.number, again!.session], ['working', 'agent-first', 7, { id: 's-1', resume: 'claude --resume s-1' }])

    // Asked for some of them: by id, or since a time.
    assert.deepEqual((await here.list(project, { ids: [first] })).map(run => run.id), [first])
    assert.deepEqual((await here.list(project, { since: '2026-09-16T14:03:00.000Z' })).map(run => run.id), [second])

    // A read never writes: a run whose process died still says it works, until its sweep ends it.
    await liveCard(repo, first, 'running', { pid: 9999, host: HERE })
    assert.deepEqual([(await here.list(project, { ids: [first] }))[0]?.status, (await here.list(project, { ids: [first] }))[0]?.gone], ['working', true])
    // Ended clean, its process still alive here: saving its record.
    await liveCard(repo, first, 'done', { pid: 4242, host: HERE })
    assert.equal((await here.list(project, { ids: [first] }))[0]?.saving, true)

    // A run another host ran is that host's to list.
    const elsewhere = '2026-09-16T14-09-00-000Z'
    await writeMarker(repo, { ...markerCard({ id: elsewhere, startedAt: '2026-09-16T14:09:00.000Z', prompt: 'on the web', driver: 'claude-code', mark: { host: HERE } }), caller: { target: 'web', host: HERE } })
    assert.ok(!(await here.list(project)).some(run => run.id === elsewhere))
  } finally {
    await removeRepo(repo)
  }
})

test("a run's events are its diary's, read as events, from its checkout while it has one, then its record's, with the marker after what is already there", async () => {
  const repo = await testRepo()
  try {
    const project = projectAt(repo)
    const { host: here } = host()
    const id = '2026-09-16T14-01-00-000Z'
    await git(['worktree', 'add', '-q', '-b', 'agent-x', worktreePath(repo, id), 'main'], repo)
    await liveCard(repo, id, 'running', { host: HERE })
    await writeFile(join(liveDir(worktreePath(repo, id)), `${id}.jsonl`), JSON.stringify({ kind: 'said', text: 'hello', at: 't1' }) + '\n')
    const stop = new AbortController()
    const seen: unknown[] = []
    for await (const event of here.events!({ id, project }, stop.signal)) {
      seen.push(event)
      if (event.kind === 'stream-sync') break
    }
    assert.deepEqual(seen, [{ kind: 'driver', event: { type: 'text', text: 'hello' }, at: 't1' }, { kind: 'stream-sync' }])

    // Recorded, its checkout gone: the record's lines.
    const ended = '2026-09-16T14-05-00-000Z'
    await writeMarker(repo, { ...markerCard({ id: ended, startedAt: NOW.toISOString(), prompt: 'tidy', driver: 'claude-code', mark: { host: HERE } }), status: 'done', endedAt: NOW.toISOString() })
    const lines: unknown[] = []
    for await (const event of here.events!({ id: ended, project }, stop.signal)) {
      lines.push(event.kind)
      if (event.kind === 'stream-sync') break
    }
    assert.equal(lines.at(-1), 'stream-sync')

    // No such run, long after its start: nothing comes.
    const none: unknown[] = []
    for await (const event of here.events!({ id: '2020-01-01T00-00-00-000Z', project }, stop.signal)) none.push(event)
    assert.deepEqual(none, [])
    stop.abort()
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
      record: { status: 'running', startedAt: NOW.toISOString(), prompt: 'fix it', options: { 'agent-driver': { driver: 'claude-code' }, 'git-branches': { base: 'develop' } }, host: HERE, branch: 'agent-login-fix', pr: { number: 7, url: 'https://github.com/o/r/pull/7' }, base: 'develop', baseCommit: start },
      changedNothing: false,
    })

    /** What the record of a run that ended keeps of it, beside where its work is: when it started and ended, what it was asked, its options. */
    const endedRecord = (prompt: string) => ({ status: 'done', startedAt: NOW.toISOString(), endedAt: NOW.toISOString(), prompt, options: { 'agent-driver': { driver: 'claude-code' } } })

    // Ended here, its checkout gone, with no pull request and nothing landed: it changed nothing. Landed, or another computer's, it did not say so.
    const ended = '2026-09-16T14-05-00-000Z'
    await writeMarker(repo, { ...markerCard({ id: ended, startedAt: NOW.toISOString(), prompt: 'tidy', driver: 'claude-code', mark: { host: HERE } }), status: 'done', endedAt: NOW.toISOString(), branch: 'agent-tidy' })
    assert.deepEqual(await here.find({ id: ended, project }), { record: { ...endedRecord('tidy'), host: HERE, branch: 'agent-tidy' }, changedNothing: true })
    await patchRun(repo, ended, { landed: { commit: start, from: start } })
    assert.deepEqual(await here.find({ id: ended, project }), { record: { ...endedRecord('tidy'), host: HERE, baseCommit: start, landed: start }, changedNothing: false })
    const elsewhere = '2026-09-16T14-06-00-000Z'
    await writeMarker(repo, { ...markerCard({ id: elsewhere, startedAt: NOW.toISOString(), prompt: 'tidy', driver: 'claude-code', mark: { host: 'laptop' } }), status: 'done', endedAt: NOW.toISOString() })
    assert.deepEqual(await here.find({ id: elsewhere, project }), { record: { ...endedRecord('tidy'), host: 'laptop' }, changedNothing: false })

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
