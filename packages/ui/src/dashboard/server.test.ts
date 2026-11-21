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
import type { IncomingMessage } from 'node:http'
import type { AppRoute } from '@openagt/hooks'

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
    const module = await fetch(dash.url + '/_computer-modules/%40openagt%2Fagent-driver/dashboard.js')
    assert.equal(module.status, 200)
    assert.match(module.headers.get('content-type') ?? '', /javascript/)
    assert.match(await module.text(), /export/)
    assert.equal((await fetch(dash.url + '/_computer-modules/%40openagt%2Fui-pane-files/dashboard.js')).status, 404)
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
  // A plain HTTP request's: its connection holds no certificate.
  const req = (headers: Record<string, string>): IncomingMessage => ({ headers, socket: {} } as IncomingMessage)
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

// The modules' routes (`app.route`, #2394): what a program of another origin calls a module on,
// a browser extension's calls host-claude-web's bridge.
test("a module's route answers its path and every path below it, after the dashboard's own, while the module is on (#2394)", async () => {
  const bundle = await fakeBundle()
  const answering = (name: string): AppRoute['handle'] => (req, res) => void res.writeHead(200, { 'content-type': 'text/plain' }).end(`${name} ${req.url}`)
  let routes: AppRoute[] = [
    { path: '/_bridge', handle: answering('bridge') },
    { path: '/_rpc', handle: answering('copycat') },
  ]
  const dash = await dashboard({ clientBundleDir: bundle, routes: async () => routes })
  try {
    assert.equal((await fetchText(`${dash.url}/_bridge`)).body, 'bridge /_bridge')
    assert.equal((await fetchText(`${dash.url}/_bridge/ping?at=1`)).body, 'bridge /_bridge/ping?at=1')
    // A path that merely begins with its name is another path: the dashboard's page, as any.
    assert.match((await fetchText(`${dash.url}/_bridges`)).body, /<div id="root">/)
    // The dashboard's own paths are its own, whatever a module says.
    assert.notEqual((await fetchText(`${dash.url}/_rpc/version`)).body, 'copycat /_rpc/version')
    // Asked on each call: a module switched off answers no more, with no restart.
    routes = []
    assert.match((await fetchText(`${dash.url}/_bridge/ping`)).body, /<div id="root">/)
  } finally {
    await dash.close()
    await rm(bundle, { recursive: true, force: true })
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
