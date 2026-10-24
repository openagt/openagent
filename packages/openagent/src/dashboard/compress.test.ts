import assert from 'node:assert/strict'
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http'
import { test } from 'node:test'
import { gunzipSync } from 'node:zlib'
import { sendBody } from './compress.js'

// What the dashboard sends goes gzipped to a browser that takes it, when it is text and not short.

function call(acceptEncoding?: string): { req: IncomingMessage; res: ServerResponse; sent: () => { status?: number; headers: OutgoingHttpHeaders; body: Buffer } } {
  const req = { headers: acceptEncoding !== undefined ? { 'accept-encoding': acceptEncoding } : {} } as IncomingMessage
  let status: number | undefined
  let headers: OutgoingHttpHeaders = {}
  let body: Buffer = Buffer.alloc(0)
  const res = {
    writeHead: (s: number, h: OutgoingHttpHeaders) => ((status = s), (headers = h), res),
    end: (b: Buffer) => ((body = b), res),
  } as unknown as ServerResponse
  return { req, res, sent: () => ({ ...(status !== undefined ? { status } : {}), headers, body }) }
}

const JSON_TYPE = { 'content-type': 'application/json' }
const long = JSON.stringify({ ret: Array.from({ length: 500 }, (_, i) => ({ id: `2026-10-24T16-48-49-${i}Z`, intent: 'tell me hi' })) })

test('a long answer goes gzipped to a browser that takes it, and whole to one that does not', async () => {
  const zipped = call('gzip, deflate, br')
  await sendBody(zipped.req, zipped.res, 200, JSON_TYPE, long)
  assert.equal(zipped.sent().headers['content-encoding'], 'gzip')
  assert.equal(gunzipSync(zipped.sent().body).toString(), long)
  assert.ok(zipped.sent().body.length < long.length / 4)
  const plain = call()
  await sendBody(plain.req, plain.res, 200, JSON_TYPE, long)
  assert.equal(plain.sent().headers['content-encoding'], undefined)
  assert.equal(plain.sent().body.toString(), long)
})

test('a short answer, and what is no text, go as they are', async () => {
  const short = call('gzip')
  await sendBody(short.req, short.res, 200, JSON_TYPE, '{"ret":true}')
  assert.equal(short.sent().headers['content-encoding'], undefined)
  const picture = call('gzip')
  await sendBody(picture.req, picture.res, 200, { 'content-type': 'image/png' }, Buffer.alloc(4096))
  assert.equal(picture.sent().headers['content-encoding'], undefined)
})
