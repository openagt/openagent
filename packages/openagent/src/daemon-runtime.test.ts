import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProjectRuntime } from './daemon-runtime.js'
import { PROJECT_HOOKS_FILE } from './project-hooks.js'
import { OPENAGENT_DIR } from './openagent-dir.js'
import { addProject, listProjects, projectId, removeProject } from './registry.js'
import type { OpenAgentEvent } from './events.js'
import { nodeGitRunner } from '@openagt/agent-data'
import { addWorktree, agentBranchName, worktreePath } from '@openagt/skill-branches'
import { DATA_BRANCH, excludeFromGit, readSharing, withFileBranch } from '@openagt/agent-data'

// A Start, as the daemon does it (#1774): the project's own start hook line, nothing else. The
// relay half of onStart has its own loopback test (dashboard/remote-run.integration.test.ts).

async function project(hooks?: string): Promise<string> {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'openagent-runtime-')))
  await mkdir(join(cwd, OPENAGENT_DIR), { recursive: true })
  if (hooks !== undefined) await writeFile(join(cwd, PROJECT_HOOKS_FILE), hooks)
  return cwd
}

const START = `start: 'printf "%s|%s|%s" "$PROMPT" "\${DRIVER-unset}" "\${MODEL-unset}" > started.txt; echo "{\\"id\\":\\"run-7\\"}"'\n`

test('onStart runs the start hook of the project addressed, home or registered, and answers the run the hook began', async () => {
  const home = await project(START)
  const other = await project(START)
  const env = { XDG_CONFIG_HOME: join(home, 'cfg') }
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true })
  const record = await addProject(other, new Date().toISOString(), undefined, env)
  const runtime = createProjectRuntime({ cwd: home, env })
  try {
    assert.deepEqual(await runtime.onStart('/work-queue', { driver: 'codex', model: 'gpt-5' }), { ok: true, agentId: 'run-7' })
    assert.equal(await readFile(join(home, 'started.txt'), 'utf8'), '/work-queue|codex|gpt-5')
    // No picks made: the line's own defaults apply, so neither variable is set.
    assert.deepEqual(await runtime.onStart('Read the docs', {}, record.id), { ok: true, agentId: 'run-7' })
    assert.equal(await readFile(join(other, 'started.txt'), 'utf8'), 'Read the docs|unset|unset')
  } finally {
    await runtime.dispose()
    await rm(home, { recursive: true, force: true })
    await rm(other, { recursive: true, force: true })
  }
})

test('onStart refuses in words: an unknown project, a project with no start line, a line that fails', async () => {
  const home = await project('open:\n  - "true"\n')
  const env = { XDG_CONFIG_HOME: join(home, 'cfg') }
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true })
  const runtime = createProjectRuntime({ cwd: home, env })
  try {
    assert.deepEqual(await runtime.onStart('x', {}, 'no-such-project'), { ok: false, error: 'unknown project: no-such-project' })
    assert.deepEqual(await runtime.onStart('x'), { ok: false, error: 'this project has no start hook' })
    await writeFile(join(home, PROJECT_HOOKS_FILE), 'start: echo "codex is not installed" >&2; exit 1\n')
    assert.deepEqual(await runtime.onStart('x'), { ok: false, error: 'the start hook: codex is not installed' })
  } finally {
    await runtime.dispose()
    await rm(home, { recursive: true, force: true })
  }
})

