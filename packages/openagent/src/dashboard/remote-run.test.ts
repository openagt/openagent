import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { deviceIdOf, enterRemote, leaveRemote, machineCall, remoteFacts, remoteProject, startRemoteAgent, streamRemoteEvents, pingRemote, relayRpc, remoteVersion, MachineRefusal, RelayedAgents, foldRelayedEvent, type RemoteTarget } from './remote-run.js'
import { type AgentMeta } from '../store/index.js'
import type { OpenAgentEvent } from '../events.js'
import { handleRelayRequest } from './relay-endpoints.js'

/** The project every call here names: a repository's address, the name both machines have for it. */
const PROJECT = 'github.com/acme/shop'

// A throwaway loopback server; the handler decides how it answers. Returns its base url + close.
async function server(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ url: string; close: () => Promise<void> }> {
  const srv: Server = createServer(handler)
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()))
  const port = (srv.address() as AddressInfo).port
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>(r => srv.close(() => r())) }
}

// A minimal running AgentMeta stub, the local list row RelayedAgents keeps for a relayed agent (#1077).
function stubMeta(id: string, overrides: Partial<AgentMeta> = {}): AgentMeta {
  const now = new Date().toISOString()
  return { status: 'running', id, startedAt: now, updatedAt: now, target: 'remote', ...overrides }
}

// Drain a RelayedAgents stream to completion, so both its `end`-driven settle and its close flip have run.
async function drainAgent(agents: RelayedAgents, agentId: string): Promise<void> {
  const stream = agents.get(agentId)
  assert.ok(stream)
  for await (const _e of stream!) { /* consume until the machine closes the body */ }
}

/** Wait until the stream ends (its `onEnd` fires) or a timeout trips, collecting events meanwhile. */
function drain(target: RemoteTarget, agentId: string, timeoutMs = 4000): Promise<{ events: OpenAgentEvent[]; ended: boolean }> {
  return new Promise(resolvePromise => {
    const events: OpenAgentEvent[] = []
    const timer = setTimeout(() => resolvePromise({ events, ended: false }), timeoutMs)
    streamRemoteEvents(target, agentId, e => events.push(e), () => {
      clearTimeout(timer)
      resolvePromise({ events, ended: true })
    })
  })
}

test('startRemoteAgent posts to /_relay/start with this computer\'s key, no Origin, and the run body (#1067)', async () => {
  let captured: { method?: string | undefined; url?: string | undefined; authorization?: string | undefined; origin?: string | undefined; body: unknown } = { body: null }
  const srv = await server((req, res) => {
    let raw = ''
    req.on('data', c => (raw += c))
    req.on('end', () => {
      captured = { method: req.method, url: req.url, authorization: req.headers.authorization, origin: req.headers.origin, body: JSON.parse(raw) }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, agentId: 'r1' }))
    })
  })
  try {
    const result = await startRemoteAgent({ url: srv.url, key: 'd1.sekret', project: PROJECT }, { prompt: 'do it', options: { model: 'opus' } })
    assert.deepEqual(result, { ok: true, agentId: 'r1' })
    assert.equal(captured.method, 'POST')
    assert.equal(captured.url, '/_relay/start')
    assert.equal(captured.authorization, 'Bearer d1.sekret') // this computer's own key there
    assert.equal(captured.origin, undefined) // NO Origin header, so it passes the remote CSRF guard
    assert.deepEqual(captured.body, { prompt: 'do it', options: { model: 'opus' }, project: PROJECT }) // the project rides every start
  } finally {
    await srv.close()
  }
})

test('startRemoteAgent surfaces a non-2xx from the machine as an ok:false result (#1067)', async () => {
  const srv = await server((_req, res) => {
    res.writeHead(500, { 'content-type': 'text/plain' })
    res.end('it broke')
  })
  try {
    const result = await startRemoteAgent({ url: srv.url, key: 'd1.wrong', project: PROJECT }, { prompt: 'x', options: {} })
    assert.deepEqual(result, { ok: false, error: 'the machine refused the run (500)' })
  } finally {
    await srv.close()
  }
})

