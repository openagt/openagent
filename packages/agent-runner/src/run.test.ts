import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AgentExitError, appendInbox, FakeDriver, promptSent, type Driver, type DriverSession, type DriverStartOptions, type FakeDriverSession } from '@openagt/agent-driver'
import { worktreePath } from '@openagt/skill-branches'
import { findRun, patchRun, readDiary } from '@openagt/skill-logs'
import { inboxPath, readLiveCard } from './live-card.js'
import { acquireRunLock, lockHolder, releaseRunLock } from './run-lock.js'
import { addedLine, HOLD_MERGE_LINE, PUBLISH_LINES, resumeRun, runCommand, STOPPED_DETAIL } from './run.js'
import { markerCard, recordRun, runnerMark, writeMarker } from './records.js'
import type { GitHost } from './git-host.js'
import { sweep } from './sweep.js'
import { git, readUntimedDiary, removeRepo, testRepo } from './test-repo.js'

// One run end to end on a real repository, with the agent faked: the marker, the checkout, the
// live card the session keeps, the record with what the agent said and cost, the reclaim; a run
// that ends on a question, kept and resumed with the answer.

const NOW = new Date('2026-09-16T14:01:00.000Z')

/** A git host with no pull request for any branch: what a run whose agent opened none reads. */
const noGitHost: GitHost = { requestOfBranch: async () => undefined, mergeRequest: async () => ({ outcome: 'failed', error: 'nothing to merge' }) }

/**
 * A git host holding one pull request for one branch, once the agent has opened it (`open()`): read
 * back by the run, merged by the follow-up's end. Every call is kept.
 */
function fakeGitHost(branch: string, hook?: () => Promise<void>): GitHost & { open(): void; calls: string[][] } {
  let opened = false
  const calls: string[][] = []
  return {
    calls,
    open: () => (opened = true),
    requestOfBranch: async (_repo, asked) => {
      calls.push(['requests', asked])
      await hook?.()
      return opened && asked === branch ? { number: 12, url: 'https://example.com/x/y/pull/12' } : undefined
    },
    mergeRequest: async (_repo, number) => {
      calls.push(['merge', String(number)])
      return { outcome: 'auto-armed' }
    },
  }
}


/** A fake session with something done before each prompt, handed the prompt as the agent is sent it, the attached text and the added sentence after it: the spread of a class instance loses its methods, so the wrapper is explicit. */
function wrap(fake: FakeDriverSession, before: (text: string) => Promise<void>): DriverSession & { prompts: string[] } {
  return {
    id: fake.id,
    cwd: fake.cwd,
    prompts: fake.prompts,
    ...(fake.log ? { log: fake.log } : {}),
    prompt: async (text, opts) => {
      await before(promptSent(text, opts ?? {}))
      return fake.prompt(text, opts)
    },
    dispose: () => fake.dispose(),
  }
}

const QUESTION = 'Plan written.\n\n```await-choices\n{ "title": "Ship it?", "options": [{ "label": "Approve" }, { "label": "Decline", "stop": true }], "recommended": "Approve" }\n```\n'

/** An agent that commits one file on a branch it names itself, the way a real one does. */
function committingDriver(): Driver {
  return {
    id: 'fake',
    start: async (opts: DriverStartOptions): Promise<DriverSession> => {
      const fake = await new FakeDriver({
        respond: () => ({ text: 'Fixed it and committed.', usage: { costUsd: 0.5, inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 } }),
        sessionId: 's-1',
        model: 'claude-opus-5-5',
      }).start(opts)
      return wrap(fake, async () => {
        await git(['config', 'user.email', 'agent@example.com'], opts.cwd)
        await git(['config', 'user.name', 'agent'], opts.cwd)
        await git(['branch', '-m', 'agent-fix-it'], opts.cwd)
        await writeFile(join(opts.cwd, 'fixed.txt'), 'fixed\n')
        await git(['add', '-A'], opts.cwd)
        await git(['commit', '-q', '-m', 'Fix it'], opts.cwd)
      })
    },
  }
}

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

test('a signal to the run\'s process stops it: the session aborted, the run recorded `stopped`, the checkout reclaimed', async () => {
  const repo = await testRepo()
  try {
    let prompted!: () => void
    const started = new Promise<void>(resolve => (prompted = resolve))
    // An agent that works until told to stop, the way agent-driver ends a session on its signal.
    const patient: Driver = {
      id: 'fake',
      start: async (opts: DriverStartOptions): Promise<DriverSession> => {
        const fake = await new FakeDriver({ turns: [{ text: 'Working…' }] }).start(opts)
        return {
          id: fake.id,
          cwd: fake.cwd,
          ...(fake.log ? { log: fake.log } : {}),
          prompt: async (text, promptOpts) => {
            const turn = await fake.prompt(text, promptOpts)
            prompted()
            // A bound wait: nothing else holds the event loop open while the signal is in flight.
            await new Promise<void>((_, reject) => {
              const timer = setTimeout(() => reject(new Error('no signal within 5s')), 5000)
              opts.signal!.addEventListener('abort', () => {
                clearTimeout(timer)
                reject(new Error('fake prompt aborted'))
              }, { once: true })
            })
            return turn
          },
          dispose: () => fake.dispose(),
        }
      },
    }
    const running = runCommand(repo, { prompt: '/work-queue', model: 'opus', driver: patient, now: () => NOW, gitHost: noGitHost })
    await started
    process.kill(process.pid, 'SIGINT') // what a dashboard's Stop sends; this test's own process has the run's handler
    const outcome = await running
    assert.equal(outcome.status, 'stopped')
    assert.equal(outcome.detail, STOPPED_DETAIL)
    assert.deepEqual(outcome.checkout, { reclaimed: true })
    const card = await findRun(repo, outcome.id)
    assert.equal(card?.status, 'stopped')
    const diary = await readUntimedDiary(repo, outcome.id)
    assert.deepEqual(diary.find(l => l.kind === 'said'), { kind: 'said', text: 'Working…' })
    assert.deepEqual(diary.at(-1), { kind: 'ended', status: 'stopped', detail: STOPPED_DETAIL })
  } finally {
    await removeRepo(repo)
  }
})

