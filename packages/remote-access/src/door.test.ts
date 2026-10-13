import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { DEVICE_COOKIE, ENTER_PATH, openDoor, readBearer, readEntry, type Door } from './door.js'
import { COMPUTER_HEADER, addCode, enter, readStore, removeDevice, sha256, type Entry } from './store.js'
import { testHome } from './test-home.js'

// The door in front of a stand-in for OpenAgent: a real server on this machine that records what
// it was asked and answers what a test tells it to.

interface Asked {
  method: string
  url: string
  headers: IncomingMessage['headers']
  body: string
}

interface Rig {
  env: NodeJS.ProcessEnv
  door: Door
  /** The door's address, as a device knows it. */
  at: string
  /** OpenAgent's address, as the door knows it. */
  target: string
  asked: Asked[]
  /** What the stand-in answers next; a plain page when unset. */
  answer?: ((req: IncomingMessage, res: ServerResponse) => void) | undefined
  clock: { now: number }
  /** A device that is in, and the cookie it carries. */
  letIn(name?: string): Promise<{ entry: Entry; cookie: string }>
  close(): Promise<void>
}

async function rig(knocks?: (peer: string | undefined) => boolean): Promise<Rig> {
  const home = await testHome()
  const asked: Asked[] = []
  const clock = { now: Date.now() }
  let self: Rig
  const upstream: Server = createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8').on('data', chunk => (body += chunk))
    req.on('end', () => {
      asked.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body })
      if (self.answer) self.answer(req, res)
      else res.writeHead(200, { 'content-type': 'text/html', 'x-from': 'openagent' }).end('<p>the dashboard</p>')
    })
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const target = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`
  const door = await openDoor({ env: home.env, target, port: 0, host: '127.0.0.1', now: () => clock.now, ...(knocks ? { knocks } : {}) })
  self = {
    env: home.env,
    door,
    at: `http://127.0.0.1:${door.port}`,
    target,
    asked,
    clock,
    async letIn(name = 'a phone') {
      const entry = (await enter(home.env, (await addCode(home.env)).code, name))!
      return { entry, cookie: `${DEVICE_COOKIE}=${entry.id}.${entry.key}` }
    },
    async close() {
      await door.close()
      upstream.closeAllConnections()
      await new Promise<void>(resolve => upstream.close(() => resolve()))
      await home.remove()
    },
  }
  return self
}

test('a device that is not in gets the page that says how to get in, and nothing reaches OpenAgent', async () => {
  const r = await rig()
  try {
    const page = await fetch(`${r.at}/settings`, { headers: { accept: 'text/html' } })
    assert.equal(page.status, 401)
    assert.match(await page.text(), /This device is not in[\s\S]*On the computer that runs OpenAgent, open Settings, find Devices, press Add device/)
    const call = await fetch(`${r.at}/_rpc/onProjects`, { method: 'POST', body: '[]' })
    assert.equal(call.status, 401)
    const wrongKey = await fetch(`${r.at}/`, { headers: { cookie: `${DEVICE_COOKIE}=nobody.nothing` } })
    assert.equal(wrongKey.status, 401)
    assert.deepEqual(r.asked, [])
  } finally {
    await r.close()
  }
})

test('an address that is not on one of this computer\'s networks is turned away before anything else, key or not', async () => {
  const peers: (string | undefined)[] = []
  const r = await rig(peer => {
    peers.push(peer)
    return false
  })
  try {
    const { cookie } = await r.letIn()
    assert.equal((await fetch(`${r.at}/`, { headers: { cookie } })).status, 403)
    assert.equal((await fetch(`${r.at}${ENTER_PATH}`)).status, 403)
    assert.equal((await fetch(`${r.at}${ENTER_PATH}`, { method: 'POST', body: JSON.stringify({ code: (await addCode(r.env)).code }) })).status, 403)
    assert.deepEqual(r.asked, [])
    assert.equal((await readStore(r.env)).codes.length, 1, 'its code is not spent')
    assert.ok(peers.every(peer => peer === '127.0.0.1'), 'asked with the address the request came from')
  } finally {
    await r.close()
  }
})

