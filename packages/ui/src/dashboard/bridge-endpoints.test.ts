import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'
import {
  BRIDGE_PREFIX,
  EXPECTED_EXTENSION_VERSION,
  EXTENSION_VERSION_HEADER,
  handleBridgeRequest,
  type BridgeHandlers,
  type BridgeQuestion,
} from './bridge-endpoints.js'

const TOKEN = 'a'.repeat(43)

/** A server wired exactly the way `startDashboard` wires the bridge, recording what it accepts. */
async function serve(handlers: BridgeHandlers | undefined): Promise<{ url: string; got: BridgeQuestion[]; close: () => Promise<void> }> {
  const got: BridgeQuestion[] = []
  const wired = handlers ? { ...handlers, record: (q: BridgeQuestion) => void got.push(q) } : undefined
  const server: Server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    void handleBridgeRequest(req, res, pathname, wired)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    got,
    close: () =>
      new Promise<void>(resolve => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

const QUESTION = {
  sessionId: 'session_018KtaRYq8N1T9mjrJBTvrNS',
  title: 'What would you like me to do?',
  options: [{ label: 'Work on the next TODO', detail: 'the first open entry' }, { label: 'Tell you about current state' }],
  recommended: 'Work on the next TODO',
}

// `null` rather than `undefined` for "send no token": passing undefined to a defaulted
// parameter uses the default, which quietly sent a valid token and turned a 401 case into 204.
function post(url: string, body: unknown, token: string | null = TOKEN): Promise<Response> {
  return fetch(`${url}${BRIDGE_PREFIX}/question`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

test('a valid question is recorded and stamped by the daemon, not the caller (#1237)', async () => {
  const s = await serve({ token: TOKEN, record: () => {}, now: () => new Date('2026-07-26T18:00:00.000Z') })
  try {
    const res = await post(s.url, { ...QUESTION, receivedAt: 'whenever the caller likes' })
    assert.equal(res.status, 204)
    assert.equal(s.got.length, 1)
    assert.equal(s.got[0]!.title, QUESTION.title)
    assert.equal(s.got[0]!.options.length, 2)
    // The caller's own timestamp is ignored: it is the daemon's record of when it heard.
    assert.equal(s.got[0]!.receivedAt, '2026-07-26T18:00:00.000Z')
  } finally {
    await s.close()
  }
})

test('the block\'s multi, default and stop travel whole; unknown keys and false flags do not (#1554)', async () => {
  const s = await serve({ token: TOKEN, record: () => {}, now: () => new Date('2026-08-23T10:00:00.000Z') })
  try {
    const res = await post(s.url, {
      ...QUESTION,
      recommended: undefined,
      multi: true,
      options: [
        { label: 'Lint', default: true, extra: 'dropped' },
        { label: 'Tests', detail: 'slow', default: false },
        { label: 'Abandon', stop: true },
      ],
    })
    assert.equal(res.status, 204)
    assert.deepEqual(s.got, [
      {
        sessionId: QUESTION.sessionId,
        title: QUESTION.title,
        options: [{ label: 'Lint', default: true }, { label: 'Tests', detail: 'slow' }, { label: 'Abandon', stop: true }],
        multi: true,
        receivedAt: '2026-08-23T10:00:00.000Z',
      },
    ])
  } finally {
    await s.close()
  }
})

test('the bridge is off unless a token was wired, and then everything 404s (#1237)', async () => {
  const s = await serve(undefined)
  try {
    const res = await post(s.url, QUESTION)
    assert.equal(res.status, 404)
    assert.equal(s.got.length, 0)
  } finally {
    await s.close()
  }
})

test('a wrong or missing token is refused before the body is read (#1237)', async () => {
  const s = await serve({ token: TOKEN, record: () => {} })
  try {
    assert.equal((await post(s.url, QUESTION, null)).status, 401)
    assert.equal((await post(s.url, QUESTION, 'b'.repeat(43))).status, 401)
    // A token of a different length must not throw out of timingSafeEqual.
    assert.equal((await post(s.url, QUESTION, 'short')).status, 401)
    assert.equal(s.got.length, 0)
  } finally {
    await s.close()
  }
})

test('the payload is validated field by field, with a reason (#1237)', async () => {
  const s = await serve({ token: TOKEN, record: () => {} })
  try {
    const cases: [string, unknown, RegExp][] = [
      ['not JSON', '{oops', /JSON/],
      ['not an object', 42, /object/],
      ['a session id that is not one', { ...QUESTION, sessionId: '../../etc/passwd' }, /sessionId/],
      ['an empty title', { ...QUESTION, title: '   ' }, /title/],
      ['no options', { ...QUESTION, options: [] }, /options/],
      ['an option with no label', { ...QUESTION, options: [{ detail: 'x' }] }, /label/],
      ['too many options', { ...QUESTION, options: Array.from({ length: 21 }, () => ({ label: 'x' })) }, /at most/],
      // A recommendation naming no option would render a default the user cannot see.
      ['a recommendation matching nothing', { ...QUESTION, recommended: 'something else' }, /recommended/],
      // Labels double as the pick's ids (#1554), so two alike could not be told apart.
      ['two options with one label', { ...QUESTION, options: [{ label: 'Same' }, { label: 'Same' }] }, /distinct/],
      ['a multi flag that is not a boolean', { ...QUESTION, multi: 'yes' }, /multi/],
      ['a default that is not a boolean', { ...QUESTION, options: [{ label: 'x', default: 'yes' }] }, /default/],
      ['a stop that is not a boolean', { ...QUESTION, options: [{ label: 'x', stop: 1 }] }, /stop/],
    ]
    for (const [name, body, reason] of cases) {
      const res = await post(s.url, body)
      assert.equal(res.status, 400, name)
      assert.match(await res.text(), reason, name)
    }
    assert.equal(s.got.length, 0)
  } finally {
    await s.close()
  }
})

test('an oversized body is refused rather than buffered (#1237)', async () => {
  const s = await serve({ token: TOKEN, record: () => {} })
  try {
    const huge = { ...QUESTION, options: [{ label: 'x', detail: 'y'.repeat(200_000) }] }
    const res = await post(s.url, huge).catch(() => undefined)
    // The daemon destroys the request past the cap, so either a 400 or a torn-down socket is
    // correct; what matters is that nothing was recorded.
    if (res) assert.equal(res.status, 400)
    assert.equal(s.got.length, 0)
  } finally {
    await s.close()
  }
})

test('only POST reaches the question route, and ping proves reachability (#1237)', async () => {
  const s = await serve({ token: TOKEN, record: () => {} })
  try {
    const get = await fetch(`${s.url}${BRIDGE_PREFIX}/question`, { headers: { authorization: `Bearer ${TOKEN}` } })
    assert.equal(get.status, 405)
    const ping = await fetch(`${s.url}${BRIDGE_PREFIX}/ping`, { headers: { authorization: `Bearer ${TOKEN}` } })
    assert.equal(ping.status, 200)
    // The body is load-bearing, not decoration: the dashboard serves its SPA for any path it does
    // not recognise, so a build with no bridge route also answers 200, with HTML. `ok` is how a
    // client tells "the bridge is here" from "this dashboard is too old to have one".
    assert.equal((await ping.text()).trim(), 'ok')
    // Ping is guarded too: reachability is not public.
    assert.equal((await fetch(`${s.url}${BRIDGE_PREFIX}/ping`)).status, 401)
  } finally {
    await s.close()
  }
})

test('no CORS headers are offered, so a page cannot post on the user behalf (#1237)', async () => {
  const s = await serve({ token: TOKEN, record: () => {} })
  try {
    const res = await post(s.url, QUESTION)
    // A wildcard here would let any site the user visits reach their daemon. The extension
    // posts from its background worker, which needs no preflight.
    assert.equal(res.headers.get('access-control-allow-origin'), null)
  } finally {
    await s.close()
  }
})

test('the queued answer is served to the extension, and its ack travels back (#1237)', async () => {
  const acks: unknown[] = []
  const s = await serve({
    token: TOKEN,
    record: () => {},
    answer: sessionId => (sessionId === QUESTION.sessionId ? { id: 'ans-1', text: 'The user chose: Work on the next TODO.' } : undefined),
    answered: (sessionId, id, ok, note) => void acks.push({ sessionId, id, ok, note }),
  })
  try {
    const hit = await fetch(`${s.url}${BRIDGE_PREFIX}/answer?sessionId=${QUESTION.sessionId}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    assert.equal(hit.status, 200)
    assert.deepEqual(await hit.json(), { answer: { id: 'ans-1', text: 'The user chose: Work on the next TODO.' } })

    const miss = await fetch(`${s.url}${BRIDGE_PREFIX}/answer?sessionId=session_01Unknown`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    assert.equal(miss.status, 200)
    assert.deepEqual(await miss.json(), { answer: null })

    const bad = await fetch(`${s.url}${BRIDGE_PREFIX}/answer?sessionId=not-a-session`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    assert.equal(bad.status, 400)

    const ack = await fetch(`${s.url}${BRIDGE_PREFIX}/answered`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ sessionId: QUESTION.sessionId, id: 'ans-1', ok: true }),
    })
    assert.equal(ack.status, 204)
    assert.deepEqual(acks, [{ sessionId: QUESTION.sessionId, id: 'ans-1', ok: true, note: undefined }])

    const badAck = await fetch(`${s.url}${BRIDGE_PREFIX}/answered`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ sessionId: QUESTION.sessionId, id: 'ans-1', ok: 'yes' }),
    })
    assert.equal(badAck.status, 400)
  } finally {
    await s.close()
  }
})

test('the answer routes demand the bearer token like every other one (#1237)', async () => {
  const s = await serve({ token: TOKEN, record: () => {}, answer: () => ({ id: 'x', text: 'y' }), answered: () => {} })
  try {
    const read = await fetch(`${s.url}${BRIDGE_PREFIX}/answer?sessionId=${QUESTION.sessionId}`)
    assert.equal(read.status, 401)
    const ack = await fetch(`${s.url}${BRIDGE_PREFIX}/answered`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: QUESTION.sessionId, id: 'x', ok: true }),
    })
    assert.equal(ack.status, 401)
  } finally {
    await s.close()
  }
})

test('a daemon with no answer source degrades to null rather than failing (#1237)', async () => {
  const s = await serve({ token: TOKEN, record: () => {} })
  try {
    const res = await fetch(`${s.url}${BRIDGE_PREFIX}/answer?sessionId=${QUESTION.sessionId}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { answer: null })
  } finally {
    await s.close()
  }
})

test('a version-skewed or version-silent extension is refused on every route, both versions named (#1519)', async () => {
  const seen: { got: string; blocked: boolean }[] = []
  const s = await serve({
    token: TOKEN,
    record: () => {},
    expectedExtensionVersion: '9.9.9',
    extensionVersion: (got, blocked) => void seen.push({ got, blocked }),
  })
  try {
    // No header at all is exactly the dangerous case: an extension too old to announce itself.
    const bare = await post(s.url, QUESTION)
    assert.equal(bare.status, 426)
    const text = await bare.text()
    assert.match(text, /unknown/)
    assert.match(text, /9\.9\.9/)
    assert.match(text, /chrome:\/\/extensions/)
    // A wrong version is refused everywhere, ping included: no degraded mode.
    const ping = await fetch(`${s.url}${BRIDGE_PREFIX}/ping`, {
      headers: { authorization: `Bearer ${TOKEN}`, [EXTENSION_VERSION_HEADER]: '0.0.1' },
    })
    assert.equal(ping.status, 426)
    // The matching version passes, and its claim is recorded too — that is what clears a
    // blocked banner once the extension is updated.
    const ok = await fetch(`${s.url}${BRIDGE_PREFIX}/ping`, {
      headers: { authorization: `Bearer ${TOKEN}`, [EXTENSION_VERSION_HEADER]: '9.9.9' },
    })
    assert.equal(ok.status, 200)
    assert.equal(s.got.length, 0)
    assert.deepEqual(seen, [
      { got: 'unknown', blocked: true },
      { got: '0.0.1', blocked: true },
      { got: '9.9.9', blocked: false },
    ])
  } finally {
    await s.close()
  }
})

test('the version gate sits behind the token, so an unauthenticated caller learns nothing (#1519)', async () => {
  const seen: string[] = []
  const s = await serve({
    token: TOKEN,
    record: () => {},
    expectedExtensionVersion: '9.9.9',
    extensionVersion: got => void seen.push(got),
  })
  try {
    assert.equal((await post(s.url, QUESTION, null)).status, 401)
    assert.equal((await post(s.url, QUESTION, 'b'.repeat(43))).status, 401)
    assert.deepEqual(seen, [])
  } finally {
    await s.close()
  }
})

test('the expected version and the extension manifest move in lockstep (#1519)', () => {
  // Resolved from the compiled test's own location (dist-test/dashboard/) to the repo's
  // extension package, so bumping one without the other fails here instead of in someone's browser.
  const manifest = JSON.parse(readFileSync(new URL('../../../chrome-extension/manifest.json', import.meta.url), 'utf8')) as {
    version: string
  }
  assert.equal(EXPECTED_EXTENSION_VERSION, manifest.version)
})

test('the extension states its version in the header the daemon reads', () => {
  // The two files of the extension that call the daemon each write the header's name themselves:
  // renaming it on one side only would have every call refused as "unknown" in someone's browser.
  for (const file of ['background.js', 'options.js']) {
    const source = readFileSync(new URL(`../../../chrome-extension/${file}`, import.meta.url), 'utf8')
    assert.ok(source.includes(`'${EXTENSION_VERSION_HEADER}': chrome.runtime.getManifest().version`), file)
  }
})

test('the start-queue is served to the extension and its report travels back (#1328)', async () => {
  const reports: { id: string; ok: boolean; sessionId?: string; note?: string }[] = []
  let pending: { id: string; repo: string; branch: string; prompt: string; model?: string } | undefined = {
    id: 'req-1',
    repo: 'openagt/openagent',
    branch: 'cloud-1-abcd1234',
    prompt: 'Spike and plan the queue ticket',
    model: 'sonnet',
  }
  const s = await serve({
    token: TOKEN,
    record: () => {},
    // Claim-on-read, as the daemon wires it: a second poll must not be handed the same request.
    start: () => {
      const next = pending
      pending = undefined
      return next
    },
    started: (id, ok, sessionId, note) => void reports.push({ id, ok, ...(sessionId ? { sessionId } : {}), ...(note ? { note } : {}) }),
  })
  try {
    const first = await fetch(`${s.url}${BRIDGE_PREFIX}/start`, { headers: { authorization: `Bearer ${TOKEN}` } })
    assert.equal(first.status, 200)
    assert.deepEqual(await first.json(), {
      start: { id: 'req-1', repo: 'openagt/openagent', branch: 'cloud-1-abcd1234', prompt: 'Spike and plan the queue ticket', model: 'sonnet' },
    })

    const second = await fetch(`${s.url}${BRIDGE_PREFIX}/start`, { headers: { authorization: `Bearer ${TOKEN}` } })
    assert.deepEqual(await second.json(), { start: null }, 'claimed, so the next poll gets nothing')

    const ack = await fetch(`${s.url}${BRIDGE_PREFIX}/started`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ id: 'req-1', ok: true, sessionId: 'session_018KtaRYq8N1T9mjrJBTvrNS' }),
    })
    assert.equal(ack.status, 204)
    assert.deepEqual(reports, [{ id: 'req-1', ok: true, sessionId: 'session_018KtaRYq8N1T9mjrJBTvrNS' }])
  } finally {
    await s.close()
  }
})

test('a daemon with no start-queue degrades to null rather than failing (#1328)', async () => {
  const s = await serve({ token: TOKEN, record: () => {} })
  try {
    const res = await fetch(`${s.url}${BRIDGE_PREFIX}/start`, { headers: { authorization: `Bearer ${TOKEN}` } })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { start: null })
    const ack = await fetch(`${s.url}${BRIDGE_PREFIX}/started`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ id: 'req-1', ok: true, sessionId: 'session_018KtaRYq8N1T9mjrJBTvrNS' }),
    })
    assert.equal(ack.status, 204, 'accepted and dropped')
  } finally {
    await s.close()
  }
})

