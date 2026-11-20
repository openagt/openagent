import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProjectRuntime } from './daemon-runtime.js'
import { forgetStartedNames, nameStarted, startedName, withStartedNames } from './started-names.js'
import type { AgentMeta } from './store/index.js'
import { ReadyNaming } from '@openagt/agent-runner'
import { readyPrompt } from '@openagt/agent-driver'
import type { Hooks, ProjectRef, RunHost, RunOptions, Driver } from '@openagt/hooks'
import { fakeHost, type FakeHost } from '@openagt/hooks/testing'
import { OPENAGENT_DIR } from './openagent-dir.js'
import { addMachine, addProject, listMachines, listProjects, removeProject, tellMachine } from './registry.js'
import type { OpenAgentEvent } from './events.js'
import { nodeGitRunner, sessionsHome, projectId } from '@openagt/agent-data'
import { publishedBase } from '@openagt/agent-data/names'
import { SESSIONS_ID } from './project-address.js'
import { addWorktree, agentBranchName, worktreePath } from '@openagt/git-branches'
import { DATA_BRANCH, SHARE_SETTING, excludeFromGit, readSharing, withFileBranch, writeSharing } from '@openagt/agent-data'
import { handDownTestDistribution } from './test-distribution.js'

handDownTestDistribution()

// A Start, as the daemon does it: this computer's host (`run.host`, #2394), asked with the run's
// options. The relay half of onStart has its own loopback test (dashboard/remote-run.integration.test.ts).

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
    assert.deepEqual(await runtime.onStart('/work-queue', { driver: 'codex', model: 'gpt-5', effort: 'high' }), { ok: true, agentId: 'run-1', driver: 'codex' })
    assert.deepEqual(lastStart(host), { dir: home, prompt: '/work-queue', options: { 'agent-driver': { driver: 'codex', model: 'gpt-5', effort: 'high' }, publish: 'commit' } })
    // No picks made: the host's own defaults apply, and the answer names the coding agent it is on.
    assert.deepEqual(await runtime.onStart('Read the docs', {}, record.id), { ok: true, agentId: 'run-2', driver: 'claude-code' })
    assert.deepEqual(lastStart(host), { dir: other, prompt: 'Read the docs', options: { publish: 'commit' } })
    assert.equal(host.requests[1]?.project?.id, record.id)
  } finally {
    await runtime.dispose()
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
    await runtime.dispose()
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
    assert.deepEqual(await runtime.onStart('add a --verbose flag', { host: 'actions', model: 'claude-opus-4-8' }), { ok: true, agentId: 'run-1', driver: 'claude-code' })
    assert.deepEqual(lastStart(actions), { dir: home, prompt: 'add a --verbose flag', options: { host: 'actions', 'agent-driver': { model: 'claude-opus-4-8' }, publish: 'commit' } })
    assert.deepEqual(askedIn, [home], "the hosts are the project's")
    // This computer's own host, by its id, is no other host's: its run's options name none.
    assert.deepEqual(await runtime.onStart('go', { host: host.id }), { ok: true, agentId: 'run-1', driver: 'claude-code' })
    assert.deepEqual(lastStart(host).options, { publish: 'commit' })
    assert.deepEqual(await runtime.onStart('go', { host: 'claude-web' }), { ok: false, error: 'No host claude-web is on in this project. Pick another place to run.' })
    assert.deepEqual(await runtime.onStart('go', { host: 'actions', machine: 'desk' }), { ok: false, error: 'A run goes to a machine or to a host, not both.' })
    assert.deepEqual(await runtime.onStart('go', { host: '../actions' }), { ok: false, error: 'A host is named by its id.' })
    assert.deepEqual(await runtime.onStart('go', { host: 'actions' }, SESSIONS_ID), { ok: false, error: 'A session with no project runs on this computer or a machine of yours.' })
    assert.equal(actions.requests.length, 1)
    assert.equal(host.requests.length, 1)
  } finally {
    await runtime.dispose()
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
    assert.deepEqual(await runtime.onStart('Fix it', { publish: 'merge' }), { ok: true, agentId: 'run-1', driver: 'claude-code' })
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
    await runtime.dispose()
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
    await runtime.dispose()
    await rm(home, { recursive: true, force: true })
  }
})

