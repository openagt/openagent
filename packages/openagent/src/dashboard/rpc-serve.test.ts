import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createServer, type Server } from 'node:http'
import { connect } from 'node:net'
import { makeRpcMount, type DashboardContext } from './rpc-serve.js'
import { RPC_HANDLERS } from '../dashboard-rpc/index.js'
import { testDashboardContext } from '../dashboard-rpc/test-context.js'

// F3: the dashboard's transport is `POST /_rpc/<name>` and `GET /_rpc/events`, where it used to be
// Telefunc. The CSRF and rebound-Host guards are covered in server.test.ts, which exercises them
// through the whole dashboard; these pin the dispatch itself.

/** A server carrying just the mount, so a test can call it over real HTTP. */
async function mounted(over: Partial<DashboardContext> = {}): Promise<{ url: string; close: () => Promise<void> }> {
  const mount = makeRpcMount(testDashboardContext(over))
  const server: Server = createServer((req, res) => {
    void mount(req, res).then(handled => {
      if (!handled) {
        res.writeHead(404)
        res.end()
      }
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

const call = async (url: string, name: string, args: unknown[] = []): Promise<{ status: number; body: string }> => {
  const res = await fetch(`${url}/_rpc/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args),
  })
  return { status: res.status, body: await res.text() }
}

/** One request over a raw socket, so a header `fetch` refuses to send can be put on the wire. */
const rawRequest = (url: string, hostHeader: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const socket = connect(Number(new URL(url).port), '127.0.0.1', () => {
      socket.write(`POST /_rpc/onProjects HTTP/1.1\r\n${hostHeader}\r\nContent-Length: 2\r\nConnection: close\r\n\r\n[]`)
    })
    let seen = ''
    socket.setEncoding('utf8')
    socket.on('data', chunk => (seen += chunk))
    socket.on('end', () => resolve(seen))
    socket.on('error', reject)
  })

test('a request whose Host header is malformed is answered, not thrown past the server', async () => {
  // Node's parser accepts `Host:` (empty — so the `?? 'localhost'` fallback never applied) and
  // `Host: foo bar`; interpolating either into the parse base threw where nothing caught it, so
  // any local process could end the daemon with one request it never answered.
  const server = await mounted()
  try {
    for (const host of ['Host:', 'Host: foo bar']) {
      assert.match(await rawRequest(server.url, host), /^HTTP\/1\.1 \d{3}/, host)
    }
    // Still serving.
    assert.equal((await call(server.url, 'onNothingLikeThis')).status, 404)
  } finally {
    await server.close()
  }
})

test('every RPC the modules export is dispatchable by its own name', () => {
  // The registry is built from the modules' exports rather than a hand-written list, which is what
  // makes "exported but never registered" impossible — the failure that shipped per-project
  // preferences broken (#866) as a 400 with nothing else to go on.
  for (const name of ['onAgents', 'onProjects', 'sendStop', 'onPreferences', 'onQuota', 'onMachines']) {
    assert.equal(typeof RPC_HANDLERS[name], 'function', name)
  }
})

test('a call reaches its handler and comes back as JSON', async () => {
  const server = await mounted()
  try {
    const { status, body } = await call(server.url, 'sendStart', ['p1', 'do a thing', 'build'])
    assert.equal(status, 200)
    // The stub context refuses the start, which is the handler's own answer travelling back.
    assert.deepEqual(JSON.parse(body), { ret: { ok: false, error: 'not wired in this test' } })
  } finally {
    await server.close()
  }
})

test('an unknown RPC is a 404 naming it, not a hang or a crash', async () => {
  const server = await mounted()
  try {
    const { status, body } = await call(server.url, 'onNothingLikeThis')
    assert.equal(status, 404)
    assert.match(body, /no such RPC: onNothingLikeThis/)
  } finally {
    await server.close()
  }
})

test('an inherited Object member is not an RPC', async () => {
  // The name is a path segment off an unauthenticated request, indexed straight into the handler
  // table. With `Object.prototype` behind it, `/_rpc/constructor` found `Object` and answered 200
  // with whatever the caller sent; `__proto__` and `toString` reached members that are not
  // handlers and 500'd. None of them is an RPC, so all of them are 404s.
  const server = await mounted()
  try {
    for (const name of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
      const { status, body } = await call(server.url, name, [{ smuggled: true }])
      assert.equal(status, 404, `${name} answered ${status}`)
      assert.match(body, new RegExp(`no such RPC: ${name.replace(/\W/g, '.')}`))
    }
  } finally {
    await server.close()
  }
})

test('an RPC that throws answers 500 and the daemon stays up', async () => {
  // A rejected promise inside the mount used to be an unhandled rejection, which takes the process
  // with it. A failing call is a failing call.
  const server = await mounted({
    startAgent: () => {
      throw new Error('the disk is on fire')
    },
  })
  try {
    const { status, body } = await call(server.url, 'sendStart', ['p1', 'x', 'build'])
    assert.equal(status, 500)
    assert.match(JSON.parse(body).error, /the disk is on fire/)
    // Still serving.
    assert.equal((await call(server.url, 'onNothingLikeThis')).status, 404)
  } finally {
    await server.close()
  }
})

test('a request outside the RPC prefix is declined, so the static handler gets it', async () => {
  const server = await mounted()
  try {
    const res = await fetch(`${server.url}/assets/app.js`)
    assert.equal(res.status, 404) // the test server's own fallback, i.e. the mount said "not mine"
  } finally {
    await server.close()
  }
})

test('the event stream ends cleanly when there is nothing to stream', async () => {
  // An unknown project: the response ends rather than erroring, which is what the client reads as
  // "done" instead of "lost" — the distinction that lets a dead daemon look different from a
  // quiet agent (#948).
  const server = await mounted()
  try {
    const res = await fetch(`${server.url}/_rpc/events?projectId=no-such-project`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/)
    assert.equal(await res.text(), '')
  } finally {
    await server.close()
  }
})

test('the event stream sends one SSE frame per event', async () => {
  // A relayed agent (#1067): an in-memory source, which is the branch that does not tail a file.
  async function* source() {
    yield { kind: 'session-update', sessionId: 'one' } as const
    yield { kind: 'session-update', sessionId: 'two' } as const
  }
  const server = await mounted({ eventsSource: () => source() })
  try {
    const res = await fetch(`${server.url}/_rpc/events?projectId=p1&agentId=r1`)
    const text = await res.text()
    const events = text
      .split('\n\n')
      .filter(Boolean)
      .map(frame => JSON.parse(frame.replace(/^data: /, '')) as { sessionId?: string })
    assert.deepEqual(events.map(e => e.sessionId), ['one', 'two'])
  } finally {
    await server.close()
  }
})
