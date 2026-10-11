import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { USAGE, runCli, type CliIO, type Status } from './cli.js'
import { STEPS } from './steps.js'
import { readStore, update } from './store.js'
import { pretendServer, testHome } from './test-home.js'

interface Ran {
  code: number
  out: unknown
  err: string[]
}

async function run(env: NodeJS.ProcessEnv, args: string[], over: Partial<CliIO> = {}): Promise<Ran> {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli(args, { env, stdout: line => out.push(line), stderr: line => err.push(line), startWork: () => process.pid, ...over })
  return { code, out: out.length ? (JSON.parse(out.join('\n')) as unknown) : undefined, err }
}

const serversOf = (ran: Ran): Status['servers'] => (ran.out as Status).servers

test('no server until one is connected; what is no address, user or version is refused in words, and nothing is started', async () => {
  const home = await testHome()
  try {
    assert.deepEqual((await run(home.env, ['status'])).out, { servers: [] })
    const started: string[] = []
    const startWork = (address: string): number => (started.push(address), process.pid)
    for (const [args, why] of [
      [['connect', '-oProxyCommand=sh', 'root', '1.2.3'], "-oProxyCommand=sh is not a server's number or name"],
      [['connect', '203.0.113.5', 'root;id', '1.2.3'], 'root;id is not a user name'],
      [['connect', '203.0.113.5', 'root', 'latest'], 'latest is not a version of OpenAgent'],
      [['link', '203.0.113.9'], 'no server at 203.0.113.9'],
      [['forget', '203.0.113.9'], 'no server at 203.0.113.9'],
    ] as const) {
      const refused = await run(home.env, [...args], { startWork })
      assert.equal(refused.code, 1, args.join(' '))
      assert.deepEqual(refused.err, [why])
    }
    assert.deepEqual(started, [])
    assert.deepEqual((await readStore(home.env)).servers, [])
    for (const args of [[], ['nonsense'], ['connect', '203.0.113.5'], ['status', 'more'], ['forget']]) {
      const unread = await run(home.env, args)
      assert.equal(unread.code, 2)
      assert.deepEqual(unread.err, [USAGE])
    }
  } finally {
    await home.remove()
  }
})

test('connect saves the server and starts its install; a second press is the same install; the install then runs to its end', async () => {
  const home = await testHome()
  try {
    const started: string[][] = []
    // An install that runs: this very process stands in for it.
    const startWork = (address: string, version: string): number => (started.push([address, version]), process.pid)
    const connected = await run(home.env, ['connect', '203.0.113.5', 'root', '1.2.3'], { startWork })
    assert.equal(connected.code, 0)
    assert.deepEqual(started, [['203.0.113.5', '1.2.3']])
    assert.deepEqual(serversOf(connected), [{ address: '203.0.113.5', user: 'root', working: true, adding: true, steps: STEPS.map(({ id, label }) => ({ id, label, state: 'waiting' })) }])

    const again = await run(home.env, ['connect', '203.0.113.5', 'root', '1.2.3'], { startWork })
    assert.equal(again.code, 1)
    assert.deepEqual(again.err, ['OpenAgent is being installed on 203.0.113.5 right now'])
    assert.deepEqual((await run(home.env, ['forget', '203.0.113.5'])).err, ['OpenAgent is being installed on 203.0.113.5 right now: wait until it ends'])
    assert.equal(started.length, 1)

    const { exec, calls } = pretendServer()
    assert.equal((await run(home.env, ['work', '203.0.113.5', '1.2.3'], { exec, signal: new AbortController().signal })).code, 0)
    assert.equal(calls.length, STEPS.length + 1)
    const [done] = serversOf(await run(home.env, ['status']))
    assert.equal(done!.working, false)
    assert.equal(done!.fingerprint, 'SHA256:0123456789abcdefghijklmnopqrstuvwxyzABCDEFG')
    assert.deepEqual(done!.steps.map(step => step.state), STEPS.map(() => 'done'))
  } finally {
    await home.remove()
  }
})

test('an install whose process is gone reads as failed at the step it was at, and connect starts it over with the key it knew', async () => {
  const home = await testHome()
  try {
    // A process that ended: its id is no longer anyone's.
    const gone = await new Promise<number>(resolve => {
      void import('node:child_process').then(({ spawn }) => {
        const child = spawn(process.execPath, ['-e', ''])
        child.once('exit', () => resolve(child.pid!))
      })
    })
    await run(home.env, ['connect', '203.0.113.5', 'ubuntu', '1.2.3'], { startWork: () => gone })
    await update(home.env, store => {
      const [server] = store.servers
      server!.worker = gone
      server!.fingerprint = 'SHA256:0123456789abcdefghijklmnopqrstuvwxyzABCDEFG'
      server!.steps[0]!.state = 'done'
      server!.steps[1]!.state = 'running'
    })
    const [died] = serversOf(await run(home.env, ['status']))
    assert.equal(died!.working, false)
    assert.deepEqual(died!.steps.slice(0, 3), [
      { id: 'login', label: 'Log in', state: 'done' },
      { id: 'user', label: 'The user openagent', state: 'failed', said: 'The install stopped before this step ended.' },
      { id: 'tools', label: 'git, Node and Chrome', state: 'waiting' },
    ])

    const [over] = serversOf(await run(home.env, ['connect', '203.0.113.5', 'ubuntu', '1.2.4']))
    assert.equal(over!.working, true)
    assert.equal(over!.fingerprint, 'SHA256:0123456789abcdefghijklmnopqrstuvwxyzABCDEFG')
    assert.deepEqual(over!.steps.map(step => step.state), STEPS.map(() => 'waiting'))
  } finally {
    await home.remove()
  }
})

test('link asks the server\'s door; added says nothing is left to add; forget takes the server off the list', async () => {
  const home = await testHome()
  try {
    await run(home.env, ['connect', 'Box.Example.com', 'root', '1.2.3'], { startWork: () => 0 })
    const link = { url: 'https://box.example.com/_remote-access/enter#code.pin', expires: '2026-10-11T12:00:00.000Z' }
    const { exec, calls } = pretendServer(() => ({ out: JSON.stringify(link) }))
    // A name is found again however it was typed.
    assert.deepEqual((await run(home.env, ['link', 'BOX.example.com'], { exec })).out, link)
    assert.deepEqual(calls[0]!.args.slice(-5, -1), ['-l', 'root', '--', 'box.example.com'])

    const refused = await run(home.env, ['link', 'box.example.com'], { exec: pretendServer(() => ({ code: 1, err: 'the door is not open' })).exec })
    assert.equal(refused.code, 1)
    assert.deepEqual(refused.err, ['the door is not open'])

    assert.equal(serversOf(await run(home.env, ['status']))[0]!.adding, true)
    assert.equal(serversOf(await run(home.env, ['added', 'box.example.com']))[0]!.adding, false)
    assert.deepEqual((await run(home.env, ['forget', 'box.example.com'])).out, { servers: [] })
  } finally {
    await home.remove()
  }
})
