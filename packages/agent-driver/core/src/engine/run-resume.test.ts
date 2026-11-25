import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { appendInbox } from '../inbox.js'
import { FakeDriver } from '../fake.js'
import { findRun, readDiary } from '../record-store.js'
import { promptSent } from '../session-support.js'
import { chainStore, defineModule, enabledSetting, RunOrder, settingsIn, type Driver, type DriverSession, type DriverStartOptions } from '@openagt/hooks'
import { memoryStore } from '@openagt/hooks/testing'
import { worktreePath } from '@openagt/git-branches'
import { inboxPath } from './live-card.js'
import { acquireRunLock, releaseRunLock } from './run-lock.js'
import { resumeRun, runCommand } from './run.js'
import { AFRESH_NOTICE, earlierWorkLine, PUBLISH_LINES, STOPPED_DETAIL } from './session.js'
import { recordRun, runnerMark } from './records.js'
import { readUntimedDiary, removeRepo, testRepo } from './test-repo.js'
import { NOW, fakeGitHost, fakeGithub, wrap, QUESTION, committingDriver, ticking, testModules, type GitHost } from './run-test-support.js'


// A run after its first turn, on a real repository with the agent faked: stopped by a signal, ended
// waiting and resumed with the answer, continued in a fresh conversation, the lines its inbox holds,
// a level changed on the way, and the lock that keeps two processes of one run apart. The run's
// start is in `run.test.ts`.

/** An agent that works until it is stopped: `on` names the signal it ends on, the stop or the kill. */
function patientDriver(on: 'stop' | 'signal', prompted: () => void): Driver {
  return {
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
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('no signal within 5s')), 5000)
            // Asked to stop, the agent ends its turn as stopped, as agent-driver's drivers do.
            if (on === 'stop') opts.stop!.addEventListener('abort', () => (clearTimeout(timer), resolve({ ...turn, stopped: true })), { once: true })
            opts.signal!.addEventListener('abort', () => (clearTimeout(timer), reject(new Error('fake prompt aborted'))), { once: true })
          })
        },
        dispose: () => fake.dispose(),
      }
    },
  }
}

test('a signal to the run\'s process stops it: the agent asked to end its turn, the run recorded `stopped`, the checkout reclaimed', async () => {
  const repo = await testRepo()
  try {
    let prompted!: () => void
    const started = new Promise<void>(resolve => (prompted = resolve))
    const running = runCommand(repo, { prompt: '/work-queue', model: 'opus', driver: patientDriver('stop', () => prompted()), now: () => NOW, modules: testModules() })
    await started
    const pressed = Date.now()
    process.kill(process.pid, 'SIGINT') // what a dashboard's Stop sends; this test's own process has the run's handler
    const outcome = await running
    assert.ok(Date.now() - pressed < 4000, 'stopped by the agent, not by a timeout')
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

test('a second signal ends an agent that does not stop: the session killed, the run still recorded `stopped`', async () => {
  const repo = await testRepo()
  try {
    let prompted!: () => void
    const started = new Promise<void>(resolve => (prompted = resolve))
    const running = runCommand(repo, { prompt: '/work-queue', model: 'opus', driver: patientDriver('signal', () => prompted()), now: () => NOW, modules: testModules() })
    await started
    const pressed = Date.now()
    process.kill(process.pid, 'SIGINT')
    await new Promise(resolve => setTimeout(resolve, 100))
    process.kill(process.pid, 'SIGINT')
    const outcome = await running
    assert.ok(Date.now() - pressed < 4000, 'killed by the second signal, not by a timeout')
    assert.equal(outcome.status, 'stopped')
  } finally {
    await removeRepo(repo)
  }
})

/** Ends when the run asks its agent to stop. A bound wait: nothing else holds the event loop open while the signal is in flight. */
function askedToStop(opts: DriverStartOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no signal within 5s')), 5000)
    opts.stop!.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true })
  })
}