test("a Start hands the host the session's account at the git host, its preset and its picks, and refuses what is no login, no preset id, no plugin name or no skill name before the host is asked", async () => {
  const home = await project()
  const env = { XDG_CONFIG_HOME: join(home, 'cfg') }
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true })
  const host = fakeHost()
  const runtime = createProjectRuntime({ cwd: home, env, host })
  try {
    await runtime.onStart('Fix it', { account: 'octo-agent', preset: 'reviewer', pluginsWithout: ['ask', 'tickets'], projectSkills: ['deploy', 'lint'] })
    const { options } = lastStart(host)
    assert.deepEqual([options?.github, options?.presets, options?.plugins, options?.skills], [{ account: 'octo-agent' }, { preset: 'reviewer' }, { without: ['ask', 'tickets'] }, { project: ['deploy', 'lint'] }])
    await runtime.onStart('Fix it', { projectSkills: 'none' })
    assert.deepEqual(lastStart(host).options?.skills, { project: 'none' })
    await runtime.onStart('Fix it', { projectSkills: 'all' })
    assert.deepEqual(lastStart(host).options?.skills, { project: 'all' }, 'every project skill, over its preset\'s')
    await runtime.onStart('Fix it', { pluginsWithout: [] })
    assert.deepEqual(lastStart(host).options?.plugins, { without: [] }, "none of them, over its preset's")
    await runtime.onStart('Fix it')
    assert.deepEqual(lastStart(host).options, { publish: 'commit' }, "no pick: the run goes as the computer's account, on Default, with its preset's plugins and project skills")
    const asked = host.requests.length
    const notALogin = { ok: false, error: 'An account is named by its login.' }
    assert.deepEqual(await runtime.onStart('Fix it', { account: 'octo agent' }), notALogin)
    assert.deepEqual(await runtime.onStart('Fix it', { account: '' }), notALogin)
    assert.deepEqual(await runtime.onStart('Fix it', { account: 42 as unknown as string }), notALogin)
    const notAPreset = { ok: false, error: 'A preset is named by its id.' }
    assert.deepEqual(await runtime.onStart('Fix it', { preset: 'Not An Id' }), notAPreset)
    assert.deepEqual(await runtime.onStart('Fix it', { preset: '../x' }), notAPreset)
    const notPlugins = { ok: false, error: 'Plugins are named by their names.' }
    assert.deepEqual(await runtime.onStart('Fix it', { pluginsWithout: ['Not A Plugin'] }), notPlugins)
    assert.deepEqual(await runtime.onStart('Fix it', { pluginsWithout: 'ask' as unknown as string[] }), notPlugins)
    const notProjectSkills = { ok: false, error: 'Project skills are all, none, or named by their names.' }
    assert.deepEqual(await runtime.onStart('Fix it', { projectSkills: 'some' as unknown as 'none' }), notProjectSkills)
    assert.deepEqual(await runtime.onStart('Fix it', { projectSkills: [] }), notProjectSkills)
    assert.equal(host.requests.length, asked, 'the host was not asked')
  } finally {
    await runtime.dispose()
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
    assert.deepEqual(await runtime.onStart('Fix it', { base: publishedBase('feature/x') }), { ok: true, agentId: 'run-1', driver: 'claude-code' })
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
    await runtime.dispose()
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
    await runtime.dispose()
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
    await runtime.dispose()
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
  const runtime = createProjectRuntime({ cwd: cfg, env, host: fakeHost() })
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
  const runtime = createProjectRuntime({ cwd: cfg, env, host: fakeHost() })
  try {
    await usedProject(runtime, folder)
    // A run that holds its lock and has no card yet: still booting, so the dashboard's own check sees no agent at work.
    await writeFile(join(folder, '.agent-runner', 'runs', 'booting.lock'), `${process.pid}\n`)
    const [project] = await listProjects(env)

    const outcome = await runtime.onRemoveProject(project!.id, true)
    const cleanup = outcome.ok ? outcome.cleanup : undefined
    assert.deepEqual(cleanup?.failed, ['@openagt/agent-runner: a run is still working here (booting): stop it first'])
    assert.deepEqual(cleanup?.kept.filter(kept => kept.reason === 'a clean-up before it did not finish'), [
      { path: `branch ${DATA_BRANCH}`, reason: 'a clean-up before it did not finish' },
      { path: '.openagent', reason: 'a clean-up before it did not finish' },
    ])
    assert.equal(await readFile(join(folder, '.branches', DATA_BRANCH, 'card.json'), 'utf8'), '{}\n', 'the records are whole')
    assert.equal(await readFile(join(folder, OPENAGENT_DIR, '.gitignore'), 'utf8').then(() => true, () => false), true, "and so is the dashboard's directory")
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
  for (const dir of [other, local, first, second]) await addProject(dir, at, env)
  const runtime = createProjectRuntime({ cwd: other, env, host: fakeHost() })
  try {
    // Two folders cloned from one repository: the one added first, and the same one on every call,
    // so a run's later calls reach the project it started in.
    for (let i = 0; i < 3; i++) assert.equal(await runtime.projectAt('github.com/acme/shop'), projectId(first))
    assert.equal(await runtime.projectAt('github.com/acme/other'), projectId(other))
    // No project cloned from it, and no project at all for a folder with no remote: nothing is fallen back to.
    assert.equal(await runtime.projectAt('github.com/acme/nowhere'), undefined)
    assert.equal(await runtime.projectAt(''), undefined)
    // Off the list, the first is no longer this machine's project, and the second answers.
    await removeProject(projectId(first), env)
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
  await addProject(shop, new Date().toISOString(), env)
  const runtime = createProjectRuntime({ cwd: home, env, host: fakeHost() })
  // What is expected is waited for until it is there, however busy the computer is; what must
  // not come is given the time it would take.
  const read = (project: string, expected = false): Promise<OpenAgentEvent[]> =>
    new Promise(resolvePromise => {
      const events: OpenAgentEvent[] = []
      const end = (): void => {
        clearTimeout(timer)
        stop()
        resolvePromise(events)
      }
      const stop = runtime.tailRelayEvents(project, agentId, event => {
        events.push(event)
        if (expected) setImmediate(end)
      })
      const timer = setTimeout(end, expected ? 10_000 : 600)
    })
  try {
    const events = await read(projectId(shop), true)
    assert.equal(JSON.stringify(events).includes('from the shop'), true, JSON.stringify(events))
    // The same run asked for in the daemon's own folder, or in no project of this machine: nothing.
    assert.deepEqual(await read(projectId(home)), [])
    assert.deepEqual(await read('no-such-project'), [])
  } finally {
    await runtime.dispose()
    await rm(base, { recursive: true, force: true })
  }
})

test('a run started on another machine is followed only under an id that is a run\'s, and not one of this computer\'s own', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'openagent-relayed-id-')))
  const env = { XDG_CONFIG_HOME: join(base, 'cfg') }
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true })
  const shop = await clone(base, 'shop', 'https://github.com/acme/shop.git')
  await addProject(shop, new Date().toISOString(), env)
  // A run of this computer's own: a checkout the project's branches list names.
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'seed'], { cwd: shop, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })
  await addWorktree(shop, { agentId: 'mine-1', branch: agentBranchName('mine-1') }, nodeGitRunner())

  // The machine: whatever id it is told to answer a start with, and whatever coding agent; what each start named as its project.
  let answers = 'run-on-the-machine'
  let driver: unknown
  const sent: { project?: unknown; options?: Record<string, unknown> }[] = []
  const machine = createServer((req, res) => {
    if (req.url?.startsWith('/_relay/start')) {
      let body = ''
      req.on('data', chunk => (body += chunk))
      req.on('end', () => {
        sent.push(JSON.parse(body) as { project?: unknown })
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, agentId: answers, ...(driver !== undefined ? { driver } : {}) }))
      })
      return
    }
    req.resume()
    res.writeHead(200, { 'content-type': 'application/x-ndjson' }).end()
  })
  await new Promise<void>(resolve => machine.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(machine.address() as AddressInfo).port}`
  await addMachine({ url, key: 'id.key', door: `${url}/_devices/enter`, label: 'Server' }, env)
  const runtime = createProjectRuntime({ cwd: shop, env, host: fakeHost() })
  try {
    const start = () => runtime.onStart('go', { machine: url })
    assert.deepEqual(await start(), { ok: true, agentId: 'run-on-the-machine' })
    assert.ok(runtime.remoteAgents.target('run-on-the-machine'))
    // The run's row here says which coding agent runs it only when the machine said so, in a word a row can show.
    const row = (id: string) => runtime.remoteAgents.list(projectId(shop)).find(agent => agent.id === id)
    assert.equal(row('run-on-the-machine')!.driver, undefined)
    for (const [said, kept] of [['claude-code', 'claude-code'], [{ name: 'x' }, undefined], ['x'.repeat(64), 'x'.repeat(64)], ['x'.repeat(65), undefined]] as const) {
      driver = said
      answers = `run-${typeof said === 'string' ? said.length : 'odd'}`
      // The page is answered what was checked, and nothing else the machine said.
      assert.deepEqual(await start(), { ok: true, agentId: answers, ...(kept !== undefined ? { driver: kept } : {}) })
      assert.equal(row(answers)!.driver, kept)
    }
    driver = undefined

    const refused = { ok: false, error: 'Server answered with a run this computer cannot follow.' }
    answers = 'mine-1'
    assert.deepEqual(await start(), refused)
    assert.equal(runtime.remoteAgents.target('mine-1'), undefined, 'this computer\'s own run stays its own')
    answers = '../../etc'
    assert.deepEqual(await start(), refused)
    assert.equal(runtime.remoteAgents.target('../../etc'), undefined)

    // A session with no project goes to a machine too, named by the sessions' own id, which every machine
    // answers for with its own folder for them. Its repos are folders here, and go nowhere.
    answers = 'run-with-no-project'
    assert.deepEqual(await runtime.onStart('go', { machine: url }, 'session'), { ok: true, agentId: 'run-with-no-project' })
    assert.equal(sent.at(-1)!.project, 'session')
    assert.equal(sent.at(-1)!.options?.repos, undefined)
    assert.equal(await runtime.projectAt('session'), 'session')
    assert.deepEqual(await runtime.onStart('go', { machine: url, repos: [shop] }, 'session'), { ok: false, error: 'The repos are folders on this computer: a session with them runs here. Pick this computer, or start without them.' })
  } finally {
    await runtime.dispose()
    machine.closeAllConnections()
    machine.close()
    await rm(base, { recursive: true, force: true })
  }
})

test('a run sent to another person\'s computer first has the server\'s logins copied there, and stops with the computer\'s words when it cannot; a laptop copies nothing, and sends none before they are there', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'openagent-other-')))
  const env = { XDG_CONFIG_HOME: join(base, 'cfg'), OPENAGENT_SERVER: '1', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-mine' }
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true })
  const shop = await clone(base, 'shop', 'https://github.com/acme/shop.git')
  await addProject(shop, new Date().toISOString(), env)
  // Another person's computer, as its line's address on this server: it says which logins it has, and takes them.
  const asked: string[] = []
  let place: 'ready' | 'making' = 'making'
  let has: Record<string, unknown> = {}
  const machine = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    asked.push(`${req.method} ${path}`)
    req.resume()
    if (path === '/_relay/logins' && place === 'making') return void res.writeHead(503, { 'content-type': 'text/plain' }).end("@sul's place on this computer is being made. Try again in a minute.")
    if (path === '/_relay/logins') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(req.method === 'GET' ? has : { claude: { source: 'copied', from: 'vps-1' } }))
    if (path === '/_relay/start') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, agentId: '2026-07-19T10-00-00-000Z' }))
    res.writeHead(200, { 'content-type': 'application/x-ndjson' }).end()
  })
  await new Promise<void>(resolve => machine.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(machine.address() as AddressInfo).port}`
  await addMachine({ url, key: 'line', door: `${url}/_devices/enter`, label: 'rom-desktop', owner: 'rom' }, env)
  // This server's own logins, as its user's gh and its service say them: never this test computer's.
  const logins = async (said: NodeJS.ProcessEnv) => ({ github: 'gho_mine123', ...(said.CLAUDE_CODE_OAUTH_TOKEN ? { claude: said.CLAUDE_CODE_OAUTH_TOKEN } : {}) })
  const runtime = createProjectRuntime({ cwd: shop, env, logins, host: fakeHost() })
  const laptop = createProjectRuntime({ cwd: shop, env: { ...env, OPENAGENT_SERVER: '' }, logins, host: fakeHost() })
  try {
    // Nothing is copied before the person said OK to the line that says it is.
    assert.deepEqual(await runtime.onStart('go', { machine: url }), { ok: false, error: "Your own logins are used on rom's computer for a run there: say OK to that above the message box first." })
    assert.equal(asked.length, 0)
    await tellMachine(url, env)
    assert.deepEqual(await runtime.onStart('go', { machine: url }), { ok: false, error: "rom-desktop: @sul's place on this computer is being made. Try again in a minute." })
    assert.deepEqual(asked, ['GET /_relay/logins'], 'no run is sent before the logins are there')
    place = 'ready'
    asked.length = 0
    const started = await runtime.onStart('go', { machine: url })
    assert.equal(started.ok, true)
    assert.deepEqual(asked.slice(0, 2), ['GET /_relay/logins', 'POST /_relay/logins'])
    // A Claude login starts that OpenAgent again: the run waits until it answers.
    assert.ok(asked.indexOf('GET /_relay/ping') > 1 && asked.indexOf('GET /_relay/ping') < asked.indexOf('POST /_relay/start'))
    assert.ok(asked.includes('POST /_relay/start'))

    asked.length = 0
    assert.deepEqual(await laptop.onStart('go', { machine: url }), { ok: false, error: 'Your GitHub and Claude logins are not on rom-desktop yet. Start your first run there from your page on its server, which copies them, or log in there on its page in Settings › Devices.' })
    // The run the server sent is still read meanwhile: only what this start asked counts.
    assert.deepEqual(asked.filter(call => call !== 'GET /_relay/events'), ['GET /_relay/logins'], 'a laptop copies nothing, and sends no run before the logins are there')
    has = { github: { account: 'sul', source: 'copied', from: 'vps-1' }, claude: { source: 'made' } }
    asked.length = 0
    assert.equal((await laptop.onStart('go', { machine: url })).ok, true)
    assert.equal(asked.includes('POST /_relay/logins'), false, 'a laptop copies nothing')
  } finally {
    await runtime.dispose()
    await laptop.dispose()
    machine.closeAllConnections()
    machine.close()
    await rm(base, { recursive: true, force: true })
  }
})

