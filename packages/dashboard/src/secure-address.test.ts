import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDashboard } from './dashboard/server.js'
import { testDashboardOptions } from './dashboard-rpc/test-context.js'
import { CERTIFICATE_FILE, KEY_FILE, certificateNames, readSecureAddress, secureAddressDir } from './secure-address.js'

const NAME = 'dash.openagent.test'

/** A certificate for `name` alone, made the way the install makes one. */
async function makeCertificate(dir: string, name: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  const config = join(dir, 'openssl.cnf')
  await writeFile(config, `[req]\ndistinguished_name = dn\nprompt = no\n[dn]\nCN = ${name}\n[ext]\nsubjectAltName = DNS:${name}\nbasicConstraints = critical, CA:FALSE\nkeyUsage = critical, digitalSignature, keyEncipherment\nextendedKeyUsage = serverAuth\n`)
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, KEY_FILE), '-out', join(dir, CERTIFICATE_FILE), '-days', '30', '-config', config, '-extensions', 'ext'], { stdio: 'ignore' })
}

/** A GET over HTTPS to `name` at `port`, trusting `ca` only, with the cookie a browser would send. */
function get(port: number, path: string, ca: string, opts: { method?: string; cookie?: string } = {}): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const headers = { host: NAME, ...(opts.cookie ? { cookie: opts.cookie } : {}) }
    const req = httpsRequest({ host: '127.0.0.1', port, path, method: opts.method ?? 'GET', servername: NAME, ca, headers }, res => {
      let body = ''
      res.on('data', c => (body += c))
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, body, headers: res.headers }))
    })
    req.on('error', rejectPromise)
    req.end()
  })
}

/** A POST to the RPC mount, as a page on `host` makes it. Over HTTPS it trusts only `ca`, for `servername`. */
function post(url: string, host: string, tls?: { ca: string; servername: string }): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const origin = `${tls ? 'https' : 'http'}://${host}`
    const options = { method: 'POST', headers: { host, origin, 'content-type': 'application/json' }, ...(tls ?? {}) }
    const req = (tls ? httpsRequest : httpRequest)(url, options, res => {
      res.resume()
      res.on('end', () => resolvePromise(res.statusCode ?? 0))
    })
    req.on('error', rejectPromise)
    req.end('[]')
  })
}

test('certificateNames reads the DNS names of a subjectAltName, and nothing else', () => {
  assert.deepEqual(certificateNames('DNS:a.test, IP Address:127.0.0.1, DNS:b.test'), ['a.test', 'b.test'])
  assert.deepEqual(certificateNames(undefined), [])
})

test('readSecureAddress: none without a certificate; the name is read off the certificate', async () => {
  const home = await mkdtemp(join(tmpdir(), 'secure-address-'))
  const env = { XDG_CONFIG_HOME: home }
  try {
    assert.equal(await readSecureAddress(env), undefined)
    await makeCertificate(secureAddressDir(env), NAME)
    const secure = await readSecureAddress(env)
    assert.equal(secure?.name, NAME)
    assert.equal(secure?.cert, await readFile(join(secureAddressDir(env), CERTIFICATE_FILE), 'utf8'))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('the secure address answers its name over HTTPS, and only there; a rebound name gets no further than the certificate', async () => {
  const home = await mkdtemp(join(tmpdir(), 'secure-address-'))
  const bundle = join(home, 'bundle')
  await mkdir(bundle)
  await writeFile(join(bundle, 'index.html'), '<!doctype html>')
  await makeCertificate(join(home, 'keys'), NAME)
  const key = await readFile(join(home, 'keys', KEY_FILE), 'utf8')
  const cert = await readFile(join(home, 'keys', CERTIFICATE_FILE), 'utf8')
  const dash = await startDashboard(testDashboardOptions({ clientBundleDir: bundle, secure: { name: NAME, key, cert, port: 0 } }))
  try {
    assert.ok(dash.secureUrl, 'the secure address is answered')
    const secureUrl = new URL(dash.secureUrl)
    assert.equal(secureUrl.hostname, NAME)
    // What the browser does once the name points here: it calls 127.0.0.1, says the name, and checks the certificate is for it.
    const at = `https://127.0.0.1:${secureUrl.port}/_rpc/onProjects`
    assert.notEqual(await post(at, NAME, { ca: cert, servername: NAME }), 403)

    // A page on another name made to point here: the certificate is not for it, so the browser stops at once.
    await assert.rejects(post(at, 'evil.com', { ca: cert, servername: 'evil.com' }), /altnames|certificate/i)
    // Even past the certificate, its Host is refused.
    assert.equal(await post(at, 'evil.com', { ca: cert, servername: NAME }), 403)

    // Over plain HTTP the name is any other: it could be pointed here by whoever answers for it.
    assert.equal(await post(`${dash.url}/_rpc/onProjects`, NAME), 403)
  } finally {
    await dash.close()
    await rm(home, { recursive: true, force: true })
  }
})

test('on the secure address, / is the dashboard until the toggle picks the landing page; the website\'s other pages are at their own paths', async () => {
  const home = await mkdtemp(join(tmpdir(), 'secure-address-'))
  const bundle = join(home, 'bundle')
  const website = join(home, 'website')
  await mkdir(bundle)
  await writeFile(join(bundle, 'index.html'), 'the dashboard')
  await mkdir(join(website, 'press'), { recursive: true })
  await writeFile(join(website, 'index.html'), 'the landing page')
  await writeFile(join(website, 'press', 'index.html'), 'the press page')
  await makeCertificate(join(home, 'keys'), NAME)
  const key = await readFile(join(home, 'keys', KEY_FILE), 'utf8')
  const cert = await readFile(join(home, 'keys', CERTIFICATE_FILE), 'utf8')
  const dash = await startDashboard(testDashboardOptions({ clientBundleDir: bundle, websiteDir: website, secure: { name: NAME, key, cert, port: 0 } }))
  try {
    const port = Number(new URL(dash.secureUrl!).port)
    const first = await get(port, '/', cert)
    assert.equal(first.body, 'the dashboard')
    // A first visit is given the dashboard as its pick: how the dashboard's page knows to draw the toggle.
    assert.match(String(first.headers['set-cookie']), /^openagent-view=dashboard;/)
    assert.equal((await get(port, '/', cert, { cookie: 'openagent-view=dashboard' })).headers['set-cookie'], undefined)
    // How a page tells the dashboard's copy of the website from the public one.
    assert.equal((await get(port, '/_view', cert, { method: 'HEAD' })).status, 204)

    const picked = await get(port, '/_view/landing', cert)
    assert.equal(picked.status, 303)
    assert.equal(picked.headers.location, '/')
    const cookie = String(picked.headers['set-cookie']).split(';')[0]!
    assert.equal(cookie, 'openagent-view=landing')
    assert.equal((await get(port, '/', cert, { cookie })).body, 'the landing page')
    assert.equal((await get(port, '/press', cert)).body, 'the press page')
    // A dashboard path is still the dashboard's, whatever was picked.
    assert.equal((await get(port, '/some-project-1x2y', cert, { cookie })).body, 'the dashboard')
    assert.equal((await get(port, '/_view/nothing', cert)).status, 404)

    // The plain address has no website: there `/_view` is a page of the dashboard like any other.
    const plain = await fetch(`${dash.url}/_view`, { method: 'HEAD' })
    assert.equal(plain.status, 200)
    assert.equal(await (await fetch(`${dash.url}/`, { headers: { cookie } })).text(), 'the dashboard')
  } finally {
    await dash.close()
    await rm(home, { recursive: true, force: true })
  }
})
