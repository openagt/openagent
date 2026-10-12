import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { STEP_IDS } from './steps.js'
import { SILENT_MS, Unreadable, addressOf, doorUrl, freshSteps, heartbeat, isUser, isVersion, readStore, sanitize, storePath, update, working } from './store.js'
import { testHome } from './test-home.js'

test('the file is beside OpenAgent\'s own home file', () => {
  assert.equal(storePath({ HOME: '/home/ada' }), '/home/ada/.openagent-servers.json')
  assert.equal(storePath({ HOME: '/home/ada', XDG_CONFIG_HOME: '/cfg' }), '/cfg/openagent-servers.json')
})

test('an address is a number or a name, in one form, and never something a command reads as an option', () => {
  assert.equal(addressOf('203.0.113.5'), '203.0.113.5')
  assert.equal(addressOf('2001:DB8:0:0:0:0:0:1'), '2001:db8::1')
  assert.equal(addressOf('Box.Example.com'), 'box.example.com')
  for (const no of ['', '-oProxyCommand=sh', 'root@203.0.113.5', '203.0.113.5 -v', 'box', 'box.example.com;id', 'fe80::1%en0', '$(id).example.com', 'a'.repeat(254)]) assert.equal(addressOf(no), undefined, no)
})

test('a user name and a version are what a server and npm take, and nothing else', () => {
  for (const yes of ['root', 'ubuntu', 'ada_l', 'deploy-1']) assert.ok(isUser(yes), yes)
  for (const no of ['', 'Root', '-l', 'ada lovelace', 'ada;id', '1ada', 'a'.repeat(33), 7]) assert.ok(!isUser(no), String(no))
  for (const yes of ['0.10.0', '1.2.3-beta.1']) assert.ok(isVersion(yes), yes)
  for (const no of ['', 'latest', '1.2', '1.2.3 --registry=http://x', '1.2.3;id', '../x']) assert.ok(!isVersion(no), no)
})

test('a file is read forgivingly: what is malformed is left out, and every step is there in the install\'s order', () => {
  const store = sanitize({
    servers: [
      { address: '203.0.113.5', user: 'root', fingerprint: 'SHA256:0123456789abcdefghijklmnopqrstuvwxyzABCDEFG', worker: { pid: 42, seen: '2026-10-11T12:00:00.000Z' }, adding: true, steps: [{ id: 'user', state: 'done' }, { id: 'login', state: 'failed', said: 'no' }, { id: 'nonsense', state: 'done' }] },
      { address: '203.0.113.5', user: 'root' },
      { address: '-oProxyCommand=sh', user: 'root' },
      { address: '203.0.113.6', user: 'Not A User' },
      { address: '203.0.113.7', user: 'ada', fingerprint: 'made up', worker: 42, steps: 'none' },
      'nonsense',
    ],
  })
  assert.deepEqual(store.servers.map(server => server.address), ['203.0.113.5', '203.0.113.7'])
  const [first, second] = store.servers
  assert.deepEqual(first!.steps.map(step => step.id), [...STEP_IDS])
  assert.deepEqual(first!.steps.slice(0, 3), [{ id: 'login', state: 'failed', said: 'no' }, { id: 'user', state: 'done' }, { id: 'tools', state: 'waiting' }])
  assert.deepEqual(first!.worker, { pid: 42, seen: '2026-10-11T12:00:00.000Z' })
  assert.equal(first!.adding, true)
  assert.deepEqual(second, { address: '203.0.113.7', user: 'ada', steps: freshSteps(), adding: false })
  assert.deepEqual(sanitize('nonsense'), { servers: [] })
})

test('an install runs while its process is there and said so a moment ago: a number alone, which another program may hold by now, is no proof', () => {
  const server = { address: '203.0.113.5', user: 'root', steps: freshSteps(), adding: true }
  const now = Date.parse('2026-10-11T12:00:00.000Z')
  const at = (ms: number): string => new Date(now - ms).toISOString()
  assert.equal(working(server, now), false)
  assert.equal(working({ ...server, worker: { pid: process.pid, seen: at(1_000) } }, now), true)
  // This very process is there, and has not been heard of for too long: it is another program's number now.
  assert.equal(working({ ...server, worker: { pid: process.pid, seen: at(SILENT_MS + 1) } }, now), false)
  assert.equal(working({ ...server, worker: { pid: 2 ** 22 + 12345, seen: at(1_000) } }, now), false)
})

test('a server\'s door answers at its address over HTTPS, a number of the long kind in brackets', () => {
  assert.equal(doorUrl('203.0.113.5'), 'https://203.0.113.5')
  assert.equal(doorUrl('box.example.com'), 'https://box.example.com')
  assert.equal(doorUrl('2001:db8::1'), 'https://[2001:db8::1]')
  assert.equal(new URL('https://[2001:db8::1]/_remote-access/enter#code').origin, doorUrl('2001:db8::1'))
})

test('a change is written whole, for the owner alone; no file reads as no server; a file that cannot be read is not written over', async () => {
  const home = await testHome()
  try {
    assert.deepEqual(await readStore(home.env), { servers: [] })
    await update(home.env, store => void store.servers.push({ address: '203.0.113.5', user: 'root', steps: freshSteps(), adding: true }))
    assert.equal((await readStore(home.env)).servers[0]!.address, '203.0.113.5')
    assert.equal((await stat(storePath(home.env))).mode & 0o777, 0o600)
    // Every change at once lands: none is lost to another.
    await Promise.all(['a', 'b', 'c', 'd'].map(name => update(home.env, store => void store.servers.push({ address: `${name}.example.com`, user: 'root', steps: freshSteps(), adding: false }))))
    assert.equal((await readStore(home.env)).servers.length, 5)

    await writeFile(storePath(home.env), '{ "servers": [')
    await assert.rejects(readStore(home.env), Unreadable)
    await assert.rejects(update(home.env, store => void (store.servers = [])), Unreadable)
    assert.equal(await readFile(storePath(home.env), 'utf8'), '{ "servers": [')
  } finally {
    await home.remove()
  }
})

test('a heartbeat beats one at a time, and stopping it waits for the beat on its way', async () => {
  let started = 0
  let ended = 0
  const beating = heartbeat(async () => {
    started++
    await new Promise(resolve => setTimeout(resolve, 60))
    ended++
    throw new Error('a beat that failed is left at that')
  }, 5)
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(started, 1, 'no second beat while the first is on its way')
  await beating.stop()
  assert.deepEqual([started, ended], [1, 1], 'the beat on its way has landed')
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(started, 1, 'none after the stop')

  const never = heartbeat(async () => void started++, 10_000)
  await never.stop()
  assert.equal(started, 1)

  // A beat that throws before it has anything to wait for is a failed beat like any other.
  const throwing = heartbeat(() => {
    throw new Error('thrown at once')
  }, 5)
  await new Promise(resolve => setTimeout(resolve, 30))
  await throwing.stop()
})