test('a Start goes no further than the project can, the commit with no remote, the branch with a remote and no git host; with no pick it commits, and with Nothing it is given no level', async () => {
  const PUBLISH = `start: 'printf "%s" "\${PUBLISH-unset}" > started.txt; echo "{\\"id\\":\\"run-8\\"}"'\n`
  const home = await project(PUBLISH)
  const env = { XDG_CONFIG_HOME: join(home, 'cfg') }
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true })
  const runtime = createProjectRuntime({ cwd: home, env })
  try {
    execFileSync('git', ['init', '-q'], { cwd: home })
    assert.deepEqual(await runtime.onStart('Fix it', { publish: 'merge' }), { ok: true, agentId: 'run-8' })
    assert.equal(await readFile(join(home, 'started.txt'), 'utf8'), 'commit', 'no remote: the commit')
    // No pick saved: the daemon starts the run at the commit, which pushes nothing.
    assert.deepEqual(await runtime.onStart('Fix it'), { ok: true, agentId: 'run-8' })
    assert.equal(await readFile(join(home, 'started.txt'), 'utf8'), 'commit', 'no pick, no remote: the commit')
    // Nothing is a pick: the line is given no level.
    assert.deepEqual(await runtime.onStart('Fix it', { publish: 'nothing' }), { ok: true, agentId: 'run-8' })
    assert.equal(await readFile(join(home, 'started.txt'), 'utf8'), 'unset', 'Nothing saved: no level')
    execFileSync('git', ['remote', 'add', 'origin', 'https://example.com/x.git'], { cwd: home })
    assert.deepEqual(await runtime.onStart('Fix it', { publish: 'merge' }), { ok: true, agentId: 'run-8' })
    assert.equal(await readFile(join(home, 'started.txt'), 'utf8'), 'branch', 'a remote and no git host: the branch')
    assert.deepEqual(await runtime.onStart('Fix it'), { ok: true, agentId: 'run-8' })
    assert.equal(await readFile(join(home, 'started.txt'), 'utf8'), 'commit', 'no pick, a remote: the commit all the same')
    assert.deepEqual(await runtime.onStart('Fix it', { publish: 'commit' }), { ok: true, agentId: 'run-8' })
    assert.equal(await readFile(join(home, 'started.txt'), 'utf8'), 'commit', 'Commit saved: the commit, the remote or not')
  } finally {
    await runtime.dispose()
    await rm(home, { recursive: true, force: true })
  }
})

test('a Start hands the line the branch to start from, and refuses a word that is no branch name before the line runs', async () => {
  const BASE = `start: 'printf "%s" "\${BASE-unset}" > started.txt; echo "{\\"id\\":\\"run-9\\"}"'\n`
  const home = await project(BASE)
  const env = { XDG_CONFIG_HOME: join(home, 'cfg') }
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true })
  const runtime = createProjectRuntime({ cwd: home, env })
  try {
    assert.deepEqual(await runtime.onStart('Fix it', { base: 'my/branch' }), { ok: true, agentId: 'run-9' })
    assert.equal(await readFile(join(home, 'started.txt'), 'utf8'), 'my/branch')
    assert.deepEqual(await runtime.onStart('Fix it'), { ok: true, agentId: 'run-9' })
    assert.equal(await readFile(join(home, 'started.txt'), 'utf8'), 'unset', 'no pick: the line is given no branch')
    await rm(join(home, 'started.txt'))
    assert.deepEqual(await runtime.onStart('Fix it', { base: '--upload-pack=x' }), { ok: false, error: 'not a branch name: --upload-pack=x' })
    assert.deepEqual(await runtime.onStart('Fix it', { base: '' }), { ok: false, error: 'not a branch name: ' })
    await assert.rejects(readFile(join(home, 'started.txt'), 'utf8'), 'the line did not run')
  } finally {
    await runtime.dispose()
    await rm(home, { recursive: true, force: true })
  }
})

