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
    // Started by a server's own service, OpenAgent says it is a server: its page then offers no servers to connect.
    assert.deepEqual((await run({ ...home.env, OPENAGENT_SERVER: '1' }, ['status'])).out, { server: true, servers: [] })
    assert.deepEqual((await run({ ...home.env, OPENAGENT_SERVER: '' }, ['status'])).out, { servers: [] })
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

test('devices asks the server\'s door who is in, and marks the line this computer keeps there; remove-device takes one out, never that line', async () => {
  const home = await testHome()
  try {
    await run(home.env, ['connect', 'box.example.com', 'root', '1.2.3'], { startWork: () => 0 })
    const PHONE = { id: 'a1b2c3d4e5f6', name: 'iPhone, Safari', added: '2026-10-12T17:50:00.000Z', seen: '2026-10-13T19:24:00.000Z' }
    const LINE = { id: '0f9e8d7c6b5a', name: 'Studio', added: '2026-10-13T19:20:00.000Z', line: true }
    const OTHER = { id: '112233445566', name: 'Laptop', added: '2026-10-13T19:21:00.000Z', line: true }
    let listed: unknown[] = [PHONE, LINE, OTHER]
    const { exec, calls } = pretendServer(call => {
      const removed = /^ID='([a-z0-9]+)'$/m.exec(call.script)?.[1]
      if (removed) listed = listed.filter(device => (device as { id: string }).id !== removed)
      return { out: JSON.stringify({ on: false, listening: true, devices: listed, lines: [] }) }
    })
    const asked: string[] = []
    // This computer's own door: it keeps a line to the server, and one to another server.
    const lines = [{ url: 'https://other.example.com', mode: 'full', id: OTHER.id }, { url: 'https://box.example.com', mode: 'full', id: LINE.id }]
    const door: CliIO['door'] = async args => (asked.push(args.join(' ')), { ok: true, out: JSON.stringify({ on: false, listening: false, devices: [], lines }) })

    // The door is asked which line is this computer's, whatever this package's own file says of one: the door keeps the line.
    assert.deepEqual((await run(home.env, ['devices', 'BOX.example.com'], { exec, door })).out, { devices: [PHONE, { ...LINE, own: true }, OTHER] })
    assert.deepEqual(asked, ['status'])
    assert.deepEqual(calls[0]!.args.slice(-5, -1), ['-l', 'root', '--', 'box.example.com'])
    // A device that says it keeps no line is not this computer's line, whatever id it has.
    listed = [PHONE, { ...LINE, line: undefined }, OTHER]
    assert.deepEqual((await run(home.env, ['devices', 'box.example.com'], { exec, door })).out, { devices: [PHONE, { id: LINE.id, name: LINE.name, added: LINE.added }, OTHER] })
    listed = [PHONE, LINE, OTHER]
    // A door that does not say, or says something else, marks nothing: the list is still told.
    for (const silent of [{ ok: false as const, error: 'the door of this computer did not answer' }, { ok: true as const }, { ok: true as const, out: 'not JSON' }, { ok: true as const, out: JSON.stringify({ lines: [{ url: 'https://box.example.com', id: '$(reboot)' }] }) }]) {
      assert.deepEqual((await run(home.env, ['devices', 'box.example.com'], { exec, door: async () => silent })).out, { devices: [PHONE, LINE, OTHER] })
    }

    // The line this computer keeps there is not taken out as a device is: it would go on asking with a key that opens nothing.
    const before = calls.length
    const own = await run(home.env, ['remove-device', 'box.example.com', LINE.id], { exec, door })
    assert.equal(own.code, 1)
    assert.deepEqual(own.err, ['That device is the line this computer keeps open to box.example.com. To take it out, remove the server here.'])
    const noId = await run(home.env, ['remove-device', 'box.example.com', "x'; reboot; '"], { exec, door })
    assert.equal(noId.code, 1)
    assert.deepEqual(noId.err, ["x'; reboot; ' is not a device's id"])
    assert.equal(calls.length, before)

    assert.deepEqual((await run(home.env, ['remove-device', 'box.example.com', PHONE.id], { exec, door })).out, { devices: [{ ...LINE, own: true }, OTHER] })
    assert.match(calls.at(-1)!.script, /remote-access remove "\$ID"\n/)

    const refused = await run(home.env, ['devices', 'box.example.com'], { exec: pretendServer(() => ({ code: 1, err: 'the door is not installed' })).exec, door })
    assert.equal(refused.code, 1)
    assert.deepEqual(refused.err, ['the door is not installed'])
    for (const args of [['devices', '203.0.113.9'], ['remove-device', '203.0.113.9', PHONE.id]]) {
      const unknown = await run(home.env, args, { exec, door })
      assert.equal(unknown.code, 1)
      assert.deepEqual(unknown.err, ['no server at 203.0.113.9'])
    }
    for (const args of [['devices'], ['devices', 'box.example.com', 'more'], ['remove-device', 'box.example.com']]) assert.equal((await run(home.env, args)).code, 2)
  } finally {
    await home.remove()
  }
})