test('a run whose record names a saved machine\'s computer is that machine\'s, whoever started it there: asked of the machine, followed from here, and no other computer\'s run is', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'openagent-home-')))
  const env = { XDG_CONFIG_HOME: join(base, 'cfg') }
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true })
  const git = nodeGitRunner()
  // A project whose records name the computer that ran each run.
  const project = async (name: string, runs: readonly (readonly [string, string])[]): Promise<string> => {
    const dir = await clone(base, name, `https://github.com/acme/${name}.git`)
    await git(['config', 'user.email', 't@t'], dir)
    await git(['config', 'user.name', 't'], dir)
    await git(['commit', '-q', '--allow-empty', '-m', 'init'], dir)
    for (const [agentId, host] of runs) {
      await addWorktree(dir, { agentId, branch: agentBranchName(agentId) }, git)
      const card = join(worktreePath(dir, agentId), OPENAGENT_DIR)
      await mkdir(card, { recursive: true })
      await writeFile(join(card, `${agentId}.json`), JSON.stringify({ id: agentId, startedAt: '2026-07-19T10:00:00.000Z', status: 'waiting', driver: 'claude-code', branch: agentBranchName(agentId), caller: { pid: 1, host } }))
    }
    await addProject(dir, new Date().toISOString(), env)
    return projectId(dir)
  }
  // Three runs: a saved machine's, this computer's, a teammate's.
  const [ON_SERVER, MINE, ELSEWHERE] = ['2026-07-19T10-00-00-000Z', '2026-07-19T10-00-01-000Z', '2026-07-19T10-00-02-000Z'] as const
  const shop = await project('shop', [[ON_SERVER, 'server-box'], [MINE, hostname()], [ELSEWHERE, 'rom-thinkpad-x280']])
  // Another project, where someone wrote a record under the id of this computer's run in the shop, naming the machine.
  // And one under the id of the machine's run in the shop.
  const other = await project('other', [[MINE, 'server-box'], [ON_SERVER, 'server-box']])
  // A machine is asked its name behind a list's back when it is slow: asked again until the name is as expected.
  const named = async (from: { machineNames: () => Promise<(host: string) => { label: string } | undefined> }, host: string, expected: string | undefined): Promise<string | undefined> => {
    for (let i = 0; i < 100; i++) {
      if ((await from.machineNames())(host)?.label === expected) return expected
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return (await from.machineNames())(host)?.label
  }

  // A machine: its ping says its computer's own name, and its events stream stays open, as a real one's does.
  const asked: string[] = []
  const open: ServerResponse[] = []
  const machineAt = async (says: () => string | undefined): Promise<{ url: string; close: () => void }> => {
    const server = createServer((req, res) => {
      req.resume()
      asked.push(`${req.headers.authorization} ${req.url}`)
      if (req.url === '/_relay/ping') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ version: '9.9.9', ...(says() !== undefined ? { host: says() } : {}) }))
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      res.write(`${JSON.stringify({ kind: 'session-update', sessionId: 'from the machine' })}\n`)
      open.push(res)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => (server.closeAllConnections(), server.close()) }
  }
  let said: string | undefined = 'server-box'
  const machine = await machineAt(() => said)
  const { url } = machine
  await addMachine({ url, key: 'id.key', door: `${url}/_devices/enter`, label: 'Server' }, env)
  let runtime = createProjectRuntime({ cwd: join(base, 'shop'), env, host: fakeHost() })
  const closing = [machine.close]
  try {
    const { home, follow, list, machineNames, working } = runtime.remoteAgents
    // The machine is asked its name once, and known by the name it was given here.
    assert.equal(await named(runtime.remoteAgents, 'server-box', 'Server'), 'Server')
    assert.equal((await machineNames())('rom-thinkpad-x280'), undefined)
    assert.deepEqual(asked, ['Bearer id.key /_relay/ping'])

    // Where each run runs: the machine's is the machine's to be asked about, with this computer's key there.
    const atMachine = { url, key: 'id.key', project: 'github.com/acme/shop' }
    assert.deepEqual(await home(shop, ON_SERVER), atMachine)
    assert.equal(await home(shop, MINE), undefined)
    assert.equal(await home(shop, ELSEWHERE), undefined)
    assert.equal(await home(shop, '2026-07-19T10-00-09-000Z'), undefined)
    assert.equal(await home('no-such-project', ON_SERVER), undefined)

    // Followed from here on, as a run this computer sent: its events the machine's own, its row the record's.
    assert.deepEqual(list(shop), [])
    for (const agentId of [ON_SERVER, MINE, ELSEWHERE, ON_SERVER]) await follow(shop, agentId)
    for await (const event of runtime.remoteEventsSource(shop, ON_SERVER)!) {
      assert.deepEqual(event, { kind: 'session-update', sessionId: 'from the machine' })
      break
    }
    assert.deepEqual(list(shop).map(row => [row.id, row.target, row.remoteLabel, row.status, row.driver, row.branch]), [[ON_SERVER, 'remote', 'Server', 'waiting', 'claude-code', agentBranchName(ON_SERVER)]])
    assert.deepEqual(asked.filter(line => line.includes('/_relay/events')), ['Bearer id.key /_relay/events?run=2026-07-19T10-00-00-000Z&project=github.com%2Facme%2Fshop'], 'followed once')
    // A record does not hold a machine: one that says its run works still lets the machine be removed.
    assert.equal(working(url), false)

    // A record in another project under the id of this computer's own run: followed there, and the shop's run stays this computer's.
    // One under the id of the run followed in the shop does not take that run over.
    await follow(other, MINE)
    await follow(other, ON_SERVER)
    assert.deepEqual(list(other).map(row => row.id), [MINE])
    assert.deepEqual(runtime.remoteAgents.target(ON_SERVER, shop), atMachine)
    assert.equal(runtime.remoteAgents.sent(ON_SERVER), false)
    assert.equal(await home(shop, MINE), undefined)
    assert.equal(runtime.remoteEventsSource(shop, MINE), undefined)
    assert.equal(runtime.remoteAgents.target(MINE, shop), undefined)

    // Renamed: it goes by the new name, the runs under its old one are still its, and they are asked of it. One that says none is still this one.
    const again = async (name: string | undefined): Promise<void> => {
      said = name
      for (const res of open.splice(0)) res.end()
      await runtime.dispose()
      runtime = createProjectRuntime({ cwd: join(base, 'shop'), env, host: fakeHost() })
    }
    await again('renamed-box')
    assert.equal(await named(runtime.remoteAgents, 'renamed-box', 'Server'), 'Server')
    assert.equal((await runtime.remoteAgents.machineNames())('server-box')?.label, 'Server')
    assert.deepEqual(await runtime.remoteAgents.home(shop, ON_SERVER), atMachine)
    await again(undefined)
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal((await runtime.remoteAgents.machineNames())('renamed-box')?.label, 'Server')
    await again('server-box')
    for (let i = 0; i < 100 && (await listMachines(env))[0]!.host !== 'server-box'; i++) {
      await runtime.remoteAgents.machineNames()
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.equal((await listMachines(env)).find(saved => saved.url === url)!.host, 'server-box')

    // A second machine that says the same name: the name is neither's, and the run is asked of no machine.
    const twin = await machineAt(() => 'server-box')
    closing.push(twin.close)
    await addMachine({ url: twin.url, key: 'id.twin', door: `${twin.url}/_devices/enter`, label: 'Twin' }, env)
    await runtime.dispose()
    runtime = createProjectRuntime({ cwd: join(base, 'shop'), env, host: fakeHost() })
    assert.equal(await named(runtime.remoteAgents, 'server-box', undefined), undefined)
    assert.equal(await runtime.remoteAgents.home(shop, ON_SERVER), undefined)

    // A machine that does not say its name, an older one, is asked and keeps none.
    const quiet = await machineAt(() => undefined)
    closing.push(quiet.close)
    await addMachine({ url: quiet.url, key: 'id.quiet', door: `${quiet.url}/_devices/enter`, label: 'Quiet' }, env)
    for (let i = 0; i < 100 && !asked.includes('Bearer id.quiet /_relay/ping'); i++) {
      await runtime.remoteAgents.machineNames()
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.ok(asked.includes('Bearer id.quiet /_relay/ping'))
    assert.equal((await listMachines(env)).find(saved => saved.url === quiet.url)!.host, undefined)
  } finally {
    for (const res of open) res.end()
    await runtime.dispose()
    for (const close of closing) close()
    await rm(base, { recursive: true, force: true })
  }
})

