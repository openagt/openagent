import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, type TestContext } from 'node:test'
import type { OpenAgentEvent } from '../events.js'
import { RELAY_RPC_NAMES, isRelayRead } from '../dashboard-rpc/relay-dispatch.js'
import { handleRelayRequest, WATCH_HEADER, WATCH_ONLY, type RelayHandlers } from './relay-endpoints.js'

// A call that may only watch (WATCH_HEADER): a computer that keeps a line open to its server adds
// the header to every call it passes on to its own OpenAgent, while its person lets the server
// watch and no more. Each relay endpoint is asked here with the header and without it, over the
// real handlers: what reads is answered both times, and what acts only without it.

const SHOP = 'github.com/acme/shop'
const RUN = '2026-07-19T10-00-00-000Z'
const WATCH = { [WATCH_HEADER]: '1' }
const JSON_BODY = { 'content-type': 'application/json' }

async function listen(t: TestContext, handle: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const server = createServer(handle)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/** A computer's relay routes over handlers that record what reached them, and the screen of its one run. */
async function computer(t: TestContext) {
  const did: string[] = []
  const screen = await listen(t, (req, res) => {
    did.push(`screen ${req.method} ${new URL(req.url ?? '/', 'http://x').pathname}`)
    req.resume()
    if (req.method === 'GET') return void res.writeHead(200).end('a picture')
    res.writeHead(204).end()
  })
  const handlers: RelayHandlers = {
    project: async address => (address === SHOP ? 'shop-here' : undefined),
    start: async prompt => (did.push(`start ${prompt}`), { ok: true, agentId: RUN }),
    tailEvents: (_projectId, _agentId, onEvent) => (onEvent({ kind: 'session-update', sessionId: 's1' } as OpenAgentEvent), () => {}),
    rpc: async (_projectId, fn) => (did.push(`rpc ${fn}`), fn),
    bring: async (_address, bring) => (bring && did.push('clone'), { state: bring ? 'coming' : 'missing' }),
    screen: async () => `${screen}/`,
  }
  const url = await listen(t, (req, res) => void handleRelayRequest(req, res, new URL(req.url ?? '/', 'http://x').pathname, handlers))
  const get = (path: string, headers: Record<string, string> = {}): Promise<Response> => fetch(`${url}${path}`, { headers, signal: AbortSignal.timeout(5000) })
  const post = (path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
    fetch(`${url}${path}`, { method: 'POST', headers: { ...JSON_BODY, ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) })
  return { did, get, post }
}

/** The answer's status, and its first words: a stream stays open, so it is hung up on once it said something. */
async function said(answer: Response): Promise<[number, string]> {
  const reader = answer.body?.getReader()
  const first = await reader?.read()
  await reader?.cancel().catch(() => {})
  return [answer.status, new TextDecoder().decode(first?.value)]
}

const where = `run=${RUN}&project=${encodeURIComponent(SHOP)}`

test('a call that may only watch reads what any call reads: the ping, a run\'s events, where a project stands, a run\'s screen', async t => {
  const { did, get } = await computer(t)
  for (const headers of [{}, WATCH]) {
    assert.equal((await get('/_relay/ping', headers)).status, 200)
    assert.deepEqual(await said(await get(`/_relay/events?${where}`, headers)), [200, '{"kind":"session-update","sessionId":"s1"}\n'])
    assert.deepEqual(await said(await get(`/_relay/project?project=${encodeURIComponent(SHOP)}`, headers)), [200, '{"state":"missing"}'])
    assert.deepEqual(await said(await get(`/_relay/screen/stream?${where}`, headers)), [200, 'a picture'])
  }
  assert.deepEqual(did, ['screen GET /stream', 'screen GET /stream'])
})

test('a call that may only watch starts no run, clones no project and does nothing on a run\'s screen: it is refused in words the person reads', async t => {
  const { did, post } = await computer(t)
  const acts: [string, unknown][] = [
    ['/_relay/start', { prompt: 'do it', options: {}, project: SHOP }],
    ['/_relay/project', { project: SHOP, share: true }],
    [`/_relay/screen/input?${where}`, { type: 'click', x: 1, y: 1 }],
  ]
  for (const [path, body] of acts) assert.deepEqual(await said(await post(path, body, WATCH)), [403, WATCH_ONLY], path)
  assert.deepEqual(did, [], 'nothing reached the computer')
  assert.match(WATCH_ONLY, /^This computer only lets its server watch\. Turn on "Start runs on this computer from the phone" in its Settings, under Servers\.$/)

  // The header only restricts: the same calls without it are answered in full.
  assert.deepEqual((await said(await post(acts[0]![0], acts[0]![1])))[0], 200)
  assert.deepEqual(await said(await post(acts[1]![0], acts[1]![1])), [200, '{"state":"coming"}'])
  assert.equal((await post(acts[2]![0], acts[2]![1])).status, 204)
  assert.deepEqual(did, ['start do it', 'clone', 'screen POST /input'])
})

test('a call that may only watch runs a relayed function that reads, and no other', async t => {
  const { did, post } = await computer(t)
  const call = (fn: string, headers: Record<string, string> = {}): Promise<Response> => post('/_relay/rpc', { fn, args: ['callers-id', RUN], project: SHOP }, headers)
  for (const fn of RELAY_RPC_NAMES) {
    did.length = 0
    assert.deepEqual(await said(await call(fn)), [200, JSON.stringify({ result: fn })], `${fn}, in full`)
    const watched = await said(await call(fn, WATCH))
    if (isRelayRead(fn)) assert.deepEqual(watched, [200, JSON.stringify({ result: fn })], `${fn} reads`)
    else assert.deepEqual(watched, [403, WATCH_ONLY], `${fn} acts`)
    assert.deepEqual(did, isRelayRead(fn) ? [`rpc ${fn}`, `rpc ${fn}`] : [`rpc ${fn}`], fn)
  }
  // A name that is no relayed function is no read: it does not get as far as being looked up.
  did.length = 0
  assert.equal((await call('sendStart', WATCH)).status, 403)
  assert.equal((await call('constructor', WATCH)).status, 403)
  assert.deepEqual(did, [])
})

test('the header restricts whatever it says, and a call that is refused anyway is refused as it was', async t => {
  const { did, get, post } = await computer(t)
  for (const value of ['1', '0', '', 'no']) assert.equal((await post('/_relay/start', { prompt: 'x', options: {}, project: SHOP }, { [WATCH_HEADER]: value })).status, 403, JSON.stringify(value))
  assert.deepEqual(did, [])
  // A read asked the wrong way, and a path that is no relay call, with the header: what they are without it.
  assert.equal((await get('/_relay/start', WATCH)).status, 405)
  assert.equal((await get('/_relay/rpc', WATCH)).status, 405)
  assert.equal((await get('/_relay/nothing', WATCH)).status, 404)
})
