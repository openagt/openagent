import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { freePort, waitForDebugEndpoint } from './browser.js'

test('freePort returns a port nothing is listening on', async () => {
  const port = await freePort()
  assert.ok(port > 0 && port < 65536)
})

test('waitForDebugEndpoint resolves once the endpoint answers', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ Browser: 'Chrome/150' }))
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  try {
    assert.equal(await waitForDebugEndpoint(`http://127.0.0.1:${port}`, { timeoutMs: 3000 }), true)
  } finally {
    server.close()
  }
})

test('waitForDebugEndpoint gives up rather than hanging the run when Chrome never listens', async () => {
  const port = await freePort()
  assert.equal(await waitForDebugEndpoint(`http://127.0.0.1:${port}`, { timeoutMs: 250, intervalMs: 25 }), false)
})
