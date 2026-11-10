import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentExitError, FakeDriver, type Driver, type FakeDriverSession } from '@openagt/agent-driver'
import { worktreePath } from '@openagt/skill-branches'
import { findRun } from '@openagt/skill-logs'
import { readLiveCard } from './live-card.js'
import { lockHolder } from './run-lock.js'
import { runCommand } from './run.js'
import { markerCard, writeMarker } from './records.js'
import { sweep } from './sweep.js'
import { NAME_FILE_ENV } from './title.js'
import { git, handDownBasicSkills, readUntimedDiary, removeRepo, testRepo } from './test-repo.js'
import { NOW, noGitHost, fakeGitHost, wrap, QUESTION, committingDriver, ticking } from './run-test-support.js'

// A run as OpenAgent starts it: with the basic skills handed down.
handDownBasicSkills()

// One run end to end on a real repository, with the agent faked: the marker, the checkout, the
// live card the session keeps, the record with what the agent said and cost, the reclaim; a run
// that ends on a question, kept and resumed with the answer.

test('a run: marker, checkout, the live card, the prompt once, the record, the checkout reclaimed, its branch kept and not pushed', async () => {
  const repo = await testRepo()
  try {
    const seen: { cwd: string; card?: unknown } = { cwd: '' }
    const mainAt = (await git(['rev-parse', 'origin/main'], repo)).trim()
    const driver = committingDriver()
    const wrapped: Driver = {
      id: driver.id,
      start: async opts => {
        const session = await driver.start(opts)
        // Mid-run: the live card is what the dashboard reads, running under this pid.
        await session.log?.settled()
        seen.cwd = opts.cwd
        seen.card = await readLiveCard(opts.cwd, '2026-09-16T14-01-00-000Z')
        return session
      },
    }
    const gitHost = fakeGitHost('agent-fix-it')
    gitHost.open()
    const outcome = await runCommand(repo, { prompt: '/work-queue', model: 'opus', driver: wrapped, host: 'this-box', pid: 4242, now: () => NOW, gitHost })
    assert.equal(outcome.id, '2026-09-16T14-01-00-000Z')
    assert.equal(outcome.status, 'done')
    assert.equal(outcome.branch, 'agent-fix-it')
    assert.deepEqual(gitHost.calls, [['requests', 'agent-fix-it']], 'the pull request is asked of the git host for the branch the agent named')
    assert.deepEqual(outcome.pr, { number: 12, url: 'https://example.com/x/y/pull/12' })
    assert.equal(outcome.cost, 0.5)
    assert.deepEqual(outcome.checkout, { reclaimed: true })

    const card = seen.card as Record<string, unknown>
    assert.equal(seen.cwd, worktreePath(repo, outcome.id))
    assert.equal(card['status'], 'running')
    assert.equal(card['intent'], '/work-queue')
    assert.equal(card['model'], 'opus', 'before the agent has run, the card holds the model it was given')
    assert.equal(card['branch'], 'agent-2026-09-16T14-01-00-000Z')
    assert.deepEqual(card['caller'], { runner: { host: 'this-box', pid: 4242, baseCommit: mainAt }, pid: 4242, host: 'this-box', baseCommit: mainAt, kind: 'prompt', workspace: seen.cwd })

    // The checkout went: the branch stays here, unpushed, and the record says where the work is.
    assert.equal(await stat(worktreePath(repo, outcome.id)).then(() => true, () => false), false)
    assert.equal((await git(['rev-parse', '--verify', 'refs/heads/agent-fix-it'], repo)).trim().length, 40)
    await assert.rejects(() => git(['rev-parse', '--verify', 'refs/remotes/origin/agent-fix-it'], repo), 'nothing is pushed for the agent')
    const recorded = await findRun(repo, outcome.id)
    assert.equal(recorded?.status, 'done')
    assert.equal(recorded?.branch, 'agent-fix-it')
    assert.deepEqual(recorded?.pr, { number: 12, url: 'https://example.com/x/y/pull/12' })
    assert.equal(recorded?.cost, 0.5)
    assert.equal(recorded?.model, 'claude-opus-5-5', 'the record names the model the agent ran, not the alias it was given')
    assert.equal(recorded?.driver, 'fake')
    assert.equal(recorded?.caller?.['sessionId'], 's-1')
    assert.deepEqual(recorded?.caller?.['runner'], { host: 'this-box', pid: 4242, baseCommit: mainAt })
    const diary = await readUntimedDiary(repo, outcome.id)
    assert.deepEqual(diary.map(line => line.kind), ['start', 'said', 'result', 'cost', 'ended'])
    assert.deepEqual(diary.find(l => l.kind === 'said'), { kind: 'said', text: 'Fixed it and committed.' })
    assert.deepEqual(diary.at(-1), { kind: 'ended', status: 'done' })

    // The live directory was hidden in the run's checkout alone: the project's own is still
    // one it can track a file in, as a project that shares its presets does.
    await mkdir(join(repo, '.openagent'))
    await writeFile(join(repo, '.openagent', '.gitignore'), '*\n!.gitignore\n')
    await git(['add', '.openagent'], repo)
    assert.equal((await git(['diff', '--cached', '--name-only'], repo)).trim(), '.openagent/.gitignore')
  } finally {
    await removeRepo(repo)
  }
})

