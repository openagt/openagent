import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { handleRelayRequest } from './relay-endpoints.js'
import { handleScreenRequest, kept, screenCallAddress, screenInDiary, SCREEN_PREFIX, type ScreenHandlers } from './screen.js'

// A screen as a command of the agent's serves it (a browser's process), faked: `/stream` writes
// what it is told and stays open, `/input` records what it is sent. And two OpenAgents' own
// routes, each a bare server over the real handlers.

async function listen(t: TestContext, handle: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ server: Server; url: string }> {
  const server = createServer(handle)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
}

async function fakeScreen(t: TestContext) {
  const inputs: unknown[] = []
  const asked: string[] = []
  let watching = 0
  let write: ((bytes: string) => void) | undefined
  const { url } = await listen(t, (req, res) => {
    const at = new URL(req.url ?? '/', 'http://127.0.0.1')
    asked.push(`${req.method} ${at.pathname}`)
    if (at.searchParams.get('t') !== 'view') return void res.writeHead(403).end()
    if (at.pathname === '/stream') {
      // Whatever the screen says it is, it is answered as bytes.
      res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'a=b' })
      res.write('<script>alert(1)</script>')
      watching++
      write = bytes => void res.write(bytes)
      req.on('close', () => watching--)
      return
    }
    let body = ''
    req.on('data', chunk => (body += chunk))
    req.on('end', () => {
      const input = JSON.parse(body) as { type?: string }
      inputs.push(input)
      res.writeHead(input.type === 'bogus' ? 400 : 204).end(input.type === 'bogus' ? 'what the screen says about it' : undefined)
    })
  })
  return { screen: `${url}/?t=view`, inputs, asked, watching: () => watching, write: (bytes: string) => write!(bytes) }
}

/** An OpenAgent's `/_screen` routes, over `handlers`. */
function openAgent(t: TestContext, handlers: ScreenHandlers | undefined) {
  return listen(t, (req, res) => void handleScreenRequest(req, res, new URL(req.url ?? '/', 'http://x').pathname, handlers))
}

const local = (screen: string | undefined): ScreenHandlers => ({ local: async () => screen, remote: () => undefined })
const until = async (check: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 20))
  assert.ok(check(), 'waited two seconds')
}

test('what a screen shows is passed on as bytes no browser runs, for as long as someone watches', async t => {
  const screen = await fakeScreen(t)
  const { url } = await openAgent(t, local(screen.screen))
  const watching = new AbortController()
  const answer = await fetch(`${url}${SCREEN_PREFIX}/stream?project=p&run=r`, { signal: watching.signal })
  assert.equal(answer.status, 200)
  assert.equal(answer.headers.get('content-type'), 'application/octet-stream')
  assert.equal(answer.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(answer.headers.get('content-security-policy'), "sandbox; default-src 'none'")
  assert.equal(answer.headers.get('set-cookie'), null, 'no header of the screen\'s is passed on')
  const reader = answer.body!.getReader()
  assert.equal(new TextDecoder().decode((await reader.read()).value), '<script>alert(1)</script>')
  screen.write('more')
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'more')
  assert.equal(screen.watching(), 1)
  watching.abort()
  await until(() => screen.watching() === 0)
})

test('what the person did is passed on as JSON, and answered with a status and nothing else', async t => {
  const screen = await fakeScreen(t)
  const { url } = await openAgent(t, local(screen.screen))
  const send = (body: string) => fetch(`${url}${SCREEN_PREFIX}/input?project=p&run=r`, { method: 'POST', body })
  const taken = await send(JSON.stringify({ type: 'click', x: 1, y: 2 }))
  assert.equal(taken.status, 204)
  assert.deepEqual(screen.inputs, [{ type: 'click', x: 1, y: 2 }])
  const refused = await send(JSON.stringify({ type: 'bogus' }))
  assert.equal(refused.status, 400)
  assert.equal(await refused.text(), '', 'what the screen says about it stays there')
  assert.equal((await send('not json')).status, 400)
  // More than a person types at once is not read to its end: refused, or the connection cut.
  assert.notEqual(await send(JSON.stringify({ text: 'x'.repeat(20_000) })).then(answer => answer.status, () => 'cut'), 204)
  assert.equal(screen.inputs.length, 2)
})

