import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createServer, type AddressInfo } from 'node:net'
import { freed } from './install.js'

/** A server holding a port of this computer's own, until it is closed. */
async function holding(): Promise<{ port: number; close: () => void }> {
  const server = createServer()
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  return { port: (server.address() as AddressInfo).port, close: () => server.close() }
}

test('freed waits for a dashboard that is closing, and gives up on one that stays', async () => {
  const closing = await holding()
  setTimeout(closing.close, 400)
  assert.equal(await freed(closing.port, 5000), true)

  const staying = await holding()
  try {
    assert.equal(await freed(staying.port, 600), false)
    // Nothing was told to stop: it is asked once.
    assert.equal(await freed(staying.port, 0), false)
  } finally {
    staying.close()
  }
})
