import { strict as assert } from 'node:assert'
import { localHost } from '@openagt/agent-driver'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProjectRuntime } from './daemon-runtime.js'
import type { Hooks, ProjectRef, RunHost, RunOptions } from '@openagt/hooks'
import { fakeHost, type FakeHost } from '@openagt/hooks/testing'
import { OPENAGENT_DIR } from './openagent-dir.js'
import { addProject, listProjects } from './registry.js'
import { projectId } from '@openagt/agent-data'
import { publishedBase } from '@openagt/agent-data/names'
import { SESSIONS_ID } from './project-address.js'
import { DATA_BRANCH, SHARE_SETTING, excludeFromGit, readSharing, withFileBranch, writeSharing } from '@openagt/agent-data'
import { handDownTestDistribution } from './test-distribution.js'

handDownTestDistribution()

// A Start, as the daemon does it: this computer's host (`run.host`, #2394), asked with the run's
// options.

async function project(): Promise<string> {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'openagent-runtime-')))
  await mkdir(join(cwd, OPENAGENT_DIR), { recursive: true })
  return cwd
}

/** What the modules are told of the projects added and removed, as `added <id> <dir>` and `removed <id> <dir>`. */
function toldModules(): { told: string[]; lifecycle: Pick<Hooks, 'projectAdded' | 'projectRemoved'> } {
  const told: string[] = []
  const said = (what: string) => async (project: ProjectRef): Promise<void> => void told.push(`${what} ${project.id} ${project.dir}`)
  return { told, lifecycle: { projectAdded: said('added'), projectRemoved: said('removed') } }
}

/** What the host was asked last: the project's folder, the prompt, and the run's options. */
function lastStart(host: FakeHost): { dir?: string; prompt?: string; options?: RunOptions } {
  const request = host.requests.at(-1)
  return { ...(request?.project ? { dir: request.project.dir } : {}), ...(request ? { prompt: request.prompt, options: request.options } : {}) }
}

test("onStart starts the run on this computer's host, in the project addressed, home or registered, and answers the run it began", async () => {
  const home = await project()
  const other = await project()
  const env = { XDG_CONFIG_HOME: join(home, 'cfg') }
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true })
  const record = await addProject(other, new Date().toISOString(), env)
  const host = fakeHost()
  const runtime = createProjectRuntime({ cwd: home, env, host })
  try {
    assert.deepEqual(await runtime.onStart('/work-queue', { options: { 'agent-driver': { driver: 'codex', model: 'gpt-5', effort: 'high' } } }), { ok: true, agentId: 'run-1' })
    assert.deepEqual(lastStart(host), { dir: home, prompt: '/work-queue', options: { 'agent-driver': { driver: 'codex', model: 'gpt-5', effort: 'high' }, publish: 'commit' } })
    // No picks made: the host's own defaults apply, and the answer names the coding agent it is on.
    assert.deepEqual(await runtime.onStart('Read the docs', {}, record.id), { ok: true, agentId: 'run-2' })
    assert.deepEqual(lastStart(host), { dir: other, prompt: 'Read the docs', options: { publish: 'commit' } })
    assert.equal(host.requests[1]?.project?.id, record.id)
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(other, { recursive: true, force: true })
  }
})

