import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DATA_BRANCH, excludeFromGit, withFileBranch } from '@openagt/agent-data'
import { listProjects } from '../distribution-hooks.js'
import { OPENAGENT_DIR } from '../openagent-dir.js'
import { handDownTestDistribution } from '../test-distribution.js'
import { callModule } from './module-calls.js'

handDownTestDistribution()

// Add project and Remove project, as the dashboard calls them: the projects module's functions
// (`@openagt/projects`), with the distribution's modules behind them. The app says whether a
// project may go (agent-driver's: an agent at work there), and each module cleans up what it left in the folder.

/** A function of the projects module, called as the page calls it; its answer, or the call's failure thrown. */
async function projects<T>(name: string, input: object): Promise<T> {
  const called = await callModule(null, '@openagt/projects', name, input)
  if (!called.ok) throw new Error(called.error)
  return called.output as T
}

type Removed = { ok: true; cleanup?: { removed: string[]; kept: { path: string; reason: string }[]; failed: string[] } } | { ok: false; error: string }
const addProject = (path: string) => projects<{ ok: boolean }>('addProject', { path })
const removeProject = (projectId: string, files: boolean) => projects<Removed>('removeProject', { projectId, files })

test('a project with an agent at work is not removed, a lock a dead process left does not count, and a project whose folder is gone is removed', async () => {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'openagent-remove-busy-')))
  const cfg = await realpath(await mkdtemp(join(tmpdir(), 'openagent-remove-busy-cfg-')))
  const env = { XDG_CONFIG_HOME: cfg, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' }
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  try {
    assert.deepEqual(await addProject(folder), { ok: true, alreadyActivated: false })
    const [project] = await listProjects()
    // A run's lock, as agent-driver keeps one while the run's process is alive: this process stands in for it.
    const lock = join(folder, '.agent-runner', 'runs', '2026-10-06T10-00-00-000Z.lock')
    await mkdir(join(folder, '.agent-runner', 'runs'), { recursive: true })
    await writeFile(lock, `${process.pid}\n`)

    assert.deepEqual(await removeProject(project!.id, false), { ok: false, error: 'An agent is working in this project. Stop it, then remove the project.' })
    assert.equal((await listProjects()).length, 1, 'still on the list')

    // The process died and left its lock: nothing is working there.
    await writeFile(lock, `${2 ** 31 - 1}\n`)
    assert.deepEqual(await removeProject(project!.id, false), { ok: true })
    assert.deepEqual(await listProjects(), [])

    // A project whose folder was deleted by hand can still be taken off the list.
    assert.deepEqual(await addProject(folder), { ok: true, alreadyActivated: true })
    await rm(folder, { recursive: true, force: true })
    assert.deepEqual(await removeProject(project!.id, false), { ok: true })
    assert.deepEqual(await listProjects(), [])
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(folder, { recursive: true, force: true })
    await rm(cfg, { recursive: true, force: true })
  }
})

/** A project the dashboard added, with an agent at rest, an agent with work on its branch, records and a run's leftovers. */
async function usedProject(folder: string): Promise<void> {
  assert.deepEqual(await addProject(folder), { ok: true, alreadyActivated: false })
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: folder, encoding: 'utf8' })
  // An agent that changed nothing, and one whose branch holds a commit.
  git('worktree', 'add', '-q', '-b', 'agent-idle', join(folder, '.branches', 'agent-idle'))
  git('worktree', 'add', '-q', '-b', 'agent-worked', join(folder, '.branches', 'agent-worked'))
  await writeFile(join(folder, '.branches', 'agent-worked', 'made.txt'), 'made\n')
  execFileSync('git', ['add', '-A'], { cwd: join(folder, '.branches', 'agent-worked') })
  execFileSync('git', ['commit', '-q', '-m', 'work'], { cwd: join(folder, '.branches', 'agent-worked') })
  // The agents' records, and what a run leaves in the runner's directory.
  assert.equal((await withFileBranch(folder, DATA_BRANCH, 'a record', async dir => writeFile(join(dir, 'card.json'), '{}\n'))).ok, true)
  await mkdir(join(folder, '.agent-runner', 'runs'), { recursive: true })
  await writeFile(join(folder, '.agent-runner', 'runs', 'r1.stderr'), 'a warning\n')
  // Hidden from git, as the tools hide their own.
  for (const rule of ['/.agent-runner', '/.branches']) await excludeFromGit(folder, rule)
}