test('a machine that refuses a call and says why (403) is answered in its own words: a start, a project asked for, a relayed call', async () => {
  const WHY = 'This computer only lets its server watch. Turn on "From anywhere" through this server in its Settings, under Devices.'
  let why = WHY
  const srv = await server((req, res) => {
    req.resume()
    res.writeHead(403, { 'content-type': 'text/plain' }).end(why)
  })
  const target = { url: srv.url, key: 'd1.sekret', project: PROJECT }
  try {
    assert.deepEqual(await startRemoteAgent(target, { prompt: 'x', options: {} }), { ok: false, error: WHY })
    assert.deepEqual(await remoteProject(target, { share: true }), { state: 'unasked', error: WHY })
    await assert.rejects(relayRpc(target, 'sendMessage', ['pid', 'go on', 'r1']), err => err instanceof MachineRefusal && err.message === WHY)
    // Its words are cut to a length, and a refusal that gives no reason reads as any other.
    why = 'x'.repeat(5000)
    assert.equal(((await startRemoteAgent(target, { prompt: 'x', options: {} })) as { error: string }).error.length, 600)
    why = '  '
    assert.deepEqual(await startRemoteAgent(target, { prompt: 'x', options: {} }), { ok: false, error: 'the machine refused the run (403)' })
    assert.deepEqual(await remoteProject(target), { state: 'unasked', error: 'the machine refused (403)' })
    await assert.rejects(relayRpc(target, 'sendMessage', []), err => !(err instanceof MachineRefusal) && /403/.test((err as Error).message))
  } finally {
    await srv.close()
  }
})

test('pingRemote GETs /_relay/ping with this computer\'s key and is true on a 2xx (#1072)', async () => {
  let captured: { method?: string | undefined; url?: string | undefined; authorization?: string | undefined } = {}
  const srv = await server((req, res) => {
    captured = { method: req.method, url: req.url, authorization: req.headers.authorization }
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end()
  })
  try {
    assert.equal(await pingRemote({ url: srv.url, key: 'd1.sekret' }), true)
    assert.equal(captured.method, 'GET')
    assert.equal(captured.url, '/_relay/ping')
    assert.equal(captured.authorization, 'Bearer d1.sekret') // this computer's own key there
  } finally {
    await srv.close()
  }
})

test('pingRemote is false on a non-2xx from the machine (#1072)', async () => {
  const srv = await server((_req, res) => {
    res.writeHead(401, { 'content-type': 'text/plain' })
    res.end('unauthorized')
  })
  try {
    assert.equal(await pingRemote({ url: srv.url, key: 'd1.wrong' }), false)
  } finally {
    await srv.close()
  }
})

test('pingRemote is false when the machine is unreachable (#1072)', async () => {
  // A port nothing is listening on: the fetch rejects, which pingRemote swallows as offline.
  assert.equal(await pingRemote({ url: 'http://127.0.0.1:1', key: 'd1.t' }), false)
})

test('a machine\'s ping tells the OpenAgent it runs; what does not read as a version, and a machine that does not answer, tell none', async () => {
  let answer: unknown = { version: '0.10.1' }
  let status = 200
  const srv = await server((_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(typeof answer === 'string' ? answer : JSON.stringify(answer))
  })
  try {
    const target = { url: srv.url, key: 'd1.sekret' }
    assert.equal(await remoteVersion(target), '0.10.1')
    // What a machine says is shown on a page: only a version is one.
    for (const odd of [{}, { version: 7 }, { version: '' }, { version: '<img src=x onerror=alert(1)>' }, { version: 'a'.repeat(65) }, 'not json', '']) {
      answer = odd
      assert.equal(await remoteVersion(target), undefined, JSON.stringify(odd))
    }
    // Its computer's own name comes with it, as the records of its runs carry it; a name that is no name is none.
    answer = { version: '0.10.1', host: 'ubuntu-fra1' }
    assert.deepEqual(await remoteFacts(target), { version: '0.10.1', host: 'ubuntu-fra1' })
    for (const odd of [7, '', 'a'.repeat(254), { name: 'x' }]) {
      answer = { version: '0.10.1', host: odd }
      assert.deepEqual(await remoteFacts(target), { version: '0.10.1' }, JSON.stringify(odd).slice(0, 40))
    }
    answer = { version: '0.10.1' }
    status = 401 // this computer was taken out there
    assert.equal(await remoteVersion(target), undefined)
    assert.deepEqual(await remoteFacts(target), {})
  } finally {
    await srv.close()
  }
  assert.equal(await remoteVersion({ url: 'http://127.0.0.1:1', key: 'd1.t' }), undefined)
})

