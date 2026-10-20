import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { appendInbox, FakeDriver, takeInbox, type Driver, type DriverSession, type FakeDriverSession } from '@openagt/agent-driver'
import { worktreeBranch, worktreePath } from '@openagt/skill-branches'
import { findRun } from '@openagt/skill-logs'
import { inboxPath } from './live-card.js'
import { childEndedLine, tellParent, type ParentDeps } from './parent.js'
import { resumeRun, runCommand } from './run.js'
import type { GitHost } from './git-host.js'
import { git, readUntimedDiary, removeRepo, testRepo } from './test-repo.js'

// A run started for another run: what its parent is told, how the line reaches a parent that is
// working and one that has ended, and the whole thing on a real repository with the agents faked.

const NOW = new Date('2026-10-01T09:00:00.000Z')
const LATER = new Date('2026-10-01T09:05:00.000Z')

const noGitHost: GitHost = { requestOfBranch: async () => undefined, mergeRequest: async () => ({ outcome: 'failed', error: 'nothing to merge' }) }

/** A fake session with something done before each prompt. */
function wrap(fake: FakeDriverSession, before: (text: string) => Promise<void>): DriverSession {
  return {
    id: fake.id,
    cwd: fake.cwd,
    ...(fake.log ? { log: fake.log } : {}),
    prompt: async (text, opts) => {
      await before(text)
      return fake.prompt(text, opts)
    },
    dispose: () => fake.dispose(),
  }
}

type Resumed = { id: string; line: { text: string } | { answer: string } }

/** A `resume` that keeps what it was asked instead of spawning a process. */
function resumes(): { calls: Resumed[]; resume: NonNullable<ParentDeps['resume']> } {
  const calls: Resumed[] = []
  return { calls, resume: async (id, line) => void calls.push({ id, line }) }
}

test('the line a parent gets: which run, how it ended, where its work is, and its last words', () => {
  assert.equal(
    childEndedLine({ id: 'c1', status: 'done', branch: 'agent-add-tests', pr: { url: 'https://example.com/pull/3' }, lastWords: 'Added the tests.\n' }),
    'The run c1, started for this run, ended done.\nIts work is on the branch agent-add-tests.\nIts pull request: https://example.com/pull/3\n\nIts last words:\nAdded the tests.',
  )
  assert.equal(childEndedLine({ id: 'c2', status: 'failed', detail: 'its process died before the run ended' }), 'The run c2, started for this run, ended failed: its process died before the run ended.')
  assert.equal(
    childEndedLine({ id: 'c3', status: 'waiting', question: 'Which\n  file?', branch: 'agent-c3', lastWords: '  ' }),
    'The run c3, started for this run, ended waiting.\nIt is waiting on a question: Which file?\nIts work is on the branch agent-c3.',
  )
})

test('a working parent takes the line from its inbox; an ended one is continued with it; one that ends meanwhile gets what was left in its inbox', async () => {
  const repo = await testRepo()
  try {
    const inbox = inboxPath(worktreePath(repo, 'p1'))
    const base = { host: 'this-box', isAlive: () => true, log: () => {} }

    // Working: the line waits in the inbox, nothing is continued.
    const working = resumes()
    await tellParent(repo, 'p1', 'child done', { ...base, resume: working.resume, isWorking: async () => true })
    assert.deepEqual(working.calls, [])
    assert.deepEqual(await takeInbox(inbox), [{ kind: 'message', text: 'child done' }])

    // Ended: continued with the line, nothing left in an inbox.
    const ended = resumes()
    await tellParent(repo, 'p1', 'child done', { ...base, resume: ended.resume, isWorking: async () => false })
    assert.deepEqual(ended.calls, [{ id: 'p1', line: { text: 'child done' } }])
    assert.deepEqual(await takeInbox(inbox), [])

    // It ends while the line is on its way: everything still in its inbox continues it, a
    // person's answer as an answer.
    await appendInbox(inbox, { kind: 'answer', question: 'Ship it?', answer: 'Approve' })
    const racing = resumes()
    let asked = 0
    await tellParent(repo, 'p1', 'child done', { ...base, resume: racing.resume, isWorking: async () => asked++ === 0 })
    assert.deepEqual(racing.calls, [
      { id: 'p1', line: { answer: 'Approve' } },
      { id: 'p1', line: { text: 'child done' } },
    ])
    assert.deepEqual(await takeInbox(inbox), [])

    // No parent's live card at all, and a resume that fails: one line on the log, nothing thrown.
    const said: string[] = []
    await tellParent(repo, 'gone', 'child done', { host: 'this-box', isAlive: () => true, log: line => said.push(line), resume: async () => Promise.reject(new Error('no run gone')) })
    assert.deepEqual(said, ['[agent-runner] the parent run gone could not be told: no run gone'])
  } finally {
    await removeRepo(repo)
  }
})