test('adding a project writes the runner\'s start, resume and check lines, an empty folder included, and keeps a line already there', async () => {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'openagent-add-')))
  const cfg = await realpath(await mkdtemp(join(tmpdir(), 'openagent-add-cfg-')))
  // The add registers through the process's own environment, and a new folder's first commit needs an author.
  const env = { XDG_CONFIG_HOME: cfg, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' }
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  const runtime = createProjectRuntime({ cwd: folder, env })
  try {
    assert.deepEqual(await runtime.onAddProject(folder, false), { ok: true, alreadyActivated: false })
    // The person's answer on the agents' records is written with the add: kept on this machine.
    assert.equal(await readSharing(folder), false)
    const written = await readFile(join(folder, PROJECT_HOOKS_FILE), 'utf8')
    for (const key of ['start', 'resume', 'check']) assert.match(written, new RegExp(`^${key}: agent-runner `, 'm'))

    // The person's own line stays; adding the project again fills only what is missing.
    await writeFile(join(folder, PROJECT_HOOKS_FILE), 'start: my-own-tool "$PROMPT"\n')
    // A yes is to the remote that is there: this folder has none, so the records stay kept.
    assert.deepEqual(await runtime.onAddProject(folder, true), { ok: true, alreadyActivated: true, noRemote: true })
    assert.equal(await readSharing(folder), false)
    // With a remote, the same answer shares them from now on.
    execFileSync('git', ['remote', 'add', 'origin', join(cfg, 'origin.git')], { cwd: folder })
    assert.deepEqual(await runtime.onAddProject(folder, true), { ok: true, alreadyActivated: true })
    assert.equal(await readSharing(folder), true)
    const again = await readFile(join(folder, PROJECT_HOOKS_FILE), 'utf8')
    assert.match(again, /^start: my-own-tool "\$PROMPT"$/m)
    assert.match(again, /^resume: agent-runner /m)
  } finally {
    await runtime.dispose()
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(folder, { recursive: true, force: true })
    await rm(cfg, { recursive: true, force: true })
  }
})

test('removing a project runs its close hooks and takes it off the list, and deletes nothing in its folder; an id not on the list is refused', async () => {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'openagent-remove-')))
  const cfg = await realpath(await mkdtemp(join(tmpdir(), 'openagent-remove-cfg-')))
  const env = { XDG_CONFIG_HOME: cfg, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' }
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  // The daemon runs elsewhere: the project is not its own start folder.
  const runtime = createProjectRuntime({ cwd: cfg, env })
  try {
    assert.deepEqual(await runtime.onAddProject(folder, false), { ok: true, alreadyActivated: false })
    const [project] = await listProjects(undefined, env)
    assert.equal(project?.path, folder)
    await writeFile(join(folder, PROJECT_HOOKS_FILE), 'close:\n  - echo closed > closed.txt\n')
    await writeFile(join(folder, 'mine.txt'), 'mine\n')
    const kept = execFileSync('git', ['log', '--format=%H'], { cwd: folder, encoding: 'utf8' })

    assert.deepEqual(await runtime.onRemoveProject('nope-123'), { ok: false, error: 'no project with that id is on the list' })
    assert.equal((await listProjects(undefined, env)).length, 1)

    assert.deepEqual(await runtime.onRemoveProject(project!.id), { ok: true })
    assert.deepEqual(await listProjects(undefined, env), [])
    assert.equal(await readFile(join(folder, 'closed.txt'), 'utf8'), 'closed\n', 'the close line ran, in the project')
    // Nothing of the folder is deleted: the person's file, OpenAgent's directory, the commits.
    assert.equal(await readFile(join(folder, 'mine.txt'), 'utf8'), 'mine\n')
    assert.match(await readFile(join(folder, PROJECT_HOOKS_FILE), 'utf8'), /^close:/)
    assert.equal(execFileSync('git', ['log', '--format=%H'], { cwd: folder, encoding: 'utf8' }), kept)

    // Removed twice: the second time there is no such project.
    assert.deepEqual(await runtime.onRemoveProject(project!.id), { ok: false, error: 'no project with that id is on the list' })
  } finally {
    await runtime.dispose()
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(folder, { recursive: true, force: true })
    await rm(cfg, { recursive: true, force: true })
  }
})

