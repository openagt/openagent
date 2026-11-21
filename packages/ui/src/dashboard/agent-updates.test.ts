import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { agentUpdates, KEEP_MS, newer, versionIn, type RunProgram } from './agent-updates.js'
import { onAgentUpdates, onOpenAgentUpdate, sendAgentUpdate } from '../dashboard-rpc/models.js'
import { provideTestContext } from '../dashboard-rpc/test-context.js'

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

/** The models as kept, told nothing. */
const models = { forget: () => {} }

const NPM: Record<string, string> = { '@anthropic-ai/claude-code': '2.1.314', '@openai/codex': '0.166.0' }

test('a version is read off what a program says, and compared part by part', () => {
  assert.equal(versionIn('2.1.314 (Claude Code)'), '2.1.314')
  assert.equal(versionIn('codex-cli 0.166.0'), '0.166.0')
  assert.equal(versionIn('no version here'), undefined)
  assert.equal(newer('0.166.0', '0.144.4'), true)
  assert.equal(newer('2.1.314', '2.1.314'), false)
  assert.equal(newer('2.1.99', '2.1.314'), false, 'by number, not by letters')
})

test('an agent behind npm\'s newest is said; one up to date, one not on this computer and one npm does not answer for are not', async () => {
  const latest = async (pkg: string) => NPM[pkg]!
  assert.deepEqual(await agentUpdates({ models, run: programs({ claude: '2.1.314', codex: '0.144.4' }), latest }).read(), [{ agent: 'codex', installed: '0.144.4', latest: '0.166.0' }])
  assert.deepEqual(await agentUpdates({ models, run: programs({ claude: '2.1.300' }), latest }).read(), [{ agent: 'claude-code', installed: '2.1.300', latest: '2.1.314' }])
  const offline = async () => Promise.reject(new Error('fetch failed'))
  assert.deepEqual(await agentUpdates({ models, run: programs({ claude: '2.1.300', codex: '0.144.4' }), latest: offline }).read(), [])
})

test('a reading is kept for half a day: each one asks npm', async () => {
  let now = 0
  let asked = 0
  const updates = agentUpdates({ models, run: programs({ claude: '2.1.314', codex: '0.166.0' }), latest: async pkg => (asked++, NPM[pkg]!), now: () => now })
  await updates.read()
  now = KEEP_MS - 1
  await updates.read()
  assert.equal(asked, 2)
  now = KEEP_MS
  await updates.read()
  assert.equal(asked, 4)
})

test('an update runs the agent\'s own update, says the version it now has, and what it keeps of the agent is asked again; a failed one says the agent\'s last words', async () => {
  const calls: string[] = []
  const updated: string[] = []
  const updates = agentUpdates({ models: { forget: agent => void updated.push(agent) }, run: programs({ claude: '2.1.300', codex: '0.144.4' }, { codex: '0.166.0' }, calls), latest: async pkg => NPM[pkg]! })
  assert.equal((await updates.read()).length, 2)
  assert.deepEqual(await updates.update('codex'), { ok: true, version: '0.166.0' })
  assert.ok(calls.includes('codex update'))
  assert.deepEqual(updated, ['codex'])
  assert.deepEqual((await updates.read()).map(update => update.agent), ['claude-code'], 'read again, not the kept reading')

  assert.deepEqual(await updates.update('claude-code'), { ok: false, error: 'Could not reach the update server' })
  assert.deepEqual(updated, ['codex'])
})

test('an update is told and run', async () => {
  const ran: string[] = []
  provideTestContext({ agentUpdates: { read: async () => [{ agent: 'codex', installed: '0.144.4', latest: '0.166.0' }], update: async agent => (ran.push(agent), { ok: true, version: '0.166.0' }), openAgent: async () => ({ installed: '0.65.0', latest: '0.66.0', command: 'npm i -g @openagt/dashboard' }) } })
  assert.equal((await onAgentUpdates()).length, 1)
  assert.deepEqual(await sendAgentUpdate('codex'), { ok: true, version: '0.166.0' })
  assert.deepEqual(await sendAgentUpdate('claude'), { ok: false, error: 'unknown coding agent' })
  assert.deepEqual(ran, ['codex'])
  assert.deepEqual(await onOpenAgentUpdate(), { installed: '0.65.0', latest: '0.66.0', command: 'npm i -g @openagt/dashboard' })
})

test('a newer OpenAgent than the one running is said with the command that updates it, kept for half a day; the same one, an older one, or npm not answering is not', async () => {
  let now = 0
  let asked = 0
  let newest: string | Error = '0.66.0'
  const openagent = { name: '@openagt/dashboard', version: '0.65.0', dir: '/usr/lib/node_modules/@openagt/dashboard' }
  const updates = agentUpdates({ models, run: programs({}), openagent, now: () => now, latest: async pkg => (asked++, assert.equal(pkg, '@openagt/dashboard'), newest instanceof Error ? Promise.reject(newest) : newest) })
  const said = await updates.openAgent()
  assert.deepEqual({ ...said, command: undefined }, { installed: '0.65.0', latest: '0.66.0', command: undefined })
  assert.equal(said!.command, 'npm i -g @openagt/dashboard')
  newest = '0.65.0'
  now = KEEP_MS - 1
  assert.equal((await updates.openAgent())?.latest, '0.66.0', 'the kept reading')
  assert.equal(asked, 1)
  now = KEEP_MS
  assert.equal(await updates.openAgent(), undefined)
  newest = '0.64.9'
  now = 2 * KEEP_MS
  assert.equal(await updates.openAgent(), undefined)
  newest = new Error('fetch failed')
  now = 3 * KEEP_MS
  assert.equal(await updates.openAgent(), undefined)
})

test('while an update runs, every read says so, whoever pressed it; once it ends, none does', async () => {
  let finish: (said: string) => void = () => {}
  const run: RunProgram = async (bin, args) => (args[0] === 'update' ? new Promise(resolve => (finish = resolve)) : bin === 'codex' ? 'codex-cli 0.144.4' : Promise.reject(new Error('ENOENT')))
  const updates = agentUpdates({ models, run, latest: async pkg => NPM[pkg]! })
  assert.deepEqual(await updates.read(), [{ agent: 'codex', installed: '0.144.4', latest: '0.166.0' }])
  const pressed = updates.update('codex')
  assert.deepEqual(await updates.read(), [{ agent: 'codex', installed: '0.144.4', latest: '0.166.0', updating: true }])
  finish('updated')
  await pressed
  assert.equal((await updates.read())[0]?.updating, undefined)
})
