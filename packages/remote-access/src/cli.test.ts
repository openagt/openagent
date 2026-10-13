import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { NetworkInterfaceInfo } from 'node:os'
import type { AddressDeps } from './address.js'
import { doorFingerprint } from './certificate.js'
import { USAGE, runCli, type CliIO } from './cli.js'
import { keyFingerprint } from './der.js'
import { ENTER_PATH } from './door.js'
import { readFile, writeFile } from 'node:fs/promises'
import { readStore, storePath } from './store.js'
import { testHome } from './test-home.js'
import { testOffice } from './test-office.js'

/** A laptop on a Wi-Fi that answers to its name. */
const NAMED: AddressDeps = {
  interfaces: () => ({ en0: [{ address: '192.168.1.23', netmask: '', family: 'IPv4', mac: '', internal: false, cidr: '192.168.1.23/24' } satisfies NetworkInterfaceInfo] }),
  hostname: () => 'Adas-MacBook.local',
  lookup: async () => ['192.168.1.23'],
}

interface Ran {
  code: number
  out: unknown
  err: string[]
}

async function run(env: NodeJS.ProcessEnv, args: string[], over: Partial<CliIO> = {}): Promise<Ran> {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli(args, { env, stdout: line => out.push(line), stderr: line => err.push(line), address: NAMED, followMs: 200, host: '127.0.0.1', ...over })
  return { code, out: out.length ? (JSON.parse(out.join('\n')) as unknown) : undefined, err }
}

test('off until switched on; on without OpenAgent running says what is missing; a code is refused until the door is open', async () => {
  const home = await testHome()
  try {
    assert.deepEqual((await run(home.env, ['status'])).out, { on: false, listening: false, devices: [], lines: [] })
    const refused = await run(home.env, ['add'])
    assert.equal(refused.code, 1)
    assert.deepEqual(refused.err, ['Phone on Wi-Fi is off: turn it on first'])

    assert.deepEqual((await run(home.env, ['on'])).out, { on: true, listening: false, problem: 'The door opens once OpenAgent runs on this computer.', devices: [], lines: [] })
    const notOpen = await run(home.env, ['add'])
    assert.equal(notOpen.code, 1)
    assert.deepEqual(notOpen.err, ['The door opens once OpenAgent runs on this computer.'])
    assert.deepEqual((await readStore(home.env)).codes, [], 'no code is made for a door that is not open')

    assert.deepEqual((await run(home.env, ['off'])).out, { on: false, listening: false, devices: [], lines: [] })
  } finally {
    await home.remove()
  }
})