test("an agent that commits nothing: done, no PR, its empty branch goes with the checkout; a driver that throws: failed with the reason, checkout reclaimed", async () => {
  const repo = await testRepo()
  try {
    const quiet = await runCommand(repo, { prompt: '/work-queue', model: 'opus', driver: new FakeDriver({ turns: [{ text: 'Nothing is queued.' }] }), now: () => NOW, gitHost: noGitHost })
    assert.equal(quiet.status, 'done')
    assert.equal(quiet.pr, undefined)
    assert.deepEqual(quiet.checkout, { reclaimed: true })
    assert.equal((await git(['branch', '--list', `agent-${quiet.id}`], repo)).trim(), '', 'a branch holding nothing goes with its checkout')
    const quietRecord = await findRun(repo, quiet.id)
    assert.equal(quietRecord?.status, 'done')
    assert.equal(quietRecord?.branch, undefined, 'and the record names no branch that is gone')

    const dying: Driver = { id: 'fake', start: async () => { throw new Error('claude: not logged in') } }
    const failed = await runCommand(repo, { prompt: '/work-queue', model: 'opus', driver: dying, now: () => new Date(NOW.getTime() + 60_000), gitHost: noGitHost })
    assert.equal(failed.status, 'failed')
    assert.equal(failed.detail, 'claude: not logged in')
    const card = await findRun(repo, failed.id)
    assert.equal(card?.status, 'failed')
    assert.deepEqual((await readUntimedDiary(repo, failed.id)).at(-1), { kind: 'ended', status: 'failed', detail: 'claude: not logged in' })
  } finally {
    await removeRepo(repo)
  }
})

test('a run is named by the agent\'s small model: the name on its record, and a line in its diary', async () => {
  const repo = await testRepo()
  try {
    // The run's agent and the one that names it are the same CLI, so one fake answers both: the
    // naming session is the one asked to name something.
    const driver: Driver = {
      id: 'claude-code',
      start: opts => new FakeDriver({ respond: prompt => (prompt.includes('Name this coding session') ? 'README.md condensing' : 'Done.') }).start(opts),
    }
    const run = await runCommand(repo, { prompt: 'make readme.md shorter', driver, now: () => NOW, gitHost: noGitHost })
    assert.equal(run.status, 'done')
    const record = await findRun(repo, run.id)
    assert.equal(record?.title, 'README.md condensing')
    assert.equal(record?.intent, 'make readme.md shorter', 'the words the person typed are kept as they were')
    assert.deepEqual(
      (await readUntimedDiary(repo, run.id)).filter(line => line.kind === 'title'),
      [{ kind: 'title', text: 'README.md condensing' }],
      'the conversation says where the name came from, once',
    )

    // A subagent is not named: its row is the task its main agent gave it.
    const child = await runCommand(repo, { prompt: 'check the links', driver, parent: run.id, now: () => new Date(NOW.getTime() + 60_000), gitHost: noGitHost })
    assert.equal((await findRun(repo, child.id))?.title, undefined)

    // Naming turned off by the person: whoever started this process said so in its environment, and
    // the run keeps the words they typed. Nothing is asked of a model, so nothing is paid for.
    const was = process.env.OPENAGENT_NAME_RUN
    process.env.OPENAGENT_NAME_RUN = '0'
    try {
      const unnamed = await runCommand(repo, { prompt: 'make readme.md shorter again', driver, now: () => new Date(NOW.getTime() + 120_000), gitHost: noGitHost })
      assert.equal((await findRun(repo, unnamed.id))?.title, undefined)
      assert.deepEqual((await readUntimedDiary(repo, unnamed.id)).filter(line => line.kind === 'title'), [])
    } finally {
      if (was === undefined) delete process.env.OPENAGENT_NAME_RUN
      else process.env.OPENAGENT_NAME_RUN = was
    }
  } finally {
    await removeRepo(repo)
  }
})