test('a run started for a working parent, from the parent\'s branch: it sees the parent\'s commit, its record names both, and its end is the parent\'s next turn', async () => {
  const repo = await testRepo()
  try {
    const parentId = '2026-10-01T09-00-00-000Z'
    let child: Awaited<ReturnType<typeof runCommand>> | undefined
    let childSaw: string | undefined
    const childDriver: Driver = {
      id: 'fake',
      start: async opts => {
        childSaw = await readFile(join(opts.cwd, 'plan.txt'), 'utf8').catch(() => undefined)
        const fake = await new FakeDriver({ turns: [{ text: 'Task one is done.' }] }).start(opts)
        return wrap(fake, async () => {
          await writeFile(join(opts.cwd, 'task-one.txt'), 'done\n')
          await git(['add', 'task-one.txt'], opts.cwd)
          await git(['-c', 'user.email=agent@example.com', '-c', 'user.name=agent', 'commit', '-q', '-m', 'Task one'], opts.cwd)
        })
      },
    }
    // The parent commits a file on its own branch, unpushed, then starts a child from that branch
    // and goes on with its turn; the child ends before the parent's turn does.
    const parentDriver: Driver = {
      id: 'fake',
      start: async opts => {
        const fake = await new FakeDriver({ turns: [{ text: 'Started task one.' }, { text: 'Task one landed.' }] }).start(opts)
        let turns = 0
        return wrap(fake, async () => {
          if (turns++ > 0) return
          await git(['config', 'user.email', 'agent@example.com'], opts.cwd)
          await git(['config', 'user.name', 'agent'], opts.cwd)
          await writeFile(join(opts.cwd, 'plan.txt'), 'the plan\n')
          await git(['add', 'plan.txt'], opts.cwd)
          await git(['commit', '-q', '-m', 'The plan'], opts.cwd)
          child = await runCommand(repo, { prompt: 'Do task one', parent: parentId, base: (await worktreeBranch(opts.cwd, git)) ?? assert.fail('the parent is on a branch'), driver: childDriver, host: 'this-box', now: () => LATER, gitHost: noGitHost })
        })
      },
    }
    const parent = await runCommand(repo, { prompt: '/plan', driver: parentDriver, host: 'this-box', now: () => NOW, gitHost: noGitHost })
    assert.equal(parent.id, parentId)
    assert.equal(parent.status, 'done')
    assert.equal(child?.status, 'done')
    assert.equal(childSaw, 'the plan\n', 'the child starts from the parent\'s branch, not from origin\'s default')

    const recorded = await findRun(repo, child!.id)
    // Where the child's own work begins: the parent's commit its branch was made from.
    const planCommit = (await git(['rev-parse', `agent-${child!.id}~1`], repo)).trim()
    assert.equal((await git(['log', '-1', '--format=%s', planCommit], repo)).trim(), 'The plan')
    assert.deepEqual(recorded?.caller?.['runner'], { host: 'this-box', pid: process.pid, parent: parentId, base: `agent-${parentId}`, baseCommit: planCommit })
    assert.equal(recorded?.caller?.['parent'], parentId, 'the parent beside the host too, where a reader of the record looks for it')
    assert.equal(recorded?.caller?.['base'], `agent-${parentId}`, 'so is the branch it was started from')
    assert.equal(recorded?.caller?.['baseCommit'], planCommit, 'and so is the commit its changes are measured from')

    const diary = await readUntimedDiary(repo, parentId)
    assert.deepEqual(
      diary.filter(l => l.kind === 'start').map(l => l['prompt']),
      ['/plan', `The run ${child!.id}, started for this run, ended done.\nIts work is on the branch agent-${child!.id}.\n\nIts last words:\nTask one is done.`],
      'the child\'s end is the parent\'s next prompt, naming the branch its commit is on',
    )
    assert.deepEqual(diary.filter(l => l.kind === 'said').map(l => l['text']), ['Started task one.', 'Task one landed.'])
  } finally {
    await removeRepo(repo)
  }
})

