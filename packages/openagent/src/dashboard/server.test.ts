import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { get, request } from 'node:http'
import { connect } from 'node:net'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDashboard, type Dashboard, type DashboardOptions } from './server.js'
import { isExpectedHost, isSameOriginRequest } from './rpc-serve.js'
import { testDashboardOptions } from '../dashboard-rpc/test-context.js'
import type { OpenAgentEvent } from '../events.js'
import { openagentVersion } from '../version.js'
import type { StartAgentOptions, StartAgentResult } from './types.js'
import type { IncomingMessage } from 'node:http'
import { EXPECTED_EXTENSION_VERSION, EXTENSION_VERSION_HEADER } from './bridge-endpoints.js'
import { resetBridgeStarts } from './bridge-starts.js'
import { resetBridgeQuestions } from './bridge-store.js'

/** Start a dashboard the way the daemon does (D3), with only the parts a test cares about overridden. */
function dashboard(over: Partial<DashboardOptions> = {}): Promise<Dashboard> {
  return startDashboard(testDashboardOptions(over))
}

function fetchText(url: string): Promise<{ status: number; body: string; type: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    get(url, res => {
      let body = ''
      res.on('data', c => (body += c))
      res.on('end', () =>
        resolvePromise({ status: res.statusCode ?? 0, body, type: String(res.headers['content-type'] ?? '') }),
      )
    }).on('error', rejectPromise)
  })
}

/** Send a raw request line over a socket — for request targets `http.get` refuses to send. */
function rawRequest(url: string, requestLine: string): Promise<string> {
  const port = Number(new URL(url).port)
  return new Promise((resolvePromise, rejectPromise) => {
    const sock = connect(port, '127.0.0.1', () => {
      sock.write(`${requestLine}\r\nHost: x\r\nConnection: close\r\n\r\n`)
    })
    let data = ''
    sock.on('data', c => (data += c))
    sock.on('close', () => resolvePromise(data))
    sock.on('error', rejectPromise)
    sock.setTimeout(5000, () => sock.destroy())
  })
}

// A cross-origin POST: an `Origin` header for a host that is not this server.
function postCrossOrigin(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = request(url, { method: 'POST', headers: { origin: 'http://evil.com', 'content-type': 'application/json' } }, res => {
      let body = ''
      res.on('data', c => (body += c))
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', rejectPromise)
    req.end('{}')
  })
}

/**
 * A POST as a DNS-rebinding attacker's page makes it: the browser resolved `evil.com` to
 * 127.0.0.1, so it believes the request is same-origin and sends a matching `Origin` — the
 * `Host` is the only header that still names who the page really is.
 */
function postRebound(url: string, host = 'evil.com'): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const headers = { host, origin: `http://${host}`, 'content-type': 'application/json' }
    const req = request(url, { method: 'POST', headers }, res => {
      let body = ''
      res.on('data', c => (body += c))
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', rejectPromise)
    req.end('{}')
  })
}

// A minimal built SPA bundle: an index.html shell + one hashed asset.
async function fakeBundle(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dash-bundle-'))
  await writeFile(join(dir, 'index.html'), '<!doctype html><html><body><div id="root"></div></body></html>')
  await mkdir(join(dir, 'assets'), { recursive: true })
  await writeFile(join(dir, 'assets', 'app.js'), 'console.log("app")')
  return dir
}

test('without a bundle the server reports the dashboard is not installed (503)', async () => {
  const dash = await dashboard()
  try {
    const { status, body } = await fetchText(dash.url + '/')
    assert.equal(status, 503)
    assert.match(body, /not installed/)
  } finally {
    await dash.close()
  }
})

test('serves the built SPA shell at / and hashed assets, with an SPA fallback', async () => {
  const bundle = await fakeBundle()
  const dash = await dashboard({ clientBundleDir: bundle })
  try {
    const root = await fetchText(dash.url + '/')
    assert.equal(root.status, 200)
    assert.match(root.body, /<div id="root">/)

    const asset = await fetchText(dash.url + '/assets/app.js')
    assert.equal(asset.status, 200)
    assert.match(asset.type, /javascript/)

    // An unknown client route falls back to the SPA shell (client-side routing).
    const deep = await fetchText(dash.url + '/some/client/route')
    assert.equal(deep.status, 200)
    assert.match(deep.body, /<div id="root">/)
  } finally {
    await dash.close()
    await rm(bundle, { recursive: true, force: true })
  }
})