test('a fresh run is named while its checkout is made, not after its agent has started: the name is the first thing a person waits on', async () => {
  const repo = await testRepo()
  try {
    let askedToName: () => void = () => {}
    const naming = new Promise<void>(resolve => (askedToName = resolve))
    const driver: Driver = {
      id: 'claude-code',
      start: async opts =>
        wrap((await new FakeDriver({ respond: prompt => (prompt.includes('Name this coding session') ? 'Readme condensing' : 'Done.') }).start(opts)) as FakeDriverSession, async text => {
          if (text.includes('Name this coding session')) askedToName()
        }),
    }
    // The checkout waits on its skills: here, until the name was asked for, which only a run that
    // asks first gets to before its checkout is made. A run that asked after its agent started
    // would never get there, and the wait gives up.
    let namedFirst = false
    const skills = async () => {
      namedFirst = await Promise.race([naming.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5_000))])
      return []
    }
    const run = await runCommand(repo, { prompt: 'make readme.md shorter', driver, skills, now: () => NOW, gitHost: noGitHost })
    assert.equal(run.status, 'done')
    assert.equal(namedFirst, true)
    assert.equal((await findRun(repo, run.id))?.title, 'Readme condensing')
  } finally {
    await removeRepo(repo)
  }
})

test('a run handed the name its starter asked for keeps that one, and asks none of its own', async () => {
  const repo = await testRepo()
  const dir = await mkdtemp(join(tmpdir(), 'handed-name-'))
  try {
    const asked: string[] = []
    const driver: Driver = {
      id: 'claude-code',
      start: opts =>
        new FakeDriver({
          respond: prompt => {
            asked.push(prompt)
            return prompt.includes('Name this coding session') ? 'Asked by the run' : 'Done.'
          },
        }).start(opts),
    }
    // The dashboard asked a naming session it kept waiting, and writes the name once it is in.
    const file = join(dir, 'name.json')
    await writeFile(file, JSON.stringify({ title: 'Readme condensing' }))
    process.env[NAME_FILE_ENV] = file
    const run = await runCommand(repo, { prompt: 'make readme.md shorter', driver, now: () => NOW, gitHost: noGitHost })
    assert.equal((await findRun(repo, run.id))?.title, 'Readme condensing')
    assert.ok(!asked.some(prompt => prompt.includes('Name this coding session')), 'no name asked twice')

    // Asked before the run's driver could be made (`runProject`, before the git host's account): taken as it is.
    const early = await runCommand(repo, {
      prompt: 'make readme.md shorter again',
      naming: { title: Promise.resolve('Started early'), stop: new AbortController() },
      driver,
      now: () => new Date(NOW.getTime() + 60_000),
      gitHost: noGitHost,
    })
    assert.equal((await findRun(repo, early.id))?.title, 'Started early')
  } finally {
    delete process.env[NAME_FILE_ENV]
    await rm(dir, { recursive: true, force: true })
    await removeRepo(repo)
  }
})