test('a run whose last turn asked ends waiting and keeps its checkout; the answer resumes the same run, which then ends done and reclaimed', async () => {
  const repo = await testRepo()
  try {
    // First session: the agent asks. Second session, resumed by the recorded id: it finishes.
    const asking = new FakeDriver({ turns: [{ text: QUESTION }], sessionId: 's-ask' })
    const first = await runCommand(repo, { prompt: '/work-queue', model: 'opus', driver: asking, host: 'this-box', pid: 4242, now: () => NOW, gitHost: noGitHost })
    assert.equal(first.status, 'waiting')
    assert.deepEqual(first.checkout, { reclaimed: false, reason: 'waiting' })
    assert.equal(await stat(worktreePath(repo, first.id)).then(() => true, () => false), true, 'the checkout waits for the answer')
    const waiting = await findRun(repo, first.id)
    assert.equal(waiting?.status, 'waiting')
    assert.equal(waiting?.caller?.['sessionId'], 's-ask')
    const before = await readUntimedDiary(repo, first.id)
    assert.deepEqual(before.map(l => l.kind), ['start', 'said', 'result', 'question', 'ended'])
    assert.deepEqual(before.at(-1), { kind: 'ended', status: 'waiting' })

    // A message written to the inbox before the turn ended would have been drained; here nothing waited.
    assert.equal(await stat(inboxPath(worktreePath(repo, first.id))).then(() => true, () => false), false)

    // The agent's own run got the basic skills; a checkout that stayed from an older version lacks them.
    const question = join(worktreePath(repo, first.id), '.claude', 'skills', 'question')
    assert.match(await readFile(join(question, 'SKILL.md'), 'utf8'), /^name: question$/m, 'a run\'s checkout carries the basic skills')
    await unlink(question)

    let resumedWith: string | undefined
    let questionAtResume = ''
    const finishing: Driver = {
      id: 'fake',
      start: async opts => {
        resumedWith = opts.resumeSessionId
        questionAtResume = await readFile(join(opts.cwd, '.claude', 'skills', 'question', 'SKILL.md'), 'utf8').catch(() => '')
        return new FakeDriver({ turns: [{ text: 'Shipped.' }], sessionId: 's-ask' }).start(opts)
      },
    }
    const second = await resumeRun(repo, { id: first.id, answer: 'Approve', driver: finishing, host: 'this-box', pid: 4243, now: () => new Date(NOW.getTime() + 3_600_000), gitHost: noGitHost })
    assert.equal(resumedWith, 's-ask', 'the session resumes by the id the record carries')
    assert.equal(second.id, first.id, 'the same run')
    assert.match(questionAtResume, /^name: question$/m, 'a kept checkout is given the links a new one gets before the agent goes on')
    assert.equal(second.status, 'done')
    assert.deepEqual(second.checkout, { reclaimed: true })
    const done = await findRun(repo, first.id)
    assert.equal(done?.status, 'done')
    assert.equal(done?.startedAt, NOW.toISOString(), 'the start is the original one')
    const after = await readUntimedDiary(repo, first.id)
    assert.deepEqual(after.map(l => l.kind), ['start', 'said', 'result', 'question', 'ended', 'start', 'said', 'result', 'ended'], 'the diary goes on from where it stopped')
    assert.deepEqual(after.at(-1), { kind: 'ended', status: 'done' })
    const resumePrompt = after.find((l, i) => l.kind === 'start' && i > 4)
    assert.equal(resumePrompt?.['prompt'], 'You paused to ask: "Ship it?". The user chose: Approve. Continue with that decision.')
  } finally {
    await removeRepo(repo)
  }
})

test("the person's ended line runs when a run ends waiting and when it ends done with a new pull request, never again for the same one", async () => {
  const repo = await testRepo()
  try {
    const out = join(repo, '..', 'ended.txt')
    await mkdir(join(repo, '.agent-runner'), { recursive: true })
    await writeFile(join(repo, '.agent-runner', 'config.yml'), `ended: printf '%s|%s|%s|%s\\n' "$STATUS" "$QUESTION" "$PR_URL" "$MESSAGE" >> '${out}'\n`)
    const lines = async () => (await readFile(out, 'utf8').catch(() => '')).split('\n').filter(Boolean)

    const asking = new FakeDriver({ turns: [{ text: QUESTION }], sessionId: 's-ask' })
    const first = await runCommand(repo, { prompt: '/work-queue', driver: asking, now: () => NOW, gitHost: noGitHost })
    assert.equal(first.status, 'waiting')
    assert.deepEqual(await lines(), ['waiting|Ship it?||repo: "/work-queue" is waiting for you: Ship it?'])

    const gitHost = fakeGitHost('agent-fix-it')
    gitHost.open()
    const second = await resumeRun(repo, { id: first.id, answer: 'Approve', driver: committingDriver(), now: () => NOW, gitHost })
    assert.equal(second.status, 'done')
    assert.deepEqual((await lines())[1], 'done||https://example.com/x/y/pull/12|repo: "/work-queue" opened a pull request: https://example.com/x/y/pull/12')

    // Continued again, the same pull request: nothing new for the person.
    const third = await resumeRun(repo, { id: first.id, text: 'one more thing', driver: new FakeDriver({ turns: [{ text: 'Done.' }] }), now: () => NOW, gitHost })
    assert.equal(third.status, 'done')
    assert.equal((await lines()).length, 2)
  } finally {
    await removeRepo(repo)
  }
})

test('a line already in the inbox when the turn ends becomes the next turn of the same run, told the run\'s sentence like the first', async () => {
  const repo = await testRepo()
  try {
    const chatty: Driver = {
      id: 'fake',
      start: async opts => {
        const fake = await new FakeDriver({ turns: [{ text: 'First turn done.' }, { text: 'Second turn done.' }] }).start(opts)
        return wrap(fake, async () => {
          if (fake.prompts.length === 0) await appendInbox(inboxPath(opts.cwd), { kind: 'message', text: 'also add a test' })
        })
      },
    }
    const outcome = await runCommand(repo, { prompt: '/work-queue', model: 'opus', publish: 'commit', driver: chatty, now: () => NOW, gitHost: noGitHost })
    assert.equal(outcome.status, 'done')
    const diary = await readUntimedDiary(repo, outcome.id)
    assert.deepEqual(diary.filter(l => l.kind === 'start').map(l => l['prompt']), ['/work-queue', 'also add a test'])
    assert.deepEqual(diary.filter(l => l.kind === 'start').map(l => l['added']), [PUBLISH_LINES.commit, PUBLISH_LINES.commit], 'the sentence is written apart from each message')
    assert.deepEqual(diary.filter(l => l.kind === 'said').map(l => l['text']), ['First turn done.', 'Second turn done.'])
  } finally {
    await removeRepo(repo)
  }
})

