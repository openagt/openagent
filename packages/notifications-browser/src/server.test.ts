import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { rpcKind, type RpcComputerHost } from '@openagt/hooks/rpc'
import { computerRpcHost } from '@openagt/hooks/testing'
import { kinds, saveKind } from './server.js'

// Settings › Notifications' functions, against settings kept in memory.

function computer(): RpcComputerHost {
  return computerRpcHost()
}

test('reading the kinds only reads; switching one changes it', () => {
  assert.equal(rpcKind(kinds), 'read')
  assert.equal(rpcKind(saveKind), 'act')
})

test("what waits on the person is on and activity off until they switch them; each switch is kept with the person", async () => {
  const host = computer()
  assert.deepEqual(await kinds(host, {}), { waiting: true, activity: false })
  assert.deepEqual(await saveKind(host, { kind: 'activity', on: true }), { waiting: true, activity: true })
  assert.deepEqual(await saveKind(host, { kind: 'waiting', on: false }), { waiting: false, activity: true })
  assert.deepEqual(await kinds(host, {}), { waiting: false, activity: true })
})

test('a kind that is none, or a switch that is not on or off, is refused, and nothing changes', async () => {
  const host = computer()
  await assert.rejects(saveKind(host, { kind: 'everything', on: true } as unknown as { kind: 'waiting'; on: boolean }), /waiting or activity, switched on or off/)
  await assert.rejects(saveKind(host, { kind: 'waiting', on: 'yes' } as unknown as { kind: 'waiting'; on: boolean }), /switched on or off/)
  await assert.rejects(saveKind(host, { kind: 'constructor', on: true } as unknown as { kind: 'waiting'; on: boolean }), /waiting or activity/)
  assert.deepEqual(await kinds(host, {}), { waiting: true, activity: false })
})