test('streamRemoteEvents parses ndjson lines in order and ends when the body closes (#1067)', async () => {
  let asked: string | undefined
  const srv = await server((req, res) => {
    asked = req.url
    res.writeHead(200, { 'content-type': 'application/x-ndjson' })
    res.write(`${JSON.stringify({ kind: 'session-update', sessionId: 'a' })}\n`)
    res.write(`${JSON.stringify({ kind: 'session-update', sessionId: 'b' })}\n`)
    res.end()
  })
  try {
    const { events, ended } = await drain({ url: srv.url, key: 'd1.t', project: PROJECT }, 'r1')
    assert.deepEqual(events.map(e => (e as { sessionId?: string }).sessionId), ['a', 'b'])
    assert.equal(ended, true)
    // The run and its project, by the repository's address: the machine has no other way to find the run's folder.
    assert.equal(asked, '/_relay/events?run=r1&project=github.com%2Facme%2Fshop')
  } finally {
    await srv.close()
  }
})

test('a line split across two chunks is reassembled, not dropped (#1067)', async () => {
  const line = `${JSON.stringify({ kind: 'session-update', sessionId: 'split' })}\n`
  const srv = await server(async (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' })
    res.write(line.slice(0, 10)) // half a JSON line
    await new Promise(r => setTimeout(r, 20))
    res.write(line.slice(10)) // the rest, arriving in a second chunk
    res.end()
  })
  try {
    const { events } = await drain({ url: srv.url, key: 'd1.t', project: PROJECT }, 'r1')
    assert.deepEqual(events.map(e => (e as { sessionId?: string }).sessionId), ['split'])
  } finally {
    await srv.close()
  }
})

test('a 401 from the remote (this computer was removed there) surfaces as a clean stream-end, no events (#1067)', async () => {
  const srv = await server((_req, res) => {
    res.writeHead(401, { 'content-type': 'text/plain' })
    res.end('unauthorized')
  })
  try {
    const { events, ended } = await drain({ url: srv.url, key: 'd1.stale', project: PROJECT }, 'r1')
    assert.equal(events.length, 0)
    assert.equal(ended, true) // ended cleanly (a done), not an error the caller has to retry
  } finally {
    await srv.close()
  }
})

test('RelayedAgents feeds a run stream from the machine and drops its stream when the stream ends (#1067)', async () => {
  const srv = await server((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' })
    res.write(`${JSON.stringify({ kind: 'session-update', sessionId: 'hi' })}\n`)
    res.end()
  })
  try {
    const agents = new RelayedAgents()
    agents.register('r1', { url: srv.url, key: 'd1.t', project: PROJECT }, stubMeta('r1'), 'proj-1')
    const stream = agents.get('r1') // grabbed synchronously, before the remote stream ends
    assert.ok(stream)
    const got: OpenAgentEvent[] = []
    for await (const e of stream!) got.push(e) // replays, then ends when the machine closes the body
    assert.deepEqual(got.map(e => (e as { sessionId?: string }).sessionId), ['hi'])
    assert.equal(agents.get('r1'), undefined) // dropped: nothing more will come
  } finally {
    await srv.close()
  }
})

test('RelayedAgents closes cleanly on a 401 with no events (#1067)', async () => {
  const srv = await server((_req, res) => {
    res.writeHead(401)
    res.end()
  })
  try {
    const agents = new RelayedAgents()
    agents.register('r1', { url: srv.url, key: 'd1.stale', project: PROJECT }, stubMeta('r1'), 'proj-1')
    const stream = agents.get('r1')
    assert.ok(stream)
    const got: OpenAgentEvent[] = []
    for await (const e of stream!) got.push(e)
    assert.equal(got.length, 0) // a clean close, so the browser sees `done`, not `lost`
  } finally {
    await srv.close()
  }
})