test('a malformed percent-encoded path serves the SPA shell and the server survives (#938)', async () => {
  const bundle = await fakeBundle()
  const dash = await dashboard({ clientBundleDir: bundle })
  try {
    // `decodeURIComponent('/%zz')` throws; unguarded it is an unhandled rejection that kills the process.
    const bad = await fetchText(dash.url + '/%zz')
    assert.equal(bad.status, 200)
    assert.match(bad.body, /<div id="root">/)

    // The server is still alive and serving afterwards.
    const after = await fetchText(dash.url + '/assets/app.js')
    assert.equal(after.status, 200)
  } finally {
    await dash.close()
    await rm(bundle, { recursive: true, force: true })
  }
})

test('an unparseable absolute-form request target gets a 400 and the server survives (#938)', async () => {
  const bundle = await fakeBundle()
  const dash = await dashboard({ clientBundleDir: bundle })
  try {
    // Node's parser passes absolute-form targets through verbatim; `new URL('http://[', ...)`
    // throws synchronously in the request handler, which unguarded kills the process.
    const raw = await rawRequest(dash.url, 'GET http://[ HTTP/1.1')
    assert.match(raw, /^HTTP\/1\.1 400 /)

    const after = await fetchText(dash.url + '/')
    assert.equal(after.status, 200)
  } finally {
    await dash.close()
    await rm(bundle, { recursive: true, force: true })
  }
})

test('the files of the computer\'s modules are served with no project added, and the SPA shell is not what answers for one that is none', async () => {
  const bundle = await fakeBundle()
  const dash = await dashboard({ clientBundleDir: bundle })
  try {
    const module = await fetch(dash.url + '/_computer-modules/%40openagt%2Fremote-access/dashboard.js')
    assert.equal(module.status, 200)
    assert.match(module.headers.get('content-type') ?? '', /javascript/)
    assert.match(await module.text(), /export/)
    assert.equal((await fetch(dash.url + '/_computer-modules/%40openagt%2Ffiles/dashboard.js')).status, 404)
  } finally {
    await dash.close()
    await rm(bundle, { recursive: true, force: true })
  }
})

test('the RPC mount rejects a cross-origin POST (CSRF guard)', async () => {
  const bundle = await fakeBundle()
  const dash = await dashboard({ clientBundleDir: bundle })
  try {
    const { status, body } = await postCrossOrigin(dash.url + '/_rpc/onProjects')
    assert.equal(status, 403)
    assert.match(body, /cross-origin/)
  } finally {
    await dash.close()
    await rm(bundle, { recursive: true, force: true })
  }
})

test('the RPC mount rejects a rebound Host, which the Origin check alone lets through', async () => {
  const bundle = await fakeBundle()
  const dash = await dashboard({ clientBundleDir: bundle })
  try {
    // The attack: same-origin as far as the browser is concerned, so `isSameOriginRequest` passes it.
    const rebound = await postRebound(dash.url + '/_rpc/onProjects')
    assert.equal(rebound.status, 403)
    assert.match(rebound.body, /Host/)

    // The real thing still gets through: same request, but the Host the user actually typed.
    // It reaches the mount, which answers the call.
    const loopback = await postRebound(dash.url + '/_rpc/onProjects', new URL(dash.url).host)
    assert.notEqual(loopback.status, 403)
  } finally {
    await dash.close()
    await rm(bundle, { recursive: true, force: true })
  }
})

// A POST of JSON, returning the status + body.
/** A POST with headers of the caller's own. */
function postAs(url: string, body: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = request(url, { method: 'POST', headers }, res => {
      let b = ''
      res.on('data', c => (b += c))
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, body: b }))
    })
    req.on('error', rejectPromise)
    req.end(body)
  })
}

function postJson(url: string, body: string): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = request(url, { method: 'POST', headers: { 'content-type': 'application/json' } }, res => {
      let b = ''
      res.on('data', c => (b += c))
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, body: b }))
    })
    req.on('error', rejectPromise)
    req.end(body)
  })
}

