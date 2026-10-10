import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { startRemoteAgent, streamRemoteEvents, pingRemote, relayRpc, RelayedAgents, type RemoteTarget } from './remote-run.js'
import { type AgentMeta } from '../store/index.js'
import type { OpenAgentEvent } from '../events.js'

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

test('startRemoteAgent posts to /_relay/start with the oa_daemon cookie, no Origin, and the run body (#1067)', async () => {
  let captured: { method?: string | undefined; url?: string | undefined; cookie?: string | undefined; origin?: string | undefined; body: unknown } = { body: null }
  const srv = await server((req, res) => {
    let raw = ''
    req.on('data', c => (raw += c))
    req.on('end', () => {
      captured = { method: req.method, url: req.url, cookie: req.headers.cookie, origin: req.headers.origin, body: JSON.parse(raw) }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, agentId: 'r1' }))
    })
  })
  try {
    const result = await startRemoteAgent({ url: srv.url, token: 'sekret', project: PROJECT }, { prompt: 'do it', options: { model: 'opus' } })
    assert.deepEqual(result, { ok: true, agentId: 'r1' })
    assert.equal(captured.method, 'POST')
    assert.equal(captured.url, '/_relay/start')
    assert.equal(captured.cookie, 'oa_daemon=sekret') // the shared-token cookie (#1051), daemon to daemon
    assert.equal(captured.origin, undefined) // NO Origin header, so it passes the remote CSRF guard
    assert.deepEqual(captured.body, { prompt: 'do it', options: { model: 'opus' }, project: PROJECT }) // the project rides every start
  } finally {
    await srv.close()
  }
})

test('startRemoteAgent surfaces a non-2xx from the machine as an ok:false result (#1067)', async () => {
  const srv = await server((_req, res) => {
    res.writeHead(403, { 'content-type': 'text/plain' })
    res.end('unauthorized')
  })
  try {
    const result = await startRemoteAgent({ url: srv.url, token: 'wrong', project: PROJECT }, { prompt: 'x', options: {} })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /403|machine/)
  } finally {
    await srv.close()
  }
})

test('pingRemote GETs /_relay/ping with the oa_daemon cookie and is true on a 2xx (#1072)', async () => {
  let captured: { method?: string | undefined; url?: string | undefined; cookie?: string | undefined } = {}
  const srv = await server((req, res) => {
    captured = { method: req.method, url: req.url, cookie: req.headers.cookie }
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end()
  })
  try {
    assert.equal(await pingRemote({ url: srv.url, token: 'sekret' }), true)
    assert.equal(captured.method, 'GET')
    assert.equal(captured.url, '/_relay/ping')
    assert.equal(captured.cookie, 'oa_daemon=sekret') // the shared-token cookie (#1051), daemon to daemon
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
    assert.equal(await pingRemote({ url: srv.url, token: 'wrong' }), false)
  } finally {
    await srv.close()
  }
})

test('pingRemote is false when the machine is unreachable (#1072)', async () => {
  // A port nothing is listening on: the fetch rejects, which pingRemote swallows as offline.
  assert.equal(await pingRemote({ url: 'http://127.0.0.1:1', token: 't' }), false)
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
    const { events, ended } = await drain({ url: srv.url, token: 't', project: PROJECT }, 'r1')
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
    const { events } = await drain({ url: srv.url, token: 't', project: PROJECT }, 'r1')
    assert.deepEqual(events.map(e => (e as { sessionId?: string }).sessionId), ['split'])
  } finally {
    await srv.close()
  }
})

test('a 401 from the remote (rotated token) surfaces as a clean stream-end, no events (#1067)', async () => {
  const srv = await server((_req, res) => {
    res.writeHead(401, { 'content-type': 'text/plain' })
    res.end('unauthorized')
  })
  try {
    const { events, ended } = await drain({ url: srv.url, token: 'stale', project: PROJECT }, 'r1')
    assert.equal(events.length, 0)
    assert.equal(ended, true) // ended cleanly (a done), not an error the caller has to retry
  } finally {
    await srv.close()
  }
})

test('RelayedAgents feeds a run stream from the machine and drops its token when the stream ends (#1067)', async () => {
  const srv = await server((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' })
    res.write(`${JSON.stringify({ kind: 'session-update', sessionId: 'hi' })}\n`)
    res.end()
  })
  try {
    const agents = new RelayedAgents()
    agents.register('r1', { url: srv.url, token: 't', project: PROJECT }, stubMeta('r1'), 'proj-1')
    const stream = agents.get('r1') // grabbed synchronously, before the remote stream ends
    assert.ok(stream)
    const got: OpenAgentEvent[] = []
    for await (const e of stream!) got.push(e) // replays, then ends when the machine closes the body
    assert.deepEqual(got.map(e => (e as { sessionId?: string }).sessionId), ['hi'])
    assert.equal(agents.get('r1'), undefined) // dropped: the token no longer lives here
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
    agents.register('r1', { url: srv.url, token: 'stale', project: PROJECT }, stubMeta('r1'), 'proj-1')
    const stream = agents.get('r1')
    assert.ok(stream)
    const got: OpenAgentEvent[] = []
    for await (const e of stream!) got.push(e)
    assert.equal(got.length, 0) // a clean close, so the browser sees `done`, not `lost`
  } finally {
    await srv.close()
  }
})

test('relayRpc posts to /_relay/rpc with the oa_daemon cookie, no Origin, and returns the machine result (#1067 slice 2)', async () => {
  let captured: { method?: string | undefined; url?: string | undefined; cookie?: string | undefined; origin?: string | undefined; body: unknown } = { body: null }
  const srv = await server((req, res) => {
    let raw = ''
    req.on('data', c => (raw += c))
    req.on('end', () => {
      captured = { method: req.method, url: req.url, cookie: req.headers.cookie, origin: req.headers.origin, body: JSON.parse(raw) }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ result: { dirty: true, branch: 'main' } }))
    })
  })
  try {
    const result = await relayRpc({ url: srv.url, token: 'sekret', project: PROJECT }, 'onGitStatus', ['pid', 'r1'])
    assert.deepEqual(result, { dirty: true, branch: 'main' }) // the machine's own result, unwrapped from {result}
    assert.equal(captured.method, 'POST')
    assert.equal(captured.url, '/_relay/rpc')
    assert.equal(captured.cookie, 'oa_daemon=sekret') // the shared-token cookie (#1051), daemon to daemon
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
    await assert.rejects(relayRpc({ url: srv.url, token: 't', project: PROJECT }, 'onGitStatus', []), /500|machine/)
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
    agents.register('r1', { url: srv.url, token: 't', project: PROJECT }, stubMeta('r1', { intent: 'do it' }), 'proj-1')
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
    agents.register('r1', { url: srv.url, token: 't', project: PROJECT }, stubMeta('r1'), 'proj-1')
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
    agents.register('r1', { url: srv.url, token: 't', project: PROJECT }, stubMeta('r1'), 'proj-1')
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
    const target = { url: srv.url, token: 't', project: PROJECT }
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