test('a run asked only a slash command keeps it while it works, and is named from its agent\'s report', async () => {
  const repo = await testRepo()
  try {
    const asked: string[] = []
    const driver: Driver = {
      id: 'claude-code',
      start: opts =>
        new FakeDriver({
          respond: prompt => {
            if (!prompt.includes('Name this coding session')) return 'I planned the ticket "base-ui rename warnings".'
            asked.push(prompt)
            return 'Base-ui rename plan'
          },
        }).start(opts),
    }
    const run = await runCommand(repo, { prompt: '/work-queue', driver, now: () => NOW, gitHost: noGitHost })
    assert.equal(run.status, 'done')
    assert.equal(asked.length, 1, 'named once, not also from the command')
    assert.match(asked[0]!, /--------\nI planned the ticket "base-ui rename warnings"\.\n--------/)
    const record = await findRun(repo, run.id)
    assert.equal(record?.title, 'Base-ui rename plan')
    assert.equal(record?.intent, '/work-queue')
    // The name is said before the run ended, so the ended line stays the diary's last.
    const kinds = (await readUntimedDiary(repo, run.id)).map(line => line.kind)
    assert.ok(kinds.indexOf('title') < kinds.indexOf('ended'))
    assert.equal(kinds.at(-1), 'ended')

    // A run that ends on a question has not reported its work: it is not named from the question.
    const asking: Driver = { id: 'claude-code', start: opts => new FakeDriver({ respond: prompt => (prompt.includes('Name this coding session') ? 'Ship it question' : QUESTION) }).start(opts) }
    const waiting = await runCommand(repo, { prompt: '/work-queue', driver: asking, now: () => new Date(NOW.getTime() + 60_000), gitHost: noGitHost })
    assert.equal(waiting.status, 'waiting')
    assert.equal((await findRun(repo, waiting.id))?.title, undefined)
  } finally {
    await removeRepo(repo)
  }
})

test('a run\'s card says its name is being asked while it is, not once the ask ends without one, nor for a slash command', async () => {
  const repo = await testRepo()
  try {
    let answer: (title: string | undefined) => void = () => {}
    const title = new Promise<string | undefined>(resolve => (answer = resolve))
    const seen: unknown[] = []
    const driver: Driver = {
      id: 'claude-code',
      start: async opts => {
        const fake = (await new FakeDriver({ respond: () => 'Done.' }).start(opts)) as FakeDriverSession
        // What the card says once the writes made so far have landed.
        const naming = async () => {
          await fake.log?.settled()
          return (await readLiveCard(opts.cwd, opts.log!.card.id))?.caller?.['naming']
        }
        return wrap(fake, async () => {
          seen.push(await naming())
          answer(undefined)
          for (let tries = 0; (await naming()) === true && tries < 100; tries++) await new Promise(resolve => setTimeout(resolve, 20))
          seen.push(await naming())
        })
      },
    }
    const run = await runCommand(repo, { prompt: 'make readme.md shorter', naming: { title, stop: new AbortController() }, driver, now: () => NOW, gitHost: noGitHost })
    assert.deepEqual(seen, [true, undefined])
    assert.equal((await findRun(repo, run.id))?.title, undefined)

    // A slash command is named from its report, at its end: nothing is asked while it works.
    seen.length = 0
    await runCommand(repo, { prompt: '/work-queue', driver, now: () => new Date(NOW.getTime() + 60_000), gitHost: noGitHost })
    assert.deepEqual(seen, [undefined, undefined])
  } finally {
    await removeRepo(repo)
  }
})

test('a run told how hard to think starts its agent that way and keeps it on its record', async () => {
  const repo = await testRepo()
  try {
    const starts: (string | undefined)[] = []
    const driver: Driver = {
      id: 'claude-code',
      start: opts => {
        starts.push(opts.effort)
        return new FakeDriver({ respond: () => 'Done.' }).start(opts)
      },
    }
    const run = await runCommand(repo, { prompt: 'think about it', effort: 'high', driver, now: () => NOW, gitHost: noGitHost })
    assert.equal(run.status, 'done')
    // The naming session is the agent's own small model and thinks as it does by default; the run's
    // own session is the one told.
    assert.ok(starts.includes('high'))
    assert.equal((await findRun(repo, run.id))?.effort, 'high')
  } finally {
    await removeRepo(repo)
  }
})