// GET a newline-delimited event stream, collecting the first `count` lines then tearing the
// socket down (the endpoint follows forever, so it never ends on its own).
function readNdjson(url: string, count: number): Promise<{ status: number; lines: unknown[] }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = get(url, res => {
      if (res.statusCode !== 200) {
        res.resume()
        resolvePromise({ status: res.statusCode ?? 0, lines: [] })
        return
      }
      let buffer = ''
      const lines: unknown[] = []
      res.on('data', c => {
        buffer += c
        let nl = buffer.indexOf('\n')
        while (nl !== -1) {
          const line = buffer.slice(0, nl).trim()
          if (line) lines.push(JSON.parse(line))
          buffer = buffer.slice(nl + 1)
          nl = buffer.indexOf('\n')
        }
        if (lines.length >= count) {
          req.destroy()
          resolvePromise({ status: 200, lines })
        }
      })
      res.on('end', () => resolvePromise({ status: 200, lines }))
    })
    req.on('error', () => {}) // destroy() rejects the request; the lines are already resolved
    setTimeout(() => {
      req.destroy()
      rejectPromise(new Error('timed out reading ndjson'))
    }, 4000).unref?.()
  })
}

/** The project the relay tests name, by its repository's address, and this machine's own id for it. */
const SHOP = 'github.com/acme/shop'
const SHOP_ID = 'shop-here'

// A dashboard wired for the machine relay (#1067): a stub start that records its calls, and an
// events tail backed by a fixed list. Mirrors what the daemon wires, minus a real spawn. It has
// one project, cloned from {@link SHOP}. A machine's call reaches it as this computer's own
// would: what lets a machine in is not the dashboard's, and has passed the call on already.
async function relayDashboard(): Promise<{
  base: string
  starts: Array<{ prompt: string; options: StartAgentOptions; projectId?: string }>
  brought: Array<{ address: string; bring?: unknown }>
  close: () => Promise<void>
}> {
  const bundle = await fakeBundle()
  const starts: Array<{ prompt: string; options: StartAgentOptions; projectId?: string }> = []
  const onStart = (prompt: string, options: StartAgentOptions, projectId?: string): StartAgentResult => {
    starts.push({ prompt, options, ...(projectId ? { projectId } : {}) })
    return { ok: true, agentId: 'srv-run' }
  }
  const events: OpenAgentEvent[] = [
    { kind: 'session-update', sessionId: 'e1' } as OpenAgentEvent,
    { kind: 'session-update', sessionId: 'e2' } as OpenAgentEvent,
  ]
  const tailEvents = (projectId: string, _agentId: string, onEvent: (event: OpenAgentEvent) => void): (() => void) => {
    if (projectId === SHOP_ID) for (const e of events) onEvent(e)
    return () => {}
  }
  const project = async (address: string): Promise<string | undefined> => (address === SHOP ? SHOP_ID : undefined)
  const rpc = async (projectId: string, fn: string, args: unknown[]): Promise<unknown> => ({ projectId, fn, args })
  const brought: Array<{ address: string; bring?: unknown }> = []
  const bring = async (address: string, how?: { share: boolean; from?: string }): Promise<{ state: 'there' | 'coming' | 'missing' }> => {
    brought.push({ address, ...(how ? { bring: how } : {}) })
    return { state: address === SHOP ? 'there' : how ? 'coming' : 'missing' }
  }
  const dash = await dashboard({ clientBundleDir: bundle, onStart, relay: { project, tailEvents, rpc, bring } })
  return {
    base: dash.url,
    starts,
    brought,
    close: async () => {
      await dash.close()
      await rm(bundle, { recursive: true, force: true })
    },
  }
}

test('/_relay/start starts the run in the project the call names (#1067)', async () => {
  const { base, starts, close } = await relayDashboard()
  try {
    const body = JSON.stringify({ prompt: 'do it', options: { model: 'opus' }, project: SHOP })
    const ok = await postJson(`${base}/_relay/start`, body)
    assert.equal(ok.status, 200)
    assert.deepEqual(JSON.parse(ok.body), { ok: true, agentId: 'srv-run' })
    assert.equal(starts.length, 1)
    assert.equal(starts[0]!.prompt, 'do it')
    assert.equal(starts[0]!.projectId, SHOP_ID) // in this machine's own project cloned from that address
  } finally {
    await close()
  }
})

test('/_relay/start starts nothing for a project this machine does not have, or for none named', async () => {
  const { base, starts, close } = await relayDashboard()
  try {
    for (const project of ['github.com/acme/other', undefined, 7]) {
      const res = await postJson(`${base}/_relay/start`, JSON.stringify({ prompt: 'do it', options: {}, project }))
      assert.equal(res.status, 200)
      const answer = JSON.parse(res.body) as { ok: boolean; noProject?: boolean }
      assert.equal(answer.ok, false)
      assert.equal(answer.noProject, true) // said apart from any other refusal, so the caller can name the project
    }
    assert.equal(starts.length, 0) // and never in some other project of this machine
  } finally {
    await close()
  }
})