test('removing a project with its files: OpenAgent\'s own go, each named; the person\'s files, commits, a branch with work and the remote stay', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'openagent-remove-files-')))
  const folder = join(base, 'project')
  const cfg = join(base, 'cfg')
  await mkdir(folder)
  await mkdir(cfg)
  const env = { XDG_CONFIG_HOME: cfg, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' }
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: folder, encoding: 'utf8' })
  try {
    await usedProject(folder)
    await writeFile(join(folder, 'mine.txt'), 'mine\n')
    // A remote that holds the person's branch and an older copy of the records.
    execFileSync('git', ['init', '-q', '--bare', join(base, 'origin.git')])
    git('remote', 'add', 'origin', join(base, 'origin.git'))
    git('push', '-q', 'origin', 'HEAD:refs/heads/main', `${DATA_BRANCH}:refs/heads/${DATA_BRANCH}`)
    const remote = git('ls-remote', 'origin')
    const head = git('rev-parse', 'HEAD')
    const worked = git('rev-parse', 'agent-worked')
    const [project] = await listProjects()

    const outcome = await removeProject(project!.id, true)
    assert.deepEqual(outcome, {
      ok: true,
      cleanup: {
        removed: ['.branches/agent-idle', '.branches/agent-worked', '.agent-runner/runs', '.agent-runner', `.branches/${DATA_BRANCH}`, `branch ${DATA_BRANCH}`, '.branches', 'setting agent-data.share', '.openagent'],
        kept: [],
        failed: [],
      },
    })
    assert.deepEqual(await listProjects(), [])
    assert.deepEqual((await readdir(folder)).sort(), ['.git', 'mine.txt'], 'only the person\'s own is left in the folder')
    assert.equal(await readFile(join(folder, 'mine.txt'), 'utf8'), 'mine\n')
    assert.equal(git('rev-parse', 'HEAD'), head, 'the person\'s branch is where it was')
    assert.equal(git('rev-parse', 'agent-worked'), worked, 'the branch with work on it stays')
    assert.deepEqual(git('for-each-ref', '--format=%(refname:short)', 'refs/heads').trim().split('\n').filter(name => name === 'agent-idle' || name === DATA_BRANCH), [], 'the empty branch and the records\' branch went')
    assert.equal(git('ls-remote', 'origin'), remote, 'nothing on the remote changed')
    assert.equal(git('status', '--porcelain').trim(), '?? mine.txt')
    assert.doesNotMatch(await readFile(join(folder, '.git', 'info', 'exclude'), 'utf8'), /^\/\.(agent-runner|branches)$/m, 'the rules that hid them went with them')
    assert.equal(git('worktree', 'list', '--porcelain').match(/^worktree /gm)?.length, 1)
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(base, { recursive: true, force: true })
  }
})