test('relayRpc posts to /_relay/rpc with this computer\'s key, no Origin, and returns the machine result (#1067 slice 2)', async () => {
  let captured: { method?: string | undefined; url?: string | undefined; authorization?: string | undefined; origin?: string | undefined; body: unknown } = { body: null }
  const srv = await server((req, res) => {
    let raw = ''
    req.on('data', c => (raw += c))
    req.on('end', () => {
      captured = { method: req.method, url: req.url, authorization: req.headers.authorization, origin: req.headers.origin, body: JSON.parse(raw) }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ result: { dirty: true, branch: 'main' } }))
    })
  })
  try {
    const result = await relayRpc({ url: srv.url, key: 'd1.sekret', project: PROJECT }, 'onGitStatus', ['pid', 'r1'])
    assert.deepEqual(result, { dirty: true, branch: 'main' }) // the machine's own result, unwrapped from {result}
    assert.equal(captured.method, 'POST')
    assert.equal(captured.url, '/_relay/rpc')
    assert.equal(captured.authorization, 'Bearer d1.sekret') // this computer's own key there
    assert.equal(captured.origin, undefined) // NO Origin header, so it passes the remote CSRF guard
    assert.deepEqual(captured.body, { fn: 'onGitStatus', args: ['pid', 'r1'], project: PROJECT })
  } finally {
    await srv.close()
  }
})

test('relayRpc throws on a non-2xx from the machine (#1067 slice 2)', async () => {
  const srv = await server((_req, res) => {
    res.writeHead(500, { 'content-type': 'text/plain' })
    res.end('rpc failed')
  })
  try {
    await assert.rejects(relayRpc({ url: srv.url, key: 'd1.t', project: PROJECT }, 'onGitStatus', []), /500|machine/)
  } finally {
    await srv.close()
  }
})

test('RelayedAgents.list surfaces a relayed run as a remote row, scoped to its project (#1077)', async () => {
  // A server that never closes the body, so the pump stays live and the row stays `running` while
  // we read it synchronously; dispose() aborts the fetch on the way out.
  const srv = await server((_req, res) => res.writeHead(200, { 'content-type': 'application/x-ndjson' }))
  try {
    const agents = new RelayedAgents()
    agents.register('r1', { url: srv.url, key: 'd1.t', project: PROJECT }, stubMeta('r1', { intent: 'do it' }), 'proj-1')
    const rows = agents.list('proj-1') // read before the fetch does anything: the stub is set synchronously
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.id, 'r1')
    assert.equal(rows[0]?.target, 'remote')
    assert.equal(rows[0]?.status, 'running')
    assert.equal(rows[0]?.intent, 'do it')
    assert.deepEqual(agents.list('other'), []) // another project sees none of it
    agents.dispose()
  } finally {
    await srv.close()
  }
})

// Register a relayed agent against a machine that emits one log line then an optional end line and closes,
// and return the status left on its list row once RelayedAgents has fully drained the stream (#1077).
async function relayEndStatus(endEvent: OpenAgentEvent | null): Promise<string | undefined> {
  const srv = await server((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' })
    res.write(`${JSON.stringify({ kind: 'session-update', sessionId: 'working' })}\n`)
    if (endEvent) res.write(`${JSON.stringify(endEvent)}\n`)
    res.end()
  })
  try {
    const agents = new RelayedAgents()
    agents.register('r1', { url: srv.url, key: 'd1.t', project: PROJECT }, stubMeta('r1'), 'proj-1')
    await drainAgent(agents, 'r1')
    return agents.list('proj-1')[0]?.status
  } finally {
    await srv.close()
  }
}

test("a relayed run's list row flips to the machine's ending, or stopped if the stream just drops (#1077)", async () => {
  assert.equal(await relayEndStatus({ kind: 'end', ok: true } as OpenAgentEvent), 'done')
  assert.equal(await relayEndStatus({ kind: 'end', stopped: true, ok: false } as OpenAgentEvent), 'stopped')
  assert.equal(await relayEndStatus({ kind: 'end', ok: false } as OpenAgentEvent), 'failed')
  // A run that ended on a question waits for its answer: the row says so, as the machine's own does.
  assert.equal(await relayEndStatus({ kind: 'end', ok: false, waiting: true } as OpenAgentEvent), 'waiting')
  assert.equal(await relayEndStatus(null), 'stopped') // no end event: the stream dropped, so it is no longer live
})

