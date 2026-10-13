import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createServer, request, type IncomingMessage, type Server } from 'node:http'
import { connect as connectTcp, createServer as createTcpServer, type AddressInfo, type Socket } from 'node:net'
import { runCli } from './cli.js'
import { Duplex, PassThrough } from 'node:stream'
import { connect as connectTls } from 'node:tls'
import { openDoor } from './door.js'
import { DATA, END, FrameReader, HEAD, Link, MAX_PAYLOAD, PING, PONG, RESET, carriedHeaders, carriedPath, frame } from './frames.js'
import { carry, dial, enterForLine, knock, readLineLink, unchunked, WATCH_HEADER } from './line-out.js'
import { serve } from './serve.js'
import { readStore, update, type Store } from './store.js'
import { testHome } from './test-home.js'
import { testOffice } from './test-office.js'

// A server and a computer, each with the door's own process and a stand-in for its OpenAgent,
// on this one computer: the server's door speaks HTTPS with a certificate of the test's office.

test('frames come out whole however the connection cuts them, and a frame no line sends ends the reading', () => {
  const sent = Buffer.concat([frame(HEAD, 7, Buffer.from('{"a":1}')), frame(DATA, 7, Buffer.from('hello')), frame(END, 7)])
  const reader = new FrameReader()
  const got = []
  for (const byte of sent) got.push(...reader.push(Buffer.from([byte])))
  assert.deepEqual(
    got.map(one => [one.kind, one.call, one.payload.toString()]),
    [
      [HEAD, 7, '{"a":1}'],
      [DATA, 7, 'hello'],
      [END, 7, ''],
    ],
  )
  const tooLarge = Buffer.alloc(9)
  tooLarge.writeUInt8(DATA, 0)
  tooLarge.writeUInt32BE(MAX_PAYLOAD + 1, 5)
  assert.throws(() => new FrameReader().push(tooLarge), /larger than a line carries/)
})

test('a line carries what a machine is asked, spelled the one way, and nothing else', () => {
  for (const path of ['/_relay/ping', '/_relay/events?run=a&project=https%3A%2F%2Fgithub.com%2Fa%2Fb', '/_relay/screen/stream?run=a']) assert.equal(carriedPath(path), true, path)
  for (const path of ['/', '/_rpc/onProjects', '/_relay', '/_relay/../_rpc/x', '/_relay/%2e%2e/_rpc/x', '/_relay/%2E%2E/x', '/_relay/./ping', '/_relay\\..\\_rpc', '//host/_relay/ping', 'http://host/_relay/ping', '_relay/ping', '/_relay/ping?a=b c', '/_relay/ping?a=b\r\nx: y', '/_relay/ping#part']) assert.equal(carriedPath(path), false, path)
})

test('what the other end of a line sends never stops the process that reads it: a header HTTP does not take is left out, and a frame that fails ends the line alone', () => {
  assert.deepEqual(
    carriedHeaders({ 'content-type': 'application/json', 'x y': 'a name with a space', 'x-break': 'a\r\nset-cookie: b', 'x-list': ['a', 'b'], 'x-bad-list': ['a', 'b\n'], 'x-number': 7, 'x-object': {}, connection: 'close', 'transfer-encoding': 'chunked', 'content-length': '5' }),
    { 'content-type': 'application/json', 'x-list': ['a', 'b'], 'x-number': '7' },
  )
  for (const none of [undefined, null, 'text', ['a'], 7]) assert.deepEqual(carriedHeaders(none), {})
  const socket = new PassThrough()
  let closed = false
  const link = new Link(socket, {
    quietMs: 60_000,
    onFrame: () => {
      throw new Error('a reader that fails')
    },
    onClose: () => void (closed = true),
  })
  link.take(frame(HEAD, 1, Buffer.from('{}')))
  assert.equal(socket.destroyed, true)
  return new Promise<void>(resolve => setImmediate(() => (assert.equal(closed, true), resolve())))
})

