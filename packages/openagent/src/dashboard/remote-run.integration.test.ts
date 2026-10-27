import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir, hostname } from 'node:os'
import { basename, join } from 'node:path'
import { EventStream } from '../event-stream.js'
import { startDashboard, type Dashboard } from './server.js'
import { testDashboardOptions } from '../dashboard-rpc/test-context.js'
import { relayRpc, remoteProject } from './remote-run.js'
import type { Cloned } from '../clone-project.js'
import { readSharing } from '@openagt/agent-data'
import { createProjectRuntime, type ProjectRuntime } from '../daemon-runtime.js'
import { forwardStream } from '../dashboard-rpc/stream-forward.js'
import { dispatchMachineRpc } from '../dashboard-rpc/relay-dispatch.js'
import { asCaller } from './person.js'
import { elsewhereId } from './elsewhere.js'
import type { ProjectLauncher } from '../dashboard-rpc/projects.js'
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
// the whole path minus the final same-origin RPC hop on A, which server.test.ts covers on its own,
// and minus what B opened to the network, which is another package's: A calls B's OpenAgent as
// that would, once it has let A in.

const KEY = 'd1.zX2p8Q0hqk3m9tR7vN1cW4bY6sJ5aL0dFgHiKlMnOp'

async function fakeBundle(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'relay-int-'))
  await writeFile(join(dir, 'index.html'), '<!doctype html><div id="root"></div>')
  await mkdir(join(dir, 'assets'), { recursive: true })
  await writeFile(join(dir, 'assets', 'app.js'), '')
  return dir
}

