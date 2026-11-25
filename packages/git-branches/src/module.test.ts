import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeGitRunner } from '@openagt/agent-data'
import { RunOrder, type GitBranchesFacts, type ProjectRef, type RunContext, type RunStep, type RunSummary } from '@openagt/hooks'
import { fakeApp, fakeRun } from '@openagt/hooks/testing'
import { gitBranchesModule } from './module.js'
import { SESSION_FOLDER_STAYS } from './session-folder.js'
import { worktreePath } from './worktree.js'

// git-branches as a module: its steps, run alone on a real repository, each reading and writing
// the run's context as the pipeline hands it from one step to the next.

const git = nodeGitRunner()

async function project(): Promise<ProjectRef> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'git-branches-module-')))
  await git(['init', '-q', '-b', 'main'], dir)
  await writeFile(join(dir, 'README.md'), 'hi\n')
  await git(['add', '-A'], dir)
  await git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'], dir)
  return { id: 'p', name: 'p', dir }
}

const steps = (): Record<'checkout' | 'branch' | 'reclaim', RunStep> => {
  const [checkout, branch, reclaim] = gitBranchesModule({ git }).hooks['run.step'] ?? []
  return { checkout: checkout!, branch: branch!, reclaim: reclaim! }
}

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

/** The run's git-branches facts as they are now: read through a call, so an assert on them earlier narrows nothing. */
const factsOf = (ctx: RunContext): GitBranchesFacts | undefined => ctx.facts['git-branches']

test('its steps stand where a checkout is made, its branch read back, and the checkout reclaimed', () => {
  assert.deepEqual(
    (gitBranchesModule().hooks['run.step'] ?? []).map(step => [step.order, step.name]),
    [
      [RunOrder.WORKSPACE, 'make the checkout'],
      [RunOrder.RECORD - 20, 'read the branch back'],
      [RunOrder.CLEANUP, 'reclaim the checkout'],
    ],
  )
})

test('a fresh run: a checkout on a branch of its own, the commit it was made at, the branch the agent renamed, and the checkout gone with its empty branch', async () => {
  const p = await project()
  try {
    const { checkout, branch, reclaim } = steps()
    const ctx: RunContext = fakeRun({ id: 'run1', project: p })
    await checkout.run(ctx)
    assert.equal(ctx.workspace, worktreePath(p.dir, 'run1'))
    const main = (await git(['rev-parse', 'main'], p.dir)).trim()
    assert.deepEqual(ctx.facts['git-branches'], { branch: 'agent-run1', baseCommit: main })

    await git(['branch', '-m', 'agent-fix-it'], ctx.workspace!)
    await branch.run(ctx)
    assert.equal(factsOf(ctx)?.branch, 'agent-fix-it')

    ctx.outcome = { status: 'done' }
    await reclaim.run(ctx)
    assert.deepEqual(factsOf(ctx)?.reclaimed, { reclaimed: true, deleted: ['agent-fix-it'] }, 'a branch holding nothing goes with its checkout')
    assert.equal(await exists(worktreePath(p.dir, 'run1')), false)
  } finally {
    await rm(p.dir, { recursive: true, force: true })
  }
})

test('a run given a branch works on it and writes down no start of its own; one that ends waiting keeps its checkout', async () => {
  const p = await project()
  try {
    await git(['branch', 'their-work'], p.dir)
    const { checkout, reclaim } = steps()
    const ctx = fakeRun({ id: 'run2', project: p, options: { 'git-branches': { branch: 'their-work' } } })
    await checkout.run(ctx)
    assert.deepEqual(ctx.facts['git-branches'], { branch: 'their-work' })
    ctx.outcome = { status: 'waiting', question: 'Ship it?' }
    await reclaim.run(ctx)
    assert.deepEqual(factsOf(ctx)?.reclaimed, { reclaimed: false, reason: 'waiting' })
    assert.equal(await exists(worktreePath(p.dir, 'run2')), true)
  } finally {
    await rm(p.dir, { recursive: true, force: true })
  }
})

