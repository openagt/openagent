import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm, mkdir, readdir, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHooks, LOCAL_HOST, type AppContext } from '@openagt/hooks'
import { fakeHost } from '@openagt/hooks/testing'
import { runDaemon, type DaemonState, type RunDaemonOptions } from './daemon.js'
import { handDownTestDistribution } from './test-distribution.js'

handDownTestDistribution()

/**
 * Start a daemon and wait until it reports where it bound. The CLI is foreground-only, so there
 * is no liveness file to poll: `onListening` is the only way a caller learns the port. Its modules
 * are a host for this computer that starts nothing, unless the test gives its own.
 *
 * The daemon's own promise comes back too — it resolves on shutdown, so abort the signal and
 * await it before the test removes the workspace underneath it.
 */
async function startDaemon(cwd: string, opts: RunDaemonOptions): Promise<{ done: Promise<void>; state: DaemonState }> {
  let report!: (state: DaemonState) => void
  let fail!: (err: unknown) => void
  const listening = new Promise<DaemonState>((resolvePromise, rejectPromise) => {
    report = resolvePromise
    fail = rejectPromise
  })
  const hooks = opts.hooks ?? createHooks([{ module: { name: 'fake-runs', hooks: { 'run.host': [fakeHost({ id: LOCAL_HOST })] } } }])
  const done = runDaemon(cwd, { ...opts, hooks, onListening: state => report(state) })
  // runDaemon only settles on shutdown, so it is never awaited here. Settling *before* it binds
  // means it failed to come up: forward that, or `listening` would hang the test forever.
  void done.then(
    () => fail(new Error('the daemon exited before it bound')),
    (err: unknown) => fail(err),
  )
  return { done, state: await listening }
}
import { OPENAGENT_DIR } from './openagent-dir.js'
import { listProjects } from './registry.js'
import { gitignorePath, openagentGitignore, projectId } from '@openagt/agent-data'