test("a saved machine is asked for its own runs over its relay, and a run of its own that no record here has is still the machine's to be asked about and followed", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'openagent-machine-runs-')))
  const env = { XDG_CONFIG_HOME: join(base, 'cfg') }
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true })
  const git = nodeGitRunner()
  const dir = await clone(base, 'shop', 'https://github.com/acme/shop.git')
  await git(['config', 'user.email', 't@t'], dir)
  await git(['config', 'user.name', 't'], dir)
  await git(['commit', '-q', '--allow-empty', '-m', 'init'], dir)
  await addProject(dir, new Date().toISOString(), env)
  const shop = projectId(dir)
  // A run of the laptop's that never reached this computer's records.
  const ONLY_THERE = '2026-07-19T11-00-00-000Z'
  const asked: unknown[] = []
  const open: ServerResponse[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => (body += chunk)).on('end', () => {
      if (req.url === '/_relay/ping') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ version: '9.9.9', host: 'laptop-box' }))
      if (req.url === '/_relay/rpc') {
        asked.push(JSON.parse(body))
        const run = { id: ONLY_THERE, startedAt: '2026-07-19T11:00:00.000Z', updatedAt: '2026-07-19T11:00:00.000Z', status: 'running', host: 'laptop-box', person: 'me@laptop' }
        return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ result: { at: 'b.1', runs: [run], ids: [ONLY_THERE] } }))
      }
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      res.write(`${JSON.stringify({ kind: 'session-update', sessionId: 'from the laptop' })}\n`)
      open.push(res)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  await addMachine({ url, key: 'id.key', door: `${url}/_devices/enter`, label: 'Laptop' }, env)
  const runtime = createProjectRuntime({ cwd: dir, env, host: fakeHost() })
  try {
    const [laptop] = await runtime.remoteAgents.machineRuns(dir)
    assert.deepEqual([laptop!.host, laptop!.answered, laptop!.runs.map(run => run.id)], ['laptop-box', true, [ONLY_THERE]])
    // Asked of the project by its address, from the start, for as long as the machine holds the call while nothing changes.
    assert.deepEqual(asked[0], { fn: 'onOwnRuns', args: [null, null, 25_000], project: 'github.com/acme/shop' })
    // When it answered is kept with it, for while it does not: written behind the list's back.
    for (let i = 0; i < 40 && !(await listMachines(env))[0]!.seenAt; i++) await new Promise(resolve => setTimeout(resolve, 50))
    assert.ok((await listMachines(env))[0]!.seenAt)
    // The run is the machine's: asked of it, and followed from here.
    assert.deepEqual(await runtime.remoteAgents.home(shop, ONLY_THERE), { url, key: 'id.key', project: 'github.com/acme/shop' })
    await runtime.remoteAgents.follow(shop, ONLY_THERE)
    assert.deepEqual(runtime.remoteAgents.list(shop).map(row => [row.id, row.remoteLabel, row.person]), [[ONLY_THERE, 'Laptop', 'me@laptop']])

    // The sessions with no project too: the machine is asked for its own under their one name, and one of its own is followed there.
    const [sessions] = await runtime.remoteAgents.machineRuns(sessionsHome(env))
    assert.deepEqual([sessions!.host, sessions!.runs.map(run => run.id)], ['laptop-box', [ONLY_THERE]])
    assert.deepEqual(asked.at(-1), { fn: 'onOwnRuns', args: [null, null, 25_000], project: SESSIONS_ID })
    assert.deepEqual(await runtime.remoteAgents.home(SESSIONS_ID, ONLY_THERE), { url, key: 'id.key', project: SESSIONS_ID })
  } finally {
    for (const res of open) res.end()
    await runtime.dispose()
    server.closeAllConnections()
    server.close()
    await rm(base, { recursive: true, force: true })
  }
})