test('onStart refuses in words: an unknown project, a start the host refuses', async () => {
  const home = await project()
  const env = { XDG_CONFIG_HOME: join(home, 'cfg') }
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true })
  const host: RunHost = { ...fakeHost(), start: async () => { throw new Error('Codex is not installed.') } }
  const runtime = createProjectRuntime({ cwd: home, env, host })
  try {
    assert.deepEqual(await runtime.onStart('x', {}, 'no-such-project'), { ok: false, error: 'unknown project: no-such-project' })
    assert.deepEqual(await runtime.onStart('x'), { ok: false, error: 'Codex is not installed.' })
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a Start picked to run on another host goes to that host, one a module on in the project brings, its options naming it; one the project has not is refused before any host is asked (#2394)', async () => {
  const home = await project()
  const env = { XDG_CONFIG_HOME: join(home, 'cfg') }
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true })
  const host = fakeHost()
  const actions = fakeHost({ id: 'actions', label: 'GitHub Actions' })
  const askedIn: (string | undefined)[] = []
  const otherHosts = async (project?: ProjectRef): Promise<RunHost[]> => (askedIn.push(project?.dir), [actions])
  const runtime = createProjectRuntime({ cwd: home, env, host, otherHosts })
  try {
    assert.deepEqual(await runtime.onStart('add a --verbose flag', { host: 'actions', options: { 'agent-driver': { model: 'claude-opus-4-8' } } }), { ok: true, agentId: 'run-1' })
    assert.deepEqual(lastStart(actions), { dir: home, prompt: 'add a --verbose flag', options: { host: 'actions', 'agent-driver': { model: 'claude-opus-4-8' }, publish: 'commit' } })
    assert.deepEqual(askedIn, [home], "the hosts are the project's")
    // This computer's own host, by its id, is no other host's: its run's options name none.
    assert.deepEqual(await runtime.onStart('go', { host: host.id }), { ok: true, agentId: 'run-1' })
    assert.deepEqual(lastStart(host).options, { publish: 'commit' })
    assert.deepEqual(await runtime.onStart('go', { host: 'claude-web' }), { ok: false, error: 'No host claude-web is on in this project. Pick another place to run.' })
    assert.deepEqual(await runtime.onStart('go', { host: '../actions' }), { ok: false, error: 'A host is named by its id.' })
    assert.deepEqual(await runtime.onStart('go', { host: 'actions' }, SESSIONS_ID), { ok: false, error: 'A session with no project runs on this computer.' })
    // The images a Start goes with stay on this computer, and so does its run.
    const screenshot = `${'a'.repeat(64)}.png`
    assert.deepEqual(await runtime.onStart('what does it say?', { host: 'actions', images: [screenshot] }), { ok: false, error: 'Images stay on this computer: a session with images runs here, not on GitHub Actions.' })
    assert.deepEqual(await runtime.onStart('what does it say?', { images: ['../../secret.png'] }), { ok: false, error: 'Images are named by the names the dashboard kept them under.' })
    assert.equal(actions.requests.length, 1)
    assert.equal(host.requests.length, 1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a Start goes no further than the project can, the commit with no remote, the branch with a remote and no git host; with no pick it commits, and with Nothing it is given no level', async () => {
  const home = await project()
  const env = { XDG_CONFIG_HOME: join(home, 'cfg') }
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true })
  const host = fakeHost()
  const runtime = createProjectRuntime({ cwd: home, env, host })
  const level = (): unknown => lastStart(host).options?.publish
  try {
    execFileSync('git', ['init', '-q'], { cwd: home })
    assert.deepEqual(await runtime.onStart('Fix it', { publish: 'merge' }), { ok: true, agentId: 'run-1' })
    assert.equal(level(), 'commit', 'no remote: the commit')
    // No pick saved: the daemon starts the run at the commit, which pushes nothing.
    await runtime.onStart('Fix it')
    assert.equal(level(), 'commit', 'no pick, no remote: the commit')
    // Off is a pick: the run is given no level.
    await runtime.onStart('Fix it', { publish: 'nothing' })
    assert.equal(level(), undefined, 'Off saved: no level')
    execFileSync('git', ['remote', 'add', 'origin', 'https://example.com/x.git'], { cwd: home })
    await runtime.onStart('Fix it', { publish: 'merge' })
    assert.equal(level(), 'branch', 'a remote and no git host: the branch')
    await runtime.onStart('Fix it')
    assert.equal(level(), 'commit', 'no pick, a remote: the commit all the same')
    await runtime.onStart('Fix it', { publish: 'commit' })
    assert.equal(level(), 'commit', 'Commit saved: the commit, the remote or not')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a Start hands the host the branch to start from, and refuses a word that is no branch name before the host is asked', async () => {
  const home = await project()
  const env = { XDG_CONFIG_HOME: join(home, 'cfg') }
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true })
  const host = fakeHost()
  const runtime = createProjectRuntime({ cwd: home, env, host })
  try {
    await runtime.onStart('Fix it', { base: 'my/branch', prBase: 'develop' })
    assert.deepEqual([lastStart(host).options?.['git-branches'], lastStart(host).options?.github], [{ base: 'my/branch' }, { prBase: 'develop' }])
    await runtime.onStart('Fix it')
    assert.equal(lastStart(host).options?.['git-branches'], undefined, 'no pick: the run is given no branch')
    assert.deepEqual(await runtime.onStart('Fix it', { base: '--upload-pack=x' }), { ok: false, error: 'not a branch name: --upload-pack=x' })
    assert.deepEqual(await runtime.onStart('Fix it', { base: '' }), { ok: false, error: 'not a branch name: ' })
    assert.deepEqual(await runtime.onStart('Fix it', { prBase: '--upload-pack=x' }), { ok: false, error: 'not a branch name: --upload-pack=x' })
    assert.equal(host.requests.length, 2, 'the host was not asked')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test("a Start hands the host the session's account at the git host and its controls' run options, and refuses what is no login before the host is asked", async () => {
  const home = await project()
  const env = { XDG_CONFIG_HOME: join(home, 'cfg') }
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true })
  const host = fakeHost()
  const runtime = createProjectRuntime({ cwd: home, env, host })
  try {
    await runtime.onStart('Fix it', { account: 'octo-agent', options: { plugins: { without: ['ask', 'tickets'] }, skills: { project: ['deploy', 'lint'] } } })
    const { options } = lastStart(host)
    assert.deepEqual([options?.github, options?.plugins, options?.skills], [{ account: 'octo-agent' }, { without: ['ask', 'tickets'] }, { project: ['deploy', 'lint'] }])
    await runtime.onStart('Fix it')
    assert.deepEqual(lastStart(host).options, { publish: 'commit' }, "no pick: the run goes as the computer's account, on the profile picked for every next run")
    const asked = host.requests.length
    const notALogin = { ok: false, error: 'An account is named by its login.' }
    assert.deepEqual(await runtime.onStart('Fix it', { account: 'octo agent' }), notALogin)
    assert.deepEqual(await runtime.onStart('Fix it', { account: '' }), notALogin)
    assert.deepEqual(await runtime.onStart('Fix it', { account: 42 as unknown as string }), notALogin)
    assert.equal(host.requests.length, asked, 'the host was not asked')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test("a Start from a branch of origin's hands the host origin's copy; one gone from origin, or an origin that cannot be read, refuses in plain words before the host is asked", async () => {
  const home = await project()
  const env = { XDG_CONFIG_HOME: join(home, 'cfg') }
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true })
  const origin = await realpath(await mkdtemp(join(tmpdir(), 'openagent-origin-')))
  const host = fakeHost()
  const runtime = createProjectRuntime({ cwd: home, env, host })
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd })
  const base = (): unknown => lastStart(host).options?.['git-branches']?.base
  try {
    git(origin, 'init', '-q', '--bare', '-b', 'main')
    git(home, 'init', '-q', '-b', 'main')
    git(home, 'commit', '-q', '--allow-empty', '-m', 'first')
    git(home, 'remote', 'add', 'origin', origin)
    git(home, 'push', '-q', 'origin', 'main', 'main:feature/x')
    // This clone's copy outlives the branch, as it does in any clone: origin is what is asked.
    git(home, 'fetch', '-q', 'origin')
    assert.deepEqual(await runtime.onStart('Fix it', { base: publishedBase('feature/x') }), { ok: true, agentId: 'run-1' })
    assert.equal(base(), publishedBase('feature/x'))

    git(origin, 'update-ref', '-d', 'refs/heads/feature/x')
    assert.deepEqual(await runtime.onStart('Fix it', { base: publishedBase('feature/x') }), { ok: false, error: 'The branch feature/x is no longer on origin. Pick another branch to start from.' })
    git(home, 'remote', 'set-url', 'origin', join(origin, 'nowhere'))
    assert.deepEqual(await runtime.onStart('Fix it', { base: publishedBase('main') }), { ok: false, error: 'Could not read the branch main from origin. Check the connection, or pick another branch to start from.' })
    assert.equal(host.requests.length, 1, 'the host was not asked')

    // The local pick asks nothing of origin: it starts where the origin cannot be read too.
    await runtime.onStart('Fix it', { base: 'main' })
    assert.equal(base(), 'main')
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(origin, { recursive: true, force: true })
  }
})