// The dashboard steers + starts over the daemon's in-process RPC mount (#405/#426), not the
// retired per-read HTTP routes. Post to `/_rpc/<name>` (same-origin) and return the unwrapped `ret`.
async function callRpc(url: string, name: string, args: unknown[]): Promise<unknown> {
  const res = await fetch(`${url}/_rpc/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: url },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  return text ? (JSON.parse(text) as { ret?: unknown }).ret : undefined
}
type StartResult = { ok: true; agentId: string } | { ok: false; error: string }
// The home project's id: what the browser sends for the daemon's own workspace, which the
// daemon resolves back to `cwd` (see `resolveProject`).
const homeId = (cwd: string): string => projectId(resolve(cwd))
const sendStart = (url: string, cwd: string, prompt: string, options: Record<string, unknown> = {}): Promise<StartResult> =>
  callRpc(url, 'sendStart', [homeId(cwd), prompt, options]) as Promise<StartResult>

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** Fake an activated workspace: the install-written ignore file is the activation marker (#1600). */
async function activate(cwd: string): Promise<void> {
  await mkdir(join(cwd, OPENAGENT_DIR), { recursive: true })
  await writeFile(gitignorePath(cwd), openagentGitignore())
}

async function tmpWorkspace(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'openagent-daemon-'))
  await activate(cwd)
  return cwd
}

// Point the registry at a throwaway config dir under the workspace so tests never touch the real
// $HOME and clean up with the workspace. Returns the env the daemon reads it from.
async function configEnv(cwd: string): Promise<NodeJS.ProcessEnv> {
  const dir = join(cwd, 'cfg')
  await mkdir(dir, { recursive: true })
  return { XDG_CONFIG_HOME: dir }
}

test('runDaemon serves the dashboard, and shuts down when the signal aborts', async () => {
  const cwd = await tmpWorkspace()
  const env = await configEnv(cwd)
  const ac = new AbortController()
  try {
    const { done, state } = await startDaemon(cwd, { port: 0, signal: ac.signal, env })
    assert.equal(state.pid, process.pid)
    assert.match(state.url, /^http:\/\/127\.0\.0\.1:\d+$/)

    // The dashboard's static shell is served.
    const res = await fetch(state.url)
    assert.equal(res.status, 200)
    assert.match(await res.text(), /id="root"/)

    // Ctrl-C closes everything: the daemon runs in the foreground and owns nothing beyond itself.
    ac.abort()
    await done
    await assert.rejects(fetch(state.url)) // the port is free again
  } finally {
    ac.abort()
    await rm(cwd, { recursive: true, force: true })
  }
})

test("the modules' own work starts once the dashboard listens, told its address, and stops while it still answers", async () => {
  const cwd = await tmpWorkspace()
  const env = await configEnv(cwd)
  const ac = new AbortController()
  const started: (string | undefined)[] = []
  let answeredAtStop: number | undefined
  let url = ''
  const lifecycle = {
    started: (app: AppContext) => void started.push(app.url),
    stopping: async () => {
      answeredAtStop = (await fetch(url)).status
    },
  }
  const hooks = createHooks([{ module: { name: 'fake-runs', hooks: { 'run.host': [fakeHost({ id: LOCAL_HOST })], 'app.lifecycle': lifecycle } } }])
  try {
    const { done, state } = await startDaemon(cwd, { port: 0, signal: ac.signal, env, hooks })
    url = state.url
    // Started once the dashboard listens: never a reason the address came late.
    for (let i = 0; i < 250 && started.length === 0; i++) await sleep(20)
    // Told where OpenAgent is.
    assert.deepEqual(started, [state.url])
    ac.abort()
    await done
    assert.equal(answeredAtStop, 200, "the modules' work stops first, before the dashboard closes")
  } finally {
    ac.abort()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('runDaemon comes up in a folder that is no project, and leaves nothing in it', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'openagent-daemon-'))
  const env = await configEnv(cwd)
  const ac = new AbortController()
  try {
    const { done, state } = await startDaemon(cwd, { port: 0, signal: ac.signal, env })
    assert.equal((await fetch(state.url)).status, 200)
    ac.abort()
    await done
    assert.deepEqual(await readdir(cwd), ['cfg'], 'no .openagent of its own')
  } finally {
    ac.abort()
    await rm(cwd, { recursive: true, force: true })
  }
})

test("a Start goes to this computer's host, of the modules the daemon runs, with the prompt and the picks, and answers the id the host answered (#2394)", async () => {
  const cwd = await realpath(await tmpWorkspace())
  const env = await configEnv(cwd)
  // The daemon names no tool: the host of its distribution starts the run.
  const host = fakeHost({ id: LOCAL_HOST })
  const hooks = createHooks([{ module: { name: 'fake-runs', hooks: { 'run.host': [host] } } }])
  const ac = new AbortController()
  try {
    const { done, state } = await startDaemon(cwd, { port: 0, signal: ac.signal, env, hooks })
    assert.deepEqual(await sendStart(state.url, cwd, '/work-queue now', { options: { 'agent-driver': { driver: 'codex' } } }), { ok: true, agentId: 'run-1' })
    assert.deepEqual(host.requests.map(request => [request.project?.dir, request.prompt, request.options['agent-driver']]), [[cwd, '/work-queue now', { driver: 'codex' }]])
    assert.deepEqual(await sendStart(state.url, cwd, '   '), { ok: false, error: 'a non-empty prompt is required' })
    assert.deepEqual(await callRpc(state.url, 'sendStart', ['no-such-project', 'x']), { ok: false, error: 'unknown project: no-such-project' })
    assert.equal(host.requests.length, 1)
    ac.abort()
    await done
  } finally {
    ac.abort()
    await rm(cwd, { recursive: true, force: true })
  }
})

test("a daemon whose modules have no host for this computer does not start: it would start no run", async () => {
  const cwd = await realpath(await tmpWorkspace())
  const env = await configEnv(cwd)
  try {
    await assert.rejects(runDaemon(cwd, { port: 0, env, hooks: createHooks([]) }), /no host for this computer/)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('a stop ends at its deadline however long a step takes, a module\'s own stop too, and what is left of it goes on behind (#2141)', async () => {
  const cwd = await realpath(await tmpWorkspace())
  const env = await configEnv(cwd)
  const logged: string[] = []
  const original = console.log
  console.log = (...args: unknown[]) => void logged.push(args.map(String).join(' '))
  // A module whose own work takes longer to stop than the stop may take.
  const hooks = createHooks([{ module: { name: 'fake-runs', hooks: { 'run.host': [fakeHost({ id: LOCAL_HOST })], 'app.lifecycle': { stopping: () => sleep(3_000) } } } }])
  const ac = new AbortController()
  try {
    const { done, state } = await startDaemon(cwd, { port: 0, signal: ac.signal, env, hooks, shutdownDeadlineMs: 1_000 })
    const stopping = Date.now()
    ac.abort()
    await done
    assert.ok(Date.now() - stopping < 2_500, "not held by the module's stop")
    assert.ok(logged.some(line => line.includes("stopped without waiting for the modules' own work")), logged.join('\n'))
    // The rest of the stop goes on once the module is done: the dashboard closes, the port is free again.
    let free = false
    for (let i = 0; i < 100 && !free; i++) {
      free = await fetch(state.url).then(() => false, () => true)
      if (!free) await sleep(100)
    }
    assert.ok(free, 'the port is free again')
  } finally {
    console.log = original
    ac.abort()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('the dashboard adds no folder by itself, not even its own start folder, so a removed project stays removed', async () => {
  const cwd = await tmpWorkspace() // activated, as a project that was added and then removed still is
  const env = await configEnv(cwd)
  const ac = new AbortController()
  try {
    const { done } = await startDaemon(cwd, { port: 0, signal: ac.signal, env })
    assert.deepEqual(await listProjects(env), [])
    ac.abort()
    await done
  } finally {
    ac.abort()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('the folder the caller names is added once the dashboard listens, as Add project adds it; started again inside it, it is the project already there', async () => {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'openagent-daemon-add-')))
  const cfg = await realpath(await mkdtemp(join(tmpdir(), 'openagent-daemon-add-cfg-')))
  // The add's git reads the process's own environment, and a new folder's first commit needs an author.
  const env = { XDG_CONFIG_HOME: cfg, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' }
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  await mkdir(join(folder, 'src'))
  const told: { id: string; path: string; added: boolean; address: string }[] = []
  // The modules are told of the project added (`app.lifecycle`): a scheduler starts with it.
  const added: string[] = []
  const hooks = createHooks([{ module: { name: 'fake-runs', hooks: { 'run.host': [fakeHost({ id: LOCAL_HOST })], 'app.lifecycle': { projectAdded: project => void added.push(project.dir) } } } }])
  try {
    // Aborted as soon as it listens: the add comes before the daemon waits, so it has run once it is done.
    for (const project of [folder, join(folder, 'src')]) {
      const ac = new AbortController()
      const { done } = await startDaemon(cfg, { port: 0, signal: ac.signal, env, hooks, project, onProject: started => told.push(started) })
      ac.abort()
      await done
    }
    const id = projectId(folder)
    const address = id.slice(0, id.lastIndexOf('-')) // the folder's name, as the id writes it
    assert.deepEqual(told, [{ id, path: folder, added: true, address }, { id, path: folder, added: false, address }])
    assert.deepEqual((await listProjects(env)).map(project => project.id), [id])
    assert.deepEqual(added, [folder], 'told once: the second start finds it on the list')
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(folder, { recursive: true, force: true })
    await rm(cfg, { recursive: true, force: true })
  }
})