test('a line written after the last turn took the inbox, while the card still said running, is sent by the same process before the run ends', async () => {
  const repo = await testRepo()
  try {
    const driver = new FakeDriver({ turns: [{ text: 'First turn done.' }, { text: 'Late line handled.' }] })
    let cwd = ''
    const recording: Driver = { id: 'fake', start: async opts => ((cwd = opts.cwd), driver.start(opts)) }
    // The pull request is read after the last turn and before the card says ended: the moment a
    // dashboard still sees the run working and hands it a line.
    let calls = 0
    const gitHost = fakeGitHost('none', async () => {
      if (calls++ === 0) await appendInbox(inboxPath(cwd), { kind: 'message', text: 'one more thing' })
    })
    const outcome = await runCommand(repo, { prompt: '/work-queue', attached: 'Found:\n["one entry"]', model: 'opus', driver: recording, now: () => NOW, gitHost })
    assert.equal(outcome.status, 'done')
    assert.deepEqual(outcome.checkout, { reclaimed: true })
    const diary = await readUntimedDiary(repo, outcome.id)
    assert.deepEqual(diary.map(l => l.kind), ['start', 'said', 'result', 'ended', 'start', 'said', 'result', 'ended'])
    assert.deepEqual(diary.filter(l => l.kind === 'start').map(l => l['prompt']), ['/work-queue', 'one more thing'])
    assert.deepEqual(diary.filter(l => l.kind === 'start').map(l => l['attached']), ['Found:\n["one entry"]', undefined], 'what was handed over went with the run\'s own prompt, not with the late line')
    assert.equal((await findRun(repo, outcome.id))?.status, 'done')
  } finally {
    await removeRepo(repo)
  }
})

test('a signal that comes while the run records and reclaims is ignored: the run ends as it ended', async () => {
  const repo = await testRepo()
  try {
    // Without its handler, this signal would end this test's own process.
    const gitHost = fakeGitHost('none', async () => {
      process.kill(process.pid, 'SIGINT')
      await new Promise(resolve => setTimeout(resolve, 50))
    })
    const outcome = await runCommand(repo, { prompt: '/work-queue', model: 'opus', driver: new FakeDriver({ turns: [{ text: 'Done.' }] }), now: () => NOW, gitHost })
    assert.equal(outcome.status, 'done')
    assert.deepEqual(outcome.checkout, { reclaimed: true })
    assert.equal((await findRun(repo, outcome.id))?.status, 'done')
  } finally {
    await removeRepo(repo)
  }
})

test('a resume waits while another process of the run holds its lock, then reads the run as that one left it', async () => {
  const repo = await testRepo()
  try {
    const first = await runCommand(repo, { prompt: '/work-queue', model: 'opus', driver: new FakeDriver({ turns: [{ text: QUESTION }], sessionId: 's-ask' }), now: () => NOW, gitHost: noGitHost })
    assert.equal(first.status, 'waiting')
    // The run's own process, or an earlier resume, still at work.
    const alive = new Set([777])
    await acquireRunLock(repo, first.id, { pid: 777, isAlive: pid => alive.has(pid) })
    let started = false
    const finishing: Driver = { id: 'fake', start: async opts => ((started = true), new FakeDriver({ turns: [{ text: 'Shipped.' }] }).start(opts)) }
    const resuming = resumeRun(repo, { id: first.id, answer: 'Approve', driver: finishing, pid: 778, isAlive: pid => alive.has(pid), now: () => NOW, gitHost: noGitHost })
    await new Promise(resolve => setTimeout(resolve, 1200))
    assert.equal(started, false, 'the resume waits for the holder')
    assert.equal((await findRun(repo, first.id))?.status, 'waiting')
    await releaseRunLock(repo, first.id, 777)
    const second = await resuming
    assert.equal(started, true)
    assert.equal(second.status, 'done')
  } finally {
    await removeRepo(repo)
  }
})

/** A clock a minute on at every reading: two runs of one process get two ids. */
function ticking(): () => Date {
  let minutes = 0
  return () => new Date(NOW.getTime() + minutes++ * 60_000)
}

/** An agent that commits a file on the branch it names, pushes it and opens its pull request, the way the skills say; it notes the prompt it was given. */
function publishingDriver(gitHost: ReturnType<typeof fakeGitHost>, seen: { prompt?: string }): Driver {
  return {
    id: 'fake',
    start: async (opts: DriverStartOptions): Promise<DriverSession> => {
      const fake = await new FakeDriver({ turns: [{ text: 'Fixed it and published.' }], sessionId: 's-1' }).start(opts)
      return wrap(fake, async text => {
        seen.prompt = text
        await git(['config', 'user.email', 'agent@example.com'], opts.cwd)
        await git(['config', 'user.name', 'agent'], opts.cwd)
        await git(['branch', '-m', 'agent-fix-it'], opts.cwd)
        await writeFile(join(opts.cwd, 'fixed.txt'), 'fixed\n')
        await git(['add', '-A'], opts.cwd)
        await git(['commit', '-q', '-m', 'Fix it'], opts.cwd)
        await git(['push', '-q', 'origin', 'HEAD'], opts.cwd)
        gitHost.open()
      })
    },
  }
}

