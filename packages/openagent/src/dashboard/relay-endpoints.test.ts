import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { test, type TestContext } from 'node:test'
import type { OpenAgentEvent } from '../events.js'
import { MACHINE_RPC_NAMES, RELAY_RPC_NAMES, isMachineRead, isRelayRead } from '../dashboard-rpc/relay-dispatch.js'
import { handleRelayRequest, WATCH_HEADER, WATCH_ONLY, type RelayHandlers } from './relay-endpoints.js'
import { addMachine, renameThisComputer } from '../registry.js'
import { computerName } from '../computer-name.js'

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
    machine: async (fn, args) => (did.push(`machine ${fn}`), { fn, args }),
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
  assert.match(WATCH_ONLY, /^This computer only lets its server watch\. Turn on "From anywhere" through this server in its Settings, under Devices\.$/)

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

test('a call that may only watch runs a module command when this computer says it only reads, whatever the call says', async t => {
  const did: string[] = []
  const handlers: RelayHandlers = {
    project: async address => (address === SHOP ? 'shop-here' : undefined),
    start: async () => ({ ok: true, agentId: RUN }),
    tailEvents: () => () => {},
    rpc: async (_projectId, fn, args) => (did.push(`rpc ${fn} ${JSON.stringify(args[2])}`), 'ran'),
    // This computer's own word: the queue's bare command reads, in this project.
    reads: async (projectId, fn, args) => projectId === 'shop-here' && fn === 'runModuleCommand' && Array.isArray(args[2]) && args[2].length === 0,
  }
  const url = await listen(t, (req, res) => void handleRelayRequest(req, res, new URL(req.url ?? '/', 'http://x').pathname, handlers))
  const call = (args: unknown[], project = SHOP): Promise<Response> =>
    fetch(`${url}/_relay/rpc`, { method: 'POST', headers: { ...JSON_BODY, ...WATCH }, body: JSON.stringify({ fn: 'runModuleCommand', args, project }), signal: AbortSignal.timeout(5000) })
  assert.deepEqual(await said(await call(['callers-id', 'queue', []])), [200, JSON.stringify({ result: 'ran' })])
  // Called a read by the page (no `acts`): still a change here.
  assert.deepEqual(await said(await call(['callers-id', 'queue', ['add', 'x'], undefined, false])), [403, WATCH_ONLY])
  assert.deepEqual(await said(await call(['callers-id', 'queue', []], 'github.com/acme/none')), [404, 'no such project on this machine'])
  assert.deepEqual(did, ['rpc runModuleCommand []'])
})

test('a machine-wide call names no project, and one that may only watch runs it only when it reads', async t => {
  const { did, post } = await computer(t)
  const call = (fn: string, headers: Record<string, string> = {}): Promise<Response> => post('/_relay/machine', { fn, args: [{ kind: 'git' }, 'secret'] }, headers)
  for (const fn of MACHINE_RPC_NAMES) {
    did.length = 0
    const answer = JSON.stringify({ result: { fn, args: [{ kind: 'git' }, 'secret'] } })
    assert.deepEqual(await said(await call(fn)), [200, answer], `${fn}, in full`)
    const watched = await said(await call(fn, WATCH))
    if (isMachineRead(fn)) assert.deepEqual(watched, [200, answer], `${fn} reads`)
    else assert.deepEqual(watched, [403, WATCH_ONLY], `${fn} acts`)
    assert.deepEqual(did, isMachineRead(fn) ? [`machine ${fn}`, `machine ${fn}`] : [`machine ${fn}`], fn)
  }
  did.length = 0
  assert.equal((await call('sendStart', WATCH)).status, 403)
  assert.equal((await post('/_relay/machine', { args: [] })).status, 400)
  assert.deepEqual(did, [])
})

test('the header restricts whatever it says, and a call that is refused anyway is refused as it was', async t => {
  const { did, get, post } = await computer(t)
  for (const value of ['1', '0', '', 'no']) assert.equal((await post('/_relay/start', { prompt: 'x', options: {}, project: SHOP }, { [WATCH_HEADER]: value })).status, 403, JSON.stringify(value))
  assert.deepEqual(did, [])
  // A read asked the wrong way, and a path that is no relay call, with the header: what they are without it.
  assert.equal((await get('/_relay/start', WATCH)).status, 405)
  assert.equal((await get('/_relay/rpc', WATCH)).status, 405)
  assert.equal((await get('/_relay/machine', WATCH)).status, 405)
  assert.equal((await get('/_relay/nothing', WATCH)).status, 404)
})

test('the ping says the ids this OpenAgent is listed under at the doors of the machines it saved; never a key, and none for a computer reached through a server', async t => {
  const home = await mkdtemp(join(tmpdir(), 'oa-ping-'))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = home
  t.after(async () => {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(home, { recursive: true, force: true })
  })
  const studio = 'http://192.168.1.5:4201'
  await addMachine({ url: studio, key: 'a1b2c3d4e5f6.s3cret', door: `${studio}/_devices/enter`, label: 'Studio' })
  await addMachine({ url: `${studio}/_devices/via/abc123def456`, key: 'a1b2c3d4e5f6.s3cret', door: `${studio}/_devices/enter`, label: 'Home PC' })
  const { get } = await computer(t)
  const answer = await get('/_relay/ping')
  const body = await answer.text()
  assert.deepEqual((JSON.parse(body) as { listed: string[] }).listed, ['a1b2c3d4e5f6'])
  assert.doesNotMatch(body, /s3cret/)
  // The name every page shows this computer under is said from here: its host name until the person names it.
  assert.equal((JSON.parse(body) as { name?: string }).name, computerName())
  await renameThisComputer('Studio at home')
  assert.equal(((await (await get('/_relay/ping')).json()) as { name?: string }).name, 'Studio at home')
})