test('/_relay/project says where a project stands with a GET, and has it cloned with a POST; a call that names none is refused', async () => {
  const { base, brought, starts, close } = await relayDashboard()
  try {
    const other = 'github.com/acme/other'
    const read = await fetchText(`${base}/_relay/project?project=${encodeURIComponent(other)}`)
    assert.equal(read.status, 200)
    assert.deepEqual(JSON.parse(read.body), { state: 'missing' })
    const asked = await postJson(`${base}/_relay/project`, JSON.stringify({ project: other, share: true, from: 'github.com/Acme/Other', more: 'dropped' }))
    assert.equal(asked.status, 200)
    assert.deepEqual(JSON.parse(asked.body), { state: 'coming' })
    // Anything but a plain yes on the records is a no, and a spelling that is no text is not passed on.
    await postJson(`${base}/_relay/project`, JSON.stringify({ project: other, share: 'yes', from: 7 }))
    assert.deepEqual(brought, [{ address: other }, { address: other, bring: { share: true, from: 'github.com/Acme/Other' } }, { address: other, bring: { share: false } }])
    assert.deepEqual(JSON.parse((await fetchText(`${base}/_relay/project?project=${encodeURIComponent(SHOP)}`)).body), { state: 'there' })

    assert.equal((await fetchText(`${base}/_relay/project`)).status, 400)
    assert.equal((await postJson(`${base}/_relay/project`, JSON.stringify({ share: true }))).status, 400)
    assert.equal((await postJson(`${base}/_relay/project`, JSON.stringify({ project: 'x'.repeat(600) }))).status, 400)
    assert.equal((await postJson(`${base}/_relay/project`, 'null')).status, 400)
    assert.equal(brought.length, 4)
    assert.equal(starts.length, 0) // asking for a project starts no run
  } finally {
    await close()
  }
})

test('/_relay/rpc runs the call in the project it names, and answers 404 for one this machine does not have', async () => {
  const { base, close } = await relayDashboard()
  try {
    const ok = await postJson(`${base}/_relay/rpc`, JSON.stringify({ fn: 'onGitStatus', args: ['callers-id', 'r1'], project: SHOP }))
    assert.equal(ok.status, 200)
    assert.deepEqual(JSON.parse(ok.body), { result: { projectId: SHOP_ID, fn: 'onGitStatus', args: ['callers-id', 'r1'] } })
    const other = await postJson(`${base}/_relay/rpc`, JSON.stringify({ fn: 'onGitStatus', args: [], project: 'github.com/acme/other' }))
    assert.equal(other.status, 404)
    const none = await postJson(`${base}/_relay/rpc`, JSON.stringify({ fn: 'onGitStatus', args: [] }))
    assert.equal(none.status, 404)
  } finally {
    await close()
  }
})

test('/_relay/start strips a nested machine so a relayed run never relays onward (#1067)', async () => {
  const { base, starts, close } = await relayDashboard()
  try {
    const body = JSON.stringify({ prompt: 'x', options: { machine: 'http://evil', model: 'opus' }, project: SHOP })
    const ok = await postJson(`${base}/_relay/start`, body)
    assert.equal(ok.status, 200)
    assert.equal(starts[0]!.options.machine, undefined) // the onward target was dropped
    assert.equal(starts[0]!.options.model, 'opus') // the rest of the options survive
  } finally {
    await close()
  }
})

test('/_relay/start drops the branch to start from: a start relayed to a machine never names a branch', async () => {
  const { base, starts, close } = await relayDashboard()
  try {
    const body = JSON.stringify({ prompt: 'x', options: { base: 'a-branch-of-the-caller', model: 'opus' }, project: SHOP })
    const ok = await postJson(`${base}/_relay/start`, body)
    assert.equal(ok.status, 200)
    assert.equal(starts.length, 1)
    assert.equal('base' in starts[0]!.options, false) // the caller's branch was dropped
    assert.equal(starts[0]!.options.model, 'opus') // the rest of the options survive
  } finally {
    await close()
  }
})

