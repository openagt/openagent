import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { EventStream } from '../event-stream.js'
import { startDashboard, type Dashboard } from './server.js'
import { testDashboardOptions } from '../dashboard-rpc/test-context.js'
import { relayRpc } from './remote-run.js'
import { createProjectRuntime, type ProjectRuntime } from '../daemon-runtime.js'
import { forwardStream } from '../dashboard-rpc/stream-forward.js'
import { addMachine, addProject, projectId } from '../registry.js'
import type { StartAgentOptions, StartAgentResult } from './types.js'
import type { OpenAgentEvent } from '../events.js'
import type { HandoffResult } from './agent-handoff.js'

// The real two-daemon proof for "run on a saved machine" (#1067). Two HTTP servers stand up on
// loopback, each with a home file of its own: machine A (the person's own, a real project runtime)
// relays a start to machine B (a dashboard whose Start is stubbed so no run actually begins). Both
// have the same repository in a different folder, cloned a different way, and B has a second
// project besides. We assert the run is created in B's copy of THAT project, that A ran no hook
// of its own, and that B's events stream back through A's relayed-run source in order. That is
// the whole path minus the final same-origin RPC hop on A, which server.test.ts covers on its own.

const TOKEN = 'zX2p8Q0hqk3m9tR7vN1cW4bY6sJ5aL0dFgHiKlMnOp'

async function fakeBundle(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'relay-int-'))
  await writeFile(join(dir, 'index.html'), '<!doctype html><div id="root"></div>')
  await mkdir(join(dir, 'assets'), { recursive: true })
  await writeFile(join(dir, 'assets', 'app.js'), '')
  return dir
}

/** A repository in a folder of its own, cloned (as far as its `origin` says) from `origin`, or with none. */
async function repository(under: string, name: string, origin?: string): Promise<string> {
  const dir = join(under, name)
  await mkdir(dir, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  if (origin) execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: dir })
  return dir
}

/** Consume a stream until an event of `stopKind` arrives, or a timeout trips. */
async function collectUntil(stream: AsyncIterable<OpenAgentEvent>, stopKind: string, timeoutMs = 4000): Promise<OpenAgentEvent[]> {
  const got: OpenAgentEvent[] = []
  const loop = (async () => {
    for await (const e of stream) {
      got.push(e)
      if ((e as { kind?: string }).kind === stopKind) return
    }
  })()
  await Promise.race([loop, new Promise(resolve => setTimeout(resolve, timeoutMs))])
  return got
}

const B_RUN = 'remote-run-1'

interface TwoMachines {
  /** Machine A's runtime, and the env its home file is read through. */
  a: ProjectRuntime
  envA: NodeJS.ProcessEnv
  /** A's copy of the shop, a second project of A's with no remote, and the id A saved B under. */
  shopA: string
  localOnlyA: string
  machineB: string
  /** B's dashboard, its copy of the shop, and the Starts it was asked for. */
  b: Dashboard
  shopB: string
  bStarts: Array<{ prompt: string; options: StartAgentOptions; projectId: string }>
  close: () => Promise<void>
}

/**
 * Stand the two machines up. B's home file is the one `process.env` names, since the calls a
 * relayed read lands in find a project's folder through it; A's is handed to its runtime.
 */
async function twoMachines(opts: { shopOnB?: boolean } = {}): Promise<TwoMachines> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'relay-two-')))
  const envA = { ...process.env, XDG_CONFIG_HOME: join(root, 'home-a') }
  const envB = { ...process.env, XDG_CONFIG_HOME: join(root, 'home-b') }
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = envB.XDG_CONFIG_HOME
  const at = new Date().toISOString()

  // B: another project first on its list, then (unless the test says not) the shop, cloned over HTTPS.
  const otherB = await repository(join(root, 'b'), 'other', 'https://github.com/acme/other.git')
  const shopB = await repository(join(root, 'b'), 'work-shop', 'https://github.com/Acme/Shop.git')
  await addProject(otherB, at, undefined, envB)
  if (opts.shopOnB !== false) await addProject(shopB, at, undefined, envB)
  const runtimeB = createProjectRuntime({ cwd: otherB, env: envB })

  // B's Start is stubbed to record the call and emit a short event stream, so the relay path is
  // exercised without spawning a real agent.
  const bStarts: TwoMachines['bStarts'] = []
  const bStreams = new Map<string, EventStream<OpenAgentEvent>>()
  const bStart = (prompt: string, options: StartAgentOptions, pid?: string): StartAgentResult => {
    bStarts.push({ prompt, options, projectId: pid ?? '(none)' })
    const stream = new EventStream<OpenAgentEvent>()
    stream.push({ kind: 'session-update', sessionId: 'hello from B' } as OpenAgentEvent)
    stream.push({ kind: 'end', ok: true } as OpenAgentEvent)
    stream.close()
    bStreams.set(`${pid} ${B_RUN}`, stream)
    return { ok: true, agentId: B_RUN }
  }
  const bTail = (pid: string, agentId: string, onEvent: (event: OpenAgentEvent) => void): (() => void) => forwardStream(bStreams.get(`${pid} ${agentId}`), onEvent)
  const bundle = await fakeBundle()
  // The rest of the one host's wiring (D3) comes from the shared defaults: this test drives the
  // relay endpoints, not the other capabilities.
  const b = await startDashboard(
    testDashboardOptions({
      clientBundleDir: bundle,
      token: TOKEN,
      onStart: bStart,
      relay: { project: runtimeB.projectAt, tailEvents: bTail, rpc: runtimeB.onRelayRpc },
    }),
  )

  // A: the shop cloned over SSH into another folder, a project with no remote, and B saved as a machine.
  const shopA = await repository(join(root, 'a'), 'shop', 'git@github.com:acme/shop.git')
  const localOnlyA = await repository(join(root, 'a'), 'notes')
  await addProject(shopA, at, undefined, envA)
  await addProject(localOnlyA, at, undefined, envA)
  const machineB = (await addMachine({ url: b.url, token: TOKEN, label: 'Studio' }, undefined, envA)).id
  const a = createProjectRuntime({ cwd: shopA, env: envA })

  return {
    a,
    envA,
    shopA,
    localOnlyA,
    machineB,
    b,
    shopB,
    bStarts,
    close: async () => {
      await a.dispose()
      await runtimeB.dispose()
      await b.close()
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = previous
      await rm(bundle, { recursive: true, force: true })
      await rm(root, { recursive: true, force: true })
    },
  }
}

