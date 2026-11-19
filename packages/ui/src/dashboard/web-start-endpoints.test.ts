import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { BridgeStarts } from './bridge-starts.js'
import { WEB_START_PREFIX, handleWebStartRequest, type WebStartHandlers } from './web-start-endpoints.js'

const TOKEN = 'b'.repeat(43)

async function serve(handlers: WebStartHandlers | undefined): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    void handleWebStartRequest(req, res, pathname, handlers)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>(resolve => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

function wired(starts: BridgeStarts, alive = true): WebStartHandlers {
  return { token: TOKEN, extensionAlive: () => alive, request: input => starts.request(input), get: id => starts.get(id) }
}

const INPUT = { repo: 'openagt/openagent', branch: 'cloud-1-abcd1234', prompt: 'Add the thing' }

function post(url: string, body: unknown, token: string | null = TOKEN): Promise<Response> {
  return fetch(`${url}${WEB_START_PREFIX}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
}

test('a run queues a request and polls it to the session the extension created (#1328)', async () => {
  const starts = new BridgeStarts()
  const s = await serve(wired(starts))
  try {
    const queued = await post(s.url, INPUT)
    assert.equal(queued.status, 202)
    const { id } = (await queued.json()) as { id: string }
    assert.ok(id)

    const pending = await fetch(`${s.url}${WEB_START_PREFIX}/${id}`, { headers: { authorization: `Bearer ${TOKEN}` } })
    assert.deepEqual(await pending.json(), { state: 'queued' })

    // The extension's side: claim it and report the session.
    const claimed = starts.claimNext()
    assert.equal(claimed?.id, id)
    starts.resolve(id, true, 'session_01ABCdefGHIjklMNO')

    const done = await fetch(`${s.url}${WEB_START_PREFIX}/${id}`, { headers: { authorization: `Bearer ${TOKEN}` } })
    assert.deepEqual(await done.json(), {
      state: 'created',
      sessionId: 'session_01ABCdefGHIjklMNO',
      url: 'https://claude.ai/code/session_01ABCdefGHIjklMNO',
    })
  } finally {
    await s.close()
  }
})

test('the model travels to the queue when the run names one, and must be a string when it does (#1697)', async () => {
  const starts = new BridgeStarts()
  const s = await serve(wired(starts))
  try {
    const queued = await post(s.url, { ...INPUT, model: 'sonnet' })
    assert.equal(queued.status, 202)
    const { id } = (await queued.json()) as { id: string }
    assert.equal(starts.get(id)?.model, 'sonnet')
    const bare = await post(s.url, INPUT)
    assert.equal(starts.get(((await bare.json()) as { id: string }).id)?.model, undefined)
    assert.equal((await post(s.url, { ...INPUT, model: 42 })).status, 400)
  } finally {
    await s.close()
  }
})

test('a failure travels back with the extension note (#1328)', async () => {
  const starts = new BridgeStarts()
  const s = await serve(wired(starts))
  try {
    const { id } = (await (await post(s.url, INPUT)).json()) as { id: string }
    starts.claimNext()
    starts.resolve(id, false, undefined, 'no repo picker on the page')
    const res = await fetch(`${s.url}${WEB_START_PREFIX}/${id}`, { headers: { authorization: `Bearer ${TOKEN}` } })
    assert.deepEqual(await res.json(), { state: 'failed', note: 'no repo picker on the page' })
  } finally {
    await s.close()
  }
})

test('no extension around answers 409 at once, not after a timeout (#1328)', async () => {
  const s = await serve(wired(new BridgeStarts(), false))
  try {
    const res = await post(s.url, INPUT)
    assert.equal(res.status, 409)
    assert.match(await res.text(), /no browser extension/)
  } finally {
    await s.close()
  }
})

test('the routes demand the bridge token, validate the request, and 404 when the bridge is off (#1328)', async () => {
  const starts = new BridgeStarts()
  const s = await serve(wired(starts))
  const off = await serve(undefined)
  try {
    assert.equal((await post(s.url, INPUT, null)).status, 401)
    assert.equal((await post(s.url, INPUT, 'wrong')).status, 401)
    assert.equal((await post(s.url, { ...INPUT, repo: 'not-a-slug' })).status, 400)
    assert.equal((await post(s.url, 'not an object')).status, 400)
    assert.equal((await fetch(`${s.url}${WEB_START_PREFIX}`, { headers: { authorization: `Bearer ${TOKEN}` } })).status, 405)
    assert.equal((await fetch(`${s.url}${WEB_START_PREFIX}/nope`, { headers: { authorization: `Bearer ${TOKEN}` } })).status, 404)
    assert.equal((await fetch(`${s.url}${WEB_START_PREFIX}/../x`, { headers: { authorization: `Bearer ${TOKEN}` } })).status, 404)
    assert.equal((await post(off.url, INPUT)).status, 404)
  } finally {
    await s.close()
    await off.close()
  }
})