test('connect with "github" keeps the person\'s tick until the install copies the login; the tick counts as it is at each press', async () => {
  const home = await testHome()
  try {
    for (const args of [['connect', '203.0.113.5', 'root', '1.2.3', 'gitlab'], ['connect', '203.0.113.5', 'root', '1.2.3', 'github', 'more'], ['login', '203.0.113.5'], ['login', '203.0.113.5', 'gitlab'], ['logout', '203.0.113.5'], ['github', 'more'], ['login-work'], ['login-work', '203.0.113.5'], ['logout-work', '203.0.113.5', 'gitlab']]) {
      assert.equal((await run(home.env, args)).code, 2, args.join(' '))
    }
    const ticked = serversOf(await run(home.env, ['connect', '203.0.113.5', 'root', '1.2.3', 'github']))[0]!
    assert.deepEqual(ticked.logins, { github: { there: false, working: true, wanted: true }, claude: NONE })
    assert.deepEqual((await readStore(home.env)).servers[0]!.github, { wanted: true })

    const { exec } = pretendServer(call => (call.script.includes('--with-token') ? { out: 'octocat\n' } : undefined))
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

test('github says whose login a copy would be, or why there is none', async () => {
  const home = await testHome()
  try {
    const good = pretendServer()
    assert.deepEqual((await run(home.env, ['github'], { exec: good.exec })).out, { account: 'octocat' })
    // Asked of github.com, whatever other host this computer's gh is set to.
    assert.deepEqual(good.asked, ['api --hostname github.com user --jq .login'])
    // Nobody's is an answer too: a page asks to know what it can offer.
    const nobody = await run(home.env, ['github'], { exec: pretendServer(undefined, () => ({ code: 1, out: '', err: 'To get started with GitHub CLI, please run:  gh auth login' })).exec })
    assert.equal(nobody.code, 0)
    assert.deepEqual(nobody.out, { problem: 'There is no GitHub login to copy from this computer. `gh` is not logged in to github.com here, or GitHub does not answer: see `gh auth status`.' })
  } finally {
    await home.remove()
  }
})

test('login and logout start a process of their own, which tells the server; not during an install, and not twice at once', async () => {
  const home = await testHome()
  const { spawn } = await import('node:child_process')
  const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'])
  try {
    assert.deepEqual((await run(home.env, ['login', '203.0.113.5', 'github'])).err, ['no server at 203.0.113.5'])
    await run(home.env, ['connect', '203.0.113.5', 'root', '1.2.3'])
    // Not while the server is being installed: the install's own end is where a ticked login goes.
    for (const args of [['login', '203.0.113.5', 'github'], ['login', '203.0.113.5', 'claude'], ['logout', '203.0.113.5', 'github']]) {
      assert.deepEqual((await run(home.env, args)).err, ['OpenAgent is being installed on 203.0.113.5 right now'], args.join(' '))
    }
    await update(home.env, store => void delete store.servers[0]!.worker)

    // A command a page runs has seconds: it starts the work and answers, and the work is another process's.
    const started: string[][] = []
    const copying = serversOf(await run(home.env, ['login', '203.0.113.5', 'github'], { startWork: words => (started.push(words), other.pid!) }))[0]!
    assert.deepEqual(started, [['login-work', '203.0.113.5', 'github']])
    assert.deepEqual(copying.logins.github, { there: false, working: true })
    for (const [args, why] of [
      [['login', '203.0.113.5', 'github'], 'The GitHub login of 203.0.113.5 is being changed right now'],
      [['logout', '203.0.113.5', 'github'], 'The GitHub login of 203.0.113.5 is being changed right now'],
      [['forget', '203.0.113.5'], 'A login of 203.0.113.5 is being changed right now: wait until it ends'],
      [['connect', '203.0.113.5', 'root', '1.2.4'], 'A login of 203.0.113.5 is being changed right now: wait until it ends'],
    ] as const) {
      const refused = await run(home.env, [...args])
      assert.equal(refused.code, 1, args.join(' '))
      assert.deepEqual(refused.err, [why])
    }
    assert.equal(started.length, 1)

    // The process itself: this one stands in for it, as the command that started it left it.
    await update(home.env, store => void (store.servers[0]!.github!.worker = { pid: process.pid, seen: new Date().toISOString() }))
    const { exec, calls } = pretendServer(call => (call.script.includes('--with-token') ? { out: 'octocat\n' } : undefined))
    assert.equal((await run(home.env, ['login-work', '203.0.113.5', 'github'], { exec, signal: new AbortController().signal })).code, 0)
    assert.equal(calls.length, 2)
    const copied = serversOf(await run(home.env, ['status']))[0]!.logins.github
    assert.equal(copied.account, 'octocat')
    assert.equal(copied.there, true)
    assert.equal(copied.working, false)

    const refusing = pretendServer(call => (call.remote === 'true' ? undefined : { code: 1, err: 'error validating token: HTTP 401: Bad credentials' }))
    assert.equal((await run(home.env, ['login-work', '203.0.113.5', 'github'], { exec: refusing.exec, signal: new AbortController().signal })).code, 0)
    assert.deepEqual(serversOf(await run(home.env, ['status']))[0]!.logins.github, { there: false, working: false, said: 'error validating token: HTTP 401: Bad credentials' })

    await run(home.env, ['login-work', '203.0.113.5', 'github'], { exec, signal: new AbortController().signal })
    const leaving = serversOf(await run(home.env, ['logout', '203.0.113.5', 'github'], { startWork: words => (started.push(words), process.pid) }))[0]!
    assert.deepEqual(started.at(-1), ['logout-work', '203.0.113.5', 'github'])
    assert.equal(leaving.logins.github.working, true)
    assert.equal((await run(home.env, ['logout-work', '203.0.113.5', 'github'], { exec, signal: new AbortController().signal })).code, 0)
    assert.deepEqual(serversOf(await run(home.env, ['status']))[0]!.logins.github, NONE)
  } finally {
    other.kill()
    await home.remove()
  }
})

test('login github own has the server get a login of its own: status tells the code while the server waits, and a second press starts over; own is for a GitHub login alone', async () => {
  const home = await testHome()
  const { spawn } = await import('node:child_process')
  const first = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'])
  try {
    await run(home.env, ['connect', '203.0.113.5', 'root', '1.2.3'])
    await update(home.env, store => void delete store.servers[0]!.worker)
    for (const args of [['login', '203.0.113.5', 'claude', 'own'], ['logout', '203.0.113.5', 'github', 'own'], ['login', '203.0.113.5', 'github', 'mine'], ['login-work', '203.0.113.5', 'claude', 'own'], ['logout-work', '203.0.113.5', 'github', 'own']]) {
      assert.equal((await run(home.env, args)).code, 2, args.join(' '))
    }

    const started: string[][] = []
    const asked = serversOf(await run(home.env, ['login', '203.0.113.5', 'github', 'own'], { startWork: words => (started.push(words), first.pid!) }))[0]!
    assert.deepEqual(started, [['login-work', '203.0.113.5', 'github', 'own']])
    assert.deepEqual(asked.logins.github, { there: false, working: true })
    // Not yet waiting for the person: a second press is refused, as for a copy.
    assert.deepEqual((await run(home.env, ['login', '203.0.113.5', 'github', 'own'])).err, ['The GitHub login of 203.0.113.5 is being changed right now'])

    // The server waits for the code to be typed: status tells it, and a second press ends the first and asks anew.
    await update(home.env, store => void Object.assign(store.servers[0]!.github!, { asking: true, code: 'ABCD-1234' }))
    assert.deepEqual(serversOf(await run(home.env, ['status']))[0]!.logins.github, { there: false, working: true, asking: true, code: 'ABCD-1234' })
    const ended = new Promise(resolve => first.once('exit', resolve))
    const again = serversOf(await run(home.env, ['login', '203.0.113.5', 'github', 'own'], { startWork: words => (started.push(words), process.pid) }))[0]!
    await ended
    assert.equal(started.length, 2)
    // The old code is no longer told: it is the first press's.
    assert.deepEqual(again.logins.github, { there: false, working: true })

    // The process itself, as the command that started it left it.
    const { exec, calls } = pretendServer(call => (call.script.includes('nohup setsid gh') ? { out: '4242 /home/openagent/.cache/openagent-github-login.aB3dE9 WXYZ-9876\n' } : call.script.includes('while asking "$PID"') ? { out: 'octocat\n' } : undefined))
    assert.equal((await run(home.env, ['login-work', '203.0.113.5', 'github', 'own'], { exec, signal: new AbortController().signal })).code, 0)
    assert.equal(calls.filter(call => call.remote !== 'true').length, 2)
    const given = serversOf(await run(home.env, ['status']))[0]!.logins.github
    assert.deepEqual([given.there, given.working, given.account, given.asking, given.code], [true, false, 'octocat', undefined, undefined])
  } finally {
    first.kill()
    await home.remove()
  }
})

test('login claude asks the person and gives the server the login; a second press while the person is asked starts over and ends the first; one on its way to the server is not cut', async () => {
  const home = await testHome()
  const { spawn } = await import('node:child_process')
  const first = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'])
  const second = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'])
  try {
    await run(home.env, ['connect', '203.0.113.5', 'root', '1.2.3'], { startWork: () => 0 })
    await update(home.env, store => void delete store.servers[0]!.worker)

    const started: string[][] = []
    const begun = serversOf(await run(home.env, ['login', '203.0.113.5', 'claude'], { startWork: words => (started.push(words), first.pid!) }))[0]!
    assert.deepEqual(started, [['login-work', '203.0.113.5', 'claude']])
    assert.deepEqual(begun.logins.claude, { there: false, working: true })

    // Its process says it waits for the person: from then on a second press is a new start.
    await update(home.env, store => void (store.servers[0]!.claude!.asking = true))
    assert.deepEqual(serversOf(await run(home.env, ['status']))[0]!.logins.claude, { there: false, working: true, asking: true })
    assert.deepEqual((await run(home.env, ['logout', '203.0.113.5', 'claude'])).err, ['The Claude login of 203.0.113.5 is being changed right now'])
    const ended = new Promise<NodeJS.Signals | null>(resolve => first.once('exit', (_code, signal) => resolve(signal)))
    await run(home.env, ['login', '203.0.113.5', 'claude'], { startWork: words => (started.push(words), second.pid!) })
    assert.equal(await ended, 'SIGTERM')
    assert.equal(started.length, 2)

    // The second one no longer waits: it tells the server. A press now changes nothing and ends nothing.
    assert.deepEqual(serversOf(await run(home.env, ['status']))[0]!.logins.claude, { there: false, working: true })
    const cut = await run(home.env, ['login', '203.0.113.5', 'claude'], { startWork: words => (started.push(words), process.pid) })
    assert.deepEqual(cut.err, ['The Claude login of 203.0.113.5 is being changed right now'])
    assert.equal(started.length, 2)
    assert.equal(second.exitCode, null)
    assert.equal(second.signalCode, null)

    // The process itself: this one stands in for it, as the command that started it left it.
    await update(home.env, store => void (store.servers[0]!.claude!.worker = { pid: process.pid, seen: new Date().toISOString() }))
    const login = `sk-ant-oat01-${'Zx9_-q'.repeat(16)}`
    const { exec, calls } = pretendServer()
    assert.equal((await run(home.env, ['login-work', '203.0.113.5', 'claude'], { exec, mint: async () => ({ ok: true, login }), signal: new AbortController().signal })).code, 0)
    assert.deepEqual(calls.map(call => call.remote), ['true', 'bash -s'])
    const { claude } = serversOf(await run(home.env, ['status']))[0]!.logins
    assert.equal(claude.there, true)
    assert.equal(claude.working, false)
    // Good for a year from the day it was made.
    assert.equal(Date.parse(claude.ends!) - Date.parse(claude.since!), 365 * 24 * 60 * 60_000)

    await run(home.env, ['logout', '203.0.113.5', 'claude'])
    assert.equal((await run(home.env, ['logout-work', '203.0.113.5', 'claude'], { exec, signal: new AbortController().signal })).code, 0)
    assert.deepEqual(serversOf(await run(home.env, ['status']))[0]!.logins.claude, NONE)
  } finally {
    first.kill()
    second.kill()
    await home.remove()
  }
})

test('reach asks the server for a link once and has this computer\'s own door keep a line with it; after that only what the server may do changes; forget takes the line with it', async () => {
  const home = await testHome()
  try {
    await run(home.env, ['connect', 'box.example.com', 'root', '1.2.3'], { startWork: () => 0 })
    const link = { url: 'https://box.example.com/_remote-access/enter#code.pin', expires: '2026-10-11T12:00:00.000Z' }
    const { exec, calls } = pretendServer(() => ({ out: JSON.stringify(link) }))
    const asked: string[] = []
    let answers: (args: string[]) => { ok: true } | { ok: false; error: string } = () => ({ ok: true })
    // What the door is told, and after a bar what it is handed on standard input.
    const door: CliIO['door'] = async (args, _env, input) => (asked.push(args.join(' ') + (input === undefined ? '' : ` | ${input}`)), answers(args))

    assert.equal(serversOf(await run(home.env, ['status']))[0]!.reach, undefined)
    // The first time: a link from the server, over SSH, and the door gets in with it.
    assert.equal(serversOf(await run(home.env, ['reach', 'box.example.com', 'full'], { exec, door }))[0]!.reach, 'full')
    assert.deepEqual(asked, [`line add - | ${link.url}`])
    assert.equal(calls.length, 1)

    // From then on the server is asked nothing: the door is told what the server may do.
    assert.equal(serversOf(await run(home.env, ['reach', 'box.example.com', 'watch'], { exec, door }))[0]!.reach, 'watch')
    assert.deepEqual(asked.slice(1), ['line watch box.example.com'])
    assert.equal(calls.length, 1)

    // A line the door no longer keeps is asked for anew, as what the person just picked.
    answers = args => (args[1] === 'add' ? { ok: true } : { ok: false, error: 'This computer keeps no line to box.example.com.' })
    assert.equal(serversOf(await run(home.env, ['reach', 'box.example.com', 'watch'], { exec, door }))[0]!.reach, 'watch')
    assert.deepEqual(asked.slice(2), ['line watch box.example.com', `line add - watch | ${link.url}`])
    assert.equal(calls.length, 2)

    // What the door or the server refuses is said, and nothing is kept of the try.
    answers = () => ({ ok: false, error: 'The server did not give a line: this code no longer works' })
    const refused = await run(home.env, ['reach', 'box.example.com', 'full'], { exec, door })
    assert.equal(refused.code, 1)
    assert.deepEqual(refused.err, ['The server did not give a line: this code no longer works'])
    assert.equal(serversOf(await run(home.env, ['status']))[0]!.reach, 'watch')
    const unreachable = await run(home.env, ['reach', 'box.example.com', 'full'], { exec: pretendServer(() => ({ code: 1, err: 'the door is not open' })).exec, door })
    assert.deepEqual(unreachable.err, ['the door is not open'])

    for (const args of [['reach', 'box.example.com'], ['reach', 'box.example.com', 'half'], ['reach']]) assert.equal((await run(home.env, args, { exec, door })).code, 2)
    assert.deepEqual((await run(home.env, ['reach', '203.0.113.9', 'full'], { exec, door })).err, ['no server at 203.0.113.9'])

    // A server taken off the list is left no way to this computer.
    asked.length = 0
    answers = () => ({ ok: true })
    assert.deepEqual((await run(home.env, ['forget', 'box.example.com'], { door })).out, { servers: [] })
    assert.deepEqual(asked, ['line remove box.example.com'])
  } finally {
    await home.remove()
  }
})
