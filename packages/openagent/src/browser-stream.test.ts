import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { connectCdp } from './browser-stream.js'

/** A socket server that opens the WebSocket, then drops the connection at the first frame it gets: a Chrome that quits mid-call. */
async function quittingChrome(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer()
  server.on('upgrade', (req, socket) => {
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    socket.once('data', () => socket.destroy())
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/devtools/browser`, close: () => new Promise(resolve => server.close(() => resolve())) }
}

test('a call the socket closes under fails, and so does a call on the closed socket, rather than waiting forever (#2141)', async () => {
  const chrome = await quittingChrome()
  try {
    const cdp = await connectCdp(chrome.url)
    await assert.rejects(cdp.send('Browser.close'), /closed/)
    await assert.rejects(cdp.send('Browser.getVersion'), /closed/)
    cdp.close()
  } finally {
    await chrome.close()
  }
})