test("a run a saved machine's Human Queue names, which no record here has, is that machine's: its row opens it there", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'openagent-machine-queue-')))
  const env = { XDG_CONFIG_HOME: join(base, 'cfg') }
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true })
  const git = nodeGitRunner()
  const dir = await clone(base, 'shop', 'https://github.com/acme/shop.git')
  await git(['config', 'user.email', 't@t'], dir)
  await git(['config', 'user.name', 't'], dir)
  await git(['commit', '-q', '--allow-empty', '-m', 'init'], dir)
  await addProject(dir, new Date().toISOString(), env)
  const shop = projectId(dir)
  // An old run of the server's, waiting on a question: in no list of runs, in its Human Queue only.
  const ASKING = '2026-07-13T00-22-59-512Z'
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => (body += chunk)).on('end', () => {
      const answer = (result: unknown) => void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ result }))
      if (req.url === '/_relay/ping') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ version: '9.9.9', host: 'server-box' }))
      const { fn } = JSON.parse(body) as { fn: string }
      if (fn === 'onOwnProjects') return answer([{ id: 'shop-there', name: 'shop', path: '/srv/shop', address: 'github.com/acme/shop', share: false, gitHost: true, activated: true }])
      if (fn === 'onOwnWaiting') return answer({ items: [{ kind: 'waiting', projectId: 'shop-there', projectName: 'shop', module: 'ask', scope: 'run', run: ASKING, words: 'Needs answer', title: 'Pick a colour', detail: 'Which colour?' }], whole: ['shop-there'] })
      if (fn === 'onOwnRuns') return answer({ at: 'b.1', runs: [], ids: [] })
      answer(null)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  await addMachine({ url, key: 'id.key', door: `${url}/_devices/enter`, label: 'Server' }, env)
  const runtime = createProjectRuntime({ cwd: dir, env, host: fakeHost() })
  try {
    // The machine said its projects, as the page's lists ask them.
    for (let i = 0; i < 40 && !(await listMachines(env))[0]!.projects; i++) {
      await runtime.remoteAgents.elsewhere()
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    const queue = await runtime.remoteAgents.machinesQueue()
    assert.deepEqual(queue.said[0]!.items.map(item => [item.projectId, item.run, item.computer]), [[shop, ASKING, { name: 'Server', kind: 'computer', id: url }]])
    assert.deepEqual(await runtime.remoteAgents.home(shop, ASKING), { url, key: 'id.key', project: 'github.com/acme/shop' })
    // A run nobody names is still nobody's.
    assert.equal(await runtime.remoteAgents.home(shop, '2026-07-13T00-22-59-999Z'), undefined)
  } finally {
    await runtime.dispose()
    server.closeAllConnections()
    server.close()
    await rm(base, { recursive: true, force: true })
  }
})