test('a run with a follow-up: its agent is told not to arm the merge, a fresh agent works its branch with the run\'s id, and the request is merged once that one ends done', async () => {
  const repo = await testRepo()
  try {
    const out = join(repo, '..', 'ended.txt')
    await mkdir(join(repo, '.agent-runner'), { recursive: true })
    await writeFile(join(repo, '.agent-runner', 'config.yml'), `ended: printf '%s\\n' "$MESSAGE" >> '${out}'\n`)
    const gitHost = fakeGitHost('agent-fix-it')
    const { calls } = gitHost
    const seen: { prompt?: string } = {}
    const next: { prompt?: string; cwd?: string; branch?: string; mergedBefore?: boolean } = {}
    const cleanup: Driver = {
      id: 'fake',
      start: async opts => {
        const fake = await new FakeDriver({ turns: [{ text: 'Cleaned up.' }], sessionId: 's-2' }).start(opts)
        return wrap(fake, async text => {
          next.prompt = text
          next.cwd = opts.cwd
          next.branch = (await git(['branch', '--show-current'], opts.cwd)).trim()
          next.mergedBefore = calls.some(c => c[0] === 'merge')
          await git(['config', 'user.email', 'agent@example.com'], opts.cwd)
          await git(['config', 'user.name', 'agent'], opts.cwd)
          await writeFile(join(opts.cwd, 'FACTS.md'), 'a fact\n')
          await git(['add', '-A'], opts.cwd)
          await git(['commit', '-q', '-m', 'Knowledge'], opts.cwd)
          await git(['push', '-q', 'origin', 'HEAD'], opts.cwd)
        })
      },
    }
    const nextIds: string[] = []
    const outcome = await runCommand(repo, {
      prompt: '/work-queue',
      attached: 'Found:\n["one entry"]',
      then: '/post-merge-cleanup',
      driver: publishingDriver(gitHost, seen),
      nextDriver: id => (nextIds.push(id), cleanup),
      host: 'this-box',
      pid: 4242,
      now: ticking(),
      gitHost,
    })

    assert.equal(seen.prompt, `/work-queue\n\nFound:\n["one entry"]\n\n${HOLD_MERGE_LINE}`, 'the first agent is handed what came with its prompt, and told not to arm the merge')
    assert.equal(outcome.status, 'done')
    assert.deepEqual(outcome.pr, { number: 12, url: 'https://example.com/x/y/pull/12' })
    assert.equal((await findRun(repo, outcome.id))?.intent, '/work-queue', 'the record keeps the bare prompt')
    assert.deepEqual((await findRun(repo, outcome.id))?.caller?.['runner'], { host: 'this-box', pid: 4242, then: '/post-merge-cleanup', baseCommit: (await git(['rev-parse', 'origin/main'], repo)).trim() })

    const then = outcome.then!
    assert.notEqual(then.id, outcome.id, 'a fresh agent: a run of its own')
    assert.deepEqual(nextIds, [then.id], 'on the coding agent made for its own id')
    assert.equal(next.prompt, `/post-merge-cleanup ${outcome.id}`, 'the follow-up gets its prompt as written: no publish level, and nothing of what the first run was handed')
    assert.equal(next.cwd, worktreePath(repo, then.id))
    assert.equal(next.branch, 'agent-fix-it', 'on the first run\'s branch')
    assert.equal(next.prompt?.includes(HOLD_MERGE_LINE), false, 'the follow-up is the last: it is not told to hold')
    assert.equal(next.mergedBefore, false, 'nothing merged while the follow-up worked')
    assert.equal(then.status, 'done')
    assert.deepEqual(then.merge, { outcome: 'auto-armed' })
    assert.deepEqual(calls.filter(c => c[0] === 'merge'), [['merge', '12']], 'merged once, through the git host, after the follow-up')
    assert.deepEqual(then.checkout, { reclaimed: true })

    const recorded = await findRun(repo, then.id)
    assert.equal(recorded?.status, 'done')
    assert.equal(recorded?.intent, `/post-merge-cleanup ${outcome.id}`)
    assert.deepEqual(recorded?.caller?.['runner'], { host: 'this-box', pid: 4242 }, 'on a branch another run made: it writes down no start of its own')
    assert.equal((await git(['rev-parse', 'refs/remotes/origin/agent-fix-it'], repo)).trim(), (await git(['rev-parse', 'agent-fix-it'], repo)).trim(), 'the follow-up\'s commit is on the same branch, pushed')
    assert.deepEqual((await readFile(out, 'utf8')).split('\n').filter(Boolean), ['repo: "/work-queue" opened a pull request: https://example.com/x/y/pull/12'], 'the pull request is announced once, by the run that opened it, not again by its follow-up')
  } finally {
    await removeRepo(repo)
  }
})

test('a run given its start keeps it as its record\'s start, whatever its own clock says: a scheduler asks, then marks and spawns, and the record names the moment it asked', async () => {
  const repo = await testRepo()
  try {
    const asked = '2026-09-16T14:00:40.000Z'
    const given = await runCommand(repo, { prompt: '/answer-comments', id: 'given-1', startedAt: asked, driver: new FakeDriver({ turns: [{ text: 'Done.' }] }), now: () => NOW, gitHost: noGitHost })
    assert.equal(given.status, 'done')
    assert.equal((await findRun(repo, 'given-1'))?.startedAt, asked)
    const own = await runCommand(repo, { prompt: '/answer-comments', id: 'own-1', driver: new FakeDriver({ turns: [{ text: 'Done.' }] }), now: () => NOW, gitHost: noGitHost })
    assert.equal((await findRun(repo, own.id))?.startedAt, NOW.toISOString(), 'no start given: this process\'s clock')
  } finally {
    await removeRepo(repo)
  }
})

test('the sentence a run adds after its prompts: none with no publish level, that of its level with one, the hold sentence whenever a follow-up is coming', () => {
  assert.equal(addedLine(undefined, undefined), undefined, 'no level: the prompt as written')
  assert.equal(addedLine('commit', undefined), 'When you finish, if you changed any file, commit your work.')
  assert.equal(addedLine('branch', undefined), 'When you finish, if you changed any file, commit your work, push your branch and open no pull request.')
  assert.equal(addedLine('pr', undefined), 'When you finish, if you changed any file, commit your work, push your branch and open its pull request.')
  assert.equal(addedLine('merge', undefined), 'When you finish, if you changed any file, commit your work, push your branch and open its pull request, set to merge on its own once its checks pass.')
  assert.equal(addedLine('merge', '/post-merge-cleanup'), HOLD_MERGE_LINE, 'a follow-up is coming: the merge is this tool\'s, whatever the level')
  assert.equal(addedLine(undefined, '/post-merge-cleanup'), HOLD_MERGE_LINE)
})

