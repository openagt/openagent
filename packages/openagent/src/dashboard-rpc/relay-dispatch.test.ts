import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { provideTestContext } from './test-context.js'
import { dispatchMachineRpc, dispatchRelayRpc, ELSEWHERE_FORWARDED, isMachineRead, isRelayRead, isRelayReadCall, MACHINE_RPC_NAMES, RELAY_RPC_NAMES } from './relay-dispatch.js'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addProject, projectId } from '../registry.js'
import type { StartAgentOptions } from '../dashboard/types.js'

// The machine-side whitelist dispatcher (#1067 slice 2): a daemon that relayed an agent here calls one of a
// fixed set of run-scoped RPCs against this machine's own copy of the project the call named. These assert the whitelist is
// exactly the run-scoped read/steer/handoff surface (and excludes start/delete), and that an unknown
// name is refused. The real HTTP round-trip through /_relay/rpc is in remote-run.integration.test.ts.

test('RELAY_RPC_NAMES is the run-scoped read/steer/handoff surface and a project\'s reads and start, and excludes delete (#1067 slice 2)', () => {
  for (const name of [
    'onProjectFiles', 'readModule',
    'onGitStatus', 'onAgentWorktree', 'onAgentHandoff', 'onAgent', 'onOwnRuns', 'onStartCheck',
    'onCommands', 'onDocs', 'onAgentsDoing', 'onRetainedWorktrees', 'onGitHostHome', 'onRepositoryOffer', 'onProjectSkills', 'onRecordsReach',
    'sendStop', 'sendChoice', 'sendMessage', 'sendOpenPullRequest', 'sendPush', 'sendMerge', 'sendMergeBranch', 'sendStart', 'runModuleCommand',
  ]) {
    assert.ok(RELAY_RPC_NAMES.includes(name), `expected ${name} on the relay whitelist`)
  }
  // Deleting a session, removing a worktree, and how a project keeps its records are NOT relayable:
  // destroying history/checkouts is not something a relaying daemon may reach. A start is, as the
  // guarded start a run sent here gets (the test below). A module's command is, as an act unless
  // this computer's own copy of the module says it only reads (isRelayReadCall).
  for (const off of ['sendDeleteAgent', 'sendRemoveWorktree', 'sendShareRecords', 'sendCreateRepository', 'sendRemoveProject', 'sendPreview']) {
    assert.ok(!RELAY_RPC_NAMES.includes(off), `${off} must not be relayable`)
  }
})

test('a start that comes over the relay starts here: the machine it names is the asker\'s and is never sent on', async () => {
  let started: { options: StartAgentOptions | undefined; project: string | undefined } | undefined
  provideTestContext({
    startAgent: (_prompt, options, project) => {
      started = { options, project }
      return { ok: true, agentId: 'a' }
    },
  })
  const result = await dispatchRelayRpc('laptop-project', 'sendStart', ['server-project', 'say hi', { machine: 'http://127.0.0.1:4210', base: 'my-branch', driver: 'codex' }])
  assert.deepEqual(result, { ok: true, agentId: 'a' })
  assert.deepEqual(started, { options: { base: 'my-branch', driver: 'codex' }, project: 'laptop-project' })
})

test('a page\'s call about another computer\'s project goes to that computer as it is, but its start and that computer\'s own runs', () => {
  for (const name of RELAY_RPC_NAMES) assert.equal(ELSEWHERE_FORWARDED.has(name), name !== 'sendStart' && name !== 'onOwnRuns', name)
  for (const off of ['onAgents', 'sendDeleteAgent', 'onMachineStartCheck', 'onOwnProjects']) assert.equal(ELSEWHERE_FORWARDED.has(off), false, off)
})

test('every relayed rpc is classed as a read or an act, by name: a computer that only lets its server watch answers the reads alone', () => {
  // Pinned one by one: a function added to the whitelist fails here until its class is written down.
  const classes: Record<string, 'read' | 'act'> = {
    onProjectFiles: 'read',
    readModule: 'read',
    onGitStatus: 'read',
    onAgentWorktree: 'read',
    onAgentHandoff: 'read',
    onAgent: 'read',
    onOwnRuns: 'read',
    onStartCheck: 'read',
    onCommands: 'read',
    onDocs: 'read',
    onAgentsDoing: 'read',
    onRetainedWorktrees: 'read',
    onGitHostHome: 'read',
    onRepositoryOffer: 'read',
    onProjectSkills: 'read',
    onRecordsReach: 'read',
    sendStop: 'act',
    sendChoice: 'act',
    sendMessage: 'act',
    sendOpenPullRequest: 'act',
    sendPush: 'act',
    sendMerge: 'act',
    sendMergeBranch: 'act',
    sendStart: 'act',
    runModuleCommand: 'act',
  }
  assert.deepEqual([...RELAY_RPC_NAMES].sort(), Object.keys(classes).sort())
  for (const [name, said] of Object.entries(classes)) assert.equal(isRelayRead(name) ? 'read' : 'act', said, name)
  // A name that is not relayed is no read, whatever it is called, and neither is anything a plain object would answer.
  for (const off of ['onAgents', 'onMachines', 'sendStart', 'constructor', 'toString', '__proto__', '']) assert.equal(isRelayRead(off), false, off)
})