test('dispose clears the relayed run list and its machine target (#1077)', async () => {
  const srv = await server((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' })
    res.end()
  })
  try {
    const agents = new RelayedAgents()
    agents.register('r1', { url: srv.url, key: 'd1.t', project: PROJECT }, stubMeta('r1'), 'proj-1')
    assert.equal(agents.list('proj-1').length, 1) // present before shutdown
    agents.dispose()
    assert.deepEqual(agents.list('proj-1'), []) // and gone after
    assert.equal(agents.target('r1'), undefined)
  } finally {
    await srv.close()
  }
})

test('RelayedAgents.target outlives the event stream and dispose clears it (#1067 slice 2)', async () => {
  const srv = await server((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' })
    res.write(`${JSON.stringify({ kind: 'session-update', sessionId: 'hi' })}\n`)
    res.end()
  })
  try {
    const agents = new RelayedAgents()
    const target = { url: srv.url, key: 'd1.t', project: PROJECT }
    agents.register('r1', target, stubMeta('r1'), 'proj-1')
    const stream = agents.get('r1')
    assert.ok(stream)
    for await (const _e of stream!) { /* drain until the machine closes the body, ending the pump */ }
    assert.equal(agents.get('r1'), undefined) // the event stream is gone once the machine closes
    assert.deepEqual(agents.target('r1'), target) // but the machine target outlives it, for a post-run push/PR
    agents.dispose()
    assert.equal(agents.target('r1'), undefined) // cleared on shutdown
  } finally {
    await srv.close()
  }
})

test('a start on a machine that no longer lets this computer in says so', async () => {
  const srv = await server((_req, res) => {
    res.writeHead(401, { 'content-type': 'text/plain' })
    res.end('this device is not in')
  })
  try {
    const target = { url: srv.url, key: 'd1.removed', project: PROJECT }
    const started = await startRemoteAgent(target, { prompt: 'x', options: {} })
    assert.deepEqual(started, { ok: false, error: 'this computer is no longer in on the machine: add the machine again, with a new link' })
  } finally {
    await srv.close()
  }
})

test('enterRemote sends the link\'s code and this computer\'s name where the link points, and answers the key', async () => {
  let captured: { method?: string | undefined; url?: string | undefined; origin?: string | undefined; body: unknown } = { body: null }
  const srv = await server((req, res) => {
    let raw = ''
    req.on('data', c => (raw += c))
    req.on('end', () => {
      captured = { method: req.method, url: req.url, origin: req.headers.origin, body: JSON.parse(raw) }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, key: 'd7.fresh' }))
    })
  })
  try {
    assert.deepEqual(await enterRemote(`${srv.url}/_devices/enter`, 'c0de', 'studio'), { ok: true, key: 'd7.fresh' })
    assert.equal(captured.method, 'POST')
    assert.equal(captured.url, '/_devices/enter')
    assert.equal(captured.origin, undefined) // no page made this call
    assert.deepEqual(captured.body, { code: 'c0de', computer: 'studio' })
  } finally {
    await srv.close()
  }
})

test('enterRemote says in words why this computer was not let in', async () => {
  const answers: Array<[number, string]> = [
    [403, 'this code no longer works'],
    [403, 'only a device on the same network as this computer gets in'],
    [403, ''],
    [429, 'too many wrong codes: wait a minute'],
    [500, '<html>boom</html>'],
    [200, '{"ok":true}'],
    [200, '<!doctype html>'],
  ]
  let next = 0
  const srv = await server((_req, res) => {
    const [status, body] = answers[next++]!
    res.writeHead(status).end(body)
  })
  try {
    const door = `${srv.url}/_devices/enter`
    const spent = await enterRemote(door, 'c', 'studio')
    assert.equal(spent.ok, false)
    assert.equal(spent.ok ? '' : spent.error, "That code doesn't work. A code works once, for ten minutes: check it, or make a new one on the other device.")
    // Another refusal is told in the machine's own words, not as a link that was used.
    const elsewhere = await enterRemote(door, 'c', 'studio')
    assert.deepEqual(elsewhere, { ok: false, error: 'The machine refused: only a device on the same network as this computer gets in.' })
    assert.deepEqual(await enterRemote(door, 'c', 'studio'), { ok: false, error: 'The machine refused.' })
    assert.deepEqual(await enterRemote(door, 'c', 'studio'), { ok: false, error: 'Too many wrong codes: wait a minute, then try again.' })
    const failed = await enterRemote(door, 'c', 'studio')
    assert.deepEqual(failed, { ok: false, error: 'The machine refused (500).' })
    // An answer with no key, or one that is no JSON: not an OpenAgent that lets a machine in.
    for (let i = 0; i < 2; i++) {
      const other = await enterRemote(door, 'c', 'studio')
      assert.match(other.ok ? '' : other.error, /not an OpenAgent that lets a machine in/)
    }
    const nobody = await enterRemote('http://127.0.0.1:1/_devices/enter', 'c', 'studio')
    assert.match(nobody.ok ? '' : nobody.error, /did not answer/)
  } finally {
    await srv.close()
  }
})