/** B's other project, the one A does not have. */
function otherOf(shopB: string): string {
  return join(shopB, '..', 'other')
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
  /** What B was asked to clone, and the door each clone waits behind: a test lets it land, or fail. */
  bClones: Array<{ from: string; land: (how: Cloned) => void }>
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
  // B adds a project it cloned, which commits: git is told who commits, since a computer with no
  // git settings (a test runner) has no name to guess.
  const WHO = { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' }
  const who = Object.fromEntries(Object.keys(WHO).map(key => [key, process.env[key]]))
  Object.assign(process.env, WHO)
  const at = new Date().toISOString()

  // B: another project first on its list, then (unless the test says not) the shop, cloned over HTTPS.
  const otherB = await repository(join(root, 'b'), 'other', 'https://github.com/acme/other.git')
  const shopB = await repository(join(root, 'b'), 'work-shop', 'https://github.com/Acme/Shop.git')
  await addProject(otherB, at, undefined, envB)
  if (opts.shopOnB !== false) await addProject(shopB, at, undefined, envB)
  const bClones: TwoMachines['bClones'] = []
  const runtimeB = createProjectRuntime({ cwd: otherB, env: envB, clone: from => new Promise<Cloned>(land => bClones.push({ from, land })) })

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
    return { ok: true, agentId: B_RUN, driver: 'claude-code' }
  }
  const bTail = (pid: string, agentId: string, onEvent: (event: OpenAgentEvent) => void): (() => void) => forwardStream(bStreams.get(`${pid} ${agentId}`), onEvent)
  const bundle = await fakeBundle()
  // The rest of the one host's wiring (D3) comes from the shared defaults: this test drives the
  // relay endpoints, not the other capabilities.
  const b = await startDashboard(
    testDashboardOptions({
      clientBundleDir: bundle,
      onStart: bStart,
      relay: { project: runtimeB.projectAt, tailEvents: bTail, rpc: runtimeB.onRelayRpc, machine: dispatchMachineRpc, bring: runtimeB.bringProject },
    }),
  )

  // A: the shop cloned over SSH into another folder, a project with no remote, and B saved as a machine.
  const shopA = await repository(join(root, 'a'), 'shop', 'git@github.com:acme/shop.git')
  const localOnlyA = await repository(join(root, 'a'), 'notes')
  await addProject(shopA, at, undefined, envA)
  await addProject(localOnlyA, at, undefined, envA)
  const machineB = (await addMachine({ url: b.url, key: KEY, door: `${b.url}/_devices/enter`, label: 'Studio' }, undefined, envA)).record.id
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
    bClones,
    close: async () => {
      await a.dispose()
      await runtimeB.dispose()
      await b.close()
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = previous
      for (const [key, value] of Object.entries(who)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
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
    // The machine's word on the coding agent comes over with the run's id.
    assert.deepEqual(result, { ok: true, agentId: B_RUN, driver: 'claude-code' })
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
    assert.equal(listed[0]!.driver, 'claude-code')
    assert.equal(listed[0]!.target, 'remote')
    assert.equal(listed[0]!.status, 'running')
    assert.equal(listed[0]!.remoteLabel, 'Studio')
    assert.equal(listed[0]!.intent, 'build the thing')

    // B says its computer's own name in its ping, so A knows which runs in a project's shared records are B's.
    // Both run on this computer here, so the name is this computer's, and the machine's own is the one A gave it.
    let studio: string | undefined
    for (let i = 0; i < 100 && studio === undefined; i++) {
      studio = (await m.a.remoteAgents.machineNames())(hostname())?.label
      if (studio === undefined) await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.equal(studio, 'Studio')
    assert.equal((await m.a.remoteAgents.machineNames())('some-other-computer'), undefined)

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
    assert.deepEqual(target, { url: m.b.url, key: KEY, project: 'github.com/acme/shop' })
    const push = (await relayRpc(target!, 'sendOpenPullRequest', [shopIdA, B_RUN])) as HandoffResult
    assert.equal(push.ok, false)
    // The same call for a project B does not have reaches no project at all.
    await assert.rejects(relayRpc({ ...target!, project: 'github.com/acme/nowhere' }, 'sendOpenPullRequest', [shopIdA, B_RUN]), /404/)
  } finally {
    await m.close()
  }
})

test('a project the other machine does not have starts nothing there, and the refusal is marked as one a clone mends', async () => {
  const m = await twoMachines({ shopOnB: false })
  try {
    const shopIdA = projectId(m.shopA)
    const result = await m.a.onStart('build the thing', { machine: m.machineB }, shopIdA)
    assert.deepEqual(result, { ok: false, error: `${basename(m.shopA)} is not on Studio yet.`, notThere: true })
    assert.equal(m.bStarts.length, 0) // never in B's other project
    assert.deepEqual(m.a.remoteAgents.list(shopIdA), [])
    assert.equal(m.bClones.length, 0) // and a start alone clones nothing
  } finally {
    await m.close()
  }
})

/** Until `check` holds. */
async function until(check: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 200 && !(await check()); i++) await new Promise(r => setTimeout(r, 20))
}