test('a continued run goes on in the checkout it kept, from the facts its record kept; one whose branch is gone everywhere gets it made again', async () => {
  const p = await project()
  try {
    const { checkout } = steps()
    const first = fakeRun({ id: 'run3', project: p })
    await checkout.run(first)
    const kept = first.facts['git-branches']!

    const again = fakeRun({ id: 'run3', project: p, resume: { text: 'more' }, facts: { 'git-branches': { ...kept } } })
    await checkout.run(again)
    assert.equal(again.workspace, first.workspace)
    assert.deepEqual(again.facts['git-branches'], kept, 'the kept checkout, as the record has it')

    await git(['worktree', 'remove', '--force', first.workspace!], p.dir)
    await git(['branch', '-D', 'agent-run3'], p.dir)
    const remade = fakeRun({ id: 'run3', project: p, resume: { text: 'more' }, facts: { 'git-branches': { branch: 'agent-run3', baseCommit: 'f'.repeat(40) } } })
    await checkout.run(remade)
    assert.deepEqual(remade.facts['git-branches'], { branch: 'agent-run3', baseCommit: (await git(['rev-parse', 'main'], p.dir)).trim(), again: true })
  } finally {
    await rm(p.dir, { recursive: true, force: true })
  }
})

test('a run with no project works in a folder of its own, which stays; a run whose checkout was never made has none to reclaim', async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'git-branches-sessions-')))
  const before = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = home
  try {
    const { checkout, branch, reclaim } = steps()
    const ctx = fakeRun({ id: 'run4' })
    await checkout.run(ctx)
    assert.equal(ctx.workspace, join(home, 'openagent-sessions', 'run4'))
    await branch.run(ctx)
    assert.equal(ctx.facts['git-branches'], undefined, 'a folder with no branch')
    ctx.outcome = { status: 'done' }
    await reclaim.run(ctx)
    assert.deepEqual(factsOf(ctx)?.reclaimed, { reclaimed: false, reason: SESSION_FOLDER_STAYS })

    const failed = fakeRun({ id: 'run5', outcome: { status: 'failed', error: 'make the checkout: no' } })
    await reclaim.run(failed)
    assert.deepEqual(factsOf(failed)?.reclaimed, { reclaimed: false, reason: 'no checkout' })
  } finally {
    if (before === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = before
    await rm(home, { recursive: true, force: true })
  }
})

test('a run in a project with repos: its checkout of the project, a copy of each repo in a session folder, and its facts name the copies made now', async () => {
  const p = await project()
  const other = await project()
  const home = await realpath(await mkdtemp(join(tmpdir(), 'git-branches-home-')))
  const before = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = home
  try {
    // The repo has an origin, as a repo on a git host has: its copy's work can be pushed.
    await git(['init', '-q', '--bare', join(home, 'other-origin.git')], home)
    await git(['remote', 'add', 'origin', join(home, 'other-origin.git')], other.dir)
    const { checkout, reclaim } = steps()
    const repos = [{ name: 'other', from: other.dir }]
    const ctx: RunContext = fakeRun({ id: 'run1', project: p, options: { 'git-branches': { repos } } })
    await checkout.run(ctx)
    assert.equal(ctx.workspace, worktreePath(p.dir, 'run1'), 'the run works in its checkout of the project')
    const folder = join(home, 'openagent-sessions', 'run1')
    assert.equal((await git(['branch', '--show-current'], join(folder, 'other'))).trim(), 'agent-run1', 'the copy is on a branch of its own')
    assert.equal((await git(['branch', '--show-current'], other.dir)).trim(), 'main', "the repo's own folder is left on its branch")
    assert.deepEqual(ctx.facts['git-branches']?.copies, { folder, branch: 'agent-run1', made: repos })

    // A resumed run has its copy already: nothing is made.
    const resumed: RunContext = fakeRun({ id: 'run1', project: p, options: { 'git-branches': { repos } }, resume: { text: 'go on' }, facts: ctx.facts })
    await checkout.run(resumed)
    assert.deepEqual(resumed.facts['git-branches']?.copies?.made, [])

    // The run ends with work in its copy: the copy stays. One it never touched goes, and the empty folder with it.
    await writeFile(join(folder, 'other', 'work.txt'), 'x\n')
    await git(['add', '-A'], join(folder, 'other'))
    await git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'work'], join(folder, 'other'))
    resumed.outcome = { status: 'done' }
    await reclaim.run(resumed)
    assert.equal(await exists(join(folder, 'other')), true, 'a copy with a commit of its own stays')
    // Pushed, its work is still its own: the copy stays, where a resumed run goes on and the work bar reads it.
    await git(['push', '-q', 'origin', 'agent-run1'], join(folder, 'other'))
    await reclaim.run(resumed)
    assert.equal(await exists(join(folder, 'other')), true, 'a copy whose commit was pushed stays')
    const untouched: RunContext = fakeRun({ id: 'run2', project: p, options: { 'git-branches': { repos } } })
    await checkout.run(untouched)
    const second = join(home, 'openagent-sessions', 'run2')
    await writeFile(join(second, 'other', 'scratch.txt'), 'x\n')
    untouched.outcome = { status: 'done' }
    await reclaim.run(untouched)
    assert.equal(await exists(join(second, 'other')), true, 'a copy with a file not committed stays')
    await rm(join(second, 'other', 'scratch.txt'))
    await reclaim.run(untouched)
    assert.deepEqual([await exists(join(second, 'other')), await exists(second)], [false, false], 'an untouched copy goes, and the session folder once it is empty')
  } finally {
    if (before === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = before
    await rm(p.dir, { recursive: true, force: true })
    await rm(other.dir, { recursive: true, force: true })
    await rm(home, { recursive: true, force: true })
  }
})

