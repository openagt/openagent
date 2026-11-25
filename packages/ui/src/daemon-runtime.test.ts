import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProjectRuntime } from './daemon-runtime.js'
import type { Hooks, ProjectRef, RunHost, RunOptions } from '@openagt/hooks'
import { fakeHost, type FakeHost } from '@openagt/hooks/testing'
import { OPENAGENT_DIR } from './openagent-dir.js'
import { listTestProject } from './test-projects.js'
import { projectId } from '@openagt/agent-data'
import { SESSIONS_ID } from './project-address.js'
import { handDownTestDistribution } from './test-distribution.js'

handDownTestDistribution()

// A Start, as the daemon does it: this computer's host (`run.host`, #2394), asked with the run's
// options.

async function project(): Promise<string> {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'openagent-runtime-')))
  await mkdir(join(cwd, OPENAGENT_DIR), { recursive: true })
  return cwd
}

/** What the host was asked last: the project's folder, the prompt, and the run's options. */
function lastStart(host: FakeHost): { dir?: string; prompt?: string; options?: RunOptions } {
  const request = host.requests.at(-1)
  return { ...(request?.project ? { dir: request.project.dir } : {}), ...(request ? { prompt: request.prompt, options: request.options } : {}) }
}

test("onStart starts the run on this computer's host, in the project addressed, home or registered, and answers the run it began", async () => {
  const home = await project()
  const other = await project()
  const env = { ...process.env, XDG_CONFIG_HOME: join(home, 'cfg') }
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true })
  const record = await listTestProject(other)
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
  const env = { ...process.env, XDG_CONFIG_HOME: join(home, 'cfg') }
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
  const env = { ...process.env, XDG_CONFIG_HOME: join(home, 'cfg') }
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
    // The images a Start goes with stay on this computer, and so does its run; which names it takes is its host's.
    const screenshot = `${'a'.repeat(64)}.png`
    assert.deepEqual(await runtime.onStart('what does it say?', { host: 'actions', images: [screenshot] }), { ok: false, error: 'Images stay on this computer: a session with images runs here, not on GitHub Actions.' })
    assert.equal(actions.requests.length, 1)
    assert.equal(host.requests.length, 1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test("a Start hands its host the Auto level picked, which goes as far as the project lets it there: with no pick the run commits, and with Off it is given no level", async () => {
  const home = await project()
  const env = { ...process.env, XDG_CONFIG_HOME: join(home, 'cfg') }
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true })
  const host = fakeHost()
  const runtime = createProjectRuntime({ cwd: home, env, host })
  const level = (): unknown => lastStart(host).options?.publish
  try {
    execFileSync('git', ['init', '-q'], { cwd: home })
    assert.deepEqual(await runtime.onStart('Fix it', { publish: 'merge' }), { ok: true, agentId: 'run-1' })
    assert.equal(level(), 'merge', 'the pick, as the person made it')
    // No pick saved: the daemon starts the run at the commit, which pushes nothing.
    await runtime.onStart('Fix it')
    assert.equal(level(), 'commit', 'no pick: the commit')
    // Off is a pick: the run is given no level.
    await runtime.onStart('Fix it', { publish: 'nothing' })
    assert.equal(level(), undefined, 'Off saved: no level')
    await runtime.onStart('Fix it', { publish: 'branch' })
    assert.equal(level(), 'branch')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test("a Start hands the host its controls' run options as they are: the account the run works as and the branch its pull request goes into among them", async () => {
  const home = await project()
  const env = { ...process.env, XDG_CONFIG_HOME: join(home, 'cfg') }
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true })
  const host = fakeHost()
  const runtime = createProjectRuntime({ cwd: home, env, host })
  try {
    await runtime.onStart('Fix it', { options: { github: { account: 'octo-agent', prBase: 'develop' }, plugins: { without: ['ask', 'tickets'] }, skills: { project: ['deploy', 'lint'] } } })
    const { options } = lastStart(host)
    assert.deepEqual([options?.github, options?.plugins, options?.skills], [{ account: 'octo-agent', prBase: 'develop' }, { without: ['ask', 'tickets'] }, { project: ['deploy', 'lint'] }])
    await runtime.onStart('Fix it')
    assert.deepEqual(lastStart(host).options, { publish: 'commit' }, "no pick: the run goes as github's pick for every next run, on the profile picked for every next run")
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('starting inside a folder asks the modules to make it a project, and answers it with the address the page writes; a folder no module takes, or one that fails, is said so', async () => {
  const cfg = await realpath(await mkdtemp(join(tmpdir(), 'openagent-started-cfg-')))
  const env = { ...process.env, XDG_CONFIG_HOME: cfg }
  const folder = await project()
  const asked: string[] = []
  let answer: 'project' | 'none' | 'broken' = 'project'
  const folderGiven: Hooks['folderGiven'] = async given => {
    asked.push(given)
    if (answer === 'broken') throw new Error('the folder could not be read')
    if (answer === 'none') return undefined
    const record = await listTestProject(given)
    return { project: { id: record.id, dir: record.path, name: 'app' }, added: true }
  }
  const runtime = createProjectRuntime({ cwd: cfg, env, host: fakeHost(), folderGiven })
  try {
    const started = await runtime.onStartedIn(join(folder, '.', OPENAGENT_DIR, '..'))
    assert.deepEqual(asked, [folder], 'the folder is handed over resolved')
    assert.ok(started?.ok)
    assert.equal(started.id, projectId(folder))
    assert.equal(started.path, folder)
    assert.equal(started.added, true)
    assert.equal(typeof started.address, 'string')
    answer = 'none'
    assert.equal(await runtime.onStartedIn(folder), undefined, 'outside a repository: no project, the dashboard opens as it is')
    answer = 'broken'
    assert.deepEqual(await runtime.onStartedIn(folder), { ok: false, error: 'the folder could not be read' })
  } finally {
    for (const dir of [folder, cfg]) await rm(dir, { recursive: true, force: true })
  }
})