test('leaveRemote takes this computer out where it was let in, with its key, and says whether the machine did', async () => {
  let captured: { method?: string | undefined; url?: string | undefined; authorization?: string | undefined } = {}
  let status = 200
  const srv = await server((req, res) => {
    captured = { method: req.method, url: req.url, authorization: req.headers.authorization }
    res.writeHead(status).end()
  })
  try {
    const machine = { url: srv.url, key: 'd1.sekret', door: `${srv.url}/_devices/enter` }
    assert.equal(await leaveRemote(machine), true)
    assert.deepEqual(captured, { method: 'DELETE', url: '/_devices/enter', authorization: 'Bearer d1.sekret' })
    status = 401
    assert.equal(await leaveRemote(machine), false)
    assert.equal(await leaveRemote({ url: 'http://127.0.0.1:1', key: 'k', door: 'http://127.0.0.1:1/_devices/enter' }), false)
  } finally {
    await srv.close()
  }
})

test('RelayedAgents says whether a run is still at work on a machine, and reads the kept runs with a new key', async () => {
  let release: (() => void) | undefined
  const srv = await server((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' })
    res.write(`${JSON.stringify({ kind: 'session-update', sessionId: 's' })}\n`)
    release = () => res.end()
  })
  const agents = new RelayedAgents()
  try {
    assert.equal(agents.working(srv.url), false)
    agents.register('r1', { url: srv.url, key: 'd1.old', project: PROJECT }, stubMeta('r1'), 'proj-1')
    assert.equal(agents.working(srv.url), true)
    assert.equal(agents.working('http://127.0.0.1:1'), false) // another machine
    for (let i = 0; i < 100 && !release; i++) await new Promise(r => setTimeout(r, 10))
    release!()
    await drainAgent(agents, 'r1')
    assert.equal(agents.working(srv.url), false) // its events ended: nothing is at work there
    // The run is kept for its reads; a machine added again answers for it with the new key.
    agents.rekey(srv.url, 'd2.new')
    agents.rekey('http://127.0.0.1:1', 'other')
    assert.deepEqual(agents.target('r1'), { url: srv.url, key: 'd2.new', project: PROJECT })
    // And with the key the machine is known by since then, when its new link named one.
    agents.rekey(srv.url, 'd3.newer', 'a-pin')
    assert.deepEqual(agents.target('r1'), { url: srv.url, key: 'd3.newer', pin: 'a-pin', project: PROJECT })
  } finally {
    agents.dispose()
    await srv.close()
  }
})

