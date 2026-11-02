import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { agentUpdates, KEEP_MS, newer, versionIn, type RunProgram } from './agent-updates.js'
import { asCaller } from './person.js'
import { onAgentUpdates, sendAgentUpdate } from '../dashboard-rpc/models.js'
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

test('the owner is told of an update and runs it; a person the owner invited is told of none, and cannot run one', async () => {
  const ran: string[] = []
  provideTestContext({ agentUpdates: { read: async () => [{ agent: 'codex', installed: '0.144.4', latest: '0.166.0' }], update: async agent => (ran.push(agent), { ok: true, version: '0.166.0' }) } })
  assert.equal((await onAgentUpdates()).length, 1)
  assert.deepEqual(await sendAgentUpdate('codex'), { ok: true, version: '0.166.0' })
  assert.deepEqual(await sendAgentUpdate('claude'), { ok: false, error: 'unknown coding agent' })
  assert.deepEqual(await asCaller('Dani', () => onAgentUpdates()), [])
  assert.deepEqual(await asCaller('Dani', () => sendAgentUpdate('codex')), { ok: false, error: "Only this computer's owner updates its coding agents." })
  assert.deepEqual(ran, ['codex'])
})