test('removing a project with its files keeps what is not OpenAgent\'s to delete: a tracked file, uncommitted work, the person\'s settings, and records another listed project uses', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'openagent-remove-kept-')))
  const folder = join(base, 'project')
  const second = join(base, 'second')
  const cfg = join(base, 'cfg')
  await mkdir(folder)
  await mkdir(cfg)
  const env = { XDG_CONFIG_HOME: cfg, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' }
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: folder, encoding: 'utf8' })
  try {
    await usedProject(folder)
    // A file of the dashboard's directory that the person committed.
    await writeFile(join(folder, '.openagent', 'notes.md'), 'notes\n')
    git('add', '-f', '.openagent/notes.md')
    git('commit', '-q', '-m', 'notes')
    // Work an agent left uncommitted, and the person's own settings for the runner.
    await writeFile(join(folder, '.branches', 'agent-idle', 'draft.txt'), 'draft\n')
    await writeFile(join(folder, '.agent-runner', 'config.yml'), 'personal:\n  memory: off\n')
    // A second checkout of the same repository, on the list as a project of its own.
    git('worktree', 'add', '-q', '-b', 'second', second)
    assert.deepEqual(await addProject(second), { ok: true, alreadyActivated: false })
    const project = (await listProjects()).find(listed => listed.path === folder)

    const outcome = await removeProject(project!.id, true)
    assert.equal(outcome.ok, true)
    const cleanup = outcome.ok ? outcome.cleanup : undefined
    assert.deepEqual(cleanup?.failed, [])
    assert.deepEqual(cleanup?.kept, [
      { path: '.branches/agent-idle', reason: 'agent-idle has uncommitted work; the checkout was kept' },
      { path: `.branches/${DATA_BRANCH}`, reason: 'not made by branches' },
      { path: '.agent-runner/config.yml', reason: 'your settings for agent-runner' },
      { path: `branch ${DATA_BRANCH}`, reason: `another project on the list uses it: ${second}` },
      { path: '.openagent/notes.md', reason: 'git tracks it' },
    ])
    assert.deepEqual(cleanup?.removed, ['.branches/agent-worked', '.agent-runner/runs', '.openagent/.gitignore'])
    assert.equal(await readFile(join(folder, '.branches', 'agent-idle', 'draft.txt'), 'utf8'), 'draft\n')
    assert.equal(await readFile(join(folder, '.agent-runner', 'config.yml'), 'utf8'), 'personal:\n  memory: off\n')
    assert.equal(await readFile(join(folder, '.branches', DATA_BRANCH, 'card.json'), 'utf8'), '{}\n', 'the records the other project reads are whole')
    assert.equal(git('status', '--porcelain').trim(), '', 'what stays is still hidden from git')
    assert.deepEqual((await listProjects()).map(listed => listed.path), [second])
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(base, { recursive: true, force: true })
  }
})

test('removing a project with its files while a run of this machine is alive, one still booting too: refused, and nothing goes; a module that cannot clean up keeps the records and the dashboard\'s directory', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'openagent-remove-live-')))
  const folder = join(base, 'project')
  const cfg = join(base, 'cfg')
  await mkdir(folder)
  await mkdir(cfg)
  const env = { XDG_CONFIG_HOME: cfg, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' }
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  try {
    await usedProject(folder)
    // A run that holds its lock and has no card yet: still booting, and at work all the same.
    await writeFile(join(folder, '.agent-runner', 'runs', 'booting.lock'), `${process.pid}\n`)
    const [project] = await listProjects()
    assert.deepEqual(await removeProject(project!.id, true), { ok: false, error: 'An agent is working in this project. Stop it, then remove the project.' })
    assert.equal((await listProjects()).length, 1, 'still on the list')
    assert.deepEqual((await readdir(join(folder, '.agent-runner', 'runs'))).sort(), ['booting.lock', 'r1.stderr'])

    // The run ended. A scheduler set to keep running is alive here (this process stands in for it):
    // its module cannot clean up, so the project goes off the list and its records stay for it.
    await rm(join(folder, '.agent-runner', 'runs', 'booting.lock'))
    await mkdir(join(folder, '.scheduler'))
    await writeFile(join(folder, '.scheduler', 'state.json'), `${JSON.stringify({ pid: process.pid })}\n`)
    const outcome = await removeProject(project!.id, true)
    const cleanup = outcome.ok ? outcome.cleanup : undefined
    assert.deepEqual(cleanup?.failed, [`scheduled-agents: the scheduler is running here (pid ${process.pid}): stop it first with npx @openagt/scheduled-agents@0.1 stop`])
    assert.deepEqual(cleanup?.kept.filter(kept => kept.reason === 'a clean-up before it did not finish'), [
      { path: `branch ${DATA_BRANCH}`, reason: 'a clean-up before it did not finish' },
      { path: '.openagent', reason: 'a clean-up before it did not finish' },
    ])
    assert.deepEqual(await listProjects(), [])
    assert.equal(await readFile(join(folder, '.branches', DATA_BRANCH, 'card.json'), 'utf8'), '{}\n', 'the records are whole')
    assert.equal(await readFile(join(folder, OPENAGENT_DIR, '.gitignore'), 'utf8').then(() => true, () => false), true, "and so is the dashboard's directory")
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(base, { recursive: true, force: true })
  }
})