test('a run started on a saved machine lands in that machine\'s own copy of the project, and its events stream back (#1067)', async () => {
  const m = await twoMachines()
  try {
    const shopIdA = projectId(m.shopA)
    const result = await m.a.onStart('build the thing', { base: 'a-branch-of-this-machine', model: 'opus', machine: m.machineB }, shopIdA)

    // The agent was created on B, and A returned B's own agent id (not a locally allocated one).
    assert.deepEqual(result, { ok: true, agentId: B_RUN })
    assert.equal(m.bStarts.length, 1)
    assert.equal(m.bStarts[0]!.prompt, 'build the thing')
    // In B's copy of the shop: not the folder B's daemon was started in, and not A's id for the project.
    assert.equal(m.bStarts[0]!.projectId, projectId(m.shopB))
    assert.notEqual(projectId(m.shopB), shopIdA)
    assert.equal(m.bStarts[0]!.options.machine, undefined) // stripped before forwarding, no onward relay
    assert.equal(m.bStarts[0]!.options.base, undefined) // a branch of this machine names nothing on the other
    assert.equal(m.bStarts[0]!.options.model, 'opus') // the rest of the picks arrive

    // The relayed agent keeps a local list row on A (#1077), under A's project, so a dashboard reload
    // re-opens it instead of losing it: a remote stub carrying B's agent id, the machine's name, and
    // the prompt, running until the relay stream ends. Read before draining, while it is still live.
    const listed = m.a.remoteAgents.list(shopIdA)
    assert.equal(listed.length, 1)
    assert.equal(listed[0]!.id, B_RUN)
    assert.equal(listed[0]!.target, 'remote')
    assert.equal(listed[0]!.status, 'running')
    assert.equal(listed[0]!.remoteLabel, 'Studio')
    assert.equal(listed[0]!.intent, 'build the thing')

    // The events stream back through A's relayed-run source, in order.
    const stream = m.a.remoteEventsSource(shopIdA, B_RUN)
    assert.ok(stream, 'A should expose a live stream for the relayed run')
    const events = await collectUntil(stream!, 'end')
    assert.deepEqual(
      events.map(e => (e as { sessionId?: string; kind?: string }).sessionId ?? (e as { kind?: string }).kind),
      ['hello from B', 'end'],
    )

    // B's stubbed start pushed `{kind:'end', ok:true}` and closed, so once A has drained the relayed
    // stream the list row settles to done (#1077): the state a reload would now read off the list.
    assert.equal(m.a.remoteAgents.list(shopIdA)[0]!.status, 'done')

    // Slice 2: a run-scoped call relays to B over /_relay/rpc with the target A kept for the run, and
    // runs in B's copy of the shop. The caller's arg[0] is A's project id; B's dispatch replaces it
    // with its own. B_RUN is not a real session on B, so the publish comes back refused: proof the
    // call ran on B's side (its checkout, its remote) and came back.
    const target = m.a.remoteAgents.target(B_RUN)
    assert.deepEqual(target, { url: m.b.url, token: TOKEN, project: 'github.com/acme/shop' })
    const push = (await relayRpc(target!, 'sendOpenPullRequest', [shopIdA, B_RUN])) as HandoffResult
    assert.equal(push.ok, false)
    // The same call for a project B does not have reaches no project at all.
    await assert.rejects(relayRpc({ ...target!, project: 'github.com/acme/nowhere' }, 'sendOpenPullRequest', [shopIdA, B_RUN]), /404/)
  } finally {
    await m.close()
  }
})

test('a project the other machine does not have is refused by name, and starts nothing there', async () => {
  const m = await twoMachines({ shopOnB: false })
  try {
    const shopIdA = projectId(m.shopA)
    const result = await m.a.onStart('build the thing', { machine: m.machineB }, shopIdA)
    assert.deepEqual(result, { ok: false, error: `${basename(m.shopA)} is not on Studio. Add it there first.` })
    assert.equal(m.bStarts.length, 0) // never in B's other project
    assert.deepEqual(m.a.remoteAgents.list(shopIdA), [])
  } finally {
    await m.close()
  }
})

test('a project with no repository address cannot be sent to another machine: the Start is refused and nothing is sent', async () => {
  const m = await twoMachines()
  try {
    const result = await m.a.onStart('build the thing', { machine: m.machineB }, projectId(m.localOnlyA))
    assert.deepEqual(result, { ok: false, error: 'This project has no repository address, so it cannot be sent to another machine.' })
    assert.equal(m.bStarts.length, 0)
  } finally {
    await m.close()
  }
})

test('a machine that is no longer saved is refused, and the run does not start here in its place', async () => {
  const m = await twoMachines()
  try {
    const result = await m.a.onStart('build the thing', { machine: 'http://10.9.9.9:4200' }, projectId(m.shopA))
    assert.equal(result.ok, false)
    assert.match(result.ok ? '' : result.error, /no longer saved/)
    assert.equal(m.bStarts.length, 0)
  } finally {
    await m.close()
  }
})
