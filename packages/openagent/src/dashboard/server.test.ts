import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { get, request } from 'node:http'
import { connect } from 'node:net'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDashboard, type Dashboard, type DashboardOptions } from './server.js'
import { isExpectedHost, isSameOriginRequest } from './rpc-serve.js'
import { testDashboardOptions } from '../dashboard-rpc/test-context.js'
import type { OpenAgentEvent } from '../events.js'
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

// Like fetchText, but with an optional Cookie header and the response's Set-Cookie / Location back.
function fetchAuth(
  url: string,
  cookie?: string,
): Promise<{ status: number; body: string; setCookie?: string | undefined; location?: string | undefined }> {
  return new Promise((resolvePromise, rejectPromise) => {
    get(url, { headers: cookie ? { cookie } : {} }, res => {
      let body = ''
      res.on('data', c => (body += c))
      res.on('end', () =>
        resolvePromise({
          status: res.statusCode ?? 0,
          body,
          setCookie: res.headers['set-cookie']?.[0],
          location: res.headers.location,
        }),
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

// The shared token (#1051): a real base64url token, matching what the registry generates.
const TOKEN = 'zX2p8Q0hqk3m9tR7vN1cW4bY6sJ5aL0dFgHiKlMnOp'

// The guard triggers on the token being configured, not on the bind host (a non-loopback bind is
// exactly what configures one). Binding loopback with the token set exercises every guard path
// without an external bind that could trip the OS firewall in an automated agent; the true two-daemon
// non-loopback drive is noted as a follow-up in the PR.
async function guardedDashboard(): Promise<{ base: string; close: () => Promise<void> }> {
  const bundle = await fakeBundle()
  const dash = await dashboard({ clientBundleDir: bundle, token: TOKEN })
  return {
    base: dash.url,
    close: async () => {
      await dash.close()
      await rm(bundle, { recursive: true, force: true })
    },
  }
}

test('with a token set, every route is 401 without a cookie or ?token= (#1051)', async () => {
  const { base, close } = await guardedDashboard()
  try {
    // The static bundle and the RPC mount are fronted uniformly.
    for (const path of ['/', '/assets/app.js', '/_rpc/onProjects']) {
      const res = await fetchAuth(base + path)
      assert.equal(res.status, 401, `${path} should be 401`)
      assert.match(res.body, /unauthorized/)
    }
  } finally {
    await close()
  }
})

test('a valid ?token= sets the HttpOnly oa_daemon cookie and 302s to the clean path (#1051)', async () => {
  const { base, close } = await guardedDashboard()
  try {
    const res = await fetchAuth(`${base}/?token=${TOKEN}`)
    assert.equal(res.status, 302)
    assert.equal(res.location, '/') // the token is stripped from the redirect target
    assert.match(res.setCookie ?? '', /^oa_daemon=/)
    assert.match(res.setCookie ?? '', /HttpOnly/)
    // Lax, not Strict, so the cookie survives the redirect when the address is opened from a link elsewhere (#1052).
    assert.match(res.setCookie ?? '', /SameSite=Lax/)
    assert.match(res.setCookie ?? '', /Path=\//)
  } finally {
    await close()
  }
})

test('a wrong ?token= is 401, not admitted (timing-safe compare) (#1051)', async () => {
  const { base, close } = await guardedDashboard()
  try {
    const sameLength = await fetchAuth(`${base}/?token=${'a'.repeat(TOKEN.length)}`)
    assert.equal(sameLength.status, 401)
    const shorter = await fetchAuth(`${base}/?token=nope`)
    assert.equal(shorter.status, 401)
  } finally {
    await close()
  }
})

test('the oa_daemon cookie admits the bundle and /_rpc (#1051)', async () => {
  const { base, close } = await guardedDashboard()
  try {
    const cookie = `oa_daemon=${TOKEN}`
    const root = await fetchAuth(`${base}/`, cookie)
    assert.equal(root.status, 200)
    assert.match(root.body, /<div id="root">/)
    // Not 401 is the guard passing; the mount then answers on its own terms.
    const rpc = await fetchAuth(`${base}/_rpc/onProjects`, cookie)
    assert.notEqual(rpc.status, 401)
  } finally {
    await close()
  }
})

test('a loopback bind sets no token, so the gate is a no-op (byte-identical) (#1051)', async () => {
  const bundle = await fakeBundle()
  const dash = await dashboard({ clientBundleDir: bundle }) // no token
  try {
    const res = await fetchAuth(dash.url + '/') // no cookie, no ?token=
    assert.equal(res.status, 200)
    assert.match(res.body, /<div id="root">/)
  } finally {
    await dash.close()
    await rm(bundle, { recursive: true, force: true })
  }
})

// A POST with an optional Cookie header, returning the status + body.
function postAuth(url: string, body: string, cookie?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } }, res => {
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
function readNdjson(url: string, cookie: string, count: number): Promise<{ status: number; lines: unknown[] }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = get(url, { headers: { cookie } }, res => {
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

// A guarded dashboard wired for the machine relay (#1067): a stub start that records its calls, and
// an events tail backed by a fixed list. Mirrors what the daemon wires, minus a real spawn. It has
// one project, cloned from {@link SHOP}.
async function relayDashboard(opts: { token?: string | undefined } = { token: TOKEN }): Promise<{
  base: string
  starts: Array<{ prompt: string; options: StartAgentOptions; projectId?: string }>
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
  const dash = await dashboard({ clientBundleDir: bundle, ...(opts.token ? { token: opts.token } : {}), onStart, relay: { project, tailEvents, rpc } })
  return {
    base: dash.url,
    starts,
    close: async () => {
      await dash.close()
      await rm(bundle, { recursive: true, force: true })
    },
  }
}

test('/_relay/start needs the cookie: 401 without it, starts the run with it (#1067)', async () => {
  const { base, starts, close } = await relayDashboard()
  try {
    const body = JSON.stringify({ prompt: 'do it', options: { model: 'opus' }, project: SHOP })
    const unauth = await postAuth(`${base}/_relay/start`, body)
    assert.equal(unauth.status, 401) // the shared-token guard (#1051) fronts the relay too
    assert.equal(starts.length, 0)

    const ok = await postAuth(`${base}/_relay/start`, body, `oa_daemon=${TOKEN}`)
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
      const res = await postAuth(`${base}/_relay/start`, JSON.stringify({ prompt: 'do it', options: {}, project }), `oa_daemon=${TOKEN}`)
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

test('/_relay/rpc runs the call in the project it names, and answers 404 for one this machine does not have', async () => {
  const { base, close } = await relayDashboard()
  try {
    const ok = await postAuth(`${base}/_relay/rpc`, JSON.stringify({ fn: 'onGitStatus', args: ['callers-id', 'r1'], project: SHOP }), `oa_daemon=${TOKEN}`)
    assert.equal(ok.status, 200)
    assert.deepEqual(JSON.parse(ok.body), { result: { projectId: SHOP_ID, fn: 'onGitStatus', args: ['callers-id', 'r1'] } })
    const other = await postAuth(`${base}/_relay/rpc`, JSON.stringify({ fn: 'onGitStatus', args: [], project: 'github.com/acme/other' }), `oa_daemon=${TOKEN}`)
    assert.equal(other.status, 404)
    const none = await postAuth(`${base}/_relay/rpc`, JSON.stringify({ fn: 'onGitStatus', args: [] }), `oa_daemon=${TOKEN}`)
    assert.equal(none.status, 404)
  } finally {
    await close()
  }
})

test('/_relay/start strips a nested machine so a relayed run never relays onward (#1067)', async () => {
  const { base, starts, close } = await relayDashboard()
  try {
    const body = JSON.stringify({ prompt: 'x', options: { machine: 'http://evil', model: 'opus' }, project: SHOP })
    const ok = await postAuth(`${base}/_relay/start`, body, `oa_daemon=${TOKEN}`)
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
    const ok = await postAuth(`${base}/_relay/start`, body, `oa_daemon=${TOKEN}`)
    assert.equal(ok.status, 200)
    assert.equal(starts.length, 1)
    assert.equal('base' in starts[0]!.options, false) // the caller's branch was dropped
    assert.equal(starts[0]!.options.model, 'opus') // the rest of the options survive
  } finally {
    await close()
  }
})

test('/_relay/events needs the cookie and streams the run\'s events as ndjson (#1067)', async () => {
  const { base, close } = await relayDashboard()
  try {
    const events = `${base}/_relay/events?run=srv-run&project=${encodeURIComponent(SHOP)}`
    const unauth = await fetchAuth(events)
    assert.equal(unauth.status, 401)

    const streamed = await readNdjson(events, `oa_daemon=${TOKEN}`, 2)
    assert.equal(streamed.status, 200)
    assert.deepEqual(streamed.lines.map(l => (l as { sessionId?: string }).sessionId), ['e1', 'e2'])

    // A project this machine does not have, or none named, has no run to stream.
    assert.equal((await fetchAuth(`${base}/_relay/events?run=srv-run&project=github.com%2Facme%2Fother`, `oa_daemon=${TOKEN}`)).status, 404)
    assert.equal((await fetchAuth(`${base}/_relay/events?run=srv-run`, `oa_daemon=${TOKEN}`)).status, 404)
  } finally {
    await close()
  }
})

test('/_relay/ping is 401 without the cookie, 200 with it, and starts nothing (#1072)', async () => {
  const { base, starts, close } = await relayDashboard()
  try {
    const unauth = await fetchAuth(`${base}/_relay/ping`)
    assert.equal(unauth.status, 401) // the shared-token guard (#1051) fronts the ping too

    const ok = await fetchAuth(`${base}/_relay/ping`, `oa_daemon=${TOKEN}`)
    assert.equal(ok.status, 200)
    assert.equal(ok.body, '') // an empty body: it only proves reachability
    assert.equal(starts.length, 0) // a health check must never spawn a run
  } finally {
    await close()
  }
})

// On a loopback bind the shared-token guard is off (#1051), so the relay carries the RPC mount's
// own CSRF + DNS-rebinding guard — without it a page the user merely visits could POST /_relay/start.
test('a loopback relay rejects a cross-origin POST and a rebound Host, and starts nothing', async () => {
  const { base, starts, close } = await relayDashboard({ token: undefined })
  try {
    const body = JSON.stringify({ prompt: 'do it', options: { model: 'opus' }, project: SHOP })

    const crossOrigin = await postCrossOrigin(`${base}/_relay/start`)
    assert.equal(crossOrigin.status, 403) // an Origin that is not this server: CSRF
    const rebound = await postRebound(`${base}/_relay/start`)
    assert.equal(rebound.status, 403) // same-origin to the browser, but the Host names evil.com
    assert.equal(starts.length, 0) // neither reached the spawn

    // The real machine caller sends no Origin and a loopback Host, so it still passes.
    const ok = await postAuth(`${base}/_relay/start`, body)
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

test('isExpectedHost: on a loopback bind only a loopback Host passes (DNS rebinding)', () => {
  const req = (headers: Record<string, string>): IncomingMessage => ({ headers } as IncomingMessage)
  const bound = '127.0.0.1'
  assert.equal(isExpectedHost(req({ host: '127.0.0.1:4200' }), bound), true)
  assert.equal(isExpectedHost(req({ host: 'localhost:4200' }), bound), true)
  assert.equal(isExpectedHost(req({ host: '[::1]:4200' }), bound), true) // the port split must not eat the IPv6 colons
  assert.equal(isExpectedHost(req({ host: 'evil.com' }), bound), false) // rebound: resolves here, names someone else
  assert.equal(isExpectedHost(req({ host: 'evil.com:4200' }), bound), false)
  // A registrable name that merely starts with `127.` is a rebound name, not a loopback address:
  // it can resolve to 127.0.0.1, so it must be rejected like any other rebound Host.
  assert.equal(isExpectedHost(req({ host: '127.evil.com' }), bound), false)
  assert.equal(isExpectedHost(req({ host: '127.0.0.1.evil.com:4200' }), bound), false)
  assert.equal(isExpectedHost(req({}), bound), false) // HTTP/1.1 requires Host; every browser sends it

  // A non-loopback bind is reached by a name we cannot predict, so there is nothing to check
  // against — that case gates behind the shared token (#1051) instead. The relay passes no host.
  assert.equal(isExpectedHost(req({ host: 'evil.com' }), '0.0.0.0'), true)
  assert.equal(isExpectedHost(req({ host: 'dash.example.com' }), undefined), true)

  // The bound address itself passes even when it is not one of the loopback spellings.
  assert.equal(isExpectedHost(req({ host: 'localhost:4200' }), 'localhost'), true)
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