test('a run with a publish level: its agent is told the sentence, the record keeps the level, and a resumed run is told again; a run with none is told nothing', async () => {
  const repo = await testRepo()
  try {
    const prompts: string[] = []
    const listening = (text: string): Driver => ({ id: 'fake', start: async opts => wrap(await new FakeDriver({ turns: [{ text }], sessionId: 's-1' }).start(opts), async prompt => void prompts.push(prompt)) })
    const first = await runCommand(repo, { prompt: 'Fix the typo', publish: 'pr', driver: listening(QUESTION), host: 'this-box', pid: 4242, now: ticking(), gitHost: noGitHost })
    assert.equal(first.status, 'waiting')
    assert.deepEqual(prompts, [`Fix the typo\n\n${PUBLISH_LINES.pr}`])
    const recorded = await findRun(repo, first.id)
    assert.equal(recorded?.intent, 'Fix the typo', 'the record keeps the bare prompt')
    const started = (await readDiary(repo, first.id))?.find(line => line.kind === 'start')
    assert.equal(started?.['prompt'], 'Fix the typo', 'the diary keeps the prompt as written')
    assert.equal(started?.['added'], PUBLISH_LINES.pr, 'and the sentence apart from it')
    assert.deepEqual(recorded?.caller?.['runner'], { host: 'this-box', pid: 4242, publish: 'pr', baseCommit: (await git(['rev-parse', 'origin/main'], repo)).trim() })

    const resumed = await resumeRun(repo, { id: first.id, text: 'Go on.', driver: listening('Done.'), host: 'this-box', pid: 4243, now: ticking(), gitHost: noGitHost })
    assert.equal(resumed.status, 'done')
    assert.equal(prompts[1], `Go on.\n\n${PUBLISH_LINES.pr}`, 'the resumed run is told its level again')
    assert.equal(runnerMark((await findRun(repo, first.id))!)?.publish, 'pr', 'and the record still names it')

    const plain = await runCommand(repo, { prompt: 'Fix the typo', driver: listening('Done.'), host: 'this-box', pid: 4242, now: ticking(), gitHost: noGitHost })
    assert.equal(prompts[2], 'Fix the typo', 'no level: the prompt as written')
    assert.deepEqual((await findRun(repo, plain.id))?.caller?.['runner'], { host: 'this-box', pid: 4242, baseCommit: (await git(['rev-parse', 'origin/main'], repo)).trim() })
  } finally {
    await removeRepo(repo)
  }
})

test('a run with an attached text: its agent is handed the text with the prompt, before the publish sentence; the record keeps the bare prompt and the text apart; a resumed run is not handed it again', async () => {
  const repo = await testRepo()
  try {
    const prompts: string[] = []
    const listening = (text: string): Driver => ({ id: 'fake', start: async opts => wrap(await new FakeDriver({ turns: [{ text }], sessionId: 's-1' }).start(opts), async prompt => void prompts.push(prompt)) })
    const found = 'The check printed:\n[{"url":"https://example.test/1"}]'
    const first = await runCommand(repo, { prompt: '/answer-comments', attached: found, publish: 'commit', driver: listening(QUESTION), host: 'this-box', pid: 4242, now: ticking(), gitHost: noGitHost })
    assert.equal(first.status, 'waiting')
    assert.deepEqual(prompts, [`/answer-comments\n\n${found}\n\n${PUBLISH_LINES.commit}`])
    assert.equal((await findRun(repo, first.id))?.intent, '/answer-comments', 'the record keeps the bare prompt: it is what the run is counted under')
    const started = (await readDiary(repo, first.id))?.find(line => line.kind === 'start')
    assert.equal(started?.['prompt'], '/answer-comments', 'the diary keeps the prompt as written')
    assert.equal(started?.['attached'], found, 'the attached text apart from it')
    assert.equal(started?.['added'], PUBLISH_LINES.commit, 'and the sentence apart from both')

    const resumed = await resumeRun(repo, { id: first.id, text: 'Go on.', driver: listening('Done.'), host: 'this-box', pid: 4243, now: ticking(), gitHost: noGitHost })
    assert.equal(resumed.status, 'done')
    assert.equal(prompts[1], `Go on.\n\n${PUBLISH_LINES.commit}`, 'the text went with the first prompt alone')
    assert.deepEqual((await readDiary(repo, first.id))?.filter(line => line.kind === 'start').map(line => line['attached']), [found, undefined])
  } finally {
    await removeRepo(repo)
  }
})

test('a follow-up that fails leaves the request open, nothing merged; a run that opened no request has no follow-up', async () => {
  const repo = await testRepo()
  try {
    const gitHost = fakeGitHost('agent-fix-it')
    const failing: Driver = { id: 'fake', start: async () => Promise.reject(new Error('the CLI is gone')) }
    const outcome = await runCommand(repo, { prompt: '/work-queue', then: '/post-merge-cleanup', driver: publishingDriver(gitHost, {}), nextDriver: () => failing, now: ticking(), gitHost })
    assert.equal(outcome.status, 'done')
    assert.equal(outcome.then?.status, 'failed')
    assert.equal(outcome.then?.merge, undefined)
    assert.deepEqual(gitHost.calls.filter(c => c[0] === 'merge'), [], 'nothing merged')

    let started = false
    const quiet = await runCommand(repo, { prompt: '/work-queue', then: '/post-merge-cleanup', driver: new FakeDriver({ turns: [{ text: 'Nothing to do.' }] }), nextDriver: () => ((started = true), failing), now: ticking(), gitHost: noGitHost })
    assert.equal(quiet.status, 'done')
    assert.equal(quiet.then, undefined)
    assert.equal(started, false)
  } finally {
    await removeRepo(repo)
  }
})

