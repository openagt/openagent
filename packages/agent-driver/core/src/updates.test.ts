import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { agentUpdates, KEEP_MS, newer, versionIn, type RunProgram } from './updates.js'
import type { RunAgent } from '@openagt/hooks'

/** Programs that say the versions in `have`, and an `update` that moves one to `after`; every call recorded. */
function programs(have: Record<string, string | Error>, after: Record<string, string> = {}, calls: string[] = []): RunProgram {
  return async (bin, args) => {
    calls.push(`${bin} ${args.join(' ')}`)
    const version = have[bin]
    if (version instanceof Error) throw version
    if (version === undefined) throw Object.assign(new Error(`spawn ${bin} ENOENT`), { code: 'ENOENT' })
    if (args[0] === 'update') {
      if (after[bin] === undefined) throw Object.assign(new Error('Command failed'), { said: 'Checking for updates…\nCould not reach the update server' })
      have[bin] = after[bin]
      return 'updated'
    }
    return bin === 'claude' ? `${version} (Claude Code)` : `codex-cli ${version}`
  }
}

/** The two coding agents, as their adapters say their programs; `fresh` is told each agent asked for its models again. */
function agents(fresh: string[] = []): () => Promise<RunAgent[]> {
  const agent = (id: string, label: string, bin: string, npm: string): RunAgent => ({
    id,
    label,
    program: { bin, npm },
    models: async opts => (opts?.fresh && fresh.push(id), []),
    ready: async () => ({ problems: [], warnings: [] }),
    driver: () => ({}) as never,
  })
  return async () => [agent('claude-code', 'Claude Code', 'claude', '@anthropic-ai/claude-code'), agent('codex', 'Codex', 'codex', '@openai/codex')]
}

const NPM: Record<string, string> = { '@anthropic-ai/claude-code': '2.1.314', '@openai/codex': '0.166.0' }

test('a version is read off what a program says, and compared part by part', () => {
  assert.equal(versionIn('2.1.314 (Claude Code)'), '2.1.314')
  assert.equal(versionIn('codex-cli 0.166.0'), '0.166.0')
  assert.equal(versionIn('no version here'), undefined)
  assert.equal(newer('0.166.0', '0.144.4'), true)
  assert.equal(newer('2.1.314', '2.1.314'), false)
  assert.equal(newer('2.1.99', '2.1.314'), false, 'by number, not by letters')
})

test("an agent behind npm's newest is said, with the command it updates with; one up to date, one not on this computer and one npm does not answer for are not", async () => {
  const latest = async (pkg: string) => NPM[pkg]!
  assert.deepEqual(await agentUpdates({ agents: agents(), run: programs({ claude: '2.1.314', codex: '0.144.4' }), latest }).read(), [{ agent: 'codex', label: 'Codex', installed: '0.144.4', latest: '0.166.0', command: 'codex update' }])
  assert.deepEqual(await agentUpdates({ agents: agents(), run: programs({ claude: '2.1.300' }), latest }).read(), [{ agent: 'claude-code', label: 'Claude Code', installed: '2.1.300', latest: '2.1.314', command: 'claude update' }])
  const offline = async () => Promise.reject(new Error('fetch failed'))
  assert.deepEqual(await agentUpdates({ agents: agents(), run: programs({ claude: '2.1.300', codex: '0.144.4' }), latest: offline }).read(), [])
})

test('an agent that says no program of its own is never said', async () => {
  const none: RunAgent = { id: 'fake', label: 'Fake', ready: async () => ({ problems: [], warnings: [] }), driver: () => ({}) as never }
  assert.deepEqual(await agentUpdates({ agents: async () => [none], run: programs({}), latest: async () => '9.9.9' }).read(), [])
})

test('a reading is kept for half a day: each one asks npm', async () => {
  let now = 0
  let asked = 0
  const updates = agentUpdates({ agents: agents(), run: programs({ claude: '2.1.314', codex: '0.166.0' }), latest: async pkg => (asked++, NPM[pkg]!), now: () => now })
  await updates.read()
  now = KEEP_MS - 1
  await updates.read()
  assert.equal(asked, 2)
  now = KEEP_MS
  await updates.read()
  assert.equal(asked, 4)
})

test("an update runs the agent's own update, says the version it now has, and its models are asked again; a failed one says the agent's last words", async () => {
  const calls: string[] = []
  const fresh: string[] = []
  const updates = agentUpdates({ agents: agents(fresh), run: programs({ claude: '2.1.300', codex: '0.144.4' }, { codex: '0.166.0' }, calls), latest: async pkg => NPM[pkg]! })
  assert.equal((await updates.read()).length, 2)
  assert.deepEqual(await updates.update('codex'), { ok: true, version: '0.166.0' })
  assert.ok(calls.includes('codex update'))
  assert.deepEqual(fresh, ['codex'])
  assert.deepEqual((await updates.read()).map(update => update.agent), ['claude-code'], 'read again, not the kept reading')

  assert.deepEqual(await updates.update('claude-code'), { ok: false, error: 'Could not reach the update server' })
  assert.deepEqual(fresh, ['codex'])
  assert.deepEqual(await updates.update('claude'), { ok: false, error: 'unknown coding agent' })
})

test('while an update runs, every read says so, whoever pressed it; once it ends, none does', async () => {
  let finish: (said: string) => void = () => {}
  const run: RunProgram = async (bin, args) => (args[0] === 'update' ? new Promise(resolve => (finish = resolve)) : bin === 'codex' ? 'codex-cli 0.144.4' : Promise.reject(new Error('ENOENT')))
  const updates = agentUpdates({ agents: agents(), run, latest: async pkg => NPM[pkg]! })
  assert.deepEqual(await updates.read(), [{ agent: 'codex', label: 'Codex', installed: '0.144.4', latest: '0.166.0', command: 'codex update' }])
  const pressed = updates.update('codex')
  assert.deepEqual((await updates.read())[0]?.updating, true)
  finish('updated')
  await pressed
  assert.equal((await updates.read())[0]?.updating, undefined)
})
