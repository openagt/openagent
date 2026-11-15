import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createServer, type AddressInfo } from 'node:net'
import { freed, inCheckout } from './install.js'

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

test("the dashboard is copied whenever a package manager installed it, and used where it is from a checkout", () => {
  const installed = [
    '/home/me/.npm/_npx/6913fdfd1ea7a741/node_modules/@openagt/dashboard/package.json',
    '/home/me/.cache/pnpm/dlx/8771caebaa7910c9a195e5dde9ce2b17/mw8pj3k8-1jlu/node_modules/.pnpm/@openagt+dashboard@0.65.0/node_modules/@openagt/dashboard/package.json',
    '/tmp/bunx-1000-@openagt/install@0.2.9/node_modules/@openagt/dashboard/package.json',
    '/tmp/xfs-1a2b3c4d/dlx-4242/node_modules/@openagt/dashboard/package.json',
    '/usr/lib/node_modules/@openagt/dashboard/package.json',
  ]
  for (const path of installed) assert.equal(inCheckout(path), false, path)
  // A workspace links the package into node_modules; its real path is the checkout's own folder.
  assert.equal(inCheckout('/home/me/openagent/packages/dashboard/package.json'), true)
})