test('a run with a follow-up that ends waiting: the answer resumes it, still told not to arm the merge, and the follow-up runs once it ends done', async () => {
  const repo = await testRepo()
  try {
    const gitHost = fakeGitHost('agent-fix-it')
    const askedWith: string[] = []
    const asking: Driver = { id: 'fake', start: async opts => wrap(await new FakeDriver({ turns: [{ text: QUESTION }], sessionId: 's-ask' }).start(opts), async text => void askedWith.push(text)) }
    const first = await runCommand(repo, { prompt: '/plan', then: '/post-merge-cleanup', driver: asking, now: ticking(), gitHost })
    assert.equal(first.status, 'waiting')
    assert.equal(first.then, undefined)
    assert.deepEqual(askedWith, [`/plan\n\n${HOLD_MERGE_LINE}`], 'the agent is told not to arm the merge')

    const prompts: string[] = []
    const cleanup: Driver = { id: 'fake', start: async opts => wrap(await new FakeDriver({ turns: [{ text: 'Cleaned up.' }] }).start(opts), async text => void prompts.push(text)) }
    const seen: { prompt?: string } = {}
    const resumed = await resumeRun(repo, { id: first.id, answer: 'Approve', driver: publishingDriver(gitHost, seen), nextDriver: () => cleanup, now: ticking(), gitHost })
    assert.ok(seen.prompt?.endsWith(`\n\n${HOLD_MERGE_LINE}`), 'the resumed run is still told not to arm the merge')
    assert.equal(resumed.status, 'done')
    assert.equal(resumed.then?.status, 'done')
    assert.deepEqual(prompts, [`/post-merge-cleanup ${first.id}`])
    assert.deepEqual(resumed.then?.merge, { outcome: 'auto-armed' })
    assert.equal(gitHost.calls.filter(c => c[0] === 'merge').length, 1)
  } finally {
    await removeRepo(repo)
  }
})

test('a run with a follow-up continued after its checkout went gets a new one, is told again not to arm the merge, and its follow-up runs once it ends done', async () => {
  const repo = await testRepo()
  try {
    const gitHost = fakeGitHost('agent-fix-it')
    const first = await runCommand(repo, { prompt: '/work-queue', then: '/post-merge-cleanup', driver: new FakeDriver({ turns: [{ text: 'Nothing to publish yet.' }], sessionId: 's-1' }), now: ticking(), gitHost })
    assert.equal(first.status, 'done')
    assert.equal(first.then, undefined, 'no pull request, no follow-up')
    assert.deepEqual(first.checkout, { reclaimed: true })

    const seen: { prompt?: string } = {}
    const prompts: string[] = []
    const cleanup: Driver = { id: 'fake', start: async opts => wrap(await new FakeDriver({ turns: [{ text: 'Cleaned up.' }] }).start(opts), async text => void prompts.push(text)) }
    const continued = await resumeRun(repo, { id: first.id, text: 'Publish it now.', driver: publishingDriver(gitHost, seen), nextDriver: () => cleanup, now: ticking(), gitHost })
    assert.equal(seen.prompt, `Publish it now.\n\n${HOLD_MERGE_LINE}`, 'the continued run is told not to arm the merge')
    assert.equal(continued.status, 'done')
    assert.deepEqual(prompts, [`/post-merge-cleanup ${first.id}`])
    assert.deepEqual(continued.then?.merge, { outcome: 'auto-armed' })
    assert.equal(gitHost.calls.filter(c => c[0] === 'merge').length, 1, 'merged once, after the follow-up')
  } finally {
    await removeRepo(repo)
  }
})

test('a run started from a base, continued after its empty branch went with its checkout, starts again from that base', async () => {
  const repo = await testRepo()
  try {
    // Another run's branch, on origin, one commit past main.
    await git(['checkout', '-q', '-b', 'agent-plan'], repo)
    await writeFile(join(repo, 'plan.txt'), 'the plan\n')
    await git(['add', '-A'], repo)
    await git(['commit', '-q', '-m', 'Plan'], repo)
    await git(['push', '-q', 'origin', 'agent-plan'], repo)
    await git(['checkout', '-q', 'main'], repo)

    const first = await runCommand(repo, { prompt: 'Do task one', base: 'agent-plan', driver: new FakeDriver({ turns: [{ text: 'Nothing to change.' }], sessionId: 's-1' }), now: () => NOW, gitHost: noGitHost })
    assert.deepEqual(first.checkout, { reclaimed: true })
    const ended = await findRun(repo, first.id)
    assert.equal(ended?.branch, undefined, 'the branch held nothing and went with the checkout')
    // Where its own work begins is on its record: in the tool's mark, and beside `host` for any reader.
    const planAt = (await git(['rev-parse', 'agent-plan'], repo)).trim()
    assert.equal(runnerMark(ended!)?.baseCommit, planAt)
    assert.equal(ended!.caller?.['baseCommit'], planAt)

    // The base moves on before the run is continued.
    await git(['checkout', '-q', 'agent-plan'], repo)
    await writeFile(join(repo, 'plan.txt'), 'the plan, revised\n')
    await git(['commit', '-q', '-am', 'Plan revised'], repo)
    await git(['checkout', '-q', 'main'], repo)

    let head = ''
    const looking: Driver = { id: 'fake', start: async opts => wrap(await new FakeDriver({ turns: [{ text: 'Done.' }] }).start(opts), async () => void (head = (await git(['rev-parse', 'HEAD'], opts.cwd)).trim())) }
    const continued = await resumeRun(repo, { id: first.id, text: 'Look again.', driver: looking, now: () => new Date(NOW.getTime() + 60_000), gitHost: noGitHost })
    assert.equal(continued.status, 'done')
    const planNow = (await git(['rev-parse', 'agent-plan'], repo)).trim()
    assert.notEqual(planNow, planAt)
    assert.equal(head, planNow, 'the new branch starts from the base on the record, not origin’s default branch')
    const again = await findRun(repo, first.id)
    assert.equal(runnerMark(again!)?.baseCommit, planNow, 'made again from the base as it is now: its own work begins there')
    assert.equal(again!.caller?.['baseCommit'], planNow)

  } finally {
    await removeRepo(repo)
  }
})