test('a run whose parent has ended continues it; continued itself, it still names its parent and tells it again; a checkout that cannot be made tells it too', async () => {
  const repo = await testRepo()
  try {
    const parent = await runCommand(repo, { prompt: '/plan', driver: new FakeDriver({ turns: [{ text: 'Started the tasks.' }] }), host: 'this-box', now: () => NOW, gitHost: noGitHost })
    assert.equal(parent.status, 'done')

    const told = resumes()
    const asking = new FakeDriver({ turns: [{ text: 'Which file?\n\n```await-choices\n{ "title": "Which file?", "options": [{ "label": "a.ts" }, { "label": "b.ts" }], "recommended": "a.ts" }\n```\n' }], sessionId: 's-child' })
    const child = await runCommand(repo, { prompt: 'Do task one', parent: parent.id, driver: asking, host: 'this-box', now: () => LATER, gitHost: noGitHost, resume: told.resume })
    assert.equal(child.status, 'waiting')
    assert.equal(told.calls.length, 1)
    assert.equal(told.calls[0]!.id, parent.id)
    const first = (told.calls[0]!.line as { text: string }).text
    assert.match(first, new RegExp(`^The run ${child.id}, started for this run, ended waiting\\.\nIt is waiting on a question: Which file\\?\nIts work is on the branch agent-${child.id}\\.\n\nIts last words:\nWhich file\\?`))

    // Answered, the same run goes on; its record still names the parent, which is told again.
    const answered = await resumeRun(repo, { id: child.id, answer: 'a.ts', driver: new FakeDriver({ turns: [{ text: 'Done with a.ts.' }], sessionId: 's-child' }), host: 'this-box', now: () => LATER, gitHost: noGitHost, resume: told.resume })
    assert.equal(answered.status, 'done')
    assert.equal((await findRun(repo, child.id))?.caller?.['runner'] && ((await findRun(repo, child.id))!.caller!['runner'] as { parent?: string }).parent, parent.id)
    assert.deepEqual(told.calls[1], { id: parent.id, line: { text: `The run ${child.id}, started for this run, ended done.\n\nIts last words:\nDone with a.ts.` } })

    // A base that does not exist: no checkout, the run recorded failed, the parent told why.
    const lost = await runCommand(repo, { prompt: 'Do task two', id: 'lost', parent: parent.id, base: 'no-such-branch', driver: new FakeDriver({ turns: [{ text: 'never' }] }), host: 'this-box', now: () => LATER, gitHost: noGitHost, resume: told.resume })
    assert.equal(lost.status, 'failed')
    assert.equal(told.calls.length, 3)
    assert.match((told.calls[2]!.line as { text: string }).text, /^The run lost, started for this run, ended failed: could not create a checkout: /)

    // A run with no parent tells nobody.
    const alone = await runCommand(repo, { prompt: 'Read the docs', id: 'alone', driver: new FakeDriver({ turns: [{ text: 'Read.' }] }), host: 'this-box', now: () => LATER, gitHost: noGitHost, resume: told.resume })
    assert.equal(alone.status, 'done')
    assert.equal(told.calls.length, 3)
  } finally {
    await removeRepo(repo)
  }
})