test('a scanned code opens a page that spends nothing by itself; sending the code lets the device in, once', async () => {
  const r = await rig()
  try {
    const { code } = await addCode(r.env)
    const page = await fetch(`${r.at}${ENTER_PATH}`)
    assert.equal(page.status, 200)
    assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'none'/)
    assert.ok(!(await page.text()).includes(code))
    assert.equal((await readStore(r.env)).codes.length, 1, 'opening the address spent nothing')

    const send = (sent: string, headers: Record<string, string> = {}): Promise<Response> =>
      fetch(`${r.at}${ENTER_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (iPhone) Version/18.0 Safari/604.1', ...headers }, body: JSON.stringify({ code: sent }) })
    assert.equal((await send('a guess')).status, 403)
    assert.equal((await send(code, { origin: 'http://evil.example' })).status, 403, 'another site cannot send a code for this device')
    assert.equal((await readStore(r.env)).codes.length, 1)

    const entered = await send(code, { origin: r.at })
    assert.equal(entered.status, 200)
    const cookie = entered.headers.get('set-cookie') ?? ''
    assert.match(cookie, new RegExp(`^${DEVICE_COOKIE}=[^;]+; HttpOnly; SameSite=Lax; Path=/; Max-Age=\\d+$`))
    const entry = readEntry(cookie.split(';')[0])!
    const store = await readStore(r.env)
    assert.deepEqual(store.devices.map(device => [device.id, device.name]), [[entry.id, 'iPhone, Safari']])
    assert.equal((await send(code)).status, 403, 'a code works once')

    const inside = await fetch(`${r.at}/`, { headers: { cookie: cookie.split(';')[0]! } })
    assert.equal(inside.status, 200)
    assert.equal(await inside.text(), '<p>the dashboard</p>')
    assert.deepEqual(r.asked.map(a => a.url), ['/'], 'nothing of getting in reached OpenAgent')
  } finally {
    await r.close()
  }
})

test('a request of a device that is in is passed on as this computer\'s own browser would make it', async () => {
  const r = await rig()
  try {
    const { cookie } = await r.letIn()
    r.answer = (_req, res) => res.writeHead(201, { 'content-type': 'application/json', 'x-from': 'openagent' }).end('{"ret":1}')
    const answer = await fetch(`${r.at}/_rpc/sendStart?x=1`, {
      method: 'POST',
      headers: { cookie: `theme=dark; ${cookie}`, origin: r.at, referer: `${r.at}/settings`, 'content-type': 'application/json' },
      body: '["hello"]',
    })
    assert.equal(answer.status, 201)
    assert.equal(answer.headers.get('x-from'), 'openagent')
    assert.equal(await answer.text(), '{"ret":1}')
    const [asked] = r.asked
    assert.equal(asked!.method, 'POST')
    assert.equal(asked!.url, '/_rpc/sendStart?x=1')
    assert.equal(asked!.body, '["hello"]')
    assert.equal(asked!.headers.host, new URL(r.target).host, 'asked at its own address')
    assert.equal(asked!.headers.origin, r.target, 'from its own page')
    assert.equal(asked!.headers.referer, undefined)
    assert.equal(asked!.headers.cookie, 'theme=dark', 'OpenAgent never sees the device\'s key')
  } finally {
    await r.close()
  }
})

test('a page of another site cannot make a device that is in ask anything', async () => {
  const r = await rig()
  try {
    const { cookie } = await r.letIn()
    const answer = await fetch(`${r.at}/_rpc/sendStart`, { method: 'POST', headers: { cookie, origin: 'http://evil.example' }, body: '[]' })
    assert.equal(answer.status, 403)
    assert.deepEqual(r.asked, [])
  } finally {
    await r.close()
  }
})

test('the door\'s own paths are never passed on', async () => {
  const r = await rig()
  try {
    const { cookie } = await r.letIn()
    assert.equal((await fetch(`${r.at}/_remote-access/anything`, { headers: { cookie } })).status, 404)
    assert.deepEqual(r.asked, [])
  } finally {
    await r.close()
  }
})

test('a removed device is out at its next request, and loses the live feed it held open', async () => {
  const r = await rig()
  try {
    const { entry, cookie } = await r.letIn()
    const other = await r.letIn('another phone')
    // A feed: its first line now, its end never.
    r.answer = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: first\n\n')
    }
    const feed = await fetch(`${r.at}/_rpc/events`, { headers: { cookie } })
    const reader = feed.body!.getReader()
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: first\n\n', 'a line arrives while the feed is still open')
    const othersFeed = await fetch(`${r.at}/_rpc/events`, { headers: { cookie: other.cookie } })
    const othersReader = othersFeed.body!.getReader()
    await othersReader.read()

    await removeDevice(r.env, entry.id)
    r.door.dropRemoved(await readStore(r.env))
    await assert.rejects(reader.read(), 'the removed device\'s feed is cut')
    r.answer = undefined
    assert.equal((await fetch(`${r.at}/`, { headers: { cookie } })).status, 401)
    assert.equal((await fetch(`${r.at}/`, { headers: { cookie: other.cookie } })).status, 200, 'the other device stays in')
    await othersReader.cancel()
  } finally {
    await r.close()
  }
})

test('an answer OpenAgent cut midway is cut for the device too, so its page can ask again', async () => {
  const r = await rig()
  try {
    const { cookie } = await r.letIn()
    r.answer = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: first\n\n')
      setTimeout(() => res.destroy(), 30)
    }
    const feed = await fetch(`${r.at}/_rpc/events`, { headers: { cookie } })
    const reader = feed.body!.getReader()
    await reader.read()
    const ended = await Promise.race([reader.read().then(() => 'ended', () => 'ended'), new Promise(resolve => setTimeout(() => resolve('still waiting'), 2_000))])
    assert.equal(ended, 'ended')
  } finally {
    await r.close()
  }
})

test('the cookie is sent again before a browser would drop it, so a device stays in until it is removed', async () => {
  const r = await rig()
  try {
    const { cookie } = await r.letIn()
    r.answer = (_req, res) => res.writeHead(200, { 'set-cookie': 'theme=dark' }).end('ok')
    const first = await fetch(`${r.at}/`, { headers: { cookie } })
    assert.deepEqual(first.headers.getSetCookie().map(c => c.split('=')[0]), ['theme', DEVICE_COOKIE], 'beside OpenAgent\'s own cookie')
    const soonAfter = await fetch(`${r.at}/`, { headers: { cookie } })
    assert.deepEqual(soonAfter.headers.getSetCookie(), ['theme=dark'])
    r.clock.now += 25 * 60 * 60 * 1000
    const nextDay = await fetch(`${r.at}/`, { headers: { cookie } })
    assert.equal(nextDay.headers.getSetCookie().length, 2)
  } finally {
    await r.close()
  }
})

test('when a device was last seen is written to the file', async () => {
  const r = await rig()
  const env = r.env
  const { entry, cookie } = await r.letIn()
  r.clock.now = Date.parse('2026-03-04T05:06:07.000Z')
  await fetch(`${r.at}/`, { headers: { cookie } })
  // Read before the rig removes its home: closing the door writes what it still held.
  await r.door.close()
  const seen = (await readStore(env)).devices.find(device => device.id === entry.id)?.seen
  await r.close()
  assert.equal(seen, '2026-03-04T05:06:07.000Z')
})

test('an OpenAgent that does not answer is said so', async () => {
  const home = await testHome()
  const door = await openDoor({ env: home.env, target: 'http://127.0.0.1:1', port: 0, host: '127.0.0.1' })
  try {
    const entry = (await enter(home.env, (await addCode(home.env)).code, 'a phone'))!
    const answer = await fetch(`http://127.0.0.1:${door.port}/`, { headers: { cookie: `${DEVICE_COOKIE}=${entry.id}.${entry.key}` } })
    assert.equal(answer.status, 502)
    assert.equal(await answer.text(), 'OpenAgent did not answer')
  } finally {
    await door.close()
    await home.remove()
  }
})