test('an end that asks and reads no answer is left, and one piece full of questions gets one answer', () => {
  // Nothing written to this connection ever leaves: what waits only grows.
  const stuck = new Duplex({ read() {}, write() {} })
  const flooded = new Link(stuck, { quietMs: 60_000, onFrame: () => {}, onClose: () => {} })
  for (let n = 0; n < 9_000 && !stuck.destroyed; n++) flooded.send(DATA, 1)
  assert.equal(stuck.destroyed, true)

  const written: Buffer[] = []
  const socket = new Duplex({ read() {}, write: (chunk: Buffer, _encoding, done) => (written.push(chunk), done()) })
  const link = new Link(socket, { quietMs: 60_000, onFrame: () => {}, onClose: () => {} })
  link.take(Buffer.concat(Array.from({ length: 500 }, () => frame(PING, 0))))
  assert.deepEqual(
    new FrameReader().push(Buffer.concat(written)).map(one => one.kind),
    [PONG],
  )
  socket.destroy()
})

test('a body in pieces is put together, and a length that is none ends the reading', () => {
  assert.equal(unchunked(Buffer.from('5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n')).toString(), 'hello world')
  for (const none of ['-6\r\nabc', 'zz\r\nabc', '', '5']) assert.equal(unchunked(Buffer.from(none)).length, 0, none)
})

test('only a server gives a line: its link is HTTPS and names its key', () => {
  assert.deepEqual(readLineLink(' https://203.0.113.7/_remote-access/enter#code.pin '), { url: 'https://203.0.113.7', door: 'https://203.0.113.7/_remote-access/enter', code: 'code', pin: 'pin' })
  assert.equal(readLineLink('http://studio.local:4201/_remote-access/enter#code'), undefined)
  assert.equal(readLineLink('https://203.0.113.7/_remote-access/enter#code'), undefined)
  assert.equal(readLineLink('not a link'), undefined)
})

async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
  const { port } = probe.address() as AddressInfo
  await new Promise<void>(resolve => probe.close(() => resolve()))
  return port
}

async function until<T>(what: string, read: () => T | undefined | Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 10_000
  for (;;) {
    const value = await read()
    if (value !== undefined && value !== false) return value
    if (Date.now() > deadline) assert.fail(`never: ${what}`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

async function bodyOf(req: IncomingMessage): Promise<string> {
  let body = ''
  for await (const chunk of req.setEncoding('utf8')) body += chunk
  return body
}

const listen = (server: Server): Promise<string> => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)))
const shut = async (server: Server): Promise<void> => {
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
}

/** The command, run as a person runs it; answers what it printed. */
async function command<T>(env: NodeJS.ProcessEnv, ...args: string[]): Promise<T> {
  let out = ''
  let said = ''
  const code = await runCli(args, { env, stdout: line => (out += line), stderr: line => (said += line) })
  assert.equal(code, 0, `remote-access ${args[0]}: ${said}`)
  return JSON.parse(out) as T
}

interface Rig {
  /** The server's and the computer's own files. */
  server: NodeJS.ProcessEnv
  computer: NodeJS.ProcessEnv
  /** The machines the server's OpenAgent has saved, as the door told it. */
  machines: { id: string; url: string; label: string }[]
  /** What the computer's OpenAgent was asked, with what each call said. */
  asked: { line: string; watch: boolean; body: string; headers: IncomingMessage['headers'] }[]
  /** The feeds of the computer's OpenAgent that their reader left. */
  left: string[]
  /** A link the server gives for a new device. */
  link: () => Promise<string>
  stop: () => Promise<void>
}