test('adding a project makes it one, an empty folder included, and tells the modules once, as it is put on the list (app.lifecycle)', async () => {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'openagent-add-')))
  const cfg = await realpath(await mkdtemp(join(tmpdir(), 'openagent-add-cfg-')))
  // The add's git reads the process's own environment, and a new folder's first commit needs an author.
  const env = { XDG_CONFIG_HOME: cfg, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' }
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  const { told, lifecycle } = toldModules()
  const runtime = createProjectRuntime({ cwd: folder, env, host: fakeHost(), lifecycle })
  try {
    assert.deepEqual(await runtime.onAddProject(folder, false), { ok: true, alreadyActivated: false })
    // The person's answer on the agents' records is written with the add: kept on this machine.
    assert.equal(await readSharing(folder), false)
    assert.deepEqual(told, [`added ${projectId(folder)} ${folder}`], 'the modules on in it start their work there')

    // A yes is to the remote that is there: this folder has none, so the records stay kept.
    assert.deepEqual(await runtime.onAddProject(folder, true), { ok: true, alreadyActivated: true, noRemote: true })
    assert.equal(await readSharing(folder), false)
    // With a remote, the same answer shares them from now on.
    execFileSync('git', ['remote', 'add', 'origin', join(cfg, 'origin.git')], { cwd: folder })
    assert.deepEqual(await runtime.onAddProject(folder, true), { ok: true, alreadyActivated: true })
    assert.equal(await readSharing(folder), true)
    assert.equal(told.length, 1, 'added again, it was on the list already: the modules are not told twice')
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(folder, { recursive: true, force: true })
    await rm(cfg, { recursive: true, force: true })
  }
})