test('another computer\'s OpenAgent gets in with the same code: it says its name and is answered a key of its own, once', async () => {
  const r = await rig()
  try {
    const { code } = await addCode(r.env)
    const send = (): Promise<Response> => fetch(`${r.at}${ENTER_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, computer: '  Adas-MacBook  ' }) })
    const first = await send()
    assert.equal(first.status, 200)
    // The key comes in the answer, for a caller with no browser to keep a cookie in.
    assert.equal(first.headers.get('set-cookie'), null)
    const { ok, key } = (await first.json()) as { ok: boolean; key: string }
    assert.equal(ok, true)
    const entry = readBearer(`Bearer ${key}`)!
    const store = await readStore(r.env)
    assert.deepEqual(store.devices.map(device => [device.id, device.name]), [[entry.id, 'OpenAgent on Adas-MacBook']])
    assert.equal(JSON.stringify(store).includes(entry.key), false) // the file keeps no key
    assert.equal((await send()).status, 403) // the code is spent

    // A name is cleaned and cut: what the list shows is one short line.
    const long = await fetch(`${r.at}${ENTER_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: (await addCode(r.env)).code, computer: `tab\there\n${'x'.repeat(200)}` }) })
    assert.equal(long.status, 200)
    const named = (await readStore(r.env)).devices[1]!.name
    assert.match(named, /^OpenAgent on tab here x+$/)
    assert.equal(named.length, 'OpenAgent on '.length + 60)
  } finally {
    await r.close()
  }
})

