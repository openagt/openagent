import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { KEEP_MS, openAgentUpdates } from './openagent-update.js'
import { onOpenAgentUpdate } from '../dashboard-rpc/agents.js'
import { provideTestContext } from '../dashboard-rpc/test-context.js'

test('a newer OpenAgent than the one running is said with the command that updates it, kept for half a day; the same one, an older one, or npm not answering is not', async () => {
  let now = 0
  let asked = 0
  let newest: string | undefined | Error = '0.66.0'
  const openagent = { name: '@openagt/dashboard', version: '0.65.0', dir: '/usr/lib/node_modules/@openagt/dashboard' }
  const updates = openAgentUpdates({ openagent, now: () => now, latest: async pkg => (asked++, assert.equal(pkg, '@openagt/dashboard'), newest instanceof Error ? Promise.reject(newest) : newest) })
  assert.deepEqual(await updates.read(), { installed: '0.65.0', latest: '0.66.0', command: 'npm i -g @openagt/dashboard' })
  newest = '0.65.0'
  now = KEEP_MS - 1
  assert.equal((await updates.read())?.latest, '0.66.0', 'the kept reading')
  assert.equal(asked, 1)
  now = KEEP_MS
  assert.equal(await updates.read(), undefined)
  newest = '0.64.9'
  now = 2 * KEEP_MS
  assert.equal(await updates.read(), undefined)
  newest = undefined
  now = 3 * KEEP_MS
  assert.equal(await updates.read(), undefined)
  newest = new Error('fetch failed')
  now = 4 * KEEP_MS
  assert.equal(await updates.read(), undefined)
})

test('the page is told of a newer OpenAgent, and of none', async () => {
  provideTestContext({ openAgentUpdate: { read: async () => ({ installed: '0.65.0', latest: '0.66.0', command: 'npm i -g @openagt/dashboard' }) } })
  assert.deepEqual(await onOpenAgentUpdate(), { installed: '0.65.0', latest: '0.66.0', command: 'npm i -g @openagt/dashboard' })
  provideTestContext({ openAgentUpdate: { read: async () => undefined } })
  assert.equal(await onOpenAgentUpdate(), null)
})