test('a machine is asked about a project with a GET, and asked to clone it with a POST that carries the sharing answer and the address as written', async () => {
  const calls: { method?: string | undefined; url?: string | undefined; authorization?: string | undefined; origin?: string | undefined; body: unknown }[] = []
  let answer: unknown = { state: 'coming' }
  const srv = await server((req, res) => {
    let raw = ''
    req.on('data', c => (raw += c))
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, authorization: req.headers.authorization, origin: req.headers.origin, body: raw ? JSON.parse(raw) : null })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(answer))
    })
  })
  try {
    const target = { url: srv.url, key: 'd1.sekret', project: PROJECT }
    assert.deepEqual(await remoteProject(target, { share: true, from: 'github.com/Acme/Shop' }), { state: 'coming' })
    assert.deepEqual(calls[0], { method: 'POST', url: '/_relay/project', authorization: 'Bearer d1.sekret', origin: undefined, body: { project: PROJECT, share: true, from: 'github.com/Acme/Shop' } })
    answer = { state: 'there' }
    assert.deepEqual(await remoteProject(target), { state: 'there' })
    assert.deepEqual(calls[1], { method: 'GET', url: `/_relay/project?project=${encodeURIComponent(PROJECT)}`, authorization: 'Bearer d1.sekret', origin: undefined, body: null })
    // The machine's own words about a failure are passed on, cut to a length; an answer that says nothing readable is a failure too.
    answer = { state: 'failed', error: 'x'.repeat(5000) }
    const failed = await remoteProject(target)
    assert.equal(failed.state, 'failed')
    assert.equal((failed as { error: string }).error.length, 600)
    answer = { state: 'elsewhere' }
    assert.deepEqual(await remoteProject(target), { state: 'failed', error: 'the machine did not say why' })
  } finally {
    await srv.close()
  }
})

test('a machine that could not be asked about a project is told apart from one that failed: removed there, an older OpenAgent, unreachable', async () => {
  let status = 401
  const srv = await server((req, res) => {
    req.resume()
    res.writeHead(status).end()
  })
  const target = { url: srv.url, key: 'd1.gone', project: PROJECT }
  try {
    assert.deepEqual(await remoteProject(target, { share: false }), { state: 'unasked', error: 'this computer is no longer in on the machine: add the machine again, with a new link' })
    status = 404
    assert.deepEqual(await remoteProject(target), { state: 'unasked', error: 'it runs an older OpenAgent, which cannot clone a project by itself. Update it, or add the project there.' })
    status = 500
    assert.deepEqual(await remoteProject(target), { state: 'unasked', error: 'the machine refused (500)' })
  } finally {
    await srv.close()
  }
  const gone = await remoteProject(target)
  assert.equal(gone.state, 'unasked')
  assert.match((gone as { error: string }).error, /^could not reach the machine: /)
})

test('a machine\'s stream stays open after its run ended: the run\'s own state says whether it works, and a run that was continued works again', () => {
  const at = '2026-10-13T00:00:00.000Z'
  let row = stubMeta('r1')
  row = foldRelayedEvent(row, { kind: 'end', ok: false, waiting: true } as OpenAgentEvent, at)
  assert.deepEqual([row.status, row.endedAt], ['waiting', at])
  // The person answered: the run's next leg starts as its first did.
  row = foldRelayedEvent(row, { kind: 'driver', event: { type: 'start', prompt: 'go on' } } as unknown as OpenAgentEvent, at)
  assert.deepEqual([row.status, row.endedAt], ['running', undefined])
  row = foldRelayedEvent(row, { kind: 'end', ok: true } as OpenAgentEvent, at)
  assert.equal(row.status, 'done')
})