test('a computer\'s call is passed on with its key taken off, and gets no cookie', async () => {
  const r = await rig()
  try {
    const { entry } = await r.letIn('OpenAgent on a laptop')
    const authorization = `Bearer ${entry.id}.${entry.key}`
    r.clock.now += 3 * 24 * 60 * 60 * 1000 // long past the day after which a browser's cookie is sent again
    const answer = await fetch(`${r.at}/_relay/start`, { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: '{"prompt":"x"}' })
    assert.equal(answer.status, 200)
    assert.equal(answer.headers.get('set-cookie'), null)
    assert.equal(r.asked.length, 1)
    assert.equal(r.asked[0]!.url, '/_relay/start')
    assert.equal(r.asked[0]!.body, '{"prompt":"x"}')
    assert.equal(r.asked[0]!.headers.authorization, undefined) // OpenAgent never sees a key
    assert.equal(r.asked[0]!.headers.host, new URL(r.target).host)
    assert.equal(r.asked[0]!.headers.origin, undefined)

    // A key that is not in, and a header that is no key, let nothing through.
    for (const wrong of [`Bearer ${entry.id}.nope`, 'Bearer nonsense', `Basic ${entry.id}.${entry.key}`]) {
      assert.equal((await fetch(`${r.at}/_relay/ping`, { headers: { authorization: wrong } })).status, 401)
    }
    assert.equal(r.asked.length, 1)
  } finally {
    await r.close()
  }
})

test('a device\'s own Authorization header is OpenAgent\'s to read: only a computer\'s key is taken off', async () => {
  const r = await rig()
  try {
    const { cookie } = await r.letIn()
    // Also one shaped like a key of the door's, with a dot in it: it is no key that is in.
    for (const own of ['Bearer something-of-the-pages', 'Bearer eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl']) {
      const answer = await fetch(`${r.at}/_rpc/onProjects`, { method: 'POST', headers: { cookie, authorization: own }, body: '[]' })
      assert.equal(answer.status, 200)
      assert.equal(r.asked.at(-1)!.headers.authorization, own)
    }
    assert.equal(r.asked.length, 2)
  } finally {
    await r.close()
  }
})