test('a run marked by another tool keeps that tool\'s own fields on its record, to the end', async () => {
  const repo = await testRepo()
  try {
    // What `orchestration start` writes before it spawns the run: the task's name as the run's
    // title, and the task's id under the writer's own key. Neither is an argument of the run.
    const marker = markerCard({ id: 'sub-1', startedAt: NOW.toISOString(), prompt: 'write about.html', driver: 'fake', mark: { host: 'laptop', pid: 1, parent: 'main-1' } })
    await writeMarker(repo, { ...marker, title: 'Write about.html from the README', caller: { ...marker.caller, task: 'write-about-html', retries: 'sub-0' } })
    const run = await runCommand(repo, { prompt: 'write about.html', id: 'sub-1', marked: true, driver: new FakeDriver({ respond: () => 'Done.' }), now: () => NOW, gitHost: noGitHost })
    assert.equal(run.status, 'done')
    const ended = await findRun(repo, 'sub-1')
    assert.equal(ended?.status, 'done', 'the run ended and wrote its own record')
    assert.equal(ended?.title, 'Write about.html from the README', 'the title the tool gave it survives the end of the run')
    assert.equal(ended?.caller?.['task'], 'write-about-html', 'and so does the task its row is named by')
    assert.equal(ended?.caller?.['retries'], 'sub-0', 'every key of the writer\'s, not a list this code knows')
    // What the run itself knows is the run's: a marker never speaks over it.
    assert.equal(ended?.caller?.['pid'], process.pid, 'the pid is this process\'s, not the marker\'s')
    assert.equal(ended?.status, 'done', 'and the status is the one it ended with, never the marker\'s `running`')
  } finally {
    await removeRepo(repo)
  }
})

test('the tick\'s run does not mark itself again, and a dirty tree keeps the checkout with the reason', async () => {
  const repo = await testRepo()
  try {
    const messy: Driver = {
      id: 'fake',
      start: async opts => {
        const fake = await new FakeDriver({ turns: [{ text: 'left a mess' }] }).start(opts)
        return wrap(fake, async () => {
          await writeFile(join(opts.cwd, 'scratch.txt'), 'uncommitted\n')
        })
      },
    }
    const outcome = await runCommand(repo, { prompt: '/work-queue', id: 'given-id', marked: true, model: 'opus', driver: messy, now: () => NOW, gitHost: noGitHost })
    assert.equal(outcome.id, 'given-id')
    assert.equal(outcome.status, 'done')
    assert.deepEqual(outcome.checkout, { reclaimed: false, reason: 'dirty' })
    assert.equal(await readFile(join(worktreePath(repo, 'given-id'), 'scratch.txt'), 'utf8'), 'uncommitted\n')
    // The record was still written, over no marker, since the tick's marker is the tick's.
    assert.equal((await findRun(repo, 'given-id'))?.status, 'done')
  } finally {
    await removeRepo(repo)
  }
})


test("a run holds its lock while the agent works: a sweep of this machine leaves it alone, and the lock goes once the run has answered", async () => {
  const repo = await testRepo()
  try {
    const id = '2026-09-16T14-01-00-000Z'
    const isAlive = (pid: number) => pid === 4242
    const seen: { holder?: number | undefined; swept?: Awaited<ReturnType<typeof sweep>>; card?: string | undefined; checkout?: boolean } = {}
    const working: Driver = {
      id: 'fake',
      start: async opts => {
        const fake = await new FakeDriver({ turns: [{ text: 'Done.' }] }).start(opts)
        return wrap(fake, async () => {
          // Mid-turn, the live card says running: the lock names the run's process, and a sweep on
          // this machine, a scheduler's tick, finds the run held and touches nothing.
          await fake.log?.settled()
          seen.holder = await lockHolder(repo, id, isAlive)
          seen.swept = await sweep(repo, { host: 'this-box', isAlive, now: () => NOW })
          seen.card = (await readLiveCard(opts.cwd, id))?.status
          seen.checkout = await stat(opts.cwd).then(s => s.isDirectory(), () => false)
        })
      },
    }
    const outcome = await runCommand(repo, { prompt: '/work-queue', model: 'opus', driver: working, host: 'this-box', pid: 4242, isAlive, now: () => NOW, gitHost: noGitHost })
    assert.equal(seen.holder, 4242, 'the lock is held through the session')
    assert.deepEqual(seen.swept, { recorded: [], reclaimed: [], kept: [] })
    assert.equal(seen.card, 'running')
    assert.equal(seen.checkout, true, 'the checkout survives the sweep')
    assert.equal(outcome.status, 'done')
    assert.deepEqual(outcome.checkout, { reclaimed: true })
    assert.equal(await lockHolder(repo, id, isAlive), undefined, 'let go once the run has answered')
  } finally {
    await removeRepo(repo)
  }
})