test('the other machine clones a project it is asked for, by itself: asked again it says coming, then there, and the run starts in the clone', async () => {
  const m = await twoMachines({ shopOnB: false })
  try {
    const shopIdA = projectId(m.shopA)
    const target = { url: m.b.url, key: KEY, project: 'github.com/acme/shop' }
    assert.deepEqual(await remoteProject(target), { state: 'missing' }) // a read brings nothing
    assert.equal(m.bClones.length, 0)

    // A's own answer on the records and its spelling of the address ride the ask; B answers at once.
    assert.deepEqual(await remoteProject(target, { share: true, from: 'github.com/Acme/Shop' }), { state: 'coming' })
    assert.deepEqual(await remoteProject(target, { share: true }), { state: 'coming' })
    assert.deepEqual(await remoteProject(target), { state: 'coming' })
    assert.deepEqual(m.bClones.map(clone => clone.from), ['github.com/Acme/Shop']) // one clone, however often it is asked for
    assert.equal((await m.a.onStart('too early', { machine: m.machineB }, shopIdA)).ok, false)

    // The clone lands: B adds the folder like any project, with the sharing answer it was given.
    // Asked all the while it lands, B says coming and then there, and never that it has no such project.
    m.bClones[0]!.land({ ok: true, path: m.shopB, cloned: true })
    const seen = new Set<string>()
    await until(async () => {
      const [one, two] = await Promise.all([remoteProject(target), remoteProject(target)])
      seen.add(one.state).add(two.state)
      return one.state === 'there' && two.state === 'there'
    })
    assert.deepEqual([...seen].filter(state => state !== 'coming' && state !== 'there'), [], JSON.stringify(await remoteProject(target)))
    assert.deepEqual(await remoteProject(target), { state: 'there' })
    assert.equal(await readSharing(m.shopB), true)
    assert.deepEqual(await remoteProject(target, { share: false }), { state: 'there' }) // asked for again: nothing to do
    assert.equal(m.bClones.length, 1)

    assert.deepEqual(await m.a.onStart('build the thing', { machine: m.machineB }, shopIdA), { ok: true, agentId: B_RUN, driver: 'claude-code' })
    assert.equal(m.bStarts.length, 1)
    assert.equal(m.bStarts[0]!.projectId, projectId(m.shopB))
  } finally {
    await m.close()
  }
})