test('a project with an agent at work is not removed, a card left "running" by a dead process does not count, and a project whose folder is gone is removed', async () => {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'openagent-remove-busy-')))
  const cfg = await realpath(await mkdtemp(join(tmpdir(), 'openagent-remove-busy-cfg-')))
  const env = { XDG_CONFIG_HOME: cfg, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' }
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  const runtime = createProjectRuntime({ cwd: cfg, env })
  try {
    assert.deepEqual(await runtime.onAddProject(folder, false), { ok: true, alreadyActivated: false })
    const [project] = await listProjects(undefined, env)
    // A run's checkout with its live card: this process stands in for the agent at work.
    const id = '2026-10-06T10-00-00-000Z'
    const checkout = join(folder, '.branches', `agent-${id}`)
    execFileSync('git', ['worktree', 'add', '-q', '-b', `agent-${id}`, checkout], { cwd: folder })
    await mkdir(join(checkout, '.openagent'), { recursive: true })
    const card = (pid: number): string => JSON.stringify({ id, status: 'running', startedAt: '2026-10-06T10:00:00.000Z', intent: 'x', caller: { pid, host: hostname() } })
    await writeFile(join(checkout, '.openagent', `${id}.json`), card(process.pid))

    assert.deepEqual(await runtime.onRemoveProject(project!.id), { ok: false, error: 'An agent is working in this project. Stop it, then remove the project.' })
    assert.equal((await listProjects(undefined, env)).length, 1, 'still on the list')

    // The process died and nothing healed the card: nothing is working there.
    await writeFile(join(checkout, '.openagent', `${id}.json`), card(2 ** 31 - 1))
    assert.deepEqual(await runtime.onRemoveProject(project!.id), { ok: true })
    assert.deepEqual(await listProjects(undefined, env), [])

    // A project whose folder was deleted by hand can still be taken off the list.
    assert.deepEqual(await runtime.onAddProject(folder, false), { ok: true, alreadyActivated: true })
    await rm(folder, { recursive: true, force: true })
    assert.deepEqual(await runtime.onRemoveProject(project!.id), { ok: true })
    assert.deepEqual(await listProjects(undefined, env), [])
  } finally {
    await runtime.dispose()
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(folder, { recursive: true, force: true })
    await rm(cfg, { recursive: true, force: true })
  }
})

/** A project the dashboard added, with an agent at rest, an agent with work on its branch, records and a run's leftovers. */
async function usedProject(runtime: ReturnType<typeof createProjectRuntime>, folder: string): Promise<void> {
  assert.deepEqual(await runtime.onAddProject(folder, false), { ok: true, alreadyActivated: false })
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
  const runtime = createProjectRuntime({ cwd: cfg, env })
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: folder, encoding: 'utf8' })
  try {
    await usedProject(runtime, folder)
    await writeFile(join(folder, 'mine.txt'), 'mine\n')
    // A remote that holds the person's branch and an older copy of the records.
    execFileSync('git', ['init', '-q', '--bare', join(base, 'origin.git')])
    git('remote', 'add', 'origin', join(base, 'origin.git'))
    git('push', '-q', 'origin', 'HEAD:refs/heads/main', `${DATA_BRANCH}:refs/heads/${DATA_BRANCH}`)
    const remote = git('ls-remote', 'origin')
    const head = git('rev-parse', 'HEAD')
    const worked = git('rev-parse', 'agent-worked')
    const [project] = await listProjects(undefined, env)

    const outcome = await runtime.onRemoveProject(project!.id, true)
    assert.deepEqual(outcome, {
      ok: true,
      cleanup: {
        removed: ['.branches/agent-idle', '.branches/agent-worked', '.agent-runner/runs', '.agent-runner', `.branches/${DATA_BRANCH}`, `branch ${DATA_BRANCH}`, '.branches', 'setting agent-data.share', '.openagent'],
        kept: [],
        failed: [],
      },
    })
    assert.deepEqual(await listProjects(undefined, env), [])
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
    await runtime.dispose()
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
  const runtime = createProjectRuntime({ cwd: cfg, env })
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: folder, encoding: 'utf8' })
  try {
    await usedProject(runtime, folder)
    // A file of the dashboard's directory that the person committed.
    await writeFile(join(folder, '.openagent', 'custom-presets.json'), '[]\n')
    git('add', '-f', '.openagent/custom-presets.json')
    git('commit', '-q', '-m', 'presets')
    // Work an agent left uncommitted, and the person's own settings for the runner.
    await writeFile(join(folder, '.branches', 'agent-idle', 'draft.txt'), 'draft\n')
    await writeFile(join(folder, '.agent-runner', 'config.yml'), 'ended: say done\n')
    // A second checkout of the same repository, on the list as a project of its own.
    git('worktree', 'add', '-q', '-b', 'second', second)
    assert.deepEqual(await runtime.onAddProject(second, false), { ok: true, alreadyActivated: false })
    const project = (await listProjects(undefined, env)).find(listed => listed.path === folder)

    const outcome = await runtime.onRemoveProject(project!.id, true)
    assert.equal(outcome.ok, true)
    const cleanup = outcome.ok ? outcome.cleanup : undefined
    assert.deepEqual(cleanup?.failed, [])
    assert.deepEqual(cleanup?.kept, [
      { path: '.branches/agent-idle', reason: 'agent-idle has uncommitted work; the checkout was kept' },
      { path: `.branches/${DATA_BRANCH}`, reason: 'not made by branches' },
      { path: '.agent-runner/config.yml', reason: 'your settings for agent-runner' },
      { path: `branch ${DATA_BRANCH}`, reason: `another project on the list uses it: ${second}` },
      { path: '.openagent/custom-presets.json', reason: 'git tracks it' },
    ])
    assert.deepEqual(cleanup?.removed, ['.branches/agent-worked', '.agent-runner/runs', '.openagent/.gitignore', '.openagent/hooks.yml'])
    assert.equal(await readFile(join(folder, '.branches', 'agent-idle', 'draft.txt'), 'utf8'), 'draft\n')
    assert.equal(await readFile(join(folder, '.agent-runner', 'config.yml'), 'utf8'), 'ended: say done\n')
    assert.equal(await readFile(join(folder, '.branches', DATA_BRANCH, 'card.json'), 'utf8'), '{}\n', 'the records the other project reads are whole')
    assert.equal(git('status', '--porcelain').trim(), '', 'what stays is still hidden from git')
    assert.deepEqual((await listProjects(undefined, env)).map(listed => listed.path), [second])
  } finally {
    await runtime.dispose()
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(base, { recursive: true, force: true })
  }
})

