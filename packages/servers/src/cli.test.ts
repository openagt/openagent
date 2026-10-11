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

const NONE = { there: false, working: false }
const serversOf = (ran: Ran): Status['servers'] => (ran.out as Status).servers

test('no server until one is connected; what is no address, user or version is refused in words, and nothing is started', async () => {
  const home = await testHome()
  try {
    assert.deepEqual((await run(home.env, ['status'])).out, { servers: [] })
    const started: string[] = []
    const startWork = (words: string[]): number => (started.push(words.join(" ")), process.pid)
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
    const startWork = (words: string[]): number => (started.push(words), process.pid)
    const connected = await run(home.env, ['connect', '203.0.113.5', 'root', '1.2.3'], { startWork })
    assert.equal(connected.code, 0)
    assert.deepEqual(started, [['work', '203.0.113.5', '1.2.3']])
    assert.deepEqual(serversOf(connected), [{ address: '203.0.113.5', url: 'https://203.0.113.5', user: 'root', working: true, adding: true, steps: STEPS.map(({ id, label }) => ({ id, label, state: 'waiting' })), logins: { github: NONE, claude: NONE } }])

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
      server!.worker = { pid: gone, seen: new Date().toISOString() }
      server!.fingerprint = 'SHA256:0123456789abcdefghijklmnopqrstuvwxyzABCDEFG'
      server!.steps[0]!.state = 'done'
      server!.steps[1]!.state = 'running'
    })
    const [died] = serversOf(await run(home.env, ['status']))
    assert.equal(died!.working, false)
    assert.deepEqual(died!.steps.slice(0, 3), [
      { id: 'login', label: 'Log in', state: 'done' },
      { id: 'user', label: 'The user openagent', state: 'failed', said: 'The install stopped before this step ended.' },
      { id: 'tools', label: 'git, gh, Node and Chrome', state: 'waiting' },
    ])

    // The same for a number that is some other program's by now: it was not heard of for too long.
    await update(home.env, store => void (store.servers[0]!.worker = { pid: process.pid, seen: new Date(Date.now() - 10 * 60_000).toISOString() }))
    assert.equal(serversOf(await run(home.env, ['status']))[0]!.working, false)

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

    const elsewhere = await run(home.env, ['link', 'box.example.com'], { exec: pretendServer(() => ({ out: JSON.stringify({ ...link, url: 'https://evil.example/_remote-access/enter#code.pin' }) })).exec })
    assert.equal(elsewhere.code, 1)
    assert.deepEqual(elsewhere.err, ['The server answered something else than a link to its own door at https://box.example.com.'])

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

test('connect with "github" keeps the person\'s tick until the install copies the login; the tick counts as it is at each press', async () => {
  const home = await testHome()
  try {
    for (const args of [['connect', '203.0.113.5', 'root', '1.2.3', 'gitlab'], ['connect', '203.0.113.5', 'root', '1.2.3', 'github', 'more'], ['login', '203.0.113.5'], ['login', '203.0.113.5', 'gitlab'], ['logout', '203.0.113.5'], ['github', 'more'], ['login-work']]) {
      assert.equal((await run(home.env, args)).code, 2, args.join(' '))
    }
    const ticked = serversOf(await run(home.env, ['connect', '203.0.113.5', 'root', '1.2.3', 'github']))[0]!
    assert.deepEqual(ticked.logins, { github: { there: false, working: true, wanted: true }, claude: NONE })
    assert.deepEqual((await readStore(home.env)).servers[0]!.github, { wanted: true })

    const { exec } = pretendServer(call => (call.script.includes('gh auth login') ? { out: 'octocat\n' } : undefined))
    assert.equal((await run(home.env, ['work', '203.0.113.5', '1.2.3'], { exec, signal: new AbortController().signal })).code, 0)
    const [copied] = serversOf(await run(home.env, ['status']))
    assert.equal(copied!.logins.github.there, true)
    assert.equal(copied!.logins.github.account, 'octocat')
    assert.equal(copied!.logins.github.working, false)
    assert.equal(copied!.logins.github.wanted, undefined)

    // An update without the tick copies nothing, and the login that is there still counts.
    const updated = serversOf(await run(home.env, ['connect', '203.0.113.5', 'root', '1.2.4']))[0]!
    assert.deepEqual(Object.keys(updated.logins.github).sort(), ['account', 'since', 'there', 'working'])
    assert.equal(updated.logins.github.working, false)
  } finally {
    await home.remove()
  }
})

test('a tick that was taken back before the next press is not kept from the press before', async () => {
  const home = await testHome()
  try {
    // An install that never started: the server is saved, and nothing works on it.
    const startWork = (): number => 0
    await run(home.env, ['connect', '203.0.113.5', 'root', '1.2.3', 'github'], { startWork })
    assert.deepEqual((await readStore(home.env)).servers[0]!.github, { wanted: true })
    await update(home.env, store => void delete store.servers[0]!.worker)
    await run(home.env, ['connect', '203.0.113.5', 'root', '1.2.3'], { startWork })
    assert.equal((await readStore(home.env)).servers[0]!.github, undefined)
  } finally {
    await home.remove()
  }
})

test('github says whose login a copy would be, or why there is none; login and logout answer the server\'s logins, and a refusal says why', async () => {
  const home = await testHome()
  try {
    assert.deepEqual((await run(home.env, ['github'], { exec: pretendServer().exec })).out, { account: 'octocat' })
    // Nobody's is an answer too: a page asks to know what it can offer.
    const nobody = await run(home.env, ['github'], { exec: pretendServer(undefined, () => ({ code: 1, out: '', err: 'To get started with GitHub CLI, please run:  gh auth login' })).exec })
    assert.equal(nobody.code, 0)
    assert.deepEqual(nobody.out, { problem: 'There is no GitHub login to copy from this computer. `gh` is not logged in to github.com here, or GitHub does not answer: see `gh auth status`.' })

    assert.deepEqual((await run(home.env, ['login', '203.0.113.5', 'github'])).err, ['no server at 203.0.113.5'])
    await run(home.env, ['connect', '203.0.113.5', 'root', '1.2.3'])
    // Not while the server is being installed: the install's own end is where a ticked login goes.
    for (const args of [['login', '203.0.113.5', 'github'], ['login', '203.0.113.5', 'claude'], ['logout', '203.0.113.5', 'github']]) {
      assert.deepEqual((await run(home.env, args, { exec: pretendServer().exec })).err, ['OpenAgent is being installed on 203.0.113.5 right now'], args.join(' '))
    }
    await update(home.env, store => void delete store.servers[0]!.worker)

    const { exec, calls } = pretendServer(call => (call.script.includes('gh auth login') ? { out: 'octocat\n' } : undefined))
    const copied = serversOf(await run(home.env, ['login', '203.0.113.5', 'github'], { exec }))[0]!
    assert.equal(copied.logins.github.account, 'octocat')
    assert.equal(copied.logins.github.there, true)
    assert.equal(calls.length, 2)

    const refused = await run(home.env, ['login', '203.0.113.5', 'github'], { exec: pretendServer(call => (call.remote === 'true' ? undefined : { code: 1, err: 'error validating token: HTTP 401: Bad credentials' })).exec })
    assert.equal(refused.code, 1)
    assert.deepEqual(refused.err, ['error validating token: HTTP 401: Bad credentials'])
    assert.equal(serversOf(await run(home.env, ['status']))[0]!.logins.github.there, false)

    await run(home.env, ['login', '203.0.113.5', 'github'], { exec })
    const gone = serversOf(await run(home.env, ['logout', '203.0.113.5', 'github'], { exec }))[0]!
    assert.deepEqual(gone.logins.github, NONE)
  } finally {
    await home.remove()
  }
})

test('login claude starts the login\'s own process, which asks the person and gives the server the login; a second press starts over, and the first one is ended', async () => {
  const home = await testHome()
  const { spawn } = await import('node:child_process')
  const first = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'])
  try {
    await run(home.env, ['connect', '203.0.113.5', 'root', '1.2.3'], { startWork: () => 0 })
    await update(home.env, store => void delete store.servers[0]!.worker)

    const started: string[][] = []
    const asking = serversOf(await run(home.env, ['login', '203.0.113.5', 'claude'], { startWork: words => (started.push(words), first.pid!) }))[0]!
    assert.deepEqual(started, [['login-work', '203.0.113.5']])
    assert.deepEqual(asking.logins.claude, { there: false, working: true })
    // Not while the person is asked: there is nothing on the server yet to take off, and the list keeps the server.
    assert.deepEqual((await run(home.env, ['logout', '203.0.113.5', 'claude'])).err, ['A Claude login is being made for 203.0.113.5 right now'])
    assert.deepEqual((await run(home.env, ['forget', '203.0.113.5'])).err, ['A Claude login is being made for 203.0.113.5 right now: wait until it ends'])

    const ended = new Promise<NodeJS.Signals | null>(resolve => first.once('exit', (_code, signal) => resolve(signal)))
    await run(home.env, ['login', '203.0.113.5', 'claude'], { startWork: words => (started.push(words), process.pid) })
    assert.equal(await ended, 'SIGTERM')
    assert.equal(started.length, 2)

    // The process itself: this one stands in for it, as the command that started it left it.
    const login = `sk-ant-oat01-${'Zx9_-q'.repeat(16)}`
    const { exec, calls } = pretendServer()
    assert.equal((await run(home.env, ['login-work', '203.0.113.5'], { exec, mint: async () => ({ ok: true, login }), signal: new AbortController().signal })).code, 0)
    assert.deepEqual(calls.map(call => call.remote), ['true', 'bash -s'])
    const { claude } = serversOf(await run(home.env, ['status']))[0]!.logins
    assert.equal(claude.there, true)
    assert.equal(claude.working, false)
    // Good for a year from the day it was made.
    assert.equal(Date.parse(claude.ends!) - Date.parse(claude.since!), 365 * 24 * 60 * 60_000)

    const off = serversOf(await run(home.env, ['logout', '203.0.113.5', 'claude'], { exec }))[0]!
    assert.deepEqual(off.logins.claude, NONE)
  } finally {
    first.kill()
    await home.remove()
  }
})
