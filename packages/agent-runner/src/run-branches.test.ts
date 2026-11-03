import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FakeDriver, type Driver } from '@openagt/agent-driver'
import { findRun, patchRun, readDiary } from '@openagt/skill-logs'
import { addedLine, PUBLISH_LINES, resumeRun, runCommand } from './run.js'
import { recordRun, runnerMark } from './records.js'
import { git, handDownBasicSkills, removeRepo, testRepo } from './test-repo.js'
import { NOW, noGitHost, wrap, QUESTION, ticking } from './run-test-support.js'

// A run as OpenAgent starts it: with the basic skills handed down.
handDownBasicSkills()

// Where a run's work starts and goes, on a real repository with the agent faked: a branch given to
// it, the start it writes down, the base it starts from and the pull request's branch, the sentence
// after its prompts, a run continued after its branch went, landed, or pushed by another run.

test('a run given a branch that exists works on it, and writes down no start of its own: the work on that branch began elsewhere', async () => {
  const repo = await testRepo()
  try {
    await git(['switch', '-q', '-c', 'dark-mode'], repo)
    await git(['push', '-q', 'origin', 'dark-mode'], repo)
    await git(['switch', '-q', 'main'], repo)
    const seen: { branch?: string } = {}
    const driver: Driver = {
      id: 'fake',
      start: async opts => wrap(await new FakeDriver({ turns: [{ text: 'Replied.' }] }).start(opts), async () => {
        seen.branch = (await git(['branch', '--show-current'], opts.cwd)).trim()
      }),
    }
    const outcome = await runCommand(repo, { prompt: '/reply', branch: 'dark-mode', driver, host: 'this-box', pid: 4242, now: ticking(), gitHost: noGitHost })
    assert.equal(outcome.status, 'done')
    assert.equal(seen.branch, 'dark-mode')
    assert.deepEqual((await findRun(repo, outcome.id))?.caller?.['runner'], { host: 'this-box', pid: 4242 })
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

test('the sentence a run adds after its prompts: none with no publish level, that of its level with one', () => {
  assert.equal(addedLine(undefined), undefined, 'no level: the prompt as written')
  assert.equal(addedLine('commit'), 'When you finish, if you changed any file, commit your work.')
  assert.equal(addedLine('branch'), 'When you finish, if you changed any file, commit your work, push your branch and open no pull request.')
  assert.equal(addedLine('pr'), 'When you finish, if you changed any file, commit your work, push your branch and open its pull request.')
  assert.equal(addedLine('merge'), 'When you finish, if you changed any file, commit your work, push your branch and open its pull request, set to merge on its own once its checks pass.')
})

test('a run with a pull request branch: the levels that open a request name it, the others say what they always say', () => {
  assert.equal(addedLine('pr', 'login-page'), 'When you finish, if you changed any file, commit your work, push your branch and open its pull request into the branch login-page.')
  assert.equal(addedLine('merge', 'login-page'), 'When you finish, if you changed any file, commit your work, push your branch and open its pull request into the branch login-page, set to merge on its own once its checks pass.')
  assert.equal(addedLine('commit', 'login-page'), PUBLISH_LINES.commit)
  assert.equal(addedLine('branch', 'login-page'), PUBLISH_LINES.branch)
  assert.equal(addedLine(undefined, 'login-page'), undefined)
})

test('a pull request branch is on the record for the run\'s whole life: a resumed run, and one given the level only later, are told it', async () => {
  const repo = await testRepo()
  try {
    const prompts: string[] = []
    const listening = (text: string): Driver => ({ id: 'fake', start: async opts => wrap(await new FakeDriver({ turns: [{ text }], sessionId: 's-1' }).start(opts), async sent => void prompts.push(sent)) })
    const first = await runCommand(repo, { prompt: 'Fix the typo', publish: 'commit', prBase: 'login-page', driver: listening(QUESTION), now: ticking(), gitHost: noGitHost })
    assert.equal(prompts[0], `Fix the typo\n\n${PUBLISH_LINES.commit}`, 'nothing to say at a level that opens no request')
    const card = await findRun(repo, first.id)
    assert.equal(runnerMark(card!)?.prBase, 'login-page')
    assert.equal(card!.caller?.['prBase'], 'login-page', 'what the dashboard reads')
    await resumeRun(repo, { id: first.id, answer: 'Approve', publish: 'pr', driver: listening('Done.'), now: ticking(), gitHost: noGitHost })
    assert.ok(prompts[1]?.endsWith(`${addedLine('pr', 'login-page')}`), prompts[1])
    assert.equal(runnerMark((await findRun(repo, first.id))!)?.prBase, 'login-page')
  } finally {
    await removeRepo(repo)
  }
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

    const resumed = await resumeRun(repo, { id: first.id, text: 'Go on.', by: 'reply', driver: listening('Done.'), host: 'this-box', pid: 4243, now: () => new Date('2026-09-16T18:00:00.000Z'), gitHost: noGitHost })
    assert.equal(resumed.status, 'done')
    assert.equal(prompts[1], `Go on.\n\n${PUBLISH_LINES.pr}`, 'the resumed run is told its level again')
    assert.equal(runnerMark((await findRun(repo, first.id))!)?.publish, 'pr', 'and the record still names it')
    // Who resumed it is on the record with the time, and gone with the next resume that names nobody.
    assert.deepEqual(runnerMark((await findRun(repo, first.id))!)?.resumed, { by: 'reply', at: '2026-09-16T18:00:00.000Z' })
    await resumeRun(repo, { id: first.id, text: 'And this.', driver: listening('Done.'), host: 'this-box', pid: 4244, now: ticking(), gitHost: noGitHost })
    assert.equal(runnerMark((await findRun(repo, first.id))!)?.resumed, undefined)

    const plain = await runCommand(repo, { prompt: 'Fix the typo', driver: listening('Done.'), host: 'this-box', pid: 4242, now: ticking(), gitHost: noGitHost })
    assert.equal(prompts[3], 'Fix the typo', 'no level: the prompt as written')
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
