import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { X509Certificate } from 'node:crypto'
import { createServer } from 'node:http'
import { request } from 'node:https'
import type { AddressInfo } from 'node:net'
import type { TLSSocket } from 'node:tls'
import { doorFingerprint } from './certificate.js'
import { keyFingerprint } from './der.js'
import { DEVICE_COOKIE, ENTER_PATH } from './door.js'
import { serve } from './serve.js'
import { keysDir } from './certificate.js'
import { addCode, readStore, update, type Store } from './store.js'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { testHome } from './test-home.js'
import { testOffice } from './test-office.js'

// The door's process on a server, with a certificate office of the test's own in place of
// Let's Encrypt, and this computer's own address in place of a server's.

async function fileSays(env: NodeJS.ProcessEnv, until: (store: Store) => boolean): Promise<Store> {
  const deadline = Date.now() + 10_000
  for (;;) {
    const store = await readStore(env)
    if (until(store)) return store
    if (Date.now() > deadline) assert.fail(`the file never said so: ${JSON.stringify(store)}`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

/** A port nothing listens on right now. */
async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
  const { port } = probe.address() as AddressInfo
  await new Promise<void>(resolve => probe.close(() => resolve()))
  return port
}

interface Answer {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
  /** The certificate the door showed. */
  shown: X509Certificate
}

/** One HTTPS request that trusts only `authority`. */
function ask(url: string, authority: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: init.method ?? 'GET', headers: init.headers ?? {}, ca: authority, agent: false }, res => {
      const shown = (res.socket as TLSSocket).getPeerX509Certificate()!
      let body = ''
      res.setEncoding('utf8').on('data', chunk => (body += chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body, shown }))
    })
    req.on('error', reject)
    req.end(init.body)
  })
}

interface Rig {
  env: NodeJS.ProcessEnv
  office: Awaited<ReturnType<typeof testOffice>>
  proofPort: number
  /** How far ahead of the real time the keeper of the certificate believes it is. */
  ahead: { ms: number }
  asked: string[]
  stop: () => Promise<void>
}

