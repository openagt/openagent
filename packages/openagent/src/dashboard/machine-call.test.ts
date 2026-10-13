import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { createHash, X509Certificate } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer as createPlainServer } from 'node:http'
import { createServer, type Server } from 'node:https'
import { createServer as createTcpServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { COMPUTER_HEADER, computerSaid, computerWordFor, machineFetch, NOT_THE_MACHINE, sayComputer } from './machine-call.js'
import { enterRemote, pingRemote, startRemoteAgent, streamRemoteEvents } from './remote-run.js'
import type { OpenAgentEvent } from '../events.js'

// A machine that speaks HTTPS, with a key and a certificate nobody signed: made by the
// computer's own `openssl` for the time of a test, so no key is kept in the repository.

interface Machine {
  url: string
  /** What the machine's key is known by. */
  pin: string
  /** What the machine was asked, in order. */
  asked: { method: string; path: string; authorization?: string | undefined; computer?: string | string[] | undefined; body: string }[]
  close: () => Promise<void>
}

async function machine(answer: (path: string) => { status: number; body?: string; lines?: string[] } = () => ({ status: 200, body: '' })): Promise<Machine> {
  const dir = await mkdtemp(join(tmpdir(), 'oa-machine-'))
  const [key, cert] = [join(dir, 'key.pem'), join(dir, 'cert.pem')]
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=a machine in a test'], { stdio: 'ignore' })
  const asked: Machine['asked'] = []
  const server: Server = createServer({ key: await readFile(key), cert: await readFile(cert) }, (req, res) => {
    let body = ''
    req.setEncoding('utf8').on('data', chunk => (body += chunk))
    req.on('end', () => {
      asked.push({ method: req.method ?? '', path: req.url ?? '', authorization: req.headers.authorization, computer: req.headers[COMPUTER_HEADER], body })
      const { status, body: text, lines } = answer(req.url ?? '')
      res.writeHead(status, { 'content-type': lines ? 'application/x-ndjson' : 'application/json' })
      if (!lines) return void res.end(text ?? '')
      for (const line of lines) res.write(`${line}\n`)
      res.end()
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const pin = createHash('sha256').update(new X509Certificate(await readFile(cert)).publicKey.export({ type: 'spki', format: 'der' })).digest('base64url')
  return {
    url: `https://127.0.0.1:${(server.address() as AddressInfo).port}`,
    pin,
    asked,
    async close() {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(dir, { recursive: true, force: true })
    },
  }
}

test('a machine that shows the key it is known by is called, whoever signed its certificate', async () => {
  const studio = await machine(path => (path === '/_relay/start' ? { status: 200, body: '{"ok":true,"agentId":"r1"}' } : { status: 200 }))
  try {
    const target = { url: studio.url, key: 'd1.sekret', pin: studio.pin, project: 'github.com/acme/shop' }
    assert.equal(await pingRemote(target), true)
    assert.deepEqual(await startRemoteAgent(target, { prompt: 'do it', options: {} }), { ok: true, agentId: 'r1' })
    assert.deepEqual(
      studio.asked.map(({ method, path, authorization }) => [method, path, authorization]),
      [
        ['GET', '/_relay/ping', 'Bearer d1.sekret'],
        ['POST', '/_relay/start', 'Bearer d1.sekret'],
      ],
    )
    assert.deepEqual(JSON.parse(studio.asked[1]!.body), { prompt: 'do it', options: {}, project: 'github.com/acme/shop' })
  } finally {
    await studio.close()
  }
})

test('a machine that shows another key is sent nothing: no key, no prompt, no code', async () => {
  const studio = await machine()
  const other = await machine()
  try {
    // What answers at the address is not the machine the link was for.
    const target = { url: studio.url, key: 'd1.sekret', pin: other.pin, project: 'github.com/acme/shop' }
    assert.equal(await pingRemote(target), false)
    const started = await startRemoteAgent(target, { prompt: 'a prompt nobody else should read', options: {} })
    assert.deepEqual(started, { ok: false, error: `could not reach the machine: ${NOT_THE_MACHINE}` })
    const entered = await enterRemote(`${studio.url}/_remote-access/enter`, 'c0de', 'a laptop', other.pin)
    assert.deepEqual(entered, { ok: false, error: `The machine did not answer: ${NOT_THE_MACHINE}` })
    await assert.rejects(machineFetch(`${studio.url}/`, other.pin), new RegExp(NOT_THE_MACHINE))
    assert.deepEqual(studio.asked, []) // the connection was dropped before a byte of a request
  } finally {
    await studio.close()
    await other.close()
  }
})

test('with no key to know it by, a machine over HTTPS needs a certificate the world trusts', async () => {
  const studio = await machine()
  try {
    assert.equal(await pingRemote({ url: studio.url, key: 'd1.sekret' }), false)
    assert.deepEqual(studio.asked, [])
  } finally {
    await studio.close()
  }
})

test('a run\'s events stream from a machine known by its key, line by line', async () => {
  const studio = await machine(() => ({ status: 200, lines: [JSON.stringify({ kind: 'session-update', sessionId: 's1' }), JSON.stringify({ kind: 'end', ok: true })] }))
  try {
    const events: OpenAgentEvent[] = []
    await new Promise<void>(resolve => streamRemoteEvents({ url: studio.url, key: 'd1.k', pin: studio.pin, project: 'p' }, 'r1', event => events.push(event), resolve))
    assert.deepEqual(events.map(event => event.kind), ['session-update', 'end'])
  } finally {
    await studio.close()
  }
})

test('a call that is given up on is given up on, also while the machine is still answering', async () => {
  const studio = await machine()
  try {
    const gone = AbortSignal.abort()
    await assert.rejects(machineFetch(`${studio.url}/`, studio.pin, { signal: gone }))
  } finally {
    await studio.close()
  }
})

test('a machine that takes the connection and then says nothing is given up on in the time the call has', async () => {
  // It accepts and stays silent: no key is ever shown.
  const silent = createTcpServer(() => {})
  await new Promise<void>(resolve => silent.listen(0, '127.0.0.1', resolve))
  const url = `https://127.0.0.1:${(silent.address() as AddressInfo).port}`
  try {
    const started = Date.now()
    await assert.rejects(machineFetch(`${url}/`, 'a-pin', { signal: AbortSignal.timeout(150) }))
    assert.equal(await pingRemote({ url, key: 'd1.k', pin: 'a-pin' }), false) // its own three seconds, not the computer's two minutes
    assert.ok(Date.now() - started < 8_000)
  } finally {
    silent.close()
  }
})

test('an answer with no body, and one with a status no answer can carry, do not take the daemon down', async () => {
  const studio = await machine(path => ({ status: path === '/reset' ? 205 : 999 }))
  try {
    assert.equal((await machineFetch(`${studio.url}/reset`, studio.pin)).status, 205)
    await assert.rejects(machineFetch(`${studio.url}/odd`, studio.pin))
  } finally {
    await studio.close()
  }
})

test('a machine over plain HTTP is called as before, and a redirect is not followed', async () => {
  const elsewhere = createPlainServer((_req, res) => res.writeHead(200).end('elsewhere'))
  await new Promise<void>(resolve => elsewhere.listen(0, '127.0.0.1', resolve))
  const plain = createPlainServer((req, res) => (req.url === '/moved' ? res.writeHead(307, { location: `http://127.0.0.1:${(elsewhere.address() as AddressInfo).port}/` }).end() : res.writeHead(200).end('here')))
  await new Promise<void>(resolve => plain.listen(0, '127.0.0.1', resolve))
  const at = `http://127.0.0.1:${(plain.address() as AddressInfo).port}`
  try {
    assert.equal(await (await machineFetch(`${at}/`, undefined)).text(), 'here')
    // A pin does nothing for a link that is not HTTPS: there is no key to compare.
    assert.equal(await (await machineFetch(`${at}/`, 'a-pin')).text(), 'here')
    await assert.rejects(machineFetch(`${at}/moved`, undefined))
  } finally {
    await new Promise<void>(resolve => plain.close(() => resolve()))
    await new Promise<void>(resolve => elsewhere.close(() => resolve()))
  }
})

test('once OpenAgent said which computer this is, every call to a machine says it, in a word of that machine\'s own, beside what the call itself says; until then none does', async () => {
  const studio = await machine()
  const seen: (string | string[] | undefined)[] = []
  const plain = createPlainServer((req, res) => {
    seen.push(req.headers[COMPUTER_HEADER])
    res.writeHead(200).end('here')
  })
  await new Promise<void>(resolve => plain.listen(0, '127.0.0.1', resolve))
  const at = `http://127.0.0.1:${(plain.address() as AddressInfo).port}`
  const MAC = 'a'.repeat(32)
  try {
    await machineFetch(`${studio.url}/_relay/ping`, studio.pin, { headers: { authorization: 'Bearer d1.sekret' } })
    await machineFetch(`${at}/`, undefined)
    assert.equal(computerSaid(), undefined)
    sayComputer(MAC)
    assert.equal(computerSaid(), MAC)
    // To a machine known by its key, and to one on the same Wi-Fi: a call with headers of its own keeps them.
    await machineFetch(`${studio.url}/_relay/ping`, studio.pin, { headers: { authorization: 'Bearer d1.sekret' } })
    await machineFetch(`${studio.url}/_remote-access/enter`, studio.pin, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    await machineFetch(`${at}/`, undefined)
    // Each machine hears a word of its own, made from the word this computer keeps and the machine's address: never the word itself.
    const [toStudio, toPlain] = [computerWordFor(MAC, studio.url), computerWordFor(MAC, at)]
    assert.deepEqual(studio.asked.map(({ authorization, computer }) => [authorization, computer]), [['Bearer d1.sekret', undefined], ['Bearer d1.sekret', toStudio], [undefined, toStudio]])
    assert.deepEqual(seen, [undefined, toPlain])
    assert.notEqual(toStudio, toPlain)
    for (const word of [toStudio, toPlain]) assert.match(word, /^[a-f0-9]{32}$/)
    assert.equal([toStudio, toPlain].includes(MAC), false)
    // The same answer as the door package's own `computerWordFor`, pinned in its tests too: the two must agree, or a computer is two rows.
    assert.equal(computerWordFor(MAC, 'https://203.0.113.5'), '46613e5444e67e384ccb7c7ba693c92e')
    assert.equal(computerWordFor(MAC, 'https://203.0.113.5/_remote-access/enter'), '46613e5444e67e384ccb7c7ba693c92e')
    assert.equal(computerWordFor(MAC, 'http://studio.local:4201/x'), 'c72e4164c235580bb030ea4b32ffb51b')
  } finally {
    sayComputer(undefined)
    await studio.close()
    await new Promise<void>(resolve => plain.close(() => resolve()))
  }
})