test("a run from origin's default branch writes down the commit its branch was made at, and one made again after its empty branch went writes the new one", async () => {
  const repo = await testRepo()
  try {
    const mainAt = (await git(['rev-parse', 'origin/main'], repo)).trim()
    const first = await runCommand(repo, { prompt: 'Do task one', driver: new FakeDriver({ turns: [{ text: 'Nothing to change.' }], sessionId: 's-1' }), now: () => NOW, gitHost: noGitHost })
    const ended = await findRun(repo, first.id)
    assert.equal(ended?.branch, undefined, 'the branch held nothing and went with the checkout')
    assert.equal(runnerMark(ended!)?.baseCommit, mainAt)
    assert.equal(ended!.caller?.['baseCommit'], mainAt)

    // The default branch moves on before the run is continued.
    await writeFile(join(repo, 'later.txt'), 'later\n')
    await git(['add', '-A'], repo)
    await git(['commit', '-q', '-m', 'Later'], repo)
    await git(['push', '-q', 'origin', 'main'], repo)
    const mainNow = (await git(['rev-parse', 'origin/main'], repo)).trim()
    assert.notEqual(mainNow, mainAt)

    const continued = await resumeRun(repo, { id: first.id, text: 'Look again.', driver: new FakeDriver({ turns: [{ text: 'Done.' }] }), now: () => new Date(NOW.getTime() + 60_000), gitHost: noGitHost })
    assert.equal(continued.status, 'done')
    const again = await findRun(repo, first.id)
    assert.equal(runnerMark(again!)?.baseCommit, mainNow, 'made again from the default branch as it is now: its own work begins there')
    assert.equal(again!.caller?.['baseCommit'], mainNow)
  } finally {
    await removeRepo(repo)
  }
})

test('a run whose work was landed, continued: its branch is made again from the default branch, and its record no longer says landed', async () => {
  const repo = await testRepo()
  try {
    await git(['remote', 'remove', 'origin'], repo)
    const working = (file: string): Driver => ({
      id: 'fake',
      start: async opts =>
        wrap(await new FakeDriver({ turns: [{ text: 'Done.' }], sessionId: 's-1' }).start(opts), async () => {
          await writeFile(join(opts.cwd, file), 'done\n')
          await git(['add', file], opts.cwd)
          await git(['-c', 'user.email=agent@example.com', '-c', 'user.name=agent', 'commit', '-q', '-m', `Add ${file}`], opts.cwd)
        }),
    })
    const first = await runCommand(repo, { prompt: 'Do task one', driver: working('one.txt'), now: () => NOW, gitHost: noGitHost })
    const branch = `agent-${first.id}`
    // A person merges it on this machine: the default branch has the work, the branch goes, the record keeps its last commit.
    const tip = (await git(['rev-parse', branch], repo)).trim()
    await git(['merge', '-q', '--ff-only', branch], repo)
    await git(['branch', '-q', '-D', branch], repo)
    assert.equal(await patchRun(repo, first.id, { landed: { commit: tip, from: (await git(['rev-parse', `${tip}^`], repo)).trim() } }), true)
    const landed = await findRun(repo, first.id)
    assert.deepEqual([landed?.branch, landed?.caller?.['landed']], [undefined, tip])

    const continued = await resumeRun(repo, { id: first.id, text: 'Now task two.', driver: working('two.txt'), now: () => new Date(NOW.getTime() + 60_000), gitHost: noGitHost })
    assert.equal(continued.status, 'done')
    const again = await findRun(repo, first.id)
    assert.equal(again?.branch, branch, 'on its branch, made again')
    assert.equal(again?.caller?.['landed'], undefined, 'what it did since is not landed')
    assert.equal(again?.caller?.['baseCommit'], tip, 'and begins where the default branch was: at the work that was merged')
    assert.match(await git(['show', `refs/heads/${branch}:two.txt`], repo), /done/)
  } finally {
    await removeRepo(repo)
  }
})

test('a run in a project with no remote: one that commits nothing loses its empty branch, one that commits keeps it, measured from the commit it was made at', async () => {
  const repo = await testRepo()
  try {
    await git(['remote', 'remove', 'origin'], repo)
    const startAt = (await git(['rev-parse', 'HEAD'], repo)).trim()
    const idle = await runCommand(repo, { prompt: 'Look around', driver: new FakeDriver({ turns: [{ text: 'Nothing to change.' }] }), now: () => NOW, gitHost: noGitHost })
    assert.deepEqual(idle.checkout, { reclaimed: true })
    const idleCard = await findRun(repo, idle.id)
    assert.equal(runnerMark(idleCard!)?.baseCommit, startAt)
    assert.equal(idleCard?.branch, undefined, 'no commit past the commit it was made at: the branch went with the checkout')
    await assert.rejects(() => git(['rev-parse', '--verify', `refs/heads/agent-${idle.id}`], repo))

    const working: Driver = {
      id: 'fake',
      start: async opts =>
        wrap(await new FakeDriver({ turns: [{ text: 'Done.' }] }).start(opts), async () => {
          await writeFile(join(opts.cwd, 'work.txt'), 'done\n')
          await git(['add', 'work.txt'], opts.cwd)
          await git(['-c', 'user.email=agent@example.com', '-c', 'user.name=agent', 'commit', '-q', '-m', 'Work'], opts.cwd)
        }),
    }
    const worked = await runCommand(repo, { prompt: 'Do the work', driver: working, now: () => new Date(NOW.getTime() + 60_000), gitHost: noGitHost })
    assert.deepEqual(worked.checkout, { reclaimed: true })
    const workedCard = await findRun(repo, worked.id)
    assert.equal(workedCard?.branch, `agent-${worked.id}`)
    assert.equal(workedCard!.caller?.['baseCommit'], startAt)
    assert.match(await git(['show', `refs/heads/agent-${worked.id}:work.txt`], repo), /done/)
  } finally {
    await removeRepo(repo)
  }
})

