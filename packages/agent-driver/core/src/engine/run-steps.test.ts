import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeDriver } from '../fake.js'
import { findRun } from '../record-store.js'
import { type GitRunner, createHooks, type Driver } from '@openagt/hooks'
import { worktreePath } from '@openagt/git-branches'
import { resumeRun, runCommand } from './run.js'
import { STOPPED_DETAIL } from './session.js'
import { git, readUntimedDiary, removeRepo, testRepo } from './test-repo.js'
import { NOW, committingDriver, fakeGithub, testModules } from './run-test-support.js'


// A run is one pipeline of its modules' steps (`steps/`): what prepares it, the agent's turns, and
// what finishes it whatever its end.

/** An agent that must never start: the run ends before its turns. */
const unstarted = (started: { yes: boolean }): Driver => ({ id: 'fake', start: async opts => ((started.yes = true), new FakeDriver({ turns: [{ text: 'Done.' }] }).start(opts)) })

test("a run's steps, in their order: its account, its project's repository, its checkout and skills, where its repos are, how it asks the person, the agent's turns, then where the work went, the record and the reclaim", async () => {
  const steps = await createHooks(testModules()).steps({ options: {} })
  assert.deepEqual(
    steps.map(step => `${step.module}: ${step.name}`),
    [
      "github: work as the run's account",
      "agent-driver: work in the run's environment",
      "projects: make sure the project's repository is here",
      'git-branches: make the checkout',
      'skills: link the skills',
      'projects: tell the agent where its repos are',
      'git-branches: tell the agent its projects',
      'ask: ask the person',
      'agent-driver: run the agent',
      'git-branches: read the branch back',
      'github: read the pull request back',
      'agent-driver: save the record',
      'git-branches: reclaim the checkout',
      'agent-driver: record the branch gone',
    ],
  )
})

test("a run works as its account from its first step: its agent is handed the account's environment, this process works in it until the leg ends, and the record names the account", async () => {
  const repo = await testRepo()
  const before = process.env['GH_TOKEN']
  process.env['GH_TOKEN'] = 'the-person-s-own'
  try {
    const github = fakeGithub({ 'octo-one': { GH_TOKEN: 'tok-one' }, 'octo-two': { GH_TOKEN: 'tok-two' } })
    const seen: Array<{ handed?: string; here?: string }> = []
    const driver: Driver = {
      id: 'fake',
      start: async opts => {
        seen.push({ ...(opts.env?.['GH_TOKEN'] !== undefined ? { handed: opts.env['GH_TOKEN'] } : {}), ...(process.env['GH_TOKEN'] !== undefined ? { here: process.env['GH_TOKEN'] } : {}) })
        return new FakeDriver({ turns: [{ text: 'Done.' }], sessionId: 's-1' }).start(opts)
      },
    }
    const picked = await runCommand(repo, { prompt: 'fix it', gitAccount: 'octo-two', driver, now: () => NOW, modules: testModules({ github }) })
    assert.equal(picked.status, 'done')
    assert.equal((await findRun(repo, picked.id))?.caller?.['gitAccount'], 'octo-two')
    const unpicked = await runCommand(repo, { prompt: 'fix it again', driver, now: () => new Date(NOW.getTime() + 60_000), modules: testModules({ github }) })
    assert.equal((await findRun(repo, unpicked.id))?.caller?.['gitAccount'], 'octo-one', 'none picked: the account runs use, by its login')
    assert.deepEqual(seen, [{ handed: 'tok-two', here: 'tok-two' }, { handed: 'tok-one', here: 'tok-one' }])
    assert.deepEqual(github.workedAs, ['octo-two', 'octo-one'])
    assert.equal(process.env['GH_TOKEN'], 'the-person-s-own', "the leg over, this process's environment is what it was")
  } finally {
    if (before === undefined) delete process.env['GH_TOKEN']
    else process.env['GH_TOKEN'] = before
    await removeRepo(repo)
  }
})

test('a run whose account cannot be worked as is recorded failed at its first step, saying which account, and nothing of it is made', async () => {
  const repo = await testRepo()
  try {
    const started = { yes: false }
    const outcome = await runCommand(repo, { prompt: 'fix it', gitAccount: 'stranger', driver: unstarted(started), now: () => NOW, modules: testModules({ github: fakeGithub({ 'octo-one': {} }) }) })
    assert.equal(outcome.status, 'failed')
    assert.match(outcome.detail ?? '', /^work as the run's account: This session works as @stranger on GitHub, and it cannot be used here: OpenAgent has no GitHub account stranger$/)
    assert.deepEqual(outcome.checkout, { reclaimed: false, reason: 'no checkout' })
    assert.equal(started.yes, false)
    assert.equal((await findRun(repo, outcome.id))?.status, 'failed')
  } finally {
    await removeRepo(repo)
  }
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