test('starting inside a folder not on the list adds it and leaves the repository\'s answer on the records as it is', async () => {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'openagent-started-')))
  const other = await realpath(await mkdtemp(join(tmpdir(), 'openagent-started-other-')))
  const cfg = await realpath(await mkdtemp(join(tmpdir(), 'openagent-started-cfg-')))
  const env = { XDG_CONFIG_HOME: cfg, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' }
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  const runtime = createProjectRuntime({ cwd: cfg, env, host: fakeHost() })
  try {
    // A clone whose person said yes before: its folder moved, so it is not on the list any more.
    execFileSync('git', ['init', '-q'], { cwd: folder })
    execFileSync('git', ['remote', 'add', 'origin', join(cfg, 'origin.git')], { cwd: folder })
    await writeSharing(folder, true)
    const started = await runtime.onStartedIn(folder)
    assert.equal(started.ok && started.added, true)
    assert.equal(await readSharing(folder), true, 'the yes stays: starting there is no answer')
    // A repository never asked stays unasked: it reads as kept, and nothing is written for it.
    const fresh = await runtime.onStartedIn(other)
    assert.equal(fresh.ok && fresh.added, true)
    assert.throws(() => execFileSync('git', ['config', '--local', '--get', SHARE_SETTING], { cwd: other, stdio: 'pipe' }))
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    for (const dir of [folder, other, cfg]) await rm(dir, { recursive: true, force: true })
  }
})

