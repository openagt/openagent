import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { ASK_BUSY, ASK_DENIED, ASK_PATH, ENTER_PATH, openDoor, readBearer, type Door } from './door.js'
import { askAt, cancelAt, doorOrigin, hearAt, mayAnswerAsks, waitingAsks } from './pair.js'
import { ASK_LIFETIME_MS, DENIED_WAIT_MS, MAX_ASKS, addAsk, answerAsk, readStore, update } from './store.js'
import { testHome } from './test-home.js'

/** A door on the Wi-Fi with a clock the test moves, and OpenAgent behind it. */
async function rig(): Promise<{ env: NodeJS.ProcessEnv; at: string; clock: { now: number }; door: Door; close: () => Promise<void> }> {
  const home = await testHome()
  await update(home.env, store => {
    store.on = true
  })
  const upstream: Server = createServer((_req, res) => res.writeHead(200).end('the dashboard'))
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const clock = { now: Date.parse('2026-10-23T12:00:00Z') }
  const door = await openDoor({ env: home.env, target: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`, port: 0, host: '127.0.0.1', now: () => clock.now, askHoldMs: 300 })
  return {
    env: home.env,
    at: `http://127.0.0.1:${door.port}`,
    clock,
    door,
    async close() {
      await door.close()
      upstream.closeAllConnections()
      await new Promise<void>(resolve => upstream.close(() => resolve()))
      await home.remove()
    },
  }
}

test('a computer asks with its name, waits for Allow, and hears the code it gets in with, once; it then gets in as with any code', async () => {
  const r = await rig()
  try {
    const asked = await askAt(r.at, 'Adas-MacBook')
    assert.ok(asked.ok)
    assert.match(asked.value.number, /^\d{6}$/)
    // The page here shows it, with the same number; the file keeps no secret of it.
    const [waiting] = waitingAsks(await readStore(r.env), r.clock.now)
    assert.deepEqual({ name: waiting!.name, number: waiting!.number }, { name: 'Adas-MacBook', number: asked.value.number })
    assert.equal(JSON.stringify(await readStore(r.env)).includes(asked.value.secret), false)

    // Nobody pressed anything yet: the look is held a while, then says it still waits.
    const started = Date.now()
    assert.deepEqual(await hearAt(r.at, asked.value.secret), { ok: true, value: { state: 'waiting', expires: waiting!.expires } })
    assert.ok(Date.now() - started >= 250, 'held open')
    // A wrong secret hears nothing of it.
    assert.deepEqual(await hearAt(r.at, 'not-the-secret'), { ok: true, value: { state: 'gone' } })

    // Allowed while a look is held open: that look hears it at once.
    const hearing = hearAt(r.at, asked.value.secret)
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(await answerAsk(r.env, waiting!.id, 'allowed', r.clock.now), true)
    const heard = await hearing
    assert.ok(heard.ok && heard.value.state === 'allowed')
    const link = new URL(heard.value.link)
    assert.equal(link.pathname, ENTER_PATH)
    // Heard once: the ask is gone, and so is the popup.
    assert.deepEqual(await hearAt(r.at, asked.value.secret), { ok: true, value: { state: 'gone' } })
    assert.deepEqual(waitingAsks(await readStore(r.env), r.clock.now), [])

    // The code gets the computer in, once, as any code a person shows.
    const enter = (): Promise<Response> => fetch(`${r.at}${ENTER_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: link.hash.slice(1), computer: 'Adas-MacBook' }) })
    const first = await enter()
    assert.equal(first.status, 200)
    assert.ok(readBearer(`Bearer ${((await first.json()) as { key: string }).key}`))
    assert.equal((await enter()).status, 403)
    assert.deepEqual((await readStore(r.env)).devices.map(device => device.name), ['OpenAgent on Adas-MacBook'])
  } finally {
    await r.close()
  }
})

test('two looks held open at once: only one of them is handed the code', async () => {
  const r = await rig()
  try {
    const asked = await askAt(r.at, 'Adas-MacBook')
    assert.ok(asked.ok)
    const looks = [hearAt(r.at, asked.value.secret), hearAt(r.at, asked.value.secret)]
    await new Promise(resolve => setTimeout(resolve, 50))
    const [waiting] = waitingAsks(await readStore(r.env), r.clock.now)
    await answerAsk(r.env, waiting!.id, 'allowed', r.clock.now)
    const states = (await Promise.all(looks)).map(heard => (heard.ok ? heard.value.state : heard.error)).sort()
    assert.deepEqual(states, ['allowed', 'gone'])
    assert.equal((await readStore(r.env)).codes.length, 1, 'one code made')
  } finally {
    await r.close()
  }
})

test('denied, the computer hears so, and its address waits a minute before it asks again', async () => {
  const r = await rig()
  try {
    const asked = await askAt(r.at, 'a guest')
    assert.ok(asked.ok)
    const [waiting] = waitingAsks(await readStore(r.env), r.clock.now)
    assert.equal(await answerAsk(r.env, waiting!.id, 'denied', r.clock.now), true)
    assert.deepEqual(await hearAt(r.at, asked.value.secret), { ok: true, value: { state: 'denied' } })
    // Its popup is gone at once, and nothing lets it in.
    assert.deepEqual(waitingAsks(await readStore(r.env), r.clock.now), [])
    assert.equal(await answerAsk(r.env, waiting!.id, 'allowed', r.clock.now), false)
    assert.deepEqual(await askAt(r.at, 'a guest'), { ok: false, error: ASK_DENIED })
    // Taking its ask away does not end the wait.
    assert.equal(await cancelAt(r.at, asked.value.secret), true)
    assert.deepEqual(await askAt(r.at, 'a guest'), { ok: false, error: ASK_DENIED })
    r.clock.now += DENIED_WAIT_MS
    assert.ok((await askAt(r.at, 'a guest')).ok, 'a minute later')
  } finally {
    await r.close()
  }
})

test('an ask waits two minutes, and the computer that gives up takes it away', async () => {
  const r = await rig()
  try {
    const asked = await askAt(r.at, 'Adas-MacBook')
    assert.ok(asked.ok)
    r.clock.now += ASK_LIFETIME_MS
    assert.deepEqual(waitingAsks(await readStore(r.env), r.clock.now), [])
    assert.deepEqual(await hearAt(r.at, asked.value.secret), { ok: true, value: { state: 'gone' } })
    const again = await askAt(r.at, 'Adas-MacBook')
    assert.ok(again.ok)
    assert.equal(waitingAsks(await readStore(r.env), r.clock.now).length, 1)
    assert.equal(await cancelAt(r.at, again.value.secret), true)
    assert.deepEqual(waitingAsks(await readStore(r.env), r.clock.now), [])
  } finally {
    await r.close()
  }
})

test('one popup per asking computer, and three at once: a fourth is told to try later', async () => {
  const home = await testHome()
  try {
    const now = Date.parse('2026-10-23T12:00:00Z')
    const first = await addAsk(home.env, 'Ada', '192.168.1.5', now)
    const again = await addAsk(home.env, 'Ada', '192.168.1.5', now)
    assert.ok(typeof first === 'object' && typeof again === 'object')
    // Pressed again: its new ask is in the place of the old one, whose secret hears nothing.
    const store = await readStore(home.env)
    assert.deepEqual(store.asks.map(ask => ask.id), [again.ask.id])
    for (let other = 1; other < MAX_ASKS; other++) assert.equal(typeof (await addAsk(home.env, 'another', `192.168.1.${10 + other}`, now)), 'object')
    assert.equal(waitingAsks({ ...(await readStore(home.env)), on: true }, now).length, MAX_ASKS)
    assert.equal(await addAsk(home.env, 'one too many', '192.168.1.99', now), 'busy')
    // One that is answered no longer takes a place on the screen.
    await answerAsk(home.env, again.ask.id, 'allowed', now)
    assert.equal(typeof (await addAsk(home.env, 'next', '192.168.1.99', now)), 'object')
  } finally {
    await home.remove()
  }
})

test('a door takes asks from a computer, never from a page, and says why it turns one away', async () => {
  const r = await rig()
  try {
    const post = (headers: Record<string, string>, body: unknown): Promise<Response> => fetch(`${r.at}${ASK_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    // A site a browser here opens puts no popup on this screen.
    assert.equal((await post({ origin: 'https://evil.example' }, { computer: 'x' })).status, 403)
    assert.equal((await post({ cookie: 'a=b' }, { computer: 'x' })).status, 403)
    assert.equal((await post({}, { computer: '  ' })).status, 400)
    assert.equal((await fetch(`${r.at}${ASK_PATH}`)).status, 401)
    assert.deepEqual((await readStore(r.env)).asks, [])
    // As many as wait at once: one more is told to try later.
    await update(r.env, store => {
      store.asks = Array.from({ length: MAX_ASKS }, (_, at) => ({ id: `a0000${at}`, secret: '0'.repeat(64), name: 'x', number: '000000', from: `192.168.1.${at + 2}`, expires: new Date(r.clock.now + 60_000).toISOString() }))
    })
    const busy = await post({}, { computer: 'one too many' })
    assert.equal(busy.status, 503)
    assert.equal(await busy.text(), ASK_BUSY)
  } finally {
    await r.close()
  }
})

test('the asks are shown only while the door is open on the Wi-Fi, and never to a person the owner invited', () => {
  const ask = { id: 'abc123', secret: '0'.repeat(64), name: 'Ada', number: '123456', from: '192.168.1.5', expires: '2026-10-23T12:02:00Z' }
  const store = { on: true, persons: [], devices: [], codes: [], lines: [], asks: [ask] }
  const now = Date.parse('2026-10-23T12:00:00Z')
  assert.deepEqual(waitingAsks(store, now), [{ id: 'abc123', name: 'Ada', number: '123456', expires: '2026-10-23T12:02:00Z' }])
  assert.deepEqual(waitingAsks({ ...store, on: false }, now), [])
  assert.deepEqual(waitingAsks({ ...store, https: { address: '203.0.113.7' } }, now), [])
  assert.equal(mayAnswerAsks({}), true)
  assert.equal(mayAnswerAsks({ OPENAGENT_CALLER: 'Rom' }), false)
})

test('a door found on the Wi-Fi is asked at its plain address, and at nothing else', () => {
  assert.equal(doorOrigin('http://192.168.1.5:4201'), 'http://192.168.1.5:4201')
  assert.equal(doorOrigin('http://192.168.1.5:4201/'), 'http://192.168.1.5:4201')
  for (const bad of ['https://192.168.1.5:4201', 'http://192.168.1.5:4201/_devices/enter', 'file:///etc', 'nothing']) assert.equal(doorOrigin(bad), undefined, bad)
})