async function rig(): Promise<Rig> {
  const [serverHome, computerHome] = [await testHome(), await testHome()]
  // The door's port is its own for the whole test, as 443 is a server's: a door that starts anew is found where it was.
  const [proofPort, doorPort] = [await freePort(), await freePort()]
  const office = await testOffice({ proofPort: () => proofPort })
  const machines: Rig['machines'] = []
  // The server's OpenAgent: it keeps the machines it is told of.
  const serverAgent = createServer((req, res) => {
    void (async () => {
      const args = JSON.parse((await bodyOf(req)) || '[]') as unknown[]
      const answer = (ret: unknown): void => void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ret }))
      if (req.url === '/_rpc/onMachines') return answer(machines)
      if (req.url === '/_rpc/sendAddMachine') {
        const link = new URL(String(args[0]))
        const entered = await fetch(link.origin + link.pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: link.hash.slice(1), computer: 'the server' }) })
        const { key } = (await entered.json()) as { key?: string }
        if (!key) return answer({ ok: false, error: 'no key' })
        machines.push({ id: link.origin, url: link.origin, label: String(args[1]) })
        return answer({ ok: true })
      }
      if (req.url === '/_rpc/sendRemoveMachine') {
        machines.splice(0, machines.length, ...machines.filter(machine => machine.id !== args[0]))
        return answer({ ok: true })
      }
      res.writeHead(404).end()
    })()
  })
  const asked: Rig['asked'] = []
  const left: string[] = []
  // The computer's OpenAgent: what a machine is asked.
  const computerAgent = createServer((req, res) => {
    void (async () => {
      const line = `${req.method} ${req.url}`
      if (req.url === '/_relay/events') {
        asked.push({ line, watch: req.headers[WATCH_HEADER] === '1', body: '', headers: req.headers })
        res.writeHead(200, { 'content-type': 'application/x-ndjson' })
        res.flushHeaders()
        let n = 0
        const timer = setInterval(() => res.write(`{"n":${n++}}\n`), 15)
        res.once('close', () => {
          clearInterval(timer)
          left.push(line)
        })
        return
      }
      const body = await bodyOf(req)
      asked.push({ line, watch: req.headers[WATCH_HEADER] === '1', body, headers: req.headers })
      // An answer that takes its time.
      if (req.url === '/_relay/slow') return void setTimeout(() => res.writeHead(200, { 'content-type': 'text/plain' }).end('at last'), 700)
      if (req.url?.startsWith('/_relay/huge?')) return void res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(Buffer.alloc(Number(req.url.split('?')[1]), 7))
      if (req.url === '/_relay/large') return void res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(Buffer.alloc(300_000, 7))
      res.writeHead(req.url === '/_relay/refused' ? 403 : 200, { 'content-type': 'application/json', 'x-said': 'by the computer' }).end(JSON.stringify({ heard: body, host: 'the-computer' }))
    })()
  })
  const [serverTarget, computerTarget] = [await listen(serverAgent), await listen(computerAgent)]
  // The first of the lines' ports: one with room after it for the others.
  let first = await freePort()
  while (first > 65_000) first = await freePort()
  serverHome.env.OPENAGENT_REMOTE_ACCESS_LINE_PORT = String(first)
  const abort = new AbortController()
  const line = { retryMs: [30, 60], pingMs: 40, quietMs: 400 }
  const running = [
    serve({ env: serverHome.env, target: serverTarget, port: doorPort, proofPort, host: '127.0.0.1', directory: office.directory, signal: abort.signal, pollMs: 20, retryMs: 100, keep: { lookMs: 30, retryMs: 60, pollMs: 10 }, line }),
    serve({ env: computerHome.env, target: computerTarget, signal: abort.signal, pollMs: 20, retryMs: 100, line }),
  ]
  await update(serverHome.env, store => void (store.https = { address: '127.0.0.1' }))
  await until('the door is open', async () => ((await readStore(serverHome.env)).listening !== undefined ? true : undefined))
  return {
    server: serverHome.env,
    computer: computerHome.env,
    machines,
    asked,
    left,
    link: async () => (await command<{ url: string }>(serverHome.env, 'add')).url,
    async stop() {
      abort.abort()
      await Promise.all(running)
      await office.close()
      await Promise.all([shut(serverAgent), shut(computerAgent)])
      await Promise.all([serverHome.remove(), computerHome.remove()])
    },
  }
}

