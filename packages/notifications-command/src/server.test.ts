import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { rpcKind, type RpcComputerHost } from '@openagt/hooks/rpc'
import { computerRpcHost } from '@openagt/hooks/testing'
import { NOTIFY_COMMAND } from './command.js'
import { command, saveCommand } from './server.js'

// Settings › Notification command's functions, against settings kept in memory.

function computer(): RpcComputerHost {
  return computerRpcHost()
}

test('reading the command only reads; saving it changes it', () => {
  assert.equal(rpcKind(command), 'read')
  assert.equal(rpcKind(saveCommand), 'act')
})

test("the command is this computer's, empty until one is saved; an empty one takes it away", async () => {
  const host = computer()
  assert.equal(await command(host, {}), '')
  await saveCommand(host, { command: '  npx @openagt/discord@0.1 send "$MESSAGE"  ' })
  assert.equal(await command(host, {}), 'npx @openagt/discord@0.1 send "$MESSAGE"')
  assert.equal(await host.settings.get(NOTIFY_COMMAND), 'npx @openagt/discord@0.1 send "$MESSAGE"')
  await saveCommand(host, { command: '' })
  assert.equal(await command(host, {}), '')
})

test('a command is one line of at most 4000 characters: anything else is refused, and the one saved stays', async () => {
  const host = computer()
  await saveCommand(host, { command: 'say done' })
  await assert.rejects(saveCommand(host, { command: 'a\nb' }), /one line of at most 4000 characters/)
  await assert.rejects(saveCommand(host, { command: 'a'.repeat(4001) }), /one line/)
  await assert.rejects(saveCommand(host, { command: 7 } as unknown as { command: string }), /one line/)
  assert.equal(await command(host, {}), 'say done')
})