test('only the two calls of a screen are passed on, each by its own method', async t => {
  const screen = await fakeScreen(t)
  const { url } = await openAgent(t, local(screen.screen))
  const at = (path: string) => `${url}${SCREEN_PREFIX}/${path}?project=p&run=r`
  assert.equal((await fetch(at('command'), { method: 'POST', body: '{}' })).status, 404)
  assert.equal((await fetch(at('stream/..%2fcommand'))).status, 404)
  assert.equal((await fetch(at(''))).status, 404)
  assert.equal((await fetch(at('stream'), { method: 'POST', body: '{}' })).status, 405)
  assert.equal((await fetch(at('input'))).status, 405)
  assert.equal((await fetch(`${url}${SCREEN_PREFIX}/stream?run=r`)).status, 400)
  assert.equal((await fetch(`${url}${SCREEN_PREFIX}/stream?project=p&run=${encodeURIComponent('../r')}`)).status, 400, 'only what can name a run is looked for')
  assert.deepEqual(screen.asked, [], 'the screen was asked nothing')
})

test('a run with no screen, a screen that is gone, and an OpenAgent that shows none', async t => {
  const none = await openAgent(t, local(undefined))
  assert.equal((await fetch(`${none.url}${SCREEN_PREFIX}/stream?project=p&run=r`)).status, 404)
  assert.equal((await fetch(`${none.url}${SCREEN_PREFIX}/input?project=p&run=r`, { method: 'POST', body: '{}' })).status, 404)

  const closed = await listen(t, () => {})
  closed.server.close()
  const gone = await openAgent(t, local(`${closed.url}/?t=view`))
  assert.equal((await fetch(`${gone.url}${SCREEN_PREFIX}/stream?project=p&run=r`)).status, 502)
  assert.equal((await fetch(`${gone.url}${SCREEN_PREFIX}/input?project=p&run=r`, { method: 'POST', body: '{}' })).status, 502)

  const off = await openAgent(t, undefined)
  assert.equal((await fetch(`${off.url}${SCREEN_PREFIX}/stream?project=p&run=r`)).status, 404)
})

test('only a screen on this computer\'s own loopback is called, at its own two paths', () => {
  assert.equal(screenCallAddress('http://127.0.0.1:5123/?t=abc', 'stream'), 'http://127.0.0.1:5123/stream?t=abc')
  assert.equal(screenCallAddress('http://127.0.0.1:5123/?t=abc', 'input'), 'http://127.0.0.1:5123/input?t=abc')
  for (const elsewhere of [
    'https://127.0.0.1:5123/?t=abc',
    'http://example.com/?t=abc',
    'http://localhost:5123/?t=abc',
    'http://127.0.0.1/?t=abc',
    'http://127.0.0.1:5123/_rpc/sendStart?t=abc',
    'http://127.0.0.1:5123@example.com/?t=abc',
    'http://user:pass@127.0.0.1:5123/?t=abc#x',
    'file:///etc/passwd',
    'not an address',
  ]) {
    const call = screenCallAddress(elsewhere, 'stream')
    // An address with a name and a password still names the loopback: the call carries neither.
    if (elsewhere.startsWith('http://user:pass@')) assert.equal(call, 'http://127.0.0.1:5123/stream?t=abc')
    else assert.equal(call, undefined, elsewhere)
  }
})