test('the start report is validated field by field, and the routes demand the token (#1328)', async () => {
  const s = await serve({ token: TOKEN, record: () => {}, start: () => undefined, started: () => {} })
  const send = (body: unknown): Promise<Response> =>
    fetch(`${s.url}${BRIDGE_PREFIX}/started`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
    })
  try {
    assert.equal((await send({ ok: true })).status, 400, 'no id')
    assert.equal((await send({ id: 'x'.repeat(65), ok: true })).status, 400, 'absurd id')
    assert.equal((await send({ id: 'r', ok: 'yes' })).status, 400, 'ok must be a boolean')
    assert.equal((await send({ id: 'r', ok: true, sessionId: 'not-a-session' })).status, 400, 'bad session id')
    assert.equal((await send({ id: 'r', ok: false, note: 42 })).status, 400, 'note must be a string')
    assert.equal((await send({ id: 'r', ok: false })).status, 204, 'a plain failure is fine')
    assert.equal((await fetch(`${s.url}${BRIDGE_PREFIX}/start`)).status, 401)
    assert.equal((await fetch(`${s.url}${BRIDGE_PREFIX}/started`, { method: 'POST' })).status, 401)
    assert.equal((await fetch(`${s.url}${BRIDGE_PREFIX}/start`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } })).status, 405)
  } finally {
    await s.close()
  }
})