test('a run stopped before its agent took its prompt, continued with a message, hands the agent its prompt first and the message after it, as one prompt', async () => {
  const repo = await testRepo()
  try {
    // Stopped while its coding agent starts: no prompt was ever sent.
    let starting!: () => void
    const started = new Promise<void>(resolve => (starting = resolve))
    const slow: Driver = {
      id: 'fake',
      start: async opts => {
        starting()
        await askedToStop(opts)
        return new FakeDriver({ turns: [] }).start(opts)
      },
    }
    const running = runCommand(repo, { prompt: 'Redesign the checkout page', driver: slow, now: () => NOW, modules: testModules() })
    await started
    process.kill(process.pid, 'SIGINT')
    const first = await running
    assert.equal(first.status, 'stopped')
    assert.deepEqual((await readUntimedDiary(repo, first.id)).map(l => l.kind), ['ended'], 'the agent never had a turn')

    let sent: string[] = []
    const going: Driver = {
      id: 'fake',
      start: async opts => {
        const fake = await new FakeDriver({ turns: [{ text: 'Redesigned.' }] }).start(opts)
        sent = fake.prompts
        return fake
      },
    }
    const second = await resumeRun(repo, { id: first.id, text: 'Use the new colours', driver: going, now: () => NOW, modules: testModules() })
    assert.equal(second.status, 'done')
    assert.deepEqual(sent, [promptSent('Redesign the checkout page\n\nUse the new colours', { attached: earlierWorkLine(first.id, undefined) })])
  } finally {
    await removeRepo(repo)
  }
})

test('a message a stopped run never read is not sent when the run is continued: the person has it back to send again', async () => {
  const repo = await testRepo()
  try {
    let prompted!: () => void
    const started = new Promise<void>(resolve => (prompted = resolve))
    // Its work left uncommitted, so the stopped run keeps its checkout, and a message sent for after its turn waits there.
    const working: Driver = {
      id: 'fake',
      start: async opts => {
        const fake = await new FakeDriver({ turns: [{ text: 'Working…' }] }).start(opts)
        return {
          id: fake.id,
          cwd: fake.cwd,
          ...(fake.log ? { log: fake.log } : {}),
          prompt: async (text, promptOpts) => {
            const turn = await fake.prompt(text, promptOpts)
            await writeFile(join(opts.cwd, 'notes.txt'), 'half done\n')
            await appendInbox(inboxPath(opts.cwd), { kind: 'message', text: 'and add a test', id: 'm1', later: true })
            prompted()
            await askedToStop(opts)
            return { ...turn, stopped: true }
          },
          dispose: () => fake.dispose(),
        }
      },
    }
    const running = runCommand(repo, { prompt: '/work-queue', driver: working, now: () => NOW, modules: testModules() })
    await started
    process.kill(process.pid, 'SIGINT')
    const first = await running
    assert.equal(first.status, 'stopped')

    let sent: string[] = []
    const going: Driver = {
      id: 'fake',
      start: async opts => {
        const fake = await new FakeDriver({ turns: [{ text: 'Going on.' }, { text: 'Added a test.' }] }).start(opts)
        sent = fake.prompts
        return fake
      },
    }
    const second = await resumeRun(repo, { id: first.id, text: 'go on', driver: going, now: () => NOW, modules: testModules() })
    assert.equal(second.status, 'done')
    assert.deepEqual(sent.map(prompt => prompt.split('\n')[0]), ['go on'])
  } finally {
    await removeRepo(repo)
  }
})