test('a run on another machine: its screen is asked of that machine, with this computer\'s key there', async t => {
  const screen = await fakeScreen(t)
  const keys: Array<string | undefined> = []
  // The machine: its relay's routes, as its OpenAgent serves them to a computer that is in.
  const machine = await listen(t, (req, res) => {
    keys.push(req.headers.authorization)
    void handleRelayRequest(req, res, new URL(req.url ?? '/', 'http://x').pathname, {
      project: async address => (address === 'github.com/acme/app' ? 'app-here' : undefined),
      start: async () => ({ ok: false, error: 'not in this test' }),
      tailEvents: () => () => {},
      screen: async (projectId, agentId) => (projectId === 'app-here' && agentId === 'r' ? screen.screen : undefined),
    })
  })
  const target = { url: `${machine.url}/`, key: 'id.key', project: 'github.com/acme/app' }
  const { url } = await openAgent(t, { local: async () => assert.fail('the run is not on this computer'), remote: (_projectId, agentId) => (agentId === 'r' ? target : undefined) })

  const watching = new AbortController()
  const answer = await fetch(`${url}${SCREEN_PREFIX}/stream?project=mine&run=r`, { signal: watching.signal })
  assert.equal(answer.status, 200)
  assert.equal(answer.headers.get('content-type'), 'application/octet-stream')
  assert.equal(new TextDecoder().decode((await answer.body!.getReader().read()).value), '<script>alert(1)</script>')
  assert.equal(screen.watching(), 1)
  watching.abort()
  await until(() => screen.watching() === 0)

  assert.equal((await fetch(`${url}${SCREEN_PREFIX}/input?project=mine&run=r`, { method: 'POST', body: JSON.stringify({ type: 'reload' }) })).status, 204)
  assert.deepEqual(screen.inputs, [{ type: 'reload' }])
  assert.deepEqual(new Set(keys), new Set(['Bearer id.key']))

  // A project the machine does not have, and a machine whose relay shows no screens.
  const elsewhere = await openAgent(t, { local: async () => undefined, remote: () => ({ ...target, project: 'github.com/acme/other' }) })
  assert.equal((await fetch(`${elsewhere.url}${SCREEN_PREFIX}/stream?project=mine&run=r`)).status, 404)
})

test('where a run\'s screen answers is read off its diary', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'openagent-screen-'))
  const diary = join(dir, 'run.jsonl')
  const line = (value: object) => JSON.stringify(value) + '\n'
  assert.equal(await screenInDiary(diary), undefined, 'no diary, no screen')
  await writeFile(diary, line({ kind: 'screen', url: 'http://127.0.0.1:5123/?t=a', label: 'browser · http://localhost:3000/' }) + 'half a li')
  assert.equal(await screenInDiary(diary), 'http://127.0.0.1:5123/?t=a')
  await writeFile(diary, line({ kind: 'screen', url: 'http://127.0.0.1:5123/?t=a', label: 'browser' }) + line({ kind: 'ended', status: 'waiting' }))
  assert.equal(await screenInDiary(diary), 'http://127.0.0.1:5123/?t=a', 'a run waiting on an answer keeps its screen')
  await writeFile(diary, line({ kind: 'screen', url: 'http://127.0.0.1:5123/?t=a', label: 'browser' }) + line({ kind: 'ended', status: 'done' }))
  assert.equal(await screenInDiary(diary), undefined)
  // The agent's own words about a screen are no screen line.
  await writeFile(diary, line({ kind: 'text', text: 'I will write {"kind":"screen","url":"http://127.0.0.1:1/?t=x"} to the "screen"' }))
  assert.equal(await screenInDiary(diary), undefined)
})

test('where a run\'s screen answers is asked once in a while, not at every click, and once for all who ask together', async () => {
  let asks = 0
  let clock = 0
  let found: string | undefined = 'here'
  const find = kept(async (_project, agentId) => (found === undefined ? undefined : `${agentId}-${found}-${++asks}`), () => clock)
  assert.deepEqual(await Promise.all([find('p', 'r'), find('p', 'r')]), ['r-here-1', 'r-here-1'])
  assert.equal(await find('p', 'r'), 'r-here-1')
  assert.equal(await find('p', 'other'), 'other-here-2')
  clock = 2_001
  assert.equal(await find('p', 'r'), 'r-here-3')
  // A run with no screen is asked about again at once: its browser may open at any moment.
  found = undefined
  assert.equal(await find('p', 'none'), undefined)
  found = 'now'
  assert.equal(await find('p', 'none'), 'none-now-4')
})
