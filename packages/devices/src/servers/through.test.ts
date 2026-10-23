import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { runCli, type CliIO, type Status } from './cli.js'
import { install } from './install.js'
import { DESKTOP_FILE, HELPER, LINE_STEP, STEPS, THROUGH_STEP_IDS, quoted, stepsFor, whoScript, type Facts } from './steps.js'
import { freshSteps, readStore, update } from './store.js'
import { pretendServer, testHome, type Call } from './test-home.js'

// A computer at home, set up as a server "through" a server its person is in at: no door of its
// own, a line to that server instead, and who there may start runs on it.

const run = promisify(execFile)
const VPS = 'https://165.245.244.10'
const BOX = { address: '192.168.1.20', user: 'rom' }
const LINK = `${VPS}/_devices/enter#code.pin`
const DOOR = '/opt/openagent/node/bin/node /opt/openagent/node/lib/node_modules/@openagt/start/node_modules/@openagt/devices/bin/devices'
const FACTS: Facts = { address: BOX.address, version: '1.2.3', through: { url: VPS, owner: 'rom', who: 'me' }, desktop: 'rom' }

/** Run a script with the door's command in place of a stand-in that writes down what it was asked, and what it read. */
async function withDoor(script: string, answer = ''): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), 'servers-through-'))
  try {
    const log = join(dir, 'log')
    const door = join(dir, 'door')
    await writeFile(door, `#!/bin/bash\ninput=$(cat)\nprintf '%s|%s|%s\\n' "\${OPENAGENT_PERSON_HELPER:-}" "$*" "$input" >> ${quoted(log)}\nprintf '%s' ${quoted(answer)}\n`)
    await chmod(door, 0o755)
    await new Promise<void>((resolve, reject) => {
      const child = execFile('bash', ['-s'], error => (error ? reject(error) : resolve()))
      child.stdin!.end(script.replaceAll(DOOR, door))
    })
    return (await readFile(log, 'utf8')).trim().split('\n')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('a computer reached through a server has its line where a server has its door, and opens nothing to the internet', async () => {
  assert.deepEqual(stepsFor(true).map(step => step.id), [...THROUGH_STEP_IDS])
  assert.deepEqual(stepsFor(false), STEPS)
  for (const step of stepsFor(true)) await run('bash', ['-n', '-c', step.script(FACTS)])
  const service = (facts: Facts): string => STEPS.find(step => step.id === 'service')!.script(facts)
  assert.match(service({ address: '203.0.113.5', version: '1.2.3' }), /ufw allow 443\/tcp/)
  assert.doesNotMatch(service(FACTS), /ufw/)
  assert.throws(() => LINE_STEP.script({ address: BOX.address, version: '1.2.3' }), /only a computer reached through a server/)
})

test('the line step names the owner, lets the line in with the link on standard input, and says who may start runs', async () => {
  const helper = '/opt/openagent/bin/openagent-person'
  const asked = await withDoor(LINE_STEP.script({ ...FACTS, through: { ...FACTS.through!, link: LINK, who: 'everyone' } }))
  assert.deepEqual(asked, ['|owner rom|', `|line add -|${LINK}`, `${helper}|line everyone ${VPS}|`])
  // A computer that keeps its line there already gets no link, and keeps what it is told.
  assert.deepEqual(await withDoor(LINE_STEP.script(FACTS)), ['|owner rom|', `${helper}|line full ${VPS}|`])
  // The link is a word of the script, never on a command line.
  assert.doesNotMatch(LINE_STEP.script({ ...FACTS, through: { ...FACTS.through!, link: LINK } }), new RegExp(`line add ${LINK.replace(/[.#/]/g, '\\$&')}`))
  assert.deepEqual(await withDoor(whoScript(VPS, 'nobody')), [`${helper}|line watch ${VPS}|`, '|status|'])
  assert.deepEqual(await withDoor(whoScript(VPS, 'me', ['dani', 'sam'])), [`${helper}|line full ${VPS}|`, `${helper}|remove-person dani|`, `${helper}|remove-person sam|`, '|status|'])
})

test('the person at a computer reached through a server may open its OpenAgent: their user is let call the owner\'s ports, and no other', async () => {
  const people = STEPS.find(step => step.id === 'people')!
  assert.match(people.script(FACTS), /^DESKTOP='rom'$/m)
  assert.match(people.script({ address: '203.0.113.5', version: '1.2.3' }), /^DESKTOP=''$/m)
  const dir = await mkdtemp(join(tmpdir(), 'servers-desktop-'))
  try {
    const file = join(dir, 'desktop-user')
    const rules = async (said: string | undefined): Promise<string> => {
      if (said === undefined) await rm(file, { force: true })
      else await writeFile(file, said)
      const at = HELPER.lastIndexOf('case "${1:-}" in')
      const text = `${HELPER.slice(0, at)}rules\n`.replaceAll(DESKTOP_FILE, quoted(file)).replace(/^PERSONS=.*$/m, `PERSONS=${quoted(dir)}`).replace(/^is_user\(\) \{.*\}$/m, 'is_user() { [ "$1" != gone ]; }')
      const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
        const child = execFile('bash', ['-s'], (error, stdout) => (error ? reject(error) : resolve({ stdout })))
        child.stdin!.end(text)
      })
      return stdout.split('\n')[0]!
    }
    assert.equal(await rules(undefined), '    oifname "lo" tcp dport 4200-4299 meta skuid != { "openagent", "root" } reject with tcp reset')
    assert.equal(await rules('rom\n'), '    oifname "lo" tcp dport 4200-4299 meta skuid != { "openagent", "root", "rom" } reject with tcp reset')
    // A name that is no user, the server's own, root, or anything that is no name at all: nobody more.
    for (const said of ['gone', 'openagent', 'root', 'rom"; drop', 'Rom', '']) assert.equal(await rules(said), '    oifname "lo" tcp dport 4200-4299 meta skuid != { "openagent", "root" } reject with tcp reset', said)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

/** OpenAgent on this computer, as the install asks it: what it said, and what it was asked. */
function pretendOpenAgent(answers: Record<string, unknown>): { ask: (fn: string, args: unknown[]) => Promise<unknown>; asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    ask: async (fn, args) => {
      asked.push(`${fn} ${JSON.stringify(args)}`)
      return answers[fn]
    },
  }
}

const statusWith = (lines: unknown[]): string => `${JSON.stringify({ devices: [], persons: [], lines })}\n`
const isStatus = (call: Call): boolean => call.script.includes(`${DOOR} status`) && !call.script.includes('line "$MODE"')

test('the install of a computer reached through a server gives it its line as the person\'s there, with a link asked for only at that step', async () => {
  const home = await testHome()
  try {
    await update(home.env, store => void store.servers.push({ ...BOX, through: VPS, steps: freshSteps(true), adding: true }))
    const { exec, calls } = pretendServer(call => (isStatus(call) ? { out: statusWith([]) } : undefined))
    const openagent = pretendOpenAgent({ onMachinePerson: { ok: true, said: { person: 'Rom', owner: false, devices: [] } }, sendMachineLineLink: { ok: true, url: LINK } })
    await install({ env: home.env, address: BOX.address, version: '1.2.3', exec, ask: openagent.ask })
    const [server] = (await readStore(home.env)).servers
    assert.deepEqual(server!.steps.map(step => `${step.id}:${step.state}`), THROUGH_STEP_IDS.map(id => `${id}:done`))
    assert.deepEqual(openagent.asked, [`onMachinePerson ["${VPS}"]`, `sendMachineLineLink ["${VPS}"]`])
    const line = calls.at(-1)!.script
    assert.match(line, /^OWNER='Rom'$/m)
    assert.match(line, new RegExp(`^LINK='${LINK.replace(/[.#/]/g, '\\$&')}'$`, 'm'))
    assert.match(line, /^MODE='full'$/m)
    // The person logs in as their own user: the one at the computer's screen, whom its firewall lets open OpenAgent.
    assert.match(calls.find(call => call.script.includes('DESKTOP='))!.script, /^DESKTOP='rom'$/m)

    // Again, with its line kept and everyone let in: no link is spent, and what it was told is kept.
    await update(home.env, store => Object.assign(store.servers[0]!, { steps: freshSteps(true), who: 'everyone' }))
    const kept = pretendServer(call => (isStatus(call) ? { out: statusWith([{ url: VPS, mode: 'full', for: 'everyone', id: 'line12345678' }]) } : undefined))
    const again = pretendOpenAgent({ onMachinePerson: { ok: true, said: { person: 'rom', owner: false, devices: [] } } })
    await install({ env: home.env, address: BOX.address, version: '1.2.3', exec: kept.exec, ask: again.ask })
    assert.deepEqual(again.asked, [`onMachinePerson ["${VPS}"]`])
    assert.match(kept.calls.at(-1)!.script, /^LINK=''$/m)
    assert.match(kept.calls.at(-1)!.script, /^MODE='everyone'$/m)
  } finally {
    await home.remove()
  }
})

test('a server that does not say who the person is there stops the line step, in words, and the steps before are done', async () => {
  const home = await testHome()
  try {
    await update(home.env, store => void store.servers.push({ ...BOX, through: VPS, steps: freshSteps(true), adding: true }))
    const { exec } = pretendServer(call => (isStatus(call) ? { out: statusWith([]) } : undefined))
    await install({ env: home.env, address: BOX.address, version: '1.2.3', exec, ask: pretendOpenAgent({ onMachinePerson: { ok: true, said: { owner: true, devices: [] } } }).ask })
    const steps = (await readStore(home.env)).servers[0]!.steps
    assert.deepEqual(steps.at(-1), { id: 'line', state: 'failed', said: '165.245.244.10 does not say who you are there. Press Invite on its row once: it names you its owner.' })
    assert.ok(steps.slice(0, -1).every(step => step.state === 'done'))

    await update(home.env, store => void (store.servers[0]!.steps = freshSteps(true)))
    await install({ env: home.env, address: BOX.address, version: '1.2.3', exec, ask: pretendOpenAgent({ onMachinePerson: { ok: true, said: { person: 'rom', owner: false, devices: [] } }, sendMachineLineLink: { ok: false, error: 'only a computer that is in at a server asks for a line' } }).ask })
    assert.equal((await readStore(home.env)).servers[0]!.steps.at(-1)!.said, '165.245.244.10 gave no link for the line: only a computer that is in at a server asks for a line')
  } finally {
    await home.remove()
  }
})

async function cli(env: NodeJS.ProcessEnv, args: string[], over: Partial<CliIO> = {}): Promise<{ code: number; out: unknown; err: string[] }> {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli(args, { env, stdout: line => out.push(line), stderr: line => err.push(line), startWork: () => process.pid, ...over })
  return { code, out: out.length ? (JSON.parse(out.join('\n')) as unknown) : undefined, err }
}

test('connect --through saves a computer reached through a server; an update keeps it so, and its status names its line and who may start runs', async () => {
  const home = await testHome()
  try {
    const started: string[][] = []
    const connected = await cli(home.env, ['connect', BOX.address, BOX.user, '1.2.3', '--through', VPS], { startWork: words => (started.push(words), process.pid) })
    assert.equal(connected.code, 0, connected.err.join('\n'))
    const [row] = (connected.out as Status).servers
    assert.equal(row!.through, VPS)
    assert.equal(row!.who, 'me')
    assert.deepEqual(row!.steps.map(step => [step.id, step.label]).at(-1), ['line', 'Its line to 165.245.244.10'])
    assert.ok(!row!.steps.some(step => step.id === 'door'))
    assert.equal(row!.url, `https://${BOX.address}`)

    await update(home.env, store => void delete store.servers[0]!.worker)
    await cli(home.env, ['connect', BOX.address, BOX.user, '1.2.3'])
    assert.equal((await readStore(home.env)).servers[0]!.through, VPS)

    for (const through of ['http://165.245.244.10', 'https://165.245.244.10/x', 'nonsense']) {
      await update(home.env, store => void delete store.servers[0]!.worker)
      assert.deepEqual((await cli(home.env, ['connect', BOX.address, BOX.user, '1.2.3', '--through', through])).err, [`${through} is not a server's address among OpenAgent's machines`])
    }
    // This computer keeps no line to it: its line goes to its own server.
    await update(home.env, store => void delete store.servers[0]!.worker)
    assert.deepEqual((await cli(home.env, ['reach', BOX.address, 'full'])).err, [`${BOX.address} is reached through a server: this computer keeps no line to it`])
  } finally {
    await home.remove()
  }
})

test('add-through saves the computer among the machines through its server, by its line there', async () => {
  const home = await testHome()
  try {
    await update(home.env, store => void store.servers.push({ ...BOX, through: VPS, steps: freshSteps(true).map(step => ({ ...step, state: 'done' })), adding: true }))
    const { exec } = pretendServer(call => (isStatus(call) ? { out: statusWith([{ url: VPS, mode: 'full', id: 'line12345678' }]) } : undefined))
    const openagent = pretendOpenAgent({ sendAddComputerThrough: { ok: true, machine: {} } })
    const added = await cli(home.env, ['add-through', BOX.address], { exec, ask: openagent.ask })
    assert.equal(added.code, 0, added.err.join('\n'))
    assert.deepEqual(openagent.asked, [`sendAddComputerThrough ["${VPS}","line12345678"]`])
    const [row] = (added.out as Status).servers
    assert.equal(row!.url, `${VPS}/_devices/via/line12345678`)
    assert.equal(row!.adding, false)

    const none = pretendServer(call => (isStatus(call) ? { out: statusWith([]) } : undefined))
    assert.deepEqual((await cli(home.env, ['add-through', BOX.address], { exec: none.exec, ask: openagent.ask })).err, [`${BOX.address} keeps no line to 165.245.244.10 yet: press Update on its row.`])
    await update(home.env, store => void store.servers.push({ address: '203.0.113.5', user: 'root', steps: freshSteps(), adding: false }))
    assert.deepEqual((await cli(home.env, ['add-through', '203.0.113.5'])).err, ['203.0.113.5 is not reached through a server'])
  } finally {
    await home.remove()
  }
})

test('who says who may start runs; with remove, the users the line made for the others go, and nobody else\'s', async () => {
  const home = await testHome()
  try {
    await update(home.env, store => void store.servers.push({ ...BOX, through: VPS, who: 'everyone', steps: freshSteps(true).map(step => ({ ...step, state: 'done' })), adding: false }))
    const persons = [{ name: 'rom', owner: true }, { name: 'dani', from: VPS }, { name: 'sam', from: 'https://other.example' }, { name: 'lee', from: VPS, removed: true }]
    const listed = `${JSON.stringify({ devices: [], persons })}\n`
    const { exec, calls } = pretendServer(call => (call.script.includes(`${DOOR} status`) ? { out: listed } : undefined))
    const said = await cli(home.env, ['who', BOX.address, 'me', 'remove'], { exec })
    assert.equal(said.code, 0, said.err.join('\n'))
    const script = calls.at(-1)!.script
    assert.match(script, /remove-person 'dani'/)
    assert.match(script, /remove-person 'lee'/)
    assert.doesNotMatch(script, /remove-person 'sam'|remove-person 'rom'/)
    assert.deepEqual((said.out as { persons: unknown[] }).persons.slice(1, 2), [{ name: 'dani', from: VPS }])
    assert.equal((await readStore(home.env)).servers[0]!.who, 'me')

    const kept = await cli(home.env, ['who', BOX.address, 'nobody'], { exec })
    assert.equal(kept.code, 0)
    assert.doesNotMatch(calls.at(-1)!.script, /remove-person/)
    assert.equal((await readStore(home.env)).servers[0]!.who, 'nobody')
    assert.equal((await cli(home.env, ['who', BOX.address, 'all'])).code, 2)
  } finally {
    await home.remove()
  }
})