test('removing a project takes it off the list, tells every module, and deletes nothing in its folder; an id not on the list is refused', async () => {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'openagent-remove-')))
  const cfg = await realpath(await mkdtemp(join(tmpdir(), 'openagent-remove-cfg-')))
  const env = { XDG_CONFIG_HOME: cfg, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' }
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  // The daemon runs elsewhere: the project is not its own start folder.
  const { told, lifecycle } = toldModules()
  const runtime = createProjectRuntime({ cwd: cfg, env, host: fakeHost(), lifecycle })
  try {
    assert.deepEqual(await runtime.onAddProject(folder, false), { ok: true, alreadyActivated: false })
    const [project] = await listProjects(env)
    assert.equal(project?.path, folder)
    await writeFile(join(folder, 'mine.txt'), 'mine\n')
    await writeFile(join(folder, OPENAGENT_DIR, 'kept.txt'), 'kept\n')
    const kept = execFileSync('git', ['log', '--format=%H'], { cwd: folder, encoding: 'utf8' })

    assert.deepEqual(await runtime.onRemoveProject('nope-123'), { ok: false, error: 'no project with that id is on the list' })
    assert.equal((await listProjects(env)).length, 1)

    assert.deepEqual(await runtime.onRemoveProject(project!.id), { ok: true })
    assert.deepEqual(await listProjects(env), [])
    assert.deepEqual(told, [`added ${project!.id} ${folder}`, `removed ${project!.id} ${folder}`], 'each module stops what it started there')
    // Nothing of the folder is deleted: the person's file, OpenAgent's directory, the commits.
    assert.equal(await readFile(join(folder, 'mine.txt'), 'utf8'), 'mine\n')
    assert.equal(await readFile(join(folder, OPENAGENT_DIR, 'kept.txt'), 'utf8'), 'kept\n')
    assert.equal(execFileSync('git', ['log', '--format=%H'], { cwd: folder, encoding: 'utf8' }), kept)

    // Removed twice: the second time there is no such project.
    assert.deepEqual(await runtime.onRemoveProject(project!.id), { ok: false, error: 'no project with that id is on the list' })
  } finally {
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
  // This computer's host, which says the project's runs off their files.
  const runtime = createProjectRuntime({ cwd: cfg, env, host: localHost({ agents: async () => [] }) })
  try {
    assert.deepEqual(await runtime.onAddProject(folder, false), { ok: true, alreadyActivated: false })
    const [project] = await listProjects(env)
    // A run's checkout with its live card: this process stands in for the agent at work.
    const id = '2026-10-06T10-00-00-000Z'
    const checkout = join(folder, '.branches', `agent-${id}`)
    execFileSync('git', ['worktree', 'add', '-q', '-b', `agent-${id}`, checkout], { cwd: folder })
    await mkdir(join(checkout, '.openagent'), { recursive: true })
    const card = (pid: number): string => JSON.stringify({ id, status: 'running', startedAt: '2026-10-06T10:00:00.000Z', intent: 'x', caller: { pid, host: hostname() } })
    await writeFile(join(checkout, '.openagent', `${id}.json`), card(process.pid))

    assert.deepEqual(await runtime.onRemoveProject(project!.id), { ok: false, error: 'An agent is working in this project. Stop it, then remove the project.' })
    assert.equal((await listProjects(env)).length, 1, 'still on the list')

    // The process died and nothing healed the card: nothing is working there.
    await writeFile(join(checkout, '.openagent', `${id}.json`), card(2 ** 31 - 1))
    assert.deepEqual(await runtime.onRemoveProject(project!.id), { ok: true })
    assert.deepEqual(await listProjects(env), [])

    // A project whose folder was deleted by hand can still be taken off the list.
    assert.deepEqual(await runtime.onAddProject(folder, false), { ok: true, alreadyActivated: true })
    await rm(folder, { recursive: true, force: true })
    assert.deepEqual(await runtime.onRemoveProject(project!.id), { ok: true })
    assert.deepEqual(await listProjects(env), [])
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
  const runtime = createProjectRuntime({ cwd: cfg, env, host: fakeHost() })
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
    const [project] = await listProjects(env)

    const outcome = await runtime.onRemoveProject(project!.id, true)
    assert.deepEqual(outcome, {
      ok: true,
      cleanup: {
        removed: ['.branches/agent-idle', '.branches/agent-worked', '.agent-runner/runs', '.agent-runner', `.branches/${DATA_BRANCH}`, `branch ${DATA_BRANCH}`, '.branches', 'setting agent-data.share', '.openagent'],
        kept: [],
        failed: [],
      },
    })
    assert.deepEqual(await listProjects(env), [])
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
  const runtime = createProjectRuntime({ cwd: cfg, env, host: fakeHost() })
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: folder, encoding: 'utf8' })
  try {
    await usedProject(runtime, folder)
    // A file of the dashboard's directory that the person committed.
    await writeFile(join(folder, '.openagent', 'notes.md'), 'notes\n')
    git('add', '-f', '.openagent/notes.md')
    git('commit', '-q', '-m', 'notes')
    // Work an agent left uncommitted, and the person's own settings for the runner.
    await writeFile(join(folder, '.branches', 'agent-idle', 'draft.txt'), 'draft\n')
    await writeFile(join(folder, '.agent-runner', 'config.yml'), 'personal:\n  memory: off\n')
    // A second checkout of the same repository, on the list as a project of its own.
    git('worktree', 'add', '-q', '-b', 'second', second)
    assert.deepEqual(await runtime.onAddProject(second, false), { ok: true, alreadyActivated: false })
    const project = (await listProjects(env)).find(listed => listed.path === folder)

    const outcome = await runtime.onRemoveProject(project!.id, true)
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
    assert.deepEqual((await listProjects(env)).map(listed => listed.path), [second])
  } finally {
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
  const runtime = createProjectRuntime({ cwd: cfg, env, host: fakeHost() })
  try {
    await usedProject(runtime, folder)
    // A run that holds its lock and has no card yet: still booting, so the dashboard's own check sees no agent at work.
    await writeFile(join(folder, '.agent-runner', 'runs', 'booting.lock'), `${process.pid}\n`)
    const [project] = await listProjects(env)

    const outcome = await runtime.onRemoveProject(project!.id, true)
    const cleanup = outcome.ok ? outcome.cleanup : undefined
    assert.deepEqual(cleanup?.failed, ['@openagt/agent-driver: a run is still working here (booting): stop it first'])
    assert.deepEqual(cleanup?.kept.filter(kept => kept.reason === 'a clean-up before it did not finish'), [
      { path: `branch ${DATA_BRANCH}`, reason: 'a clean-up before it did not finish' },
      { path: '.openagent', reason: 'a clean-up before it did not finish' },
    ])
    assert.equal(await readFile(join(folder, '.branches', DATA_BRANCH, 'card.json'), 'utf8'), '{}\n', 'the records are whole')
    assert.equal(await readFile(join(folder, OPENAGENT_DIR, '.gitignore'), 'utf8').then(() => true, () => false), true, "and so is the dashboard's directory")
    assert.deepEqual((await readdir(join(folder, '.agent-runner', 'runs'))).sort(), ['booting.lock', 'r1.stderr'])
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(base, { recursive: true, force: true })
  }
})