test('removing a project with its files while a run of this machine is still alive: the runner refuses, and the records and the dashboard\'s directory stay', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'openagent-remove-live-')))
  const folder = join(base, 'project')
  const cfg = join(base, 'cfg')
  await mkdir(folder)
  await mkdir(cfg)
  const env = { XDG_CONFIG_HOME: cfg, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' }
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  const runtime = createProjectRuntime({ cwd: cfg, env })
  try {
    await usedProject(runtime, folder)
    // A run that holds its lock and has no card yet: still booting, so the dashboard's own check sees no agent at work.
    await writeFile(join(folder, '.agent-runner', 'runs', 'booting.lock'), `${process.pid}\n`)
    const [project] = await listProjects(undefined, env)

    const outcome = await runtime.onRemoveProject(project!.id, true)
    const cleanup = outcome.ok ? outcome.cleanup : undefined
    assert.deepEqual(cleanup?.failed, ['@openagt/agent-runner: a run is still working here (booting): stop it first'])
    assert.deepEqual(cleanup?.kept.filter(kept => kept.reason === 'a clean-up before it did not finish'), [
      { path: `branch ${DATA_BRANCH}`, reason: 'a clean-up before it did not finish' },
      { path: '.openagent', reason: 'a clean-up before it did not finish' },
    ])
    assert.equal(await readFile(join(folder, '.branches', DATA_BRANCH, 'card.json'), 'utf8'), '{}\n', 'the records are whole')
    assert.match(await readFile(join(folder, PROJECT_HOOKS_FILE), 'utf8'), /^start:/m, 'and so are the project\'s start lines')
    assert.deepEqual((await readdir(join(folder, '.agent-runner', 'runs'))).sort(), ['booting.lock', 'r1.stderr'])
  } finally {
    await runtime.dispose()
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(base, { recursive: true, force: true })
  }
})