test('a computer takes itself out with its key, and is out at once; nobody takes another out', async () => {
  const r = await rig()
  try {
    const laptop = await r.letIn('OpenAgent on a laptop')
    const phone = await r.letIn('a phone')
    const authorization = `Bearer ${laptop.entry.id}.${laptop.entry.key}`

    assert.equal((await fetch(`${r.at}${ENTER_PATH}`, { method: 'DELETE' })).status, 401)
    assert.equal((await fetch(`${r.at}${ENTER_PATH}`, { method: 'DELETE', headers: { authorization: `Bearer ${laptop.entry.id}.wrong` } })).status, 401)
    // A page of another site cannot make a device leave.
    assert.equal((await fetch(`${r.at}${ENTER_PATH}`, { method: 'DELETE', headers: { cookie: phone.cookie, origin: 'http://evil.example' } })).status, 403)
    assert.equal((await readStore(r.env)).devices.length, 2)

    assert.equal((await fetch(`${r.at}${ENTER_PATH}`, { method: 'DELETE', headers: { authorization } })).status, 200)
    assert.deepEqual((await readStore(r.env)).devices.map(device => device.name), ['a phone'])
    assert.equal((await fetch(`${r.at}/_relay/ping`, { headers: { authorization } })).status, 401)
    assert.equal((await fetch(`${r.at}${ENTER_PATH}`, { method: 'DELETE', headers: { authorization } })).status, 401)
    // A device takes itself out by its cookie the same way.
    assert.equal((await fetch(`${r.at}${ENTER_PATH}`, { method: 'DELETE', headers: { cookie: phone.cookie } })).status, 200)
    assert.deepEqual((await readStore(r.env)).devices, [])
    assert.equal(r.asked.length, 0) // none of it reached OpenAgent
  } finally {
    await r.close()
  }
})