/** A naming pool whose sessions answer `title` at once: no coding agent is started. */
function readyNaming(title: string): ReadyNaming {
  const driver: Driver = {
    id: 'claude-code',
    start: async opts => ({
      id: 'naming',
      cwd: opts.cwd,
      prompt: () => Promise.reject(new Error('asked ready only')),
      ready: () => readyPrompt(async words => ({ text: (await words) && title })),
      dispose: () => Promise.resolve(),
    }),
  }
  return new ReadyNaming({ setup: async () => ({ key: 'one', driver }) })
}

test('a Start is named here as the run starts: the page asks for the name, and the host is handed it as it is asked', async () => {
  const home = await project()
  const env = { XDG_CONFIG_HOME: join(home, 'cfg') }
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true })
  const host = fakeHost()
  const runtime = createProjectRuntime({ cwd: home, env, naming: readyNaming('Fix flaky login test'), host })
  try {
    assert.deepEqual(await runtime.onStart('fix the flaky login test', { driver: 'claude-code' }), { ok: true, agentId: 'run-1', driver: 'claude-code' })
    assert.equal(await startedName('run-1'), 'Fix flaky login test', 'what the page asks for')
    const title = host.requests[0]?.title
    assert.ok(title instanceof Promise)
    assert.equal(await title, 'Fix flaky login test', 'what the run takes')

    // A bare command is named from its report, by the run: nothing is handed over.
    await runtime.onStart('/work-queue', { driver: 'claude-code' })
    assert.equal(host.requests[1]?.title, undefined)
  } finally {
    await runtime.dispose()
    forgetStartedNames()
    await rm(home, { recursive: true, force: true })
  }
})

test('the list shows the name asked at Start on the run\'s row until its record has its own', async () => {
  nameStarted('run-1', Promise.resolve('Fix flaky login test'))
  await new Promise(resolve => setImmediate(resolve))
  const rows = withStartedNames([
    { id: 'run-1', status: 'running', startedAt: '2026-11-03T18:00:00.000Z', updatedAt: '2026-11-03T18:00:00.000Z' },
    { id: 'run-2', status: 'running', startedAt: '2026-11-03T18:00:00.000Z', updatedAt: '2026-11-03T18:00:00.000Z' },
  ] as AgentMeta[])
  assert.deepEqual(rows.map(row => row.title), ['Fix flaky login test', undefined])
  // The record's own name, once it has one, is the one shown.
  assert.equal(withStartedNames([{ id: 'run-1', title: 'Its own', status: 'done', startedAt: '', updatedAt: '' } as AgentMeta])[0]!.title, 'Its own')
  assert.equal(await startedName('run-unknown'), undefined, 'a run not started here has none')
  forgetStartedNames()
})