/** A git host package declared in the test repository: `openagent.git-host` in its package.json, a command that keeps every call and answers canned pull requests. */
const GIT_HOST_PACKAGE = `
const { appendFileSync } = require('node:fs')
const { join } = require('node:path')
const args = process.argv.slice(2)
appendFileSync(join(__dirname, 'calls.log'), args.join(' ') + '\\n')
if (args[0] === 'requests') process.stdout.write(JSON.stringify([{ number: 7, url: 'https://example.com/p/pull/7', state: 'open', title: 'Fix it', draft: false, branch: args[2], head: 'abc', createdAt: '2026-09-16T14:02:00.000Z' }]))
else { process.stderr.write('unknown\\n'); process.exit(2) }
`

test('the git host is the package the project declares: a run reads its pull request through that command', async () => {
  const repo = await testRepo()
  try {
    const dir = join(repo, 'node_modules', 'git-host-fake')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'git-host-fake', bin: { 'git-host-fake': 'cli.cjs' }, openagent: { 'git-host': 'git-host-fake' } }))
    await writeFile(join(dir, 'cli.cjs'), GIT_HOST_PACKAGE)
    await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'project', devDependencies: { 'git-host-fake': '*' } }))
    await git(['add', 'package.json'], repo)
    await git(['commit', '-q', '-m', 'the git host package'], repo)
    await git(['push', '-q', 'origin', 'main'], repo)

    const outcome = await runCommand(repo, { prompt: '/work-queue', driver: committingDriver(), now: ticking() })
    assert.equal(outcome.status, 'done')
    assert.deepEqual(outcome.pr, { number: 7, url: 'https://example.com/p/pull/7' })
    const calls = (await readFile(join(dir, 'calls.log'), 'utf8')).trim().split('\n')
    assert.deepEqual(calls, ['requests --branch agent-fix-it'])
  } finally {
    await removeRepo(repo)
  }
})

test("a checkout whose project tracks its own .gitignore in the live directory keeps it as it is", async () => {
  const repo = await testRepo()
  try {
    await mkdir(join(repo, '.openagent'))
    await writeFile(join(repo, '.openagent', '.gitignore'), '*\n!.gitignore\n')
    await git(['add', '.openagent'], repo)
    await git(['commit', '-qm', 'add the project'], repo)
    await git(['push', '-q', 'origin', 'HEAD'], repo)
    const outcome = await runCommand(repo, { prompt: '/work-queue', model: 'opus', driver: new FakeDriver({ turns: [{ text: 'Nothing to do.' }] }), now: () => NOW, gitHost: noGitHost })
    assert.equal(outcome.status, 'done')
    assert.deepEqual(outcome.checkout, { reclaimed: true }, 'the checkout stayed clean: its tracked .gitignore unchanged, the live files ignored')
  } finally {
    await removeRepo(repo)
  }
})

test("an agent whose process exits with an error: the ended line says it exited, since the agent's error line already says why", async () => {
  const repo = await testRepo()
  try {
    const exiting: Driver = {
      id: 'fake',
      start: async opts => {
        const session = await new FakeDriver().start(opts)
        return Object.assign(session, { prompt: async () => Promise.reject(new AgentExitError('codex', 1, "You've hit your usage limit.")) })
      },
    }
    const failed = await runCommand(repo, { prompt: 'say hi', driver: exiting, now: () => NOW, gitHost: noGitHost })
    assert.equal(failed.status, 'failed')
    assert.equal(failed.detail, "codex exited (1): You've hit your usage limit.")
    assert.deepEqual((await readUntimedDiary(repo, failed.id)).at(-1), { kind: 'ended', status: 'failed', detail: 'codex exited (1)' })
  } finally {
    await removeRepo(repo)
  }
})