test('a computer keeps a line open to its server, and the server asks the computer through it as it asks any machine', async () => {
  const r = await rig()
  try {
    const status = await command<{ lines: { url: string; mode: string }[] }>(r.computer, 'line', 'add', await r.link())
    assert.equal(status.lines.length, 1)
    assert.equal(status.lines[0]!.mode, 'full')

    // A program hands the link over on standard input: what it is told a second time replaces the line it had.
    let out = ''
    assert.equal(await runCli(['line', 'add', '-', 'watch'], { env: r.computer, stdout: line => (out += line), stderr: () => {}, stdin: r.link }), 0)
    assert.deepEqual((JSON.parse(out) as { lines: { mode: string }[] }).lines.map(line => line.mode), ['watch'])
    await until('the line it had is taken out on the server', async () => ((await readStore(r.server)).devices.length === 1 ? true : undefined))
    await command(r.computer, 'line', 'full', '127.0.0.1')

    // The server lists the computer by its own name, with a port of its own, and its OpenAgent is told of it as one more machine.
    const listed = (await readStore(r.server)).devices
    assert.equal(listed.length, 1)
    assert.doesNotMatch(listed[0]!.name, /^OpenAgent on /)
    const port = listed[0]!.line!.port
    // The second of the lines' ports: the first was the replaced line's until that one was taken out.
    assert.equal(port, Number(r.server.OPENAGENT_REMOTE_ACCESS_LINE_PORT) + 1)
    // The replaced line's address is taken off the machines, and this one's is the only one left.
    const machine = await until('the server’s OpenAgent saved the computer', () => (r.machines.length === 1 && r.machines[0]!.url === `http://127.0.0.1:${port}` ? r.machines[0] : undefined))
    assert.deepEqual(machine, { id: `http://127.0.0.1:${port}`, url: `http://127.0.0.1:${port}`, label: listed[0]!.name })
    const at = machine.url

    // A read and a call with a body arrive at the computer's OpenAgent, and its answer comes back whole.
    // Carried, and by a line that may do everything: the door's process has read what the person last said.
    const ping = await until('the line carries', async () => {
      const res = await fetch(`${at}/_relay/ping`)
      return res.status === 200 && !r.asked.at(-1)!.watch ? res : undefined
    })
    assert.deepEqual(await ping.json(), { heard: '', host: 'the-computer' })
    assert.equal(ping.headers.get('x-said'), 'by the computer')
    const started = await fetch(`${at}/_relay/start`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer line', cookie: 'a=b' }, body: JSON.stringify({ prompt: 'x'.repeat(200_000) }) })
    assert.equal(started.status, 200)
    assert.equal(((await started.json()) as { heard: string }).heard.length, 200_000 + '{"prompt":""}'.length)
    const start = r.asked.find(one => one.line === 'POST /_relay/start')!
    assert.equal(start.headers['content-type'], 'application/json')
    // No key and no cookie goes down a line, and a call that may do everything says nothing of watching.
    assert.equal(start.headers.authorization, undefined)
    assert.equal(start.headers.cookie, undefined)
    assert.equal(start.watch, false)
    // The computer's own refusal comes back as it said it.
    assert.equal((await fetch(`${at}/_relay/refused`)).status, 403)
    // An answer larger than one frame.
    const large = Buffer.from(await (await fetch(`${at}/_relay/large`)).arrayBuffer())
    assert.equal(large.length, 300_000)
    assert.ok(large.every(byte => byte === 7))

    // Many calls at once share the one line.
    const many = await Promise.all(Array.from({ length: 20 }, (_, n) => fetch(`${at}/_relay/rpc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: `{"n":${n}}` }).then(res => res.json() as Promise<{ heard: string }>)))
    assert.deepEqual(
      many.map(one => one.heard),
      Array.from({ length: 20 }, (_, n) => `{"n":${n}}`),
    )

    // A live feed comes as it is written, and the computer's OpenAgent is told when its reader left.
    const gone = new AbortController()
    const feed = await fetch(`${at}/_relay/events`, { signal: gone.signal })
    const reader = feed.body!.getReader()
    let read = ''
    while (read.split('\n').length < 4) read += new TextDecoder().decode((await reader.read()).value)
    assert.match(read, /^\{"n":0\}\n\{"n":1\}\n/)
    gone.abort()
    await until('the feed was left', () => (r.left.length === 1 ? true : undefined))

    // Only what a machine is asked is carried: nothing else reaches the computer's OpenAgent.
    const before = r.asked.length
    assert.equal((await fetch(`${at}/_rpc/onProjects`, { method: 'POST', body: '[]' })).status, 404)
    assert.equal((await fetch(`${at}/settings`)).status, 404)
    // A path that reads as another once its dots are worked out is none a line carries.
    for (const bent of ['/_relay/../_rpc/onProjects', '/_relay/%2e%2e/_rpc/onProjects', '/_relay/./ping', '//evil.example/_relay/ping']) {
      const said = await new Promise<number>((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port: Number(new URL(at).port), path: bent, method: 'GET' }, res => (res.resume(), resolve(res.statusCode ?? 0)))
        req.on('error', reject).end()
      })
      assert.equal(said, 404, bent)
    }
    // A read with a body, and a kind of call that is neither a read nor a call with a body: nothing of either reaches the computer but the read.
    const hidden = 'POST /_rpc/sendStart HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n[]'
    const withBody = (method: string): Promise<number> =>
      new Promise<number>((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port: Number(new URL(at).port), path: '/_relay/ping', method, headers: { 'content-length': Buffer.byteLength(hidden) } }, res => (res.resume(), resolve(res.statusCode ?? 0)))
        req.on('error', reject).end(hidden)
      })
    assert.equal(await withBody('GET'), 200)
    assert.equal(await withBody('DELETE'), 405)
    assert.equal(await withBody('PUT'), 405)
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.deepEqual(
      r.asked.slice(before).map(one => `${one.line} ${one.body}`),
      ['GET /_relay/ping '],
    )
    r.asked.length = before
    // A page a browser on the server opened is turned away: it says where it comes from, or reached the address under another name.
    assert.equal((await fetch(`${at}/_relay/ping`, { headers: { origin: 'https://evil.example' } })).status, 403)
    assert.equal((await fetch(`${at}/_relay/ping`, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403)
    const rebound = await new Promise<number>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: Number(new URL(at).port), path: '/_relay/ping', headers: { host: `evil.example:${new URL(at).port}` } }, res => (res.resume(), resolve(res.statusCode ?? 0)))
      req.on('error', reject).end()
    })
    assert.equal(rebound, 403)
    assert.equal(r.asked.length, before)

    // The person lets the server only watch: every call from then on says so.
    await command(r.computer, 'line', 'watch', '127.0.0.1')
    await until('a call says it may only watch', async () => {
      await fetch(`${at}/_relay/ping`)
      return r.asked.at(-1)!.watch ? true : undefined
    })
    await command(r.computer, 'line', 'full', '127.0.0.1')
    await until('a call may do everything again', async () => {
      await fetch(`${at}/_relay/ping`)
      return r.asked.at(-1)!.watch ? undefined : true
    })
  } finally {
    await r.stop()
  }
})

test('a line that ends is asked for again, and a computer taken out on the server has no line and is no machine there', async () => {
  const r = await rig()
  try {
    await command(r.computer, 'line', 'add', await r.link())
    const machine = await until('the server’s OpenAgent saved the computer', () => r.machines[0])
    const carries = async (): Promise<true | undefined> => ((await fetch(`${machine.url}/_relay/ping`)).status === 200 ? true : undefined)
    await until('the line carries', carries)

    // The server's door starts anew (an update): the computer calls again by itself, at the same address.
    await update(r.server, store => void delete store.https)
    await until('the door is closed', async () => ((await readStore(r.server)).listening === undefined ? true : undefined))
    await update(r.server, store => void (store.https = { address: '127.0.0.1' }))
    await until('the line carries again', () => carries().catch(() => undefined))
    assert.equal(r.machines.length, 1)

    // The person removes the line on the computer.
    await command(r.computer, 'line', 'remove', '127.0.0.1')
    assert.deepEqual((await readStore(r.computer)).lines, [])
    // Removing the line took the computer's key out on the server: no address, and no machine.
    await until('the computer is out on the server', async () => ((await readStore(r.server)).devices.length === 0 ? true : undefined))
    await until('the server’s OpenAgent dropped the machine', () => (r.machines.length === 0 ? true : undefined))
    await assert.rejects(fetch(`${machine.url}/_relay/ping`))
  } finally {
    await r.stop()
  }
})

test('a computer that is on the list and away is said to be not connected, and a key that got in for no line gets none', async () => {
  const r = await rig()
  try {
    await command(r.computer, 'line', 'add', await r.link())
    const machine = await until('the server’s OpenAgent saved the computer', () => r.machines[0])
    await until('the line carries', async () => ((await fetch(`${machine.url}/_relay/ping`)).status === 200 ? true : undefined))

    // The computer forgets its line without telling the server (it was switched off): the server keeps its address.
    const kept = (await readStore(r.computer)).lines[0]!
    await update(r.computer, store => void (store.lines = []))
    const away = await until('the computer is away', async () => {
      const res = await fetch(`${machine.url}/_relay/ping`)
      return res.status === 503 ? res : undefined
    })
    assert.match(await away.text(), /not connected\. It must be on, with OpenAgent running\./)

    // Another computer's OpenAgent, in with a key of its own for calls, is given no line with it.
    const link = new URL(await r.link())
    const pin = link.hash.split('.')[1]!
    const { enterForLine, dial, knock, NotLetIn } = await import('./line-out.js')
    const socket = await dial(link.origin, pin)
    socket.destroy()
    await assert.rejects(dial(link.origin, 'another-key'), /not the server the line was set up with/)
    const store: Store = await readStore(r.server)
    assert.equal(store.devices.length, 1)
    const plain = await new Promise<string>((resolve, reject) => {
      void (async () => {
        const { request } = await import('node:https')
        const req = request(link.origin + link.pathname, { method: 'POST', rejectUnauthorized: false, agent: false, headers: { 'content-type': 'application/json' } }, res => {
          let body = ''
          res.setEncoding('utf8').on('data', chunk => (body += chunk))
          res.on('end', () => resolve((JSON.parse(body) as { key: string }).key))
        })
        req.on('error', reject)
        req.end(JSON.stringify({ code: link.hash.slice(1).split('.')[0], computer: 'another computer' }))
      })()
    })
    await assert.rejects(async () => knock(await dial(link.origin, pin), link.origin, plain), NotLetIn)
    await assert.rejects(async () => knock(await dial(link.origin, pin), link.origin, 'nobody.nothing'), NotLetIn)
    // A code is good once, for a line as for anything.
    assert.deepEqual(await enterForLine({ url: link.origin, door: link.origin + link.pathname, code: link.hash.slice(1).split('.')[0]!, pin }, 'late'), { ok: false, error: 'this code no longer works' })

    // The computer comes back with the key it had: the same address carries again.
    await update(r.computer, store => void (store.lines = [kept]))
    await until('the line carries again', async () => ((await fetch(`${machine.url}/_relay/ping`)).status === 200 ? true : undefined))
  } finally {
    await r.stop()
  }
})

/** Two ends of one connection on this computer. */
async function pair(): Promise<{ near: Socket; far: Socket; close: () => Promise<void> }> {
  const server = createTcpServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const arrived = new Promise<Socket>(resolve => server.once('connection', resolve))
  const near = connectTcp((server.address() as AddressInfo).port, '127.0.0.1')
  const far = await arrived
  return {
    near,
    far,
    async close() {
      near.destroy()
      far.destroy()
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}

const head = (call: number, method: string, path: string): Buffer => frame(HEAD, call, Buffer.from(JSON.stringify({ method, path, headers: { 'content-type': 'application/json' } })))

test('whatever a server sends down a line, this computer passes on one checked call at a time and its process goes on', async () => {
  const asked: string[] = []
  const agent = createServer((req, res) => {
    void bodyOf(req).then(body => {
      if (req.url === '/_relay/slow') return void setTimeout(() => res.writeHead(200, { 'content-type': 'text/plain' }).end('at last'), 700)
      asked.push(`${req.method} ${req.url} ${body}`)
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
    })
  })
  const target = await listen(agent)
  const { near, far, close } = await pair()
  const answers = new FrameReader()
  const got: { kind: number; call: number; text: string }[] = []
  far.on('data', (chunk: Buffer) => got.push(...answers.push(chunk).map(one => ({ kind: one.kind, call: one.call, text: one.payload.toString() }))))
  const statusOf = (call: number): Promise<number> => until(`call ${call} is answered`, () => got.filter(one => one.call === call && one.kind === HEAD).map(one => (JSON.parse(one.text) as { status: number }).status)[0])
  const carried = carry(near, Buffer.alloc(0), { target, watch: () => true, pingMs: 60_000, quietMs: 60_000 })
  try {
    // A read with a body: the body is a second call in disguise, and is never written.
    const hidden = 'POST /_rpc/sendStart HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n[]'
    far.write(Buffer.concat([head(1, 'GET', '/_relay/ping'), frame(DATA, 1, Buffer.from(hidden)), frame(END, 1)]))
    assert.equal(await statusOf(1), 200)
    // No other kind of call than a read and a call with a body.
    for (const [call, method] of [[2, 'DELETE'], [3, 'PUT'], [4, 'OPTIONS'], [5, 'get'], [6, 'GET\r\nX: y']] as const) {
      far.write(head(call, method, '/_relay/ping'))
      assert.equal(await statusOf(call), 405, method)
    }
    // Pieces after the end, twice, in one write: dropped, and the call is answered.
    far.write(Buffer.concat([head(7, 'POST', '/_relay/rpc'), frame(DATA, 7, Buffer.from('{}')), frame(END, 7), frame(DATA, 7, Buffer.from('late')), frame(DATA, 7, Buffer.from('later'))]))
    assert.equal(await statusOf(7), 200)
    // A number used again while its first call is being given up: the newer call is the one that is answered.
    far.write(Buffer.concat([head(8, 'POST', '/_relay/rpc'), frame(RESET, 8), head(8, 'POST', '/_relay/rpc'), frame(DATA, 8, Buffer.from('second')), frame(END, 8)]))
    assert.equal(await statusOf(8), 200)
    // What is no call at all.
    far.write(Buffer.concat([frame(HEAD, 9, Buffer.from('not json')), frame(HEAD, 10, Buffer.from('[1]')), frame(99, 11), frame(RESET, 12), frame(END, 0)]))
    assert.equal(await statusOf(9), 404)
    assert.equal(await statusOf(10), 404)
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.deepEqual(asked, ['GET /_relay/ping ', 'POST /_relay/rpc {}', 'POST /_relay/rpc second'])
    // A call with a large body, whole in one piece, whose answer takes its time: the line reads on meanwhile.
    far.write(Buffer.concat([head(20, 'POST', '/_relay/slow'), frame(DATA, 20, Buffer.alloc(MAX_PAYLOAD, 120)), frame(DATA, 20, Buffer.alloc(MAX_PAYLOAD, 120)), frame(END, 20)]))
    await new Promise(resolve => setTimeout(resolve, 60))
    const began = Date.now()
    far.write(head(21, 'GET', '/_relay/ping'))
    assert.equal(await statusOf(21), 200)
    assert.ok(Date.now() - began < 400, 'a read waited for the slow call before it')
    assert.equal(await statusOf(20), 200)
  } finally {
    await close()
    await carried
    await shut(agent)
  }
})

test('a computer on a line that answers nonsense ends its own call at most: the server and its door go on', async () => {
  const r = await rig()
  try {
    // A computer of the test's own, in for a line with a real key, that answers as it likes.
    const link = readLineLink(await r.link())!
    const entered = await enterForLine(link, 'a computer that lies')
    assert.equal(entered.ok, true)
    const socket = await dial(link.url, link.pin)
    const rest = await knock(socket, link.url, (entered as { key: string }).key)
    assert.equal(rest.length, 0)
    const asks = new FrameReader()
    let reply: (call: number) => Buffer = () => Buffer.alloc(0)
    socket.on('data', (chunk: Buffer) => {
      for (const one of asks.push(chunk)) if (one.kind === HEAD) socket.write(reply(one.call))
    })
    socket.resume()
    const machine = await until('the server’s OpenAgent saved the computer', () => r.machines[0])
    const ok = (call: number): Buffer => frame(HEAD, call, Buffer.from(JSON.stringify({ status: 200, headers: { 'content-type': 'text/plain' } })))
    const cases: [string, (call: number) => Buffer][] = [
      ['an answer and its giving up at once', call => Buffer.concat([ok(call), frame(RESET, call)])],
      ['two answers', call => Buffer.concat([ok(call), ok(call)])],
      ['an answer and something that is no frame of a call', call => Buffer.concat([ok(call), frame(42, call)])],
      ['a header HTTP does not take', call => Buffer.concat([frame(HEAD, call, Buffer.from(JSON.stringify({ status: 200, headers: { 'x y': 'z', 'x-break': 'a\r\nb', 'x-wide': ' ' } }))), frame(DATA, call, Buffer.from('said')), frame(END, call)])],
      ['a status no answer has', call => frame(HEAD, call, Buffer.from(JSON.stringify({ status: 42 })))],
      ['an answer with no body allowed, and a body', call => Buffer.concat([frame(HEAD, call, Buffer.from(JSON.stringify({ status: 204 }))), frame(DATA, call, Buffer.from('said')), frame(END, call)])],
    ]
    for (const [what, answer] of cases) {
      reply = answer
      // The caller gets an answer or a cut, never a wait without end, and nothing fails outside its call.
      const said = await fetch(`${machine.url}/_relay/ping`, { signal: AbortSignal.timeout(5_000) }).then(
        async res => `${res.status} ${await res.text().catch(() => 'cut')}`,
        () => 'cut',
      )
      assert.match(said, /^(cut|200 (said|cut)?|204 |503 .*)$/, what)
    }
    // The door still lets a device in, and the server's own page is still answered through it.
    assert.equal(typeof (await r.link()), 'string')
    socket.destroy()
  } finally {
    await r.stop()
  }
})

test('a door that gives no line answers a request for one as it answers any request, and a caller that leaves midway ends only itself', async () => {
  const home = await testHome()
  const upstream = createServer((_req, res) => void res.writeHead(200).end('the dashboard'))
  const target = await listen(upstream)
  const door = await openDoor({ env: home.env, target, port: 0, host: '127.0.0.1', knocks: () => true })
  try {
    for (const path of ['/_remote-access/line', '/']) {
      const socket = connectTcp(door.port, '127.0.0.1')
      await new Promise<void>(resolve => socket.once('connect', resolve))
      const answered = new Promise<string>(resolve => socket.once('data', (chunk: Buffer) => resolve(chunk.toString().split('\r\n')[0]!)))
      socket.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: openagent-line\r\nAuthorization: Bearer a.b\r\n\r\n`)
      assert.match(await answered, /^HTTP\/1\.1 40[14] /)
      // Left with a reset, not a goodbye.
      socket.resetAndDestroy()
    }
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal((await fetch(`http://127.0.0.1:${door.port}/`)).status, 401)
  } finally {
    await door.close()
    await shut(upstream)
    await home.remove()
  }
})

test('one call that is slow, or whose caller left, does not hold the other calls of the line', async () => {
  const r = await rig()
  try {
    await command(r.computer, 'line', 'add', await r.link())
    const machine = await until('the server’s OpenAgent saved the computer', () => r.machines[0])
    const ping = async (): Promise<number> => {
      const began = Date.now()
      assert.equal((await fetch(`${machine.url}/_relay/ping`, { signal: AbortSignal.timeout(3_000) })).status, 200)
      return Date.now() - began
    }
    await until('the line carries', () => ping().catch(() => undefined))

    // A caller that leaves without reading an answer the computer already ended takes it along.
    for (const size of [400_000, 655_360, 680_000, 704_512, 1_000_000]) {
      await new Promise<void>((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port: Number(new URL(machine.url).port), path: `/_relay/huge?${size}`, agent: false }, res => {
          res.pause()
          setTimeout(() => (res.destroy(), resolve()), 80)
        })
        req.on('error', reject).end()
      })
      assert.ok((await ping()) < 300, `the line was held after an answer of ${size} bytes nobody read`)
    }

    // A call with a large body whose answer takes its time: the line carries the others meanwhile.
    const slow = fetch(`${machine.url}/_relay/slow`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'x'.repeat(200_000) }) })
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.ok((await ping()) < 400, 'a ping waited for the slow call')
    assert.equal(await (await slow).text(), 'at last')

    // A request for a line that is refused is closed from the door's side, whatever the caller does after.
    const link = new URL(await r.link())
    const socket = connectTls({ host: '127.0.0.1', port: Number(link.port), rejectUnauthorized: false })
    await new Promise<void>(resolve => socket.once('secureConnect', resolve))
    const answered = new Promise<string>(resolve => socket.once('data', (chunk: Buffer) => resolve(chunk.toString().split('\r\n')[0]!)))
    const closed = new Promise<true>(resolve => socket.once('close', () => resolve(true)))
    socket.write('GET /_remote-access/line HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: openagent-line\r\nAuthorization: Bearer nobody.nothing\r\n\r\n')
    assert.match(await answered, /^HTTP\/1\.1 401 /)
    assert.equal(await Promise.race([closed, new Promise<false>(resolve => setTimeout(() => resolve(false), 3_000))]), true)
  } finally {
    await r.stop()
  }
})