test('/_relay/events streams the run\'s events as ndjson (#1067)', async () => {
  const { base, close } = await relayDashboard()
  try {
    const events = `${base}/_relay/events?run=srv-run&project=${encodeURIComponent(SHOP)}`
    const streamed = await readNdjson(events, 2)
    assert.equal(streamed.status, 200)
    assert.deepEqual(streamed.lines.map(l => (l as { sessionId?: string }).sessionId), ['e1', 'e2'])

    // A project this machine does not have, or none named, has no run to stream.
    assert.equal((await fetchText(`${base}/_relay/events?run=srv-run&project=github.com%2Facme%2Fother`)).status, 404)
    assert.equal((await fetchText(`${base}/_relay/events?run=srv-run`)).status, 404)
  } finally {
    await close()
  }
})

test('/_relay/ping answers 200 with this OpenAgent\'s version and starts nothing (#1072)', async () => {
  const { base, starts, close } = await relayDashboard()
  try {
    const ok = await fetchText(`${base}/_relay/ping`)
    assert.equal(ok.status, 200)
    assert.deepEqual(JSON.parse(ok.body), { version: openagentVersion() }) // what a machine that added this one reads whether it fell behind by
    assert.equal(starts.length, 0) // a health check must never spawn a run
  } finally {
    await close()
  }
})

test('the dashboard listens on this computer\'s own address only: nothing answers at its address on a network', async () => {
  const bundle = await fakeBundle()
  const dash = await dashboard({ clientBundleDir: bundle })
  try {
    assert.match(dash.url, /^http:\/\/127\.0\.0\.1:\d+$/)
    const port = new URL(dash.url).port
    const onNetwork = Object.values(networkInterfaces()).flatMap(list => list ?? []).find(info => info.family === 'IPv4' && !info.internal)
    // A computer on no network has no such address to try.
    if (onNetwork) await assert.rejects(fetchText(`http://${onNetwork.address}:${port}/`))
  } finally {
    await dash.close()
    await rm(bundle, { recursive: true, force: true })
  }
})

// The relay carries the RPC mount's own CSRF + DNS-rebinding guard — without it a page the user
// merely visits could POST /_relay/start.
test('the relay rejects a cross-origin POST, a rebound Host and a changing call that is not JSON, and starts and clones nothing', async () => {
  const { base, starts, brought, close } = await relayDashboard()
  try {
    const body = JSON.stringify({ prompt: 'do it', options: { model: 'opus' }, project: SHOP })

    const crossOrigin = await postCrossOrigin(`${base}/_relay/start`)
    assert.equal(crossOrigin.status, 403) // an Origin that is not this server: CSRF
    const rebound = await postRebound(`${base}/_relay/start`)
    assert.equal(rebound.status, 403) // same-origin to the browser, but the Host names evil.com
    assert.equal(starts.length, 0) // neither reached the spawn

    // A page another program serves on this computer passes the origin check, and a browser sends
    // its POST unasked while the body is not said to be JSON: such a call is refused, whatever it holds.
    for (const path of ['/_relay/start', '/_relay/project', '/_relay/rpc']) {
      const plain = await postAs(`${base}${path}`, JSON.stringify({ prompt: 'x', options: {}, project: 'github.com/evil/x', share: true }), { origin: 'http://localhost:5173', 'content-type': 'text/plain' })
      assert.equal(plain.status, 403, path)
    }
    assert.equal(starts.length, 0)
    assert.deepEqual(brought, [])

    // A machine's call arrives with no Origin and a loopback Host, so it still passes.
    const ok = await postJson(`${base}/_relay/start`, body)
    assert.equal(ok.status, 200)
    assert.equal(starts.length, 1)
  } finally {
    await close()
  }
})

test('isSameOriginRequest: absent Origin passes; same host + loopback pass; evil.com fails', () => {
  const req = (headers: Record<string, string>): IncomingMessage => ({ headers } as IncomingMessage)
  assert.equal(isSameOriginRequest(req({})), true) // no Origin (curl / tests)
  assert.equal(isSameOriginRequest(req({ host: 'localhost:4200', origin: 'http://localhost:4200' })), true)
  assert.equal(isSameOriginRequest(req({ origin: 'http://127.0.0.1:9999' })), true)
  assert.equal(isSameOriginRequest(req({ origin: 'http://[::1]' })), true)
  assert.equal(isSameOriginRequest(req({ host: 'localhost:4200', origin: 'http://evil.com' })), false)
  assert.equal(isSameOriginRequest(req({ origin: 'http://127.evil.com' })), false) // rebound name, not a loopback address
  assert.equal(isSameOriginRequest(req({ origin: 'not-a-url' })), false)
})

