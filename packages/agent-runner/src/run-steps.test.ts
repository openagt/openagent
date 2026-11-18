import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeDriver, type Driver } from '@openagt/agent-driver'
import type { GitRunner } from '@openagt/agent-data'
import { createHooks } from '@openagt/hooks'
import { worktreePath } from '@openagt/skill-branches'
import { findRun } from '@openagt/skill-logs'
import { resumeRun, runCommand } from './run.js'
import { STOPPED_DETAIL } from './session.js'
import { BUILT_IN_MODULES } from './steps/modules.js'
import { git, handDownBasicSkills, readUntimedDiary, removeRepo, testRepo } from './test-repo.js'
import { NOW, committingDriver, testModules } from './run-test-support.js'

// A run as OpenAgent starts it: with the basic skills handed down.
handDownBasicSkills()

// A run is one pipeline of its modules' steps (`steps/`): what prepares it, the agent's turns, and
// what finishes it whatever its end.

/** An agent that must never start: the run ends before its turns. */
const unstarted = (started: { yes: boolean }): Driver => ({ id: 'fake', start: async opts => ((started.yes = true), new FakeDriver({ turns: [{ text: 'Done.' }] }).start(opts)) })

test("a run's steps, in their order: its checkout and skills, the agent's turns, then where the work went, the record, the reclaim and the person's line", async () => {
  const steps = await createHooks([...testModules(), ...BUILT_IN_MODULES]).steps({ options: {} })
  assert.deepEqual(
    steps.map(step => `${step.module}: ${step.name}`),
    [
      'git-branches: make the checkout',
      'skills: link the skills',
      'agent-driver: run the agent',
      'git-branches: read the branch back',
      'github: read the pull request back',
      'agent-driver: save the record',
      'git-branches: reclaim the checkout',
      'agent-driver: record the branch gone',
      'notifications-command: run the ended line',
    ],
  )
})

test('a run whose checkout cannot be made is recorded failed, saying which step failed and why, and its agent never starts', async () => {
  const repo = await testRepo()
  try {
    const started = { yes: false }
    const outcome = await runCommand(repo, { prompt: '/work-queue', base: 'no-such-branch', driver: unstarted(started), now: () => NOW, modules: testModules() })
    assert.equal(outcome.status, 'failed')
    assert.match(outcome.detail ?? '', /^make the checkout: .*no-such-branch/)
    assert.deepEqual(outcome.checkout, { reclaimed: false, reason: 'no checkout' })
    assert.equal(started.yes, false)
    assert.equal((await findRun(repo, outcome.id))?.status, 'failed')
    assert.deepEqual(await readUntimedDiary(repo, outcome.id), [{ kind: 'ended', status: 'failed', detail: outcome.detail }])
  } finally {
    await removeRepo(repo)
  }
})

test('a run stopped while its checkout is made is not started: the agent never runs, the run is recorded stopped, and the checkout goes', async () => {
  const repo = await testRepo()
  try {
    // The signal comes while git makes the checkout: without the run's handler, it would end this test's own process.
    const signalling: GitRunner = async (args, cwd) => {
      const out = await git(args, cwd)
      if (args[0] === 'worktree' && args[1] === 'add') {
        process.kill(process.pid, 'SIGINT')
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      return out
    }
    const started = { yes: false }
    const outcome = await runCommand(repo, { prompt: '/work-queue', driver: unstarted(started), now: () => NOW, modules: testModules({ git: signalling }) })
    assert.equal(outcome.status, 'stopped')
    assert.equal(outcome.detail, STOPPED_DETAIL)
    assert.equal(started.yes, false, 'the steps still to prepare the run, and its turns, are skipped')
    assert.deepEqual(outcome.checkout, { reclaimed: true })
    assert.equal(await stat(worktreePath(repo, outcome.id)).then(() => true, () => false), false)
    const card = await findRun(repo, outcome.id)
    assert.equal(card?.status, 'stopped')
    assert.equal(card?.branch, undefined, 'its branch held nothing and went with the checkout')
    assert.deepEqual(await readUntimedDiary(repo, outcome.id), [{ kind: 'ended', status: 'stopped', detail: STOPPED_DETAIL }])
  } finally {
    await removeRepo(repo)
  }
})

test('a continued run whose checkout cannot be made is recorded failed, its record going on from what it held', async () => {
  const repo = await testRepo()
  const elsewhere = await mkdtemp(join(tmpdir(), 'agent-runner-elsewhere-'))
  try {
    const first = await runCommand(repo, { prompt: 'fix it', driver: committingDriver(), now: () => NOW, modules: testModules() })
    assert.equal(first.status, 'done')
    assert.equal(first.branch, 'agent-fix-it')
    const before = await readUntimedDiary(repo, first.id)
    // The run's branch is checked out somewhere else now: git gives it no second checkout.
    await git(['worktree', 'add', join(elsewhere, 'tree'), 'agent-fix-it'], repo)

    const started = { yes: false }
    const outcome = await resumeRun(repo, { id: first.id, text: 'one more thing', driver: unstarted(started), now: () => NOW, modules: testModules() })
    assert.equal(outcome.status, 'failed')
    assert.match(outcome.detail ?? '', /^make the checkout: /)
    assert.equal(started.yes, false)
    const card = await findRun(repo, first.id)
    assert.equal(card?.status, 'failed')
    assert.equal(card?.branch, 'agent-fix-it', 'the branch the record names is still there')
    assert.deepEqual(await readUntimedDiary(repo, first.id), [...before, { kind: 'ended', status: 'failed', detail: outcome.detail }])
  } finally {
    await git(['worktree', 'remove', '--force', join(elsewhere, 'tree')], repo).catch(() => '')
    await rm(elsewhere, { recursive: true, force: true })
    await removeRepo(repo)
  }
})