test('the session list says whether an answer is queued for each session (#1332)', async () => {
  const s = await serve({
    token: TOKEN,
    record: () => {},
    sessions: async () => [
      { id: 'session_A', url: 'https://claude.ai/code/session_A', answerQueued: false },
      { id: 'session_B', url: 'https://claude.ai/code/session_B', answerQueued: true },
    ],
  })
  try {
    const res = await fetch(`${s.url}${BRIDGE_PREFIX}/sessions`, { headers: { authorization: `Bearer ${TOKEN}` } })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), {
      sessions: [
        { id: 'session_A', url: 'https://claude.ai/code/session_A', answerQueued: false },
        { id: 'session_B', url: 'https://claude.ai/code/session_B', answerQueued: true },
      ],
    })
  } finally {
    await s.close()
  }
})

test("the Driver's list statuses are validated, stamped by the daemon and handed on (#1332)", async () => {
  const got: unknown[] = []
  const s = await serve({ token: TOKEN, record: () => {}, statuses: batch => void got.push(...batch), now: () => new Date('2026-08-25T18:00:00.000Z') })
  const send = (body: unknown): Promise<Response> =>
    fetch(`${s.url}${BRIDGE_PREFIX}/statuses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
    })
  try {
    const res = await send({
      statuses: [
        { sessionId: 'session_A', status: 'awaiting', at: 'whenever the caller likes' },
        // A label the extension did not know travels verbatim, cut to a sane length; a known
        // status carries none.
        { sessionId: 'session_B', status: 'unknown', label: 'Something new '.repeat(20) },
        { sessionId: 'session_C', status: 'idle', label: '' },
      ],
    })
    assert.equal(res.status, 204)
    assert.deepEqual(got, [
      { sessionId: 'session_A', status: 'awaiting', at: '2026-08-25T18:00:00.000Z' },
      { sessionId: 'session_B', status: 'unknown', label: 'Something new '.repeat(20).slice(0, 80), at: '2026-08-25T18:00:00.000Z' },
      { sessionId: 'session_C', status: 'idle', at: '2026-08-25T18:00:00.000Z' },
    ])

    got.length = 0
    assert.equal((await send([])).status, 400, 'not an object')
    assert.equal((await send({ statuses: [] })).status, 400, 'empty')
    assert.equal((await send({ statuses: [{ sessionId: 'nope', status: 'idle' }] })).status, 400, 'bad session id')
    assert.equal((await send({ statuses: [{ sessionId: 'session_A', status: 'busy' }] })).status, 400, 'a status the daemon does not know')
    assert.equal((await send({ statuses: [{ sessionId: 'session_A', status: 'idle', label: 3 }] })).status, 400, 'label must be a string')
    // One bad entry refuses the whole batch: nothing partial reaches the store.
    assert.equal((await send({ statuses: [{ sessionId: 'session_A', status: 'idle' }, { sessionId: 'session_B', status: 'busy' }] })).status, 400)
    assert.deepEqual(got, [])
    assert.equal((await fetch(`${s.url}${BRIDGE_PREFIX}/statuses`, { headers: { authorization: `Bearer ${TOKEN}` } })).status, 405)
    assert.equal((await fetch(`${s.url}${BRIDGE_PREFIX}/statuses`, { method: 'POST' })).status, 401)
  } finally {
    await s.close()
  }
})

test('a daemon that keeps no list statuses accepts and drops them (#1332)', async () => {
  const s = await serve({ token: TOKEN, record: () => {} })
  try {
    const res = await fetch(`${s.url}${BRIDGE_PREFIX}/statuses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ statuses: [{ sessionId: 'session_A', status: 'awaiting' }] }),
    })
    assert.equal(res.status, 204)
  } finally {
    await s.close()
  }
})