test('isExpectedHost: only a loopback Host passes (DNS rebinding)', () => {
  const req = (headers: Record<string, string>): IncomingMessage => ({ headers } as IncomingMessage)
  assert.equal(isExpectedHost(req({ host: '127.0.0.1:4200' })), true)
  assert.equal(isExpectedHost(req({ host: 'localhost:4200' })), true)
  assert.equal(isExpectedHost(req({ host: '[::1]:4200' })), true) // the port split must not eat the IPv6 colons
  assert.equal(isExpectedHost(req({ host: 'evil.com' })), false) // rebound: resolves here, names someone else
  assert.equal(isExpectedHost(req({ host: 'evil.com:4200' })), false)
  // A registrable name that merely starts with `127.` is a rebound name, not a loopback address:
  // it can resolve to 127.0.0.1, so it must be rejected like any other rebound Host.
  assert.equal(isExpectedHost(req({ host: '127.evil.com' })), false)
  assert.equal(isExpectedHost(req({ host: '127.0.0.1.evil.com:4200' })), false)
  // The computer's own address on a network is no loopback one: the dashboard does not listen there.
  assert.equal(isExpectedHost(req({ host: '192.168.1.5:4200' })), false)
  assert.equal(isExpectedHost(req({})), false) // HTTP/1.1 requires Host; every browser sends it
})

// The session start-queue end to end (#1328/#1697): what a web run posts on the run-facing route is
// what the extension is handed on the bridge route, the model included.
test('a web run\'s model reaches the extension through the start-queue (#1697)', async () => {
  resetBridgeStarts()
  resetBridgeQuestions()
  const bridgeToken = 'x'.repeat(43)
  const bundle = await fakeBundle()
  const dash = await dashboard({ clientBundleDir: bundle, bridgeToken })
  const asExtension = { authorization: `Bearer ${bridgeToken}`, [EXTENSION_VERSION_HEADER]: EXPECTED_EXTENSION_VERSION }
  try {
    // The extension must have spoken recently for the run's request to be taken at all.
    assert.equal((await fetch(`${dash.url}/_bridge/ping`, { headers: asExtension })).status, 200)
    const queued = await fetch(`${dash.url}/_web-start`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bridgeToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ repo: 'openagt/openagent', branch: 'cloud-1-abcd1234', prompt: 'Add the thing', model: 'sonnet' }),
    })
    assert.equal(queued.status, 202)
    const { id } = (await queued.json()) as { id: string }
    const claimed = await fetch(`${dash.url}/_bridge/start`, { headers: asExtension })
    assert.deepEqual(await claimed.json(), {
      start: { id, repo: 'openagt/openagent', branch: 'cloud-1-abcd1234', prompt: 'Add the thing', model: 'sonnet' },
    })
  } finally {
    await dash.close()
    await rm(bundle, { recursive: true, force: true })
    resetBridgeStarts()
    resetBridgeQuestions()
  }
})

// A run's live screen (screen.ts): watching is a plain GET, so the routes also read what a browser
// says of where a request comes from.
test('a screen is watched from this dashboard\'s own page only: another site\'s page, and the address bar, are turned away', async () => {
  const bundle = await fakeBundle()
  const dash = await dashboard({ clientBundleDir: bundle, screen: async () => undefined })
  const ask = (headers: Record<string, string>, path = '/_screen/stream?project=p&run=r'): Promise<number> =>
    new Promise((resolvePromise, rejectPromise) => {
      get(dash.url + path, { headers }, res => {
        res.resume()
        resolvePromise(res.statusCode ?? 0)
      }).on('error', rejectPromise)
    })
  try {
    // Let by, and answered that the run has no screen: this page's own fetch, and a caller that is no browser.
    assert.equal(await ask({}), 404)
    assert.equal(await ask({ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' }), 404)
    assert.equal(await ask({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' }), 403)
    assert.equal(await ask({ 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'no-cors' }), 403)
    assert.equal(await ask({ 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate' }), 403)
    assert.equal(await ask({ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate' }), 403)
    assert.equal(await ask({ origin: 'http://evil.com' }), 403)
    assert.equal(await ask({}, '/_screen/command?project=p&run=r'), 404)
  } finally {
    await dash.close()
    await rm(bundle, { recursive: true, force: true })
  }
})