test('with the door\'s process running: on opens it, add answers a link by the name and one by the number, the link lets a device in, remove takes it out', async () => {
  const home = await testHome()
  const stop = new AbortController()
  const env = { ...home.env, OPENAGENT_URL: 'http://127.0.0.1:1', OPENAGENT_REMOTE_ACCESS_PORT: '0' }
  const serving = run(env, ['serve'], { signal: stop.signal })
  try {
    assert.deepEqual((await run(home.env, ['on'], { followMs: 5_000 })).out, { on: true, listening: true, devices: [], lines: [] })
    const port = (await readStore(home.env)).listening!.port

    const link = (await run(home.env, ['add'])).out as { url: string; numberUrl: string; expires: string }
    const [byName, code] = link.url.split('#') as [string, string]
    assert.equal(byName, `http://adas-macbook.local:${port}${ENTER_PATH}`)
    assert.equal(link.numberUrl, `http://192.168.1.23:${port}${ENTER_PATH}#${code}`)
    assert.ok(Date.parse(link.expires) > Date.now())

    const entered = await fetch(`http://127.0.0.1:${port}${ENTER_PATH}`, { method: 'POST', headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Safari/604.1' }, body: JSON.stringify({ code }) })
    assert.equal(entered.status, 200)
    const status = (await run(home.env, ['status'])).out as { devices: { id: string; name: string }[] }
    assert.deepEqual(status.devices.map(device => device.name), ['iPhone, Safari'])

    const removed = await run(home.env, ['remove', status.devices[0]!.id])
    assert.deepEqual((removed.out as { devices: unknown[] }).devices, [])
    const gone = await run(home.env, ['remove', status.devices[0]!.id])
    assert.equal(gone.code, 1)
    assert.deepEqual(gone.err, [`no device has the id ${status.devices[0]!.id}`])
  } finally {
    stop.abort()
    await serving
    await home.remove()
  }
})

test('a computer with no name on the network gives its number alone', async () => {
  const home = await testHome()
  const stop = new AbortController()
  const unnamed: AddressDeps = { ...NAMED, lookup: async () => [] }
  const serving = run({ ...home.env, OPENAGENT_URL: 'http://127.0.0.1:1', OPENAGENT_REMOTE_ACCESS_PORT: '0' }, ['serve'], { signal: stop.signal })
  try {
    await run(home.env, ['on'], { followMs: 5_000 })
    const link = (await run(home.env, ['add'], { address: unnamed })).out as { url: string; numberUrl?: string }
    assert.match(link.url, /^http:\/\/192\.168\.1\.23:\d+\/_remote-access\/enter#/)
    assert.equal(link.numberUrl, undefined)
    const nowhere = await run(home.env, ['add'], { address: { interfaces: () => ({}), hostname: () => 'x', lookup: async () => [] } })
    assert.deepEqual(nowhere.err, ['this computer is on no network a device could reach it on'])
  } finally {
    stop.abort()
    await serving
    await home.remove()
  }
})

test('a file that cannot be read is said in one line, by every command that would change it', async () => {
  const home = await testHome()
  try {
    await writeFile(storePath(home.env), '{ "on": true,, }')
    assert.deepEqual((await run(home.env, ['status'])).out, { on: false, listening: false, devices: [], lines: [] })
    for (const args of [['on'], ['off'], ['remove', 'abcdef123456']]) {
      const refused = await run(home.env, args)
      assert.equal(refused.code, 1)
      assert.equal(refused.err.length, 1)
      assert.match(refused.err[0]!, /cannot be read: correct it, or delete it/)
    }
    assert.equal(await readFile(storePath(home.env), 'utf8'), '{ "on": true,, }')
  } finally {
    await home.remove()
  }
})

test('serve is refused without OpenAgent\'s address or with a port that is none, and ends; a command line that cannot be read prints the usage', async () => {
  const home = await testHome()
  try {
    // Run as OpenAgent runs it, with no signal of the test's: a refusal must leave nothing that keeps the process alive.
    const { signal: _none, ...asOpenAgentRunsIt } = { signal: undefined }
    const alone = await run(home.env, ['serve'], asOpenAgentRunsIt)
    assert.equal(alone.code, 1)
    assert.match(alone.err[0]!, /OPENAGENT_URL/)
    const badPort = await run({ ...home.env, OPENAGENT_URL: 'http://127.0.0.1:1', OPENAGENT_REMOTE_ACCESS_PORT: 'abc' }, ['serve'], asOpenAgentRunsIt)
    assert.equal(badPort.code, 1)
    assert.deepEqual(badPort.err, ['OPENAGENT_REMOTE_ACCESS_PORT is not a port'])
    for (const args of [[], ['nope'], ['remove'], ['status', 'extra']]) {
      const unread = await run(home.env, args)
      assert.equal(unread.code, 2)
      assert.deepEqual(unread.err, [USAGE])
    }
  } finally {
    await home.remove()
  }
})

test('https <address> makes this computer a server and https off undoes it; what is no number or name is refused', async () => {
  const home = await testHome()
  try {
    const set = await run(home.env, ['https', '203.0.113.5'])
    assert.deepEqual(set.out, { on: false, listening: false, problem: 'The door opens once OpenAgent runs on this computer.', https: { address: '203.0.113.5' }, devices: [], lines: [] })
    assert.deepEqual((await readStore(home.env)).https, { address: '203.0.113.5' })
    assert.equal(((await run(home.env, ['https', 'agents.example.com'])).out as { https: { address: string } }).https.address, 'agents.example.com')
    // An address is kept the one way a certificate office and a link read it.
    assert.equal(((await run(home.env, ['https', 'Agents.Example.COM'])).out as { https: { address: string } }).https.address, 'agents.example.com')
    assert.equal(((await run(home.env, ['https', '2001:DB8:0:0:0:0:0:1'])).out as { https: { address: string } }).https.address, '2001:db8::1')
    for (const not of ['http://203.0.113.5', '203.0.113.5:443', 'a b', 'localhost/x', '-x', 'fe80::1%en0', '::ffff:1.2.3.4', 'localhost']) {
      const refused = await run(home.env, ['https', not])
      assert.equal(refused.code, 1, not)
      assert.deepEqual(refused.err, [`${not} is not a server's number or name`])
    }
    assert.deepEqual((await run(home.env, ['https', 'off'])).out, { on: false, listening: false, devices: [], lines: [] })
    assert.equal((await run(home.env, ['https'])).code, 2)
  } finally {
    await home.remove()
  }
})

test('on a server, add answers one HTTPS link at the server\'s address, with what the door\'s key is known by after the code', async () => {
  const home = await testHome()
  const proof = createServer()
  await new Promise<void>(resolve => proof.listen(0, '127.0.0.1', resolve))
  const proofPort = (proof.address() as AddressInfo).port
  await new Promise<void>(resolve => proof.close(() => resolve()))
  const office = await testOffice({ proofPort: () => proofPort })
  const stop = new AbortController()
  const env = { ...home.env, OPENAGENT_URL: 'http://127.0.0.1:1', OPENAGENT_REMOTE_ACCESS_PORT: '0', OPENAGENT_REMOTE_ACCESS_PROOF_PORT: String(proofPort), OPENAGENT_REMOTE_ACCESS_ACME: office.directory }
  const serving = run(env, ['serve'], { signal: stop.signal })
  try {
    const refused = await run(home.env, ['https', '127.0.0.1'], { followMs: 0 })
    assert.equal(refused.code, 0)
    // The certificate is asked for; a link is refused until the door is open.
    for (let i = 0; i < 250 && (await readStore(home.env)).listening === undefined; i++) await new Promise(resolve => setTimeout(resolve, 20))
    const status = (await run(home.env, ['status'])).out as { listening: boolean; problem?: string; https: { address: string } }
    assert.deepEqual([status.listening, status.problem, status.https.address], [true, undefined, '127.0.0.1'])
    const port = (await readStore(home.env)).listening!.port

    const link = (await run(home.env, ['add'])).out as { url: string; numberUrl?: string }
    assert.equal(link.numberUrl, undefined)
    const [at, after] = link.url.split('#') as [string, string]
    assert.equal(at, `https://127.0.0.1:${port}${ENTER_PATH}`)
    const [code, pin] = after.split('.')
    assert.match(code!, /^[A-Za-z0-9_-]{20,}$/)
    assert.equal(pin, await doorFingerprint(home.env))
    assert.equal(pin, keyFingerprint(office.issued[0]!.publicKey))
  } finally {
    stop.abort()
    await serving
    await office.close()
    await home.remove()
  }
})