test('a run followed by its record is kept by its project, does not hold its machine, and only so many are followed at once', async () => {
  const open: ServerResponse[] = []
  const srv = await server((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' })
    open.push(res)
  })
  const agents = new RelayedAgents()
  const target = { url: srv.url, key: 'd1.key', project: PROJECT }
  try {
    // Its record says it works. A record is a file anyone with the project can write: the machine can still be removed.
    agents.register('f0', target, stubMeta('f0'), 'proj-1', false)
    assert.equal(agents.working(srv.url), false)
    // A run this computer sent there does hold it, while it works.
    agents.register('sent', target, stubMeta('sent'), 'proj-1')
    assert.equal(agents.working(srv.url), true)

    // Kept as a run of its project: under another project's name it is no run this daemon follows.
    assert.deepEqual(agents.target('f0', 'proj-1'), target)
    assert.equal(agents.target('f0', 'proj-2'), undefined)
    assert.equal(agents.get('f0', 'proj-2'), undefined)
    assert.equal(agents.follows('f0', 'proj-2'), false)
    assert.equal(agents.follows('f0', 'proj-1'), true)

    // A run this computer sent stays one it sent when it is followed again by its record: it still holds its machine.
    agents.register('sent', target, stubMeta('sent'), 'proj-1', false)
    assert.equal(agents.isSent('sent'), true)
    assert.equal(agents.isSent('f0'), false)
    assert.equal(agents.working(srv.url), true)

    // Twenty at once: the oldest makes room, and is read by its record again. A run this computer sent is never dropped.
    for (let i = 1; i <= 20; i++) agents.register(`f${i}`, target, stubMeta(`f${i}`), 'proj-1', false)
    assert.equal(agents.follows('f0'), false)
    assert.equal(agents.target('f0'), undefined)
    assert.equal(agents.follows('f1'), true)
    assert.equal(agents.follows('sent'), true)
    assert.equal(agents.list('proj-1').length, 21)

    // A line that drops says nothing of a run followed by its record: it is forgotten, and its record says how it stands.
    // A run this computer sent has no record to fall back on: it is kept, and reads as stopped.
    for (let i = 0; i < 200 && open.length < 23; i++) await new Promise(r => setTimeout(r, 10))
    for (const res of open.splice(0)) res.end()
    for (let i = 0; i < 200 && agents.follows('sent'); i++) await new Promise(r => setTimeout(r, 10))
    for (let i = 0; i < 200 && agents.target('f20') !== undefined; i++) await new Promise(r => setTimeout(r, 10))
    assert.deepEqual(agents.list('proj-1').map(row => [row.id, row.status]), [['sent', 'stopped']])
    assert.deepEqual(agents.target('sent', 'proj-1'), target)

    // A machine added again has not said its name yet: the runs followed by their records are let go, the sent ones get the new key.
    agents.register('again', target, stubMeta('again'), 'proj-1', false)
    agents.rekey(srv.url, 'd2.new')
    assert.equal(agents.target('again'), undefined)
    assert.deepEqual(agents.target('sent'), { ...target, key: 'd2.new' })
  } finally {
    agents.dispose()
    for (const res of open) res.end()
    await srv.close()
  }
})

test('the id a machine lists this computer under is the word of its key before the dot, and nothing of a key of another shape', () => {
  assert.equal(deviceIdOf('a1b2c3d4e5f6.Zm9vYmFyLXNlY3JldA'), 'a1b2c3d4e5f6')
  // No dot, nothing before it, or what no door makes as an id: no id, so no part of a secret is ever told as one.
  for (const key of ['Zm9vYmFyLXNlY3JldA', '.secret', 'd1.key', 'UPPERCASE12.secret', 'a1b2c3-d4e5f6.secret', `${'a'.repeat(33)}.secret`, '']) assert.equal(deviceIdOf(key), undefined, key)
})

test('machineCall asks a machine-wide function by the relay, so a computer reached through a server is asked as the server is', async () => {
  // A server's door passes `<via>/<id>/_relay/…` down a computer's line, and a line carries nothing but
  // the relay: the computer's own OpenAgent is asked at the same relay path as a server's is.
  const asked: { path: string; key?: string; fn: string; args: unknown[] }[] = []
  const via = '/_devices/via/8687ab858ef6'
  const relay = await server((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    const own = path.startsWith(via) ? path.slice(via.length) : path
    void handleRelayRequest(req, res, own, {
      project: async () => undefined,
      start: async () => ({ ok: false, error: 'no' }),
      tailEvents: () => () => {},
      machine: async (fn, args) => (asked.push({ path, ...(req.headers.authorization ? { key: req.headers.authorization } : {}), fn, args }), { ok: true, logins: [] }),
    })
  })
  try {
    for (const url of [relay.url, `${relay.url}${via}`]) {
      assert.deepEqual(await machineCall({ url, key: 'k1' }, 'onCopiedLogins', []), { ok: true, ret: { ok: true, logins: [] } }, url)
    }
    assert.deepEqual(await machineCall({ url: relay.url, key: 'k1' }, 'sendCopiedLogin', [{ kind: 'git', source: 'me' }, 'token']), { ok: true, ret: { ok: true, logins: [] } })
    assert.deepEqual(asked, [
      { path: '/_relay/machine', key: 'Bearer k1', fn: 'onCopiedLogins', args: [] },
      { path: `${via}/_relay/machine`, key: 'Bearer k1', fn: 'onCopiedLogins', args: [] },
      { path: '/_relay/machine', key: 'Bearer k1', fn: 'sendCopiedLogin', args: [{ kind: 'git', source: 'me' }, 'token'] },
    ])
  } finally {
    await relay.close()
  }
})
