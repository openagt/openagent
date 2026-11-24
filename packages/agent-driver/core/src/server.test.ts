import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { rpcKind } from '@openagt/hooks/rpc'
import { computerRpcHost } from '@openagt/hooks/testing'
import * as server from './server.js'

test('the server part reads with reads and changes with acts; the accounts change through the command', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(server).map(([name, fn]) => [name, rpcKind(fn)])), {
    agents: 'read',
    picked: 'read',
    pick: 'act',
    naming: 'read',
    setNaming: 'act',
    list: 'read',
    usage: 'read',
    adding: 'read',
    quota: 'read',
    states: 'read',
    install: 'act',
    updates: 'read',
    update: 'act',
  })
})

test('the pick for every next run is saved as the setting reads it, a part that is no word left out; naming is a switch', async () => {
  const host = computerRpcHost()
  assert.deepEqual(await server.picked(host, {}), {})
  assert.deepEqual(await server.pick(host, { driver: 'codex', model: 'gpt-5', effort: 'not a level' }), { driver: 'codex', model: 'gpt-5' })
  assert.deepEqual(await server.picked(host, {}), { driver: 'codex', model: 'gpt-5' })
  assert.equal(await server.naming(host, {}), true)
  await server.setNaming(host, { on: false })
  assert.equal(await server.naming(host, {}), false)
})