test('a clone that fails is told in the machine\'s words until it is asked for again; what is no address, or another project\'s spelling, is not cloned', async () => {
  const m = await twoMachines({ shopOnB: false })
  try {
    const target = { url: m.b.url, key: KEY, project: 'github.com/acme/shop' }
    // A spelling that names another repository is not what is cloned: the address is.
    assert.deepEqual(await remoteProject(target, { share: false, from: 'github.com/mallory/shop' }), { state: 'coming' })
    assert.equal(m.bClones[0]!.from, 'github.com/acme/shop')
    m.bClones[0]!.land({ ok: false, error: 'This computer has no login that can read github.com/acme/shop.' })
    await until(async () => (await remoteProject(target)).state === 'failed')
    const failed = { state: 'failed', error: 'This computer has no login that can read github.com/acme/shop.' }
    assert.deepEqual(await remoteProject(target), failed)
    assert.deepEqual(await remoteProject(target), failed) // kept: every page that asks reads it

    // Asked for again, it is cloned again. A spelling is the same host and path in other letters,
    // and nothing more: one that names a way in, a user or a port reads as the same address, and is not taken.
    for (const from of ['ssh://mallory@github.com:2222/acme/shop', 'mallory@github.com:acme/shop', 'ssh://github.com:65535/Acme/Shop.git', 'https://github.com/acme/shop']) {
      assert.deepEqual(await remoteProject(target, { share: false, from }), { state: 'coming' })
      assert.equal(m.bClones.at(-1)!.from, 'github.com/acme/shop', from)
      // What the other side made git say is kept and told only up to a length.
      m.bClones.at(-1)!.land({ ok: false, error: 'remote: '.padEnd(5000, 'x') })
      await until(async () => (await remoteProject(target)).state === 'failed')
      assert.equal(((await remoteProject(target)) as { error: string }).error.length, 600)
    }
    assert.equal(m.bClones.length, 5)

    // Asked for twice at once: one clone. A clone that throws is a failure told, not one lost.
    assert.deepEqual(await Promise.all([remoteProject(target, { share: false }), remoteProject(target, { share: false }), remoteProject(target)]), [{ state: 'coming' }, { state: 'coming' }, { state: 'coming' }])
    assert.equal(m.bClones.length, 6)

    for (const project of ['/etc', '../x', 'github.com/Acme/Shop', 'file:///tmp/x', '-x/y.z/q']) {
      const said = await remoteProject({ ...target, project }, { share: false })
      assert.equal(said.state, 'failed', project)
    }
    assert.equal(m.bClones.length, 6)

    // No more than a few at once: one more is told to ask again, and nothing of it is kept.
    for (const name of ['two', 'three']) assert.deepEqual(await remoteProject({ ...target, project: `github.com/acme/${name}` }, { share: false }), { state: 'coming' })
    assert.deepEqual(await remoteProject({ ...target, project: 'github.com/acme/four' }, { share: false }), { state: 'failed', error: 'This machine is cloning other projects. Send again in a few minutes.' })
    assert.deepEqual(await remoteProject({ ...target, project: 'github.com/acme/four' }), { state: 'missing' })
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

test("a project only the other machine has is listed here, marked with that machine, and a run of it starts there in its own copy, from a branch of its own", async () => {
  const m = await twoMachines()
  try {
    // The shop is A's too, by its address: only B's other project is B's alone.
    const listed = await m.a.remoteAgents.elsewhere()
    const otherB = otherOf(m.shopB)
    const id = elsewhereId(projectId(otherB), m.machineB)
    assert.deepEqual(listed, [{ id, path: otherB, name: 'other', activated: false, gitHost: true, machine: m.machineB, modules: ['@openagt/changes', '@openagt/files', '@openagt/skill-logs'] }])

    // On B, the run starts in B's own project, and the branch picked is B's to read: it goes with it.
    const result = await m.a.onStart('fix the other', { machine: m.machineB, base: 'a-branch-of-b', model: 'opus' }, id)
    assert.deepEqual(result, { ok: true, agentId: B_RUN, driver: 'claude-code' })
    assert.equal(m.bStarts.length, 1)
    assert.equal(m.bStarts[0]!.projectId, projectId(otherB))
    assert.deepEqual(m.bStarts[0]!.options, { base: 'a-branch-of-b', model: 'opus' })
    // Followed from here as a run of that project, marked as B's.
    assert.deepEqual(
      m.a.remoteAgents.list(id).map(run => [run.id, run.remoteLabel]),
      [[B_RUN, 'Studio']],
    )

    // What the page asks of the project is asked of B, of B's own copy.
    const launcher = (await m.a.remoteAgents.forward(id, 'onCommands', [id])) as ProjectLauncher | null
    assert.equal(launcher?.address, 'github.com/acme/other')
    // So is a module's command: B runs it in its own copy, with its own modules.
    assert.deepEqual(await m.a.remoteAgents.forward(id, 'runModuleCommand', [id, 'left-pad', []]), { ok: false, error: 'left-pad brings no module to this project' })

    // On this computer, the run waits for a copy here: the page is told it can have one cloned.
    assert.deepEqual(await m.a.onStart('fix the other', {}, id), { ok: false, error: 'other is not on this computer yet.', notThere: true })
    assert.equal(m.bStarts.length, 1)
  } finally {
    await m.close()
  }
})

test("a person the owner invited is listed none of the owner's other computers' projects, and reaches none of them", async () => {
  const m = await twoMachines()
  try {
    const id = elsewhereId(projectId(otherOf(m.shopB)), m.machineB)
    assert.equal((await m.a.remoteAgents.elsewhere()).length, 1)
    assert.deepEqual(await asCaller('Tester', () => m.a.remoteAgents.elsewhere()), [])
    assert.deepEqual(await asCaller('Tester', () => m.a.onStart('run on the owner\'s computer', { machine: m.machineB }, id)), { ok: false, error: 'That project is no longer listed on any of your computers.' })
    await assert.rejects(asCaller('Tester', () => m.a.remoteAgents.forward(id, 'onCommands', [id])), /no longer listed/)
    assert.equal(m.bStarts.length, 0)
  } finally {
    await m.close()
  }
})

test("what the other machine said of its projects is kept: they stay listed while it does not answer", async () => {
  const m = await twoMachines()
  try {
    assert.equal((await m.a.remoteAgents.elsewhere()).length, 1)
    await m.b.close()
    assert.deepEqual(
      (await m.a.remoteAgents.elsewhere()).map(project => project.name),
      ['other'],
    )
  } finally {
    await m.close()
  }
})