/** A repository in a folder of its own under `base`, with `origin` set to `origin` when one is given. */
async function clone(base: string, name: string, origin?: string): Promise<string> {
  const dir = join(base, name)
  await mkdir(dir, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  if (origin) execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: dir })
  return dir
}

test('a relayed call\'s project is this machine\'s own, found by its repository\'s address: the first on the list, every time', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'openagent-address-')))
  const env = { XDG_CONFIG_HOME: join(base, 'cfg') }
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true })
  const at = new Date().toISOString()
  const other = await clone(base, 'other', 'https://github.com/acme/other.git')
  const local = await clone(base, 'notes')
  const first = await clone(base, 'shop', 'https://github.com/Acme/Shop.git')
  const second = await clone(base, 'shop-again', 'git@github.com:acme/shop.git')
  for (const dir of [other, local, first, second]) await addProject(dir, at, undefined, env)
  const runtime = createProjectRuntime({ cwd: other, env })
  try {
    // Two folders cloned from one repository: the one added first, and the same one on every call,
    // so a run's later calls reach the project it started in.
    for (let i = 0; i < 3; i++) assert.equal(await runtime.projectAt('github.com/acme/shop'), projectId(first))
    assert.equal(await runtime.projectAt('github.com/acme/other'), projectId(other))
    // No project cloned from it, and no project at all for a folder with no remote: nothing is fallen back to.
    assert.equal(await runtime.projectAt('github.com/acme/nowhere'), undefined)
    assert.equal(await runtime.projectAt(''), undefined)
    // Off the list, the first is no longer this machine's project, and the second answers.
    await removeProject(projectId(first), undefined, env)
    assert.equal(await runtime.projectAt('github.com/acme/shop'), projectId(second))
  } finally {
    await runtime.dispose()
    await rm(base, { recursive: true, force: true })
  }
})

test('a relayed run\'s events are read from the project the call names, not from the folder the daemon was started in', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'openagent-tail-')))
  const env = { XDG_CONFIG_HOME: join(base, 'cfg') }
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true })
  const home = await clone(base, 'home')
  // The project with the run: a real repository with the run's own checkout, its card and its diary.
  const shop = await clone(base, 'shop')
  const git = nodeGitRunner()
  const agentId = '2026-07-19T10-00-00-000Z'
  await git(['config', 'user.email', 't@t'], shop)
  await git(['config', 'user.name', 't'], shop)
  await writeFile(join(shop, 'index.html'), '<h1>Hello</h1>\n')
  await git(['add', '-A'], shop)
  await git(['commit', '-q', '-m', 'init'], shop)
  await addWorktree(shop, { agentId, branch: agentBranchName(agentId) }, git)
  const worktree = worktreePath(shop, agentId)
  await mkdir(join(worktree, OPENAGENT_DIR), { recursive: true })
  await writeFile(join(worktree, OPENAGENT_DIR, `${agentId}.json`), JSON.stringify({ id: agentId, startedAt: '2026-07-19T10:00:00.000Z', status: 'running', caller: { pid: process.pid, host: hostname() } }))
  await writeFile(join(worktree, OPENAGENT_DIR, `${agentId}.jsonl`), JSON.stringify({ kind: 'said', text: 'from the shop' }) + '\n')
  await addProject(shop, new Date().toISOString(), undefined, env)
  const runtime = createProjectRuntime({ cwd: home, env })
  const read = (project: string): Promise<OpenAgentEvent[]> =>
    new Promise(resolvePromise => {
      const events: OpenAgentEvent[] = []
      const stop = runtime.tailRelayEvents(project, agentId, event => events.push(event))
      setTimeout(() => {
        stop()
        resolvePromise(events)
      }, 600)
    })
  try {
    const events = await read(projectId(shop))
    assert.equal(JSON.stringify(events).includes('from the shop'), true, JSON.stringify(events))
    // The same run asked for in the daemon's own folder, or in no project of this machine: nothing.
    assert.deepEqual(await read(projectId(home)), [])
    assert.deepEqual(await read('no-such-project'), [])
  } finally {
    await runtime.dispose()
    await rm(base, { recursive: true, force: true })
  }
})
