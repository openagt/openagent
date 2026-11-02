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
    for (const args of [[], ['nonsense'], ['connect', '203.0.113.5'], ['connect', '203.0.113.5', 'root', '1.2.3', 'github'], ['status', 'more'], ['forget']]) {
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
    assert.deepEqual(serversOf(connected), [{ address: '203.0.113.5', url: 'https://203.0.113.5', user: 'root', working: true, adding: true, steps: STEPS.map(({ id, label }) => ({ id, label, state: 'waiting' })) }])

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
      { id: 'user', label: 'A user of its own, openagent', state: 'failed', said: 'The install stopped before this step ended.' },
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
    const link = { url: 'https://box.example.com/_devices/enter#K7P4QX9M.pin', where: 'box.example.com', code: 'K7P4-QX9M', expires: '2026-10-11T12:00:00.000Z' }
    const { exec, calls } = pretendServer(() => ({ out: JSON.stringify(link) }))
    // A name is found again however it was typed.
    assert.deepEqual((await run(home.env, ['link', 'BOX.example.com'], { exec })).out, link)
    assert.deepEqual(calls[0]!.args.slice(-5, -1), ['-l', 'root', '--', 'box.example.com'])

    // For a person: their name goes to the server as one word of the script, an apostrophe and all.
    const forRom = pretendServer(() => ({ out: JSON.stringify(link) }))
    assert.deepEqual((await run(home.env, ['link', 'box.example.com', '--for', " Rom  O'Neil "], { exec: forRom.exec })).out, link)
    assert.match(forRom.calls[0]!.script, /^FOR='Rom O'\\''Neil'$/m)
    assert.match(forRom.calls[0]!.script, /devices add --for "\$FOR"\n/)
    const notName = await run(home.env, ['link', 'box.example.com', '--for', "x; reboot"], { exec: forRom.exec })
    assert.deepEqual([notName.code, notName.err, forRom.calls.length], [1, ['x; reboot is not a name: letters, digits, spaces, dots, apostrophes and dashes, at most 40'], 1])

    const elsewhere = await run(home.env, ['link', 'box.example.com'], { exec: pretendServer(() => ({ out: JSON.stringify({ ...link, url: 'https://evil.example/_devices/enter#code.pin' }) })).exec })
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

    // Nothing listed here yet: no list to show at once.
    assert.deepEqual((await run(home.env, ['devices', 'box.example.com', '--last'], { exec, door })).err, ['box.example.com was not listed here yet'])
    // The door is asked which line is this computer's, whatever this package's own file says of one: the door keeps the line.
    assert.deepEqual((await run(home.env, ['devices', 'BOX.example.com'], { exec, door })).out, { devices: [PHONE, { ...LINE, own: true }, OTHER], persons: [] })
    assert.deepEqual(asked, ['status'])
    assert.deepEqual(calls[0]!.args.slice(-5, -1), ['-l', 'root', '--', 'box.example.com'])
    // What was told is kept: --last says it at once, asking neither the server nor the door.
    assert.deepEqual((await run(home.env, ['devices', 'box.example.com', '--last'], { exec, door })).out, { devices: [PHONE, { ...LINE, own: true }, OTHER], persons: [] })
    assert.equal(calls.length, 1)
    assert.deepEqual(asked, ['status'])
    // A device that says it keeps no line is not this computer's line, whatever id it has.
    listed = [PHONE, { ...LINE, line: undefined }, OTHER]
    assert.deepEqual((await run(home.env, ['devices', 'box.example.com'], { exec, door })).out, { devices: [PHONE, { id: LINE.id, name: LINE.name, added: LINE.added }, OTHER], persons: [] })
    listed = [PHONE, LINE, OTHER]
    // A door that does not say, or says something else, marks nothing: the list is still told.
    for (const silent of [{ ok: false as const, error: 'the door of this computer did not answer' }, { ok: true as const }, { ok: true as const, out: 'not JSON' }, { ok: true as const, out: JSON.stringify({ lines: [{ url: 'https://box.example.com', id: '$(reboot)' }] }) }]) {
      assert.deepEqual((await run(home.env, ['devices', 'box.example.com'], { exec, door: async () => silent })).out, { devices: [PHONE, LINE, OTHER], persons: [] })
    }

    // The line this computer keeps there is not taken out as a device is: it would go on asking with a key that opens nothing.
    const removals = (): number => calls.filter(call => /devices remove /.test(call.script)).length
    const own = await run(home.env, ['remove-device', 'box.example.com', LINE.id], { exec, door })
    assert.equal(own.code, 1)
    assert.deepEqual(own.err, ['That device is the line this computer keeps open to box.example.com. To take it out, remove the server here.'])
    const before = calls.length
    const noId = await run(home.env, ['remove-device', 'box.example.com', "x'; reboot; '"], { exec, door })
    assert.equal(noId.code, 1)
    assert.deepEqual(noId.err, ["x'; reboot; ' is not a device's id"])
    assert.equal(calls.length, before)

    // A computer is one row there, its OpenAgent and its line: this computer's row is its own by its line, under whichever id the row is listed,
    // and no id of that row takes it out, since the server takes a computer out whole.
    const KEY = { id: 'c1b2c3d4e5f6', name: 'Studio', added: '2026-10-13T19:00:00.000Z', seen: '2026-10-13T19:30:00.000Z', line: true, also: [LINE.id] }
    listed = [PHONE, KEY, OTHER]
    assert.deepEqual((await run(home.env, ['devices', 'box.example.com'], { exec, door })).out, { devices: [PHONE, { ...KEY, own: true }, OTHER], persons: [] })
    for (const id of [KEY.id, LINE.id]) {
      const whole = await run(home.env, ['remove-device', 'box.example.com', id], { exec, door })
      assert.equal(whole.code, 1, id)
      assert.deepEqual(whole.err, ['That device is the line this computer keeps open to box.example.com. To take it out, remove the server here.'])
    }
    assert.equal(removals(), 0)
    listed = [PHONE, LINE, OTHER]

    // The door says when the server said no to the key this computer asks for its line with: told with the list.
    const refusedDoor: CliIO['door'] = async () => ({ ok: true, out: JSON.stringify({ lines: [{ url: 'https://box.example.com', mode: 'full', id: LINE.id, refused: true }] }) })
    assert.deepEqual((await run(home.env, ['devices', 'box.example.com'], { exec, door: refusedDoor })).out, { devices: [PHONE, { ...LINE, own: true }, OTHER], persons: [], lineRefused: true })

    assert.deepEqual((await run(home.env, ['remove-device', 'box.example.com', PHONE.id], { exec, door })).out, { devices: [{ ...LINE, own: true }, OTHER], persons: [] })
    // The list a removal tells is the one kept.
    assert.deepEqual((await run(home.env, ['devices', 'box.example.com', '--last'], { exec, door })).out, { devices: [{ ...LINE, own: true }, OTHER], persons: [] })
    assert.match(calls.at(-1)!.script, /devices remove "\$ID"\n/)

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

test('github says whose login a copy would be, or why there is none', async () => {
  const home = await testHome()
  try {
    assert.equal((await run(home.env, ['github', 'more'])).code, 2)
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

test('reach asks the server for a link once and has this computer\'s own door keep a line with it; after that only what the server may do changes; forget takes the line with it', async () => {
  const home = await testHome()
  try {
    await run(home.env, ['connect', 'box.example.com', 'root', '1.2.3'], { startWork: () => 0 })
    const link = { url: 'https://box.example.com/_devices/enter#K7P4QX9M.pin', where: 'box.example.com', code: 'K7P4-QX9M', expires: '2026-10-11T12:00:00.000Z' }
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