test('dispatchRelayRpc rejects an unknown rpc name (#1067 slice 2)', async () => {
  await assert.rejects(dispatchRelayRpc('home', 'sendDeleteAgent', ['pid']), /unknown relay rpc/)
  await assert.rejects(dispatchRelayRpc('home', 'nope', []), /unknown relay rpc/)
})

test('dispatchRelayRpc runs a whitelisted rpc against the project id it is given and returns its empty shape (#1067 slice 2)', async () => {
  // No project is registered under this id, so onGitStatus resolves no checkout and returns null - proof
  // the call reached the whitelisted impl with that id (the caller's arg[0] project id is dropped).
  provideTestContext()
  const result = await dispatchRelayRpc('openagent:no-such-home', 'onGitStatus', ['remote-project-id', 'run-1'])
  assert.equal(result, null)
})

test('the machine-wide calls are the logins and settings a computer brings its server up to, each classed a read or an act', () => {
  // Pinned one by one: a function added to the whitelist fails here until its class is written down.
  const classes: Record<string, 'read' | 'act'> = {
    onCopiedLogins: 'read',
    onOwnProjects: 'read',
    onOwnInterventions: 'read',
    onOwnComputers: 'read',
    onCloneCheck: 'read',
    onModels: 'read',
    sendCopiedLogin: 'act',
    sendForgetCopiedLogin: 'act',
    sendKeepCopiedLogin: 'act',
    sendCopiedUsage: 'act',
    patchPreferences: 'act',
    sendAddComputer: 'act',
    sendForgetComputers: 'act',
  }
  assert.deepEqual([...MACHINE_RPC_NAMES].sort(), Object.keys(classes).sort())
  for (const [name, said] of Object.entries(classes)) assert.equal(isMachineRead(name) ? 'read' : 'act', said, name)
  for (const off of ['onAgents', 'sendStart', 'onGitStatus', 'constructor', 'toString', '__proto__', '']) assert.equal(isMachineRead(off), false, off)
})

test('dispatchMachineRpc rejects a name that is no machine-wide call, a run-scoped one included', async () => {
  for (const off of ['sendStart', 'onGitStatus', 'constructor', 'nope']) await assert.rejects(dispatchMachineRpc(off, []), /unknown machine rpc/, off)
})

test("a relayed module command is a read when this computer's own copy of the module says so, in the project the call names", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'openagent-relay-reads-')))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  try {
    provideTestContext()
    const shop = join(dir, 'shop')
    const tool = join(shop, 'node_modules', 'tool')
    await mkdir(tool, { recursive: true })
    await writeFile(join(shop, 'package.json'), JSON.stringify({ dependencies: { tool: '1' } }))
    await writeFile(join(tool, 'package.json'), JSON.stringify({ name: 'tool', exports: { './dashboard': './w.js' }, bin: { tool: 'bin/tool' }, openagent: { reads: { tool: ['list'] } } }))
    await writeFile(join(tool, 'w.js'), 'export default {}')
    await addProject(shop, '2026-10-27T00:00:00.000Z')
    const here = projectId(shop)
    // The caller's own project id comes first and is no matter: the call is read in the project here.
    assert.equal(await isRelayReadCall(here, 'runModuleCommand', ['callers-id', 'tool', ['list']]), true)
    assert.equal(await isRelayReadCall(here, 'runModuleCommand', ['callers-id', 'tool', ['add', 'x'], undefined, false]), false)
    assert.equal(await isRelayReadCall(here, 'runModuleCommand', ['callers-id', 'nope', ['list']]), false)
    assert.equal(await isRelayReadCall('nowhere-1', 'runModuleCommand', ['callers-id', 'tool', ['list']]), false)
    assert.equal(await isRelayReadCall(here, 'runModuleCommand', ['callers-id', 'tool', 'list']), false)
    // A read by its name, and any other act.
    assert.equal(await isRelayReadCall(here, 'onGitStatus', []), true)
    assert.equal(await isRelayReadCall(here, 'sendStop', ['callers-id', 'tool', ['list']]), false)
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})