test("a run whose commit another run's pushed branch holds keeps its branch: started from the default branch, or from a base", async () => {
  const repo = await testRepo()
  try {
    // A main agent commits, a subagent starts from its branch, and the subagent's branch reaches
    // origin before the main agent's turn ends: origin has the main agent's commit under another name.
    const withSubagent = (name: string): Driver => ({
      id: 'fake',
      start: async opts =>
        wrap(await new FakeDriver({ turns: [{ text: 'Committed, and started a subagent.' }] }).start(opts), async () => {
          await git(['config', 'user.email', 'agent@example.com'], opts.cwd)
          await git(['config', 'user.name', 'agent'], opts.cwd)
          await writeFile(join(opts.cwd, `${name}.txt`), 'own work\n')
          await git(['add', '-A'], opts.cwd)
          await git(['commit', '-q', '-m', 'Own work'], opts.cwd)
          await git(['push', '-q', 'origin', `HEAD:refs/heads/agent-sub-of-${name}`], opts.cwd)
        }),
    })
    const main = await runCommand(repo, { prompt: 'Do the plan', driver: withSubagent('main'), now: () => NOW, gitHost: noGitHost })
    assert.deepEqual(main.checkout, { reclaimed: true })
    const branch = (await findRun(repo, main.id))?.branch
    assert.equal(branch, `agent-${main.id}`, 'the branch is still on the record')
    assert.match(await git(['show', `refs/heads/${branch}:main.txt`], repo), /own work/, 'and still here')
    await assert.rejects(() => git(['rev-parse', '--verify', `refs/remotes/origin/${branch}`], repo), 'and not pushed: publishing is the person\'s call')

    const based = await runCommand(repo, { prompt: 'Do the rest', base: branch!, driver: withSubagent('based'), now: () => new Date(NOW.getTime() + 60_000), gitHost: noGitHost })
    assert.deepEqual(based.checkout, { reclaimed: true })
    const basedBranch = (await findRun(repo, based.id))?.branch
    assert.equal(basedBranch, `agent-${based.id}`)
    assert.match(await git(['show', `refs/heads/${basedBranch}:based.txt`], repo), /own work/)
    await assert.rejects(() => git(['rev-parse', '--verify', `refs/remotes/origin/${basedBranch}`], repo))
  } finally {
    await removeRepo(repo)
  }
})

test('a run started from a base, continued on the branch its work is on, keeps the commit its own work begins at, however the base moved', async () => {
  const repo = await testRepo()
  try {
    await git(['checkout', '-q', '-b', 'agent-plan'], repo)
    await writeFile(join(repo, 'plan.txt'), 'the plan\n')
    await git(['add', '-A'], repo)
    await git(['commit', '-q', '-m', 'Plan'], repo)
    await git(['push', '-q', 'origin', 'agent-plan'], repo)
    await git(['checkout', '-q', 'main'], repo)
    const planAt = (await git(['rev-parse', 'agent-plan'], repo)).trim()

    const working: Driver = {
      id: 'fake',
      start: async opts =>
        wrap(await new FakeDriver({ turns: [{ text: 'Task one is done.' }], sessionId: 's-1' }).start(opts), async () => {
          await writeFile(join(opts.cwd, 'task-one.txt'), 'done\n')
          await git(['add', 'task-one.txt'], opts.cwd)
          await git(['-c', 'user.email=agent@example.com', '-c', 'user.name=agent', 'commit', '-q', '-m', 'Task one'], opts.cwd)
        }),
    }
    const first = await runCommand(repo, { prompt: 'Do task one', base: 'agent-plan', driver: working, now: () => NOW, gitHost: noGitHost })
    assert.deepEqual(first.checkout, { reclaimed: true })
    // A person published the branch; then the record lost its branch's name, and this clone the
    // branch: only origin still has it.
    const ended = (await findRun(repo, first.id))!
    const { branch, ...branchless } = ended
    assert.equal(branch, `agent-${first.id}`)
    await recordRun(repo, branchless, (await readDiary(repo, first.id)) ?? [])
    await git(['push', '-q', 'origin', branch!], repo)
    await git(['branch', '-D', branch!], repo).catch(() => {})

    await git(['checkout', '-q', 'agent-plan'], repo)
    await writeFile(join(repo, 'plan.txt'), 'the plan, revised\n')
    await git(['commit', '-q', '-am', 'Plan revised'], repo)
    await git(['checkout', '-q', 'main'], repo)

    let sawWork = false
    const looking: Driver = { id: 'fake', start: async opts => wrap(await new FakeDriver({ turns: [{ text: 'Done.' }] }).start(opts), async () => void (sawWork = await stat(join(opts.cwd, 'task-one.txt')).then(() => true, () => false))) }
    const continued = await resumeRun(repo, { id: first.id, text: 'Look again.', driver: looking, now: () => new Date(NOW.getTime() + 60_000), gitHost: noGitHost })
    assert.equal(continued.status, 'done')
    assert.equal(sawWork, true, 'back on its own branch, with its commit')
    const again = (await findRun(repo, first.id))!
    assert.equal(runnerMark(again)?.baseCommit, planAt, 'its own work still begins where it did')
    assert.equal(again.caller?.['baseCommit'], planAt)
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
else if (args[0] === 'merge') process.stdout.write(JSON.stringify({ ok: true, number: Number(args[1]), outcome: 'watching' }))
else { process.stderr.write('unknown\\n'); process.exit(2) }
`

test('the git host is the package the project declares: a run reads its pull request through that command and merges through it after the follow-up', async () => {
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

    const prompts: string[] = []
    const cleanup: Driver = { id: 'fake', start: async opts => wrap(await new FakeDriver({ turns: [{ text: 'Cleaned up.' }] }).start(opts), async text => void prompts.push(text)) }
    const outcome = await runCommand(repo, { prompt: '/work-queue', then: '/post-merge-cleanup', driver: committingDriver(), nextDriver: () => cleanup, now: ticking() })
    assert.equal(outcome.status, 'done')
    assert.deepEqual(outcome.pr, { number: 7, url: 'https://example.com/p/pull/7' })
    assert.deepEqual(prompts, [`/post-merge-cleanup ${outcome.id}`])
    assert.deepEqual(outcome.then?.merge, { outcome: 'watching' })
    const calls = (await readFile(join(dir, 'calls.log'), 'utf8')).trim().split('\n')
    assert.deepEqual(calls, ['requests --branch agent-fix-it', 'requests --branch agent-fix-it', 'merge 7'], 'each run reads its branch, then the merge once')
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