test('a computer says which one it is when it gets in: got in again, it is in the place of what it had, and its old key opens nothing', async () => {
  const r = await rig()
  try {
    const MAC = 'a'.repeat(32)
    const get = async (computer: string | undefined, name = 'Mac'): Promise<string> => {
      const answer = await fetch(`${r.at}${ENTER_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(computer !== undefined ? { [COMPUTER_HEADER]: computer } : {}) }, body: JSON.stringify({ code: (await addCode(r.env)).code, computer: name }) })
      assert.equal(answer.status, 200)
      return ((await answer.json()) as { key: string }).key
    }
    const first = await get(MAC)
    const other = await get('b'.repeat(32), 'Studio')
    // What is no such word is not one: the computer is let in, as one that did not say.
    const unsaid = await get('not a computer')
    const second = await get(MAC)
    const store = await readStore(r.env)
    // The file keeps the word as it keeps a key: its SHA-256, never the word.
    assert.deepEqual(store.devices.map(device => [device.id, device.computer]), [[readBearer(`Bearer ${other}`)!.id, sha256('b'.repeat(32))], [readBearer(`Bearer ${unsaid}`)!.id, undefined], [readBearer(`Bearer ${second}`)!.id, sha256(MAC)]])
    assert.doesNotMatch(JSON.stringify(store), new RegExp(MAC))
    assert.equal((await fetch(`${r.at}/_relay/ping`, { headers: { authorization: `Bearer ${first}` } })).status, 401)
    assert.equal((await fetch(`${r.at}/_relay/ping`, { headers: { authorization: `Bearer ${second}` } })).status, 200)

    // A phone's page cannot say it is a computer: what a browser sends with a code names no computer.
    const phone = await fetch(`${r.at}${ENTER_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json', [COMPUTER_HEADER]: MAC }, body: JSON.stringify({ code: (await addCode(r.env)).code }) })
    assert.equal(phone.status, 200)
    const after = await readStore(r.env)
    assert.equal(after.devices.length, 4)
    assert.equal(after.devices.at(-1)!.computer, undefined)
    assert.equal((await fetch(`${r.at}/_relay/ping`, { headers: { authorization: `Bearer ${second}` } })).status, 200)
  } finally {
    await r.close()
  }
})

test('a computer that got in before it said which one it is says so with its key: noted once, kept, never taken from a page, and not passed on to OpenAgent', async () => {
  const r = await rig()
  const env = r.env
  const MAC = 'a'.repeat(32)
  const { entry } = await r.letIn('OpenAgent on a laptop')
  const { entry: phone, cookie } = await r.letIn()
  const authorization = `Bearer ${entry.id}.${entry.key}`
  await fetch(`${r.at}/_relay/ping`, { headers: { authorization, [COMPUTER_HEADER]: MAC } })
  // A device's page says it too: a cookie's word for a computer is not taken.
  await fetch(`${r.at}/`, { headers: { cookie, [COMPUTER_HEADER]: 'c'.repeat(32) } })
  // What it says later changes nothing: an entry is the computer it first said.
  await fetch(`${r.at}/_relay/ping`, { headers: { authorization, [COMPUTER_HEADER]: 'b'.repeat(32) } })
  for (const asked of r.asked) assert.equal(asked.headers[COMPUTER_HEADER], undefined)
  // Written with the times: closing the door writes what it still held.
  await r.door.close()
  const said = Object.fromEntries((await readStore(env)).devices.map(device => [device.id, device.computer]))
  // What is written is kept too: a door opened anew does not take another word for that entry.
  const again = await openDoor({ env, target: r.target, port: 0, host: '127.0.0.1' })
  await fetch(`http://127.0.0.1:${again.port}/_relay/ping`, { headers: { authorization, [COMPUTER_HEADER]: 'b'.repeat(32) } })
  await again.close()
  const kept = (await readStore(env)).devices.find(device => device.id === entry.id)?.computer
  await r.close()
  assert.deepEqual(said, { [entry.id]: sha256(MAC), [phone.id]: undefined })
  assert.equal(kept, sha256(MAC))
})

test('a key that says it is a computer already listed with a key of that kind is not put in that computer\'s row: the list names every key that is in', async () => {
  const r = await rig()
  const env = r.env
  const MAC = 'a'.repeat(32)
  // The computer's own entry, which said its word when it got in.
  const own = (await enter(env, (await addCode(env)).code, 'OpenAgent on Mac', undefined, undefined, sha256(MAC)))!
  // Someone who is in gets in once more as a computer, and says the first one's word with the new key.
  const { entry: extra } = await r.letIn('OpenAgent on Mac')
  await fetch(`${r.at}/_relay/ping`, { headers: { authorization: `Bearer ${extra.id}.${extra.key}`, [COMPUTER_HEADER]: MAC } })
  await r.door.close()
  const said = Object.fromEntries((await readStore(env)).devices.map(device => [device.id, device.computer]))
  await r.close()
  assert.deepEqual(said, { [own.id]: sha256(MAC), [extra.id]: undefined })
})

test('readBearer reads a computer\'s key off its header, and nothing else', () => {
  assert.deepEqual(readBearer('Bearer ab12cd.s3cret'), { id: 'ab12cd', key: 's3cret' })
  assert.deepEqual(readBearer('bearer   ab12cd.s3.cret'), { id: 'ab12cd', key: 's3.cret' })
  for (const not of [undefined, '', 'Bearer', 'Bearer nodot', 'Bearer .key', 'Bearer id.', 'Basic ab12cd.s3cret', 'Bearer a.b c']) assert.equal(readBearer(not), undefined, String(not))
})