test('the repos a run is given are checked before anything is made: a name that is no folder name, two alike, or a folder that is no repository top refuses it', async () => {
  const p = await project()
  const other = await project()
  const home = await realpath(await mkdtemp(join(tmpdir(), 'git-branches-home-')))
  const before = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = home
  try {
    await mkdir(join(other.dir, 'src'))
    const { checkout } = steps()
    const refused = async (repos: { name: string; from: string }[], reason: RegExp) => {
      const ctx = fakeRun({ id: 'run9', options: { 'git-branches': { repos } } })
      await assert.rejects(async () => checkout.run(ctx), reason)
      assert.equal(ctx.workspace, undefined, 'no folder was made')
    }
    await refused([{ name: '../escape', from: other.dir }], /not a name for a copy of a repo: \.\.\/escape/)
    await refused([{ name: 'a', from: other.dir }, { name: 'a', from: p.dir }], /not a name for a copy of a repo: a/)
    await refused([{ name: 'src', from: join(other.dir, 'src') }], /is not a git repository/)
    await refused([{ name: 'home', from: home }], /is not a git repository/)
  } finally {
    if (before === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = before
    await rm(p.dir, { recursive: true, force: true })
    await rm(other.dir, { recursive: true, force: true })
    await rm(home, { recursive: true, force: true })
  }
})

test("a finished run's work left on this machine is what waits on the person: its commits never pushed, as its project's runs say it", async () => {
  const p = await project()
  const origin = await realpath(await mkdtemp(join(tmpdir(), 'git-branches-origin-')))
  try {
    await git(['init', '-q', '--bare', origin], origin)
    await git(['remote', 'add', 'origin', origin], p.dir)
    await git(['push', '-q', 'origin', 'main'], p.dir)
    await git(['fetch', '-q', 'origin'], p.dir)
    await git(['remote', 'set-head', 'origin', 'main'], p.dir)
    await git(['checkout', '-q', '-b', 'agent-run1'], p.dir)
    await writeFile(join(p.dir, 'cart.txt'), 'cart\n')
    await git(['add', '-A'], p.dir)
    await git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'cart'], p.dir)
    await git(['checkout', '-q', 'main'], p.dir)
    const done: RunSummary = { id: 'run1', host: 'here', status: 'done', startedAt: '2026-07-16T00:00:00Z', endedAt: '2026-07-16T01:00:00Z', prompt: 'add the cart', branch: 'agent-run1' }
    const attention = gitBranchesModule({ git }).hooks['app.attention']!
    const items = await attention({ project: p }, fakeApp({ runs: async project => (project?.id === p.id ? [done] : []) }))
    assert.deepEqual(
      items.filter(item => item.kind === 'waiting').map(item => [item.id, item.words, item.detail, item.run]),
      [['unpushed:run1', 'Needs push', '1 commit', 'run1']],
    )
  } finally {
    await rm(p.dir, { recursive: true, force: true })
    await rm(origin, { recursive: true, force: true })
  }
})
