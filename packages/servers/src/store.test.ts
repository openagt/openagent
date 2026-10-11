import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { STEP_IDS } from './steps.js'
import { Unreadable, addressOf, freshSteps, isUser, isVersion, readStore, sanitize, storePath, update } from './store.js'
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
      { address: '203.0.113.5', user: 'root', fingerprint: 'SHA256:0123456789abcdefghijklmnopqrstuvwxyzABCDEFG', worker: 42, adding: true, steps: [{ id: 'user', state: 'done' }, { id: 'login', state: 'failed', said: 'no' }, { id: 'nonsense', state: 'done' }] },
      { address: '203.0.113.5', user: 'root' },
      { address: '-oProxyCommand=sh', user: 'root' },
      { address: '203.0.113.6', user: 'Not A User' },
      { address: '203.0.113.7', user: 'ada', fingerprint: 'made up', worker: -1, steps: 'none' },
      'nonsense',
    ],
  })
  assert.deepEqual(store.servers.map(server => server.address), ['203.0.113.5', '203.0.113.7'])
  const [first, second] = store.servers
  assert.deepEqual(first!.steps.map(step => step.id), [...STEP_IDS])
  assert.deepEqual(first!.steps.slice(0, 3), [{ id: 'login', state: 'failed', said: 'no' }, { id: 'user', state: 'done' }, { id: 'tools', state: 'waiting' }])
  assert.equal(first!.worker, 42)
  assert.equal(first!.adding, true)
  assert.deepEqual(second, { address: '203.0.113.7', user: 'ada', steps: freshSteps(), adding: false })
  assert.deepEqual(sanitize('nonsense'), { servers: [] })
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