async function rig(): Promise<Rig> {
  const home = await testHome()
  const proofPort = await freePort()
  const office = await testOffice({ proofPort: () => proofPort })
  const asked: string[] = []
  const upstream = createServer((req, res) => {
    // The door's own question on a server, which machines OpenAgent has saved, is none a device asked.
    if (req.url === '/_rpc/onMachines') return void res.writeHead(200, { 'content-type': 'application/json' }).end('{"ret":[]}')
    asked.push(`${req.method} ${req.url}`)
    res.writeHead(200, { 'content-type': 'text/html' }).end('<p>the dashboard</p>')
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const ahead = { ms: 0 }
  const abort = new AbortController()
  const running = serve({
    env: home.env,
    target: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
    port: 0,
    proofPort,
    host: '127.0.0.1',
    directory: office.directory,
    signal: abort.signal,
    pollMs: 20,
    retryMs: 100,
    keep: { now: () => Date.now() + ahead.ms, lookMs: 30, retryMs: 60, pollMs: 10 },
  })
  return {
    env: home.env,
    office,
    proofPort,
    ahead,
    asked,
    async stop() {
      abort.abort()
      await running
      await office.close()
      upstream.closeAllConnections()
      await new Promise<void>(resolve => upstream.close(() => resolve()))
      await home.remove()
    },
  }
}

const server = (env: NodeJS.ProcessEnv, address: string | undefined): Promise<void> =>
  update(env, store => {
    if (address === undefined) delete store.https
    else store.https = { address }
  })

test('on a server the door gets a certificate for its address and opens over HTTPS, whatever the Wi-Fi switch says', async () => {
  const r = await rig()
  try {
    await new Promise(resolve => setTimeout(resolve, 80))
    assert.equal((await readStore(r.env)).listening, undefined, 'no server, switch off: nothing listens')

    await server(r.env, '127.0.0.1')
    const open = await fileSays(r.env, store => store.listening !== undefined && store.problem === undefined)
    assert.equal(open.on, false)
    const at = `https://127.0.0.1:${open.listening!.port}`

    // The door answers over HTTPS with the certificate the office signed for this address, for the door's own key.
    const closed = await ask(`${at}/settings`, r.office.authority)
    assert.equal(closed.status, 401)
    assert.equal(closed.shown.subjectAltName, 'IP Address:127.0.0.1')
    assert.equal(keyFingerprint(closed.shown.publicKey), await doorFingerprint(r.env))
    assert.equal(r.office.issued.length, 1)
    // A server has no screen to press on: its page says where the code comes from.
    const notIn = await ask(`${at}/settings`, r.office.authority, { headers: { accept: 'text/html' } })
    assert.match(notIn.body, /This device is not in[\s\S]*This computer is a server\. On the computer it was connected from[\s\S]*find Servers, press Add device/)
    const entering = await ask(`${at}/_devices/enter`, r.office.authority, { headers: { accept: 'text/html' } })
    assert.match(entering.body, /on the internet/)
    assert.doesNotMatch(notIn.body + entering.body, /Wi-Fi/)

    // A device gets in with a code; its cookie is one a browser never sends over plain HTTP.
    const { code } = await addCode(r.env)
    const entered = await ask(`${at}${ENTER_PATH}`, r.office.authority, { method: 'POST', headers: { 'content-type': 'application/json', origin: at }, body: JSON.stringify({ code }) })
    assert.equal(entered.status, 200)
    const cookie = String((entered.headers['set-cookie'] as string[])[0])
    assert.match(cookie, new RegExp(`^${DEVICE_COOKIE}=[^;]+; HttpOnly; SameSite=Lax; Path=/; Max-Age=\\d+; Secure$`))
    const inside = await ask(`${at}/settings`, r.office.authority, { headers: { cookie: cookie.split(';')[0]! } })
    assert.equal(inside.status, 200)
    assert.deepEqual(r.asked, ['GET /settings'])
    // A page of another site, and this address over plain HTTP, are no page of the door's.
    for (const origin of ['https://evil.example', at.replace('https', 'http')]) {
      assert.equal((await ask(`${at}/_rpc/onProjects`, r.office.authority, { method: 'POST', headers: { cookie: cookie.split(';')[0]!, origin }, body: '[]' })).status, 403)
    }

    // Port 80 shows the office its proof and sends everything else on to the door.
    const sentOn = await fetch(`http://127.0.0.1:${r.proofPort}/settings?tab=devices`, { redirect: 'manual' })
    assert.equal(sentOn.status, 308)
    assert.equal(sentOn.headers.get('location'), `${at}/settings?tab=devices`)
    assert.equal((await fetch(`http://127.0.0.1:${r.proofPort}/.well-known/acme-challenge/nothing`)).status, 404)
  } finally {
    await r.stop()
  }
})

test('the certificate is renewed past the middle of its life, for the same key, and the open door speaks with the new one', async () => {
  const r = await rig()
  try {
    await server(r.env, '127.0.0.1')
    const open = await fileSays(r.env, store => store.listening !== undefined && store.problem === undefined)
    const at = `https://127.0.0.1:${open.listening!.port}/`
    const first = (await ask(at, r.office.authority)).shown
    const key = await doorFingerprint(r.env)

    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(r.office.issued.length, 1, 'a fresh certificate is not asked for again')

    r.ahead.ms = 4 * 86_400_000 // four of its six days are gone
    for (let i = 0; i < 200 && r.office.issued.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 20))
    r.ahead.ms = 0
    assert.ok(r.office.issued.length >= 2)
    let now = (await ask(at, r.office.authority)).shown
    for (let i = 0; i < 50 && now.serialNumber === first.serialNumber; i++) {
      await new Promise(resolve => setTimeout(resolve, 20))
      now = (await ask(at, r.office.authority)).shown
    }
    assert.notEqual(now.serialNumber, first.serialNumber)
    assert.equal(keyFingerprint(now.publicKey), key, 'the door is known by the same key after a renewal')
    assert.equal((await readStore(r.env)).listening!.port, open.listening!.port, 'the door was not closed for it')
  } finally {
    await r.stop()
  }
})

test('a certificate the office does not give is said in the file, and asked for again', async () => {
  const r = await rig()
  try {
    r.office.refuse('port 80 of 127.0.0.1 cannot be reached from the internet')
    await server(r.env, '127.0.0.1')
    const refused = await fileSays(r.env, store => store.problem !== undefined && /No certificate/.test(store.problem))
    assert.equal(refused.problem, 'No certificate for 127.0.0.1 yet: port 80 of 127.0.0.1 cannot be reached from the internet')
    assert.equal(refused.listening, undefined)
    r.office.refuse(undefined)
    const open = await fileSays(r.env, store => store.listening !== undefined && store.problem === undefined)
    assert.equal((await ask(`https://127.0.0.1:${open.listening!.port}/`, r.office.authority)).status, 401)
  } finally {
    await r.stop()
  }
})

test('a computer that is no longer a server closes the door and port 80, and a restart finds the certificate it kept', async () => {
  const r = await rig()
  try {
    await server(r.env, '127.0.0.1')
    const open = await fileSays(r.env, store => store.listening !== undefined && store.problem === undefined)
    await server(r.env, undefined)
    await fileSays(r.env, store => store.listening === undefined)
    await assert.rejects(ask(`https://127.0.0.1:${open.listening!.port}/`, r.office.authority))
    await assert.rejects(fetch(`http://127.0.0.1:${r.proofPort}/`))

    // A server again: the certificate kept in the home folder is still good, and none is asked for.
    await server(r.env, '127.0.0.1')
    const again = await fileSays(r.env, store => store.listening !== undefined && store.problem === undefined)
    assert.equal((await ask(`https://127.0.0.1:${again.listening!.port}/`, r.office.authority)).status, 401)
    assert.equal(r.office.issued.length, 1)
  } finally {
    await r.stop()
  }
})

test('a renewal the office refuses leaves the open door open, and the file says so until it works again', async () => {
  const r = await rig()
  try {
    await server(r.env, '127.0.0.1')
    const open = await fileSays(r.env, store => store.listening !== undefined && store.problem === undefined)
    const at = `https://127.0.0.1:${open.listening!.port}/`
    r.office.refuse('too many certificates for this address this week')
    r.ahead.ms = 4 * 86_400_000
    const failing = await fileSays(r.env, store => store.problem !== undefined)
    assert.equal(failing.problem, 'The certificate for 127.0.0.1 could not be renewed: too many certificates for this address this week')
    assert.equal(failing.listening!.port, open.listening!.port)
    assert.equal((await ask(at, r.office.authority)).status, 401, 'the door still answers, with the certificate it has')
    r.office.refuse(undefined)
    await fileSays(r.env, store => store.problem === undefined && store.listening !== undefined)
    r.ahead.ms = 0
    assert.equal(r.office.issued.length >= 2, true)
  } finally {
    await r.stop()
  }
})

test('a key file that cannot be read is never replaced: the door stays closed, port 80 too, until the file is put right', async () => {
  const r = await rig()
  try {
    await mkdir(keysDir(r.env), { recursive: true })
    await writeFile(join(keysDir(r.env), 'door.key'), 'not a key')
    await server(r.env, '127.0.0.1')
    const stuck = await fileSays(r.env, store => store.problem !== undefined)
    assert.match(stuck.problem!, /^The door could not be opened: /)
    assert.equal(stuck.listening, undefined)
    await assert.rejects(fetch(`http://127.0.0.1:${r.proofPort}/`), 'what was opened for the certificate is closed again')
    await new Promise(resolve => setTimeout(resolve, 250)) // tried again meanwhile: the port is this door's own to take again
    assert.match((await readStore(r.env)).problem!, /^The door could not be opened: /)
    assert.equal(r.office.issued.length, 0)

    await rm(join(keysDir(r.env), 'door.key'))
    const open = await fileSays(r.env, store => store.listening !== undefined && store.problem === undefined)
    assert.equal((await ask(`https://127.0.0.1:${open.listening!.port}/`, r.office.authority)).status, 401)
  } finally {
    await r.stop()
  }
})

test('the door of the Wi-Fi and the door of a server are never one: plain HTTP is closed before HTTPS opens to every network, and back', async () => {
  const r = await rig()
  try {
    await update(r.env, store => void (store.on = true))
    const wifi = await fileSays(r.env, store => store.listening !== undefined)
    const plain = `http://127.0.0.1:${wifi.listening!.port}/`
    assert.equal((await fetch(plain)).status, 401)

    await server(r.env, '127.0.0.1')
    const open = await fileSays(r.env, store => store.listening !== undefined && store.listening.port !== wifi.listening!.port && store.problem === undefined)
    await assert.rejects(fetch(plain), 'nothing answers in plain HTTP any more')
    await assert.rejects(fetch(`http://127.0.0.1:${open.listening!.port}/`), 'the server\'s door does not speak plain HTTP')
    assert.equal((await ask(`https://127.0.0.1:${open.listening!.port}/`, r.office.authority)).status, 401)

    // No longer a server: the switch decides again, and it is still on.
    await server(r.env, undefined)
    const back = await fileSays(r.env, store => store.listening !== undefined && store.listening.port !== open.listening!.port)
    assert.equal((await fetch(`http://127.0.0.1:${back.listening!.port}/`)).status, 401)
    await assert.rejects(ask(`https://127.0.0.1:${open.listening!.port}/`, r.office.authority))
  } finally {
    await r.stop()
  }
})