test('a run whose last turn asked ends waiting and keeps its checkout; the answer resumes the same run, which then ends done and reclaimed', async () => {
  const repo = await testRepo()
  try {
    // First session: the agent asks. Second session, resumed by the recorded id: it finishes.
    const asking = new FakeDriver({ turns: [{ text: QUESTION }], sessionId: 's-ask' })
    const first = await runCommand(repo, { prompt: '/work-queue', model: 'opus', driver: asking, host: 'this-box', pid: 4242, now: () => NOW, modules: testModules() })
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
    const question = join(worktreePath(repo, first.id), '.claude', 'skills', 'ask')
    assert.match(await readFile(join(question, 'SKILL.md'), 'utf8'), /^name: ask$/m, 'a run\'s checkout carries the basic skills')
    await unlink(question)

    let resumedWith: string | undefined
    let questionAtResume = ''
    const finishing: Driver = {
      id: 'fake',
      start: async opts => {
        resumedWith = opts.resumeSessionId
        questionAtResume = await readFile(join(opts.cwd, '.claude', 'skills', 'ask', 'SKILL.md'), 'utf8').catch(() => '')
        return new FakeDriver({ turns: [{ text: 'Shipped.' }], sessionId: 's-ask' }).start(opts)
      },
    }
    const second = await resumeRun(repo, { id: first.id, answer: 'Approve', driver: finishing, host: 'this-box', pid: 4243, now: () => new Date(NOW.getTime() + 3_600_000), modules: testModules() })
    assert.equal(resumedWith, 's-ask', 'the session resumes by the id the record carries')
    assert.equal(second.id, first.id, 'the same run')
    assert.match(questionAtResume, /^name: ask$/m, 'a kept checkout is given the links a new one gets before the agent goes on')
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

test('a resumed run whose coding agent cannot start is recorded failed, not as the end its kept checkout had before', async () => {
  const repo = await testRepo()
  try {
    const first = await runCommand(repo, { prompt: '/work-queue', driver: new FakeDriver({ turns: [{ text: QUESTION }], sessionId: 's-ask' }), now: () => NOW, modules: testModules() })
    assert.equal(first.status, 'waiting')
    const dying: Driver = { id: 'fake', start: async () => { throw new Error('codex: not installed') } }
    const later = new Date(NOW.getTime() + 60_000)
    const second = await resumeRun(repo, { id: first.id, answer: 'Approve', driver: dying, now: () => later, modules: testModules() })
    assert.equal(second.status, 'failed')
    const card = await findRun(repo, first.id)
    assert.equal(card?.status, 'failed', 'the record says how this leg ended')
    assert.equal(card?.endedAt, later.toISOString())
    assert.deepEqual((await readDiary(repo, first.id))?.at(-1), { kind: 'ended', status: 'failed', detail: 'codex: not installed', at: later.toISOString() })
  } finally {
    await removeRepo(repo)
  }
})

test('a question asked with the agent’s own tool ends the run waiting as a written one does, and its answer resumes it', async () => {
  const repo = await testRepo()
  try {
    // As Claude Code's AskUserQuestion: the agent said a sentence, and the driver stopped the turn on its question.
    const question = { title: 'Which colour?', header: 'Colour', options: [{ id: 'opt:0', label: 'Blue' }, { id: 'opt:1', label: 'Green', detail: 'Light green' }], recommended: 'opt:0' }
    const asking = new FakeDriver({ turns: [{ text: 'One thing first.', question }], sessionId: 's-tool' })
    const first = await runCommand(repo, { prompt: 'Make the background light', driver: asking, now: () => NOW, modules: testModules() })
    assert.equal(first.status, 'waiting')
    const diary = await readUntimedDiary(repo, first.id)
    assert.deepEqual(diary.find(l => l.kind === 'question'), { kind: 'question', ...question })
    assert.deepEqual(diary.at(-1), { kind: 'ended', status: 'waiting' })

    const finishing = new FakeDriver({ turns: [{ text: 'Made it green.' }], sessionId: 's-tool' })
    const second = await resumeRun(repo, { id: first.id, answer: 'Green', driver: finishing, now: () => NOW, modules: testModules() })
    assert.equal(second.status, 'done')
    const resumed = (await readUntimedDiary(repo, first.id)).filter(l => l.kind === 'start').at(-1)
    assert.equal(resumed?.['prompt'], 'You paused to ask: "Which colour?". The user chose: Green. Continue with that decision.')
  } finally {
    await removeRepo(repo)
  }
})

test('a run that goes without ask waits on nothing its agent asks: its turn ends it done, and the person replies with a message', async () => {
  const repo = await testRepo()
  try {
    // A question asked with the agent's own tool is still how its turn ended: the diary has it.
    const question = { title: 'Which colour?', options: [{ id: 'opt:0', label: 'Blue' }] }
    const tool = await runCommand(repo, { prompt: '/paint', driver: new FakeDriver({ turns: [{ text: 'One thing first.', question }] }), now: () => NOW, modules: testModules(), pluginsWithout: ['ask'] })
    assert.equal(tool.status, 'done')
    assert.deepEqual(tool.checkout, { reclaimed: true })
    const diary = await readUntimedDiary(repo, tool.id)
    assert.deepEqual(diary.find(l => l.kind === 'question'), { kind: 'question', ...question })
    assert.deepEqual(diary.at(-1), { kind: 'ended', status: 'done' })
    // A block the agent wrote is words, where no module reads one.
    const written = await runCommand(repo, { prompt: '/plan', driver: new FakeDriver({ turns: [{ text: QUESTION }] }), now: () => new Date(NOW.getTime() + 60_000), modules: testModules(), pluginsWithout: ['ask'] })
    assert.equal(written.status, 'done')
    assert.equal((await readUntimedDiary(repo, written.id)).some(l => l.kind === 'question'), false)
  } finally {
    await removeRepo(repo)
  }
})

test('a resumed run whose conversation its coding agent no longer has goes on in a fresh one: the same run, its record saying where, its agent pointed at its record and pull request first', async () => {
  const repo = await testRepo()
  try {
    const gitHost = fakeGitHost('agent-fix-it')
    gitHost.open()
    const first = await runCommand(repo, { prompt: '/fix-it', driver: committingDriver(), now: () => NOW, modules: testModules({ gitHost }) })
    assert.equal(first.status, 'done')
    assert.equal((await findRun(repo, first.id))?.caller?.['sessionId'], 's-1')

    let sent: string[] = []
    const forgetful: Driver = {
      id: 'fake',
      start: async opts => {
        const fake = await new FakeDriver({ turns: [{ text: 'Answered the comment.' }], sessionId: 's-2', gone: ['s-1'] }).start(opts)
        sent = fake.prompts
        return fake
      },
    }
    const second = await resumeRun(repo, { id: first.id, text: '/reply a comment came', driver: forgetful, now: () => NOW, modules: testModules({ gitHost }) })
    assert.equal(second.id, first.id, 'the same run')
    assert.equal(second.status, 'done')
    const pointer = earlierWorkLine(first.id, { url: 'https://example.com/x/y/pull/12' })
    assert.equal(pointer, "Your earlier conversation in this run is gone, so this one starts without it. Before anything else, read what you did before: this run's record, `npx @openagt/logs@0.1 show 2026-09-16T14-01-00-000Z`, and the whole thread of its pull request, https://example.com/x/y/pull/12.")
    assert.deepEqual(sent, [promptSent('/reply a comment came', { attached: pointer })], 'one prompt reached the agent: the words, then where its earlier work is')

    const after = await readUntimedDiary(repo, first.id)
    const resumed = after.slice(after.findIndex(l => l.kind === 'ended') + 1)
    assert.deepEqual(resumed.map(l => l.kind), ['notice', 'start', 'said', 'result', 'ended'], 'nothing of the refused try is in the diary')
    assert.equal(resumed[0]?.['message'], AFRESH_NOTICE)
    assert.equal(resumed[1]?.['prompt'], '/reply a comment came', 'the words as they were said, the pointer apart')
    assert.equal(resumed[1]?.['attached'], pointer)
    const card = await findRun(repo, first.id)
    assert.equal(card?.caller?.['sessionId'], 's-2', 'the next resume continues the fresh conversation')
    assert.equal(card?.pr?.number, 12)
  } finally {
    await removeRepo(repo)
  }
})

test('a resumed run whose record names no conversation goes on in a fresh one the same way', async () => {
  const repo = await testRepo()
  try {
    const first = await runCommand(repo, { prompt: '/work-queue', driver: new FakeDriver({ turns: [{ text: 'Done.' }] }), now: () => NOW, modules: testModules() })
    const card = await findRun(repo, first.id)
    delete card!.caller!['sessionId']
    await recordRun(repo, card!, (await readDiary(repo, first.id))!)

    let resumedWith: string | undefined = 'unset'
    let sent: string[] = []
    const fresh: Driver = {
      id: 'fake',
      start: async opts => {
        resumedWith = opts.resumeSessionId
        const fake = await new FakeDriver({ turns: [{ text: 'Done again.' }] }).start(opts)
        sent = fake.prompts
        return fake
      },
    }
    const second = await resumeRun(repo, { id: first.id, text: 'one more thing', driver: fresh, now: () => NOW, modules: testModules() })
    assert.equal(second.status, 'done')
    assert.equal(resumedWith, undefined)
    assert.deepEqual(sent, [promptSent('one more thing', { attached: earlierWorkLine(first.id, undefined) })])
    const diary = await readUntimedDiary(repo, first.id)
    assert.deepEqual(diary.filter(l => l.kind === 'notice').map(l => l['message']), [AFRESH_NOTICE])
  } finally {
    await removeRepo(repo)
  }
})

test("a plugin's steps get each leg of a run as it starts and as it ends, its pull request and its first prompt; switched off, none", async () => {
  const repo = await testRepo()
  try {
    // A plugin of this computer's, a stand-in of the test's own for one such as notifications-command:
    // it notes what its steps are handed, where that one reads the pull request a leg starts with
    // and how the run ended.
    const seen: string[] = []
    const plugin = defineModule({
      name: 'notes-the-run',
      plugin: { scope: 'computer' },
      hooks: {
        'run.step': [
          { order: RunOrder.CLONE, name: 'note the start', run: ctx => void seen.push(`start|${ctx.facts.github?.pr?.url ?? ''}`) },
          {
            order: RunOrder.NOTIFY,
            name: 'note the end',
            run: ctx => {
              const end = ctx.outcome
              seen.push(`end|${end?.status}|${end?.status === 'waiting' ? end.question : ''}|${ctx.facts.github?.pr?.url ?? ''}|${ctx.project?.name}|${ctx.prompt}`)
            },
          },
        ],
      },
    })
    const store = memoryStore()
    const settings = settingsIn(chainStore([store]))
    await settings.set(enabledSetting('notes-the-run', 'computer', false), true)
    const modules = (gitHost?: GitHost) => testModules({ store, ...(gitHost ? { gitHost } : {}), also: [plugin] })

    const asking = new FakeDriver({ turns: [{ text: QUESTION }], sessionId: 's-ask' })
    const first = await runCommand(repo, { prompt: '/work-queue', driver: asking, now: () => NOW, modules: modules() })
    assert.equal(first.status, 'waiting')
    assert.deepEqual(seen.splice(0), ['start|', 'end|waiting|Ship it?||repo|/work-queue'])

    const gitHost = fakeGitHost('agent-fix-it')
    gitHost.open()
    const second = await resumeRun(repo, { id: first.id, answer: 'Approve', driver: committingDriver(), now: () => NOW, modules: modules(gitHost) })
    assert.equal(second.status, 'done')
    assert.deepEqual(seen.splice(0), ['start|', 'end|done||https://example.com/x/y/pull/12|repo|/work-queue'], "the run's first prompt, not the answer that continued it")

    // Continued again: this leg starts with the pull request the last one opened.
    const third = await resumeRun(repo, { id: first.id, text: 'one more thing', driver: new FakeDriver({ turns: [{ text: 'Done.' }] }), now: () => NOW, modules: modules(gitHost) })
    assert.equal(third.status, 'done')
    assert.deepEqual(seen.splice(0), ['start|https://example.com/x/y/pull/12', 'end|done||https://example.com/x/y/pull/12|repo|/work-queue'])

    // Switched off on this computer, its steps are no run's, whatever the run's end.
    await settings.set(enabledSetting('notes-the-run', 'computer', false), false)
    const fourth = await runCommand(repo, { prompt: '/work-queue', driver: new FakeDriver({ turns: [{ text: QUESTION }], sessionId: 's-ask-2' }), now: () => new Date(NOW.getTime() + 60_000), modules: modules() })
    assert.equal(fourth.status, 'waiting')
    assert.deepEqual(seen, [])
  } finally {
    await removeRepo(repo)
  }
})

test('a run that opens another pull request keeps the one before among its earlier ones, once', async () => {
  const repo = await testRepo()
  try {
    // Whatever the run's branch, the request the git host has for it now.
    let request = { number: 12, url: 'https://example.com/x/y/pull/12' }
    const gitHost: GitHost = { requestOfBranch: async () => request }
    const first = await runCommand(repo, { prompt: 'fix it', driver: committingDriver(), now: () => NOW, modules: testModules({ gitHost }) })
    assert.equal(first.status, 'done')
    assert.equal((await findRun(repo, first.id))?.caller?.['earlierPrs'], undefined, 'one request has no earlier one')

    request = { number: 13, url: 'https://example.com/x/y/pull/13' }
    await resumeRun(repo, { id: first.id, text: 'move it to a new branch', driver: new FakeDriver({ turns: [{ text: 'Moved.' }] }), now: () => NOW, modules: testModules({ gitHost }) })
    const moved = await findRun(repo, first.id)
    assert.deepEqual(moved?.pr, request)
    assert.deepEqual(moved?.caller?.['earlierPrs'], [{ number: 12, url: 'https://example.com/x/y/pull/12' }])

    // The same request again: nothing new among the earlier ones.
    await resumeRun(repo, { id: first.id, text: 'one more thing', driver: new FakeDriver({ turns: [{ text: 'Done.' }] }), now: () => NOW, modules: testModules({ gitHost }) })
    assert.deepEqual((await findRun(repo, first.id))?.caller?.['earlierPrs'], [{ number: 12, url: 'https://example.com/x/y/pull/12' }])

    // The work moved back to the first branch: its request is the run's again, and no earlier one.
    request = { number: 12, url: 'https://example.com/x/y/pull/12' }
    await resumeRun(repo, { id: first.id, text: 'back to the first branch', driver: new FakeDriver({ turns: [{ text: 'Back.' }] }), now: () => NOW, modules: testModules({ gitHost }) })
    const back = await findRun(repo, first.id)
    assert.deepEqual(back?.pr, request)
    assert.deepEqual(back?.caller?.['earlierPrs'], [{ number: 13, url: 'https://example.com/x/y/pull/13' }])
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
    const outcome = await runCommand(repo, { prompt: '/work-queue', model: 'opus', publish: 'commit', driver: chatty, now: () => NOW, modules: testModules() })
    assert.equal(outcome.status, 'done')
    const diary = await readUntimedDiary(repo, outcome.id)
    assert.deepEqual(diary.filter(l => l.kind === 'start').map(l => l['prompt']), ['/work-queue', 'also add a test'])
    assert.deepEqual(diary.filter(l => l.kind === 'start').map(l => l['added']), [PUBLISH_LINES.commit, PUBLISH_LINES.commit], 'the sentence is written apart from each message')
    assert.deepEqual(diary.filter(l => l.kind === 'said').map(l => l['text']), ['First turn done.', 'Second turn done.'])
  } finally {
    await removeRepo(repo)
  }
})

test('a message that says how far to take the work changes the run\'s level from it on: the sentence after it and every later one, and the record', async () => {
  const repo = await testRepo()
  try {
    const chatty: Driver = {
      id: 'fake',
      start: async opts => {
        const fake = await new FakeDriver({ turns: [{ text: 'First turn done.' }, { text: 'Shipped.' }, { text: 'Kept local.' }] }).start(opts)
        return wrap(fake, async () => {
          if (fake.prompts.length > 0) return
          // Both waiting when the first turn ends: each takes effect from its own message on.
          await appendInbox(inboxPath(opts.cwd), { kind: 'message', text: 'ship it', publish: 'pr' })
          await appendInbox(inboxPath(opts.cwd), { kind: 'message', text: 'and keep this one local', publish: 'nothing' })
        })
      },
    }
    const outcome = await runCommand(repo, { prompt: 'fix the typo', publish: 'commit', driver: chatty, now: () => NOW, modules: testModules() })
    assert.equal(outcome.status, 'done')
    const starts = (await readUntimedDiary(repo, outcome.id)).filter(l => l.kind === 'start')
    assert.deepEqual(starts.map(l => [l['prompt'], l['added']]), [
      ['fix the typo', PUBLISH_LINES.commit],
      ['ship it', PUBLISH_LINES.pr],
      // `nothing` takes the level away: the words go as written.
      ['and keep this one local', undefined],
    ])
    const record = await findRun(repo, outcome.id)
    assert.equal(runnerMark(record!)?.publish, undefined, 'the record says the level it ended at')
    assert.equal(record?.caller?.['publish'], undefined, 'for its readers too')
  } finally {
    await removeRepo(repo)
  }
})

test('the account a run works as at the git host is on its record, and a resume goes on as it; a run recorded with none works as the one runs use, named from then on', async () => {
  const repo = await testRepo()
  try {
    const github = fakeGithub({ 'octo-computer': {}, 'octo-one': {} })
    const first = await runCommand(repo, { prompt: 'Fix the typo', gitAccount: 'octo-one', driver: new FakeDriver({ turns: [{ text: 'Done.' }], sessionId: 's-1' }), now: ticking(), modules: testModules({ github }) })
    const card = await findRun(repo, first.id)
    assert.equal(runnerMark(card!)?.gitAccount, 'octo-one')
    assert.equal(card!.caller?.['gitAccount'], 'octo-one', 'what the dashboard reads')
    await resumeRun(repo, { id: first.id, text: 'Go on.', driver: new FakeDriver({ turns: [{ text: 'Done.' }] }), now: ticking(), modules: testModules({ github }) })
    assert.equal((await findRun(repo, first.id))!.caller?.['gitAccount'], 'octo-one')
    assert.deepEqual(github.workedAs, ['octo-one', 'octo-one'])

    // A run that worked as no account at GitHub, in a repository that was on none then.
    const unnamed = await runCommand(repo, { prompt: 'Fix the other typo', driver: new FakeDriver({ turns: [{ text: 'Done.' }], sessionId: 's-2' }), now: ticking(), modules: testModules() })
    assert.equal((await findRun(repo, unnamed.id))!.caller?.['gitAccount'], undefined)
    await resumeRun(repo, { id: unnamed.id, text: 'Go on.', driver: new FakeDriver({ turns: [{ text: 'Done.' }] }), now: ticking(), modules: testModules({ github }) })
    assert.equal((await findRun(repo, unnamed.id))!.caller?.['gitAccount'], 'octo-computer')
  } finally {
    await removeRepo(repo)
  }
})

test('a resume can give the run a new level, or take its level away; its record says so, for its readers too', async () => {
  const repo = await testRepo()
  try {
    const prompts: string[] = []
    const listening = (text: string): Driver => ({ id: 'fake', start: async opts => wrap(await new FakeDriver({ turns: [{ text }], sessionId: 's-1' }).start(opts), async prompt => void prompts.push(prompt)) })
    const first = await runCommand(repo, { prompt: 'Fix the typo', publish: 'commit', driver: listening('Done.'), host: 'this-box', pid: 4242, now: ticking(), modules: testModules() })
    assert.equal((await findRun(repo, first.id))?.caller?.['publish'], 'commit', 'a reader finds the level beside the host')
    await resumeRun(repo, { id: first.id, text: 'Ship it.', publish: 'pr', driver: listening('Done.'), host: 'this-box', pid: 4243, now: ticking(), modules: testModules() })
    assert.equal(prompts[1], `Ship it.\n\n${PUBLISH_LINES.pr}`)
    assert.equal(runnerMark((await findRun(repo, first.id))!)?.publish, 'pr')
    assert.equal((await findRun(repo, first.id))?.caller?.['publish'], 'pr')
    await resumeRun(repo, { id: first.id, text: 'Go on.', driver: listening('Done.'), host: 'this-box', pid: 4244, now: ticking(), modules: testModules() })
    assert.equal(prompts[2], `Go on.\n\n${PUBLISH_LINES.pr}`, 'no level given: the one it was given last')
    await resumeRun(repo, { id: first.id, text: 'Keep it local.', publish: null, driver: listening('Done.'), host: 'this-box', pid: 4245, now: ticking(), modules: testModules() })
    assert.equal(prompts[3], 'Keep it local.', 'its level taken away: the words as written')
    assert.equal(runnerMark((await findRun(repo, first.id))!)?.publish, undefined)
    assert.equal((await findRun(repo, first.id))?.caller?.['publish'], undefined)
  } finally {
    await removeRepo(repo)
  }
})

test('a line written after the last turn took the inbox, while the card still said running, is sent by the same process before the run ends', async () => {
  const repo = await testRepo()
  try {
    const driver = new FakeDriver({ turns: [{ text: 'First turn done.' }, { text: 'Late line handled.' }] })
    let late = true
    const recording: Driver = {
      id: 'fake',
      start: async opts => {
        const fake = await driver.start(opts)
        return {
          id: fake.id,
          cwd: fake.cwd,
          ...(fake.log ? { log: fake.log } : {}),
          // The turn is over and has taken its inbox, and the card does not say ended yet: the
          // moment a dashboard still sees the run working and hands it a line.
          prompt: async (text, promptOpts) => {
            const turn = await fake.prompt(text, promptOpts)
            if (late) await appendInbox(inboxPath(opts.cwd), { kind: 'message', text: 'one more thing' })
            late = false
            return turn
          },
          dispose: () => fake.dispose(),
        }
      },
    }
    const outcome = await runCommand(repo, { prompt: '/work-queue', attached: 'Found:\n["one entry"]', model: 'opus', driver: recording, now: () => NOW, modules: testModules() })
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

test('the images a run is started with go with its own prompt, a resume\'s with its text, and the record names each with the prompt it went with', async () => {
  const repo = await testRepo()
  try {
    const screenshot = `${'a'.repeat(64)}.png`
    const another = `${'b'.repeat(64)}.webp`
    const images: (string[] | undefined)[] = []
    const seeing = (): Driver => {
      const driver = new FakeDriver({ turns: [{ text: 'It says hello.' }] })
      return {
        id: 'fake',
        start: async opts => {
          const fake = await driver.start(opts)
          return { id: fake.id, cwd: fake.cwd, ...(fake.log ? { log: fake.log } : {}), prompt: (text, sent) => (images.push(sent?.images), fake.prompt(text, sent)), dispose: () => fake.dispose() }
        },
      }
    }
    const first = await runCommand(repo, { prompt: 'What word is in this screenshot?', images: [screenshot], driver: seeing(), now: () => NOW, modules: testModules() })
    assert.equal(first.status, 'done')
    const second = await resumeRun(repo, { id: first.id, text: 'And in this one?', images: [another], driver: seeing(), now: () => NOW, modules: testModules() })
    assert.equal(second.status, 'done')
    assert.deepEqual(images, [[screenshot], [another]])
    const diary = await readUntimedDiary(repo, first.id)
    assert.deepEqual(diary.filter(l => l.kind === 'start').map(l => [l['prompt'], l['images']]), [['What word is in this screenshot?', [screenshot]], ['And in this one?', [another]]])
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
    const outcome = await runCommand(repo, { prompt: '/work-queue', model: 'opus', driver: new FakeDriver({ turns: [{ text: 'Done.' }] }), now: () => NOW, modules: testModules({ gitHost }) })
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
    const first = await runCommand(repo, { prompt: '/work-queue', model: 'opus', driver: new FakeDriver({ turns: [{ text: QUESTION }], sessionId: 's-ask' }), now: () => NOW, modules: testModules() })
    assert.equal(first.status, 'waiting')
    // The run's own process, or an earlier resume, still at work.
    const alive = new Set([777])
    await acquireRunLock(repo, first.id, { pid: 777, isAlive: pid => alive.has(pid) })
    let started = false
    const finishing: Driver = { id: 'fake', start: async opts => ((started = true), new FakeDriver({ turns: [{ text: 'Shipped.' }] }).start(opts)) }
    const resuming = resumeRun(repo, { id: first.id, answer: 'Approve', driver: finishing, pid: 778, isAlive: pid => alive.has(pid), now: () => NOW, modules: testModules() })
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
