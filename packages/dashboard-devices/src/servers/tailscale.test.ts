import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { runCli, type CliIO, type Status } from './cli.js'
import { STEPS, TAILSCALE_DOOR_STEP, TAILSCALE_STEP, TAILSCALE_STEP_IDS, quoted, stepsFor, type Facts } from './steps.js'
import { freshSteps, readStore, sanitize, update } from './store.js'
import { install } from './install.js'
import { pretendServer, testHome } from './test-home.js'

// A PC on the person's Tailscale network, set up as a server: connected by its name there, with
// its door behind Tailscale in place of one on the internet, and nothing opened to the internet.

const run = promisify(execFile)
const PC = { address: 'homepc.tail1234.ts.net', user: 'rom' }
const FACTS: Facts = { address: PC.address, version: '1.2.3', tailscale: true, desktop: 'rom' }
const DOOR = '/opt/openagent/node/bin/node /opt/openagent/node/lib/node_modules/@openagt/start/node_modules/@openagt/dashboard-devices/bin/devices'

/**
 * Run a step's script with stand-ins: `tailscale` and the door's command answer what the test
 * says and write down what they were asked. The script's lock is one of the test's own, and its
 * waits are short.
 */
async function withStandIns(script: string, opts: { tailscale?: string; status?: string[] } = {}): Promise<{ code: number; asked: string[]; said: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'servers-tailscale-'))
  try {
    const log = join(dir, 'log')
    await writeFile(log, '')
    if (opts.tailscale !== undefined) {
      await writeFile(join(dir, 'tailscale'), `#!/bin/bash\nprintf 'tailscale %s\\n' "$*" >> ${quoted(log)}\nif [ "$1" = status ]; then printf '%s' ${quoted(opts.tailscale)}; fi\n`)
      await chmod(join(dir, 'tailscale'), 0o755)
    }
    // The door answers its status from a list, one after the other, the last one again and again.
    const answers = opts.status ?? ['{}']
    await writeFile(join(dir, 'count'), '0')
    await writeFile(join(dir, 'door'), `#!/bin/bash\nprintf 'door %s\\n' "$*" >> ${quoted(log)}\nif [ "$1" = status ]; then n=$(cat ${quoted(join(dir, 'count'))}); echo $((n+1)) > ${quoted(join(dir, 'count'))}; answers=(${answers.map(quoted).join(' ')}); i=$(( n < ${answers.length - 1} ? n : ${answers.length - 1} )); printf '%s' "\${answers[$i]}"; fi\n`)
    await chmod(join(dir, 'door'), 0o755)
    // The install's lock is root's on a server (flock, which a Mac has none of): a test holds no other install off.
    const body = script.replaceAll(DOOR, join(dir, 'door')).replace(/^exec 9>.*$/m, '').replace(/^flock -n 9 .*$/m, '').replaceAll('seq 45', 'seq 3').replaceAll('sleep 2', 'sleep 0')
    const ran = await new Promise<{ code: number; said: string }>(resolve => {
      const child = execFile('bash', ['-s'], { env: { ...process.env, PATH: `${dir}:${dirname(process.execPath)}:/usr/bin:/bin` } }, (error, _out, stderr) => resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, said: stderr.trim() }))
      child.stdin!.end(body.replace(/^export PATH=.*$/m, ''))
    })
    return { ...ran, asked: (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean) }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('a PC on Tailscale has Tailscale made ready and its door there where a server has its door on the internet, and opens nothing to the internet', async () => {
  assert.deepEqual(stepsFor('tailscale').map(step => step.id), [...TAILSCALE_STEP_IDS])
  assert.deepEqual(stepsFor('tailscale').slice(-2), [TAILSCALE_STEP, TAILSCALE_DOOR_STEP])
  for (const step of stepsFor('tailscale')) await run('bash', ['-n', '-c', step.script(FACTS)])
  const service = STEPS.find(step => step.id === 'service')!.script(FACTS)
  assert.doesNotMatch(service, /ufw/)
})

test('the Tailscale step says when Tailscale is missing or signed out, and lets the server\'s user serve the door', async () => {
  const missing = await withStandIns(TAILSCALE_STEP.script(FACTS))
  assert.equal(missing.code, 1)
  assert.match(missing.said, /^Tailscale is not installed on this computer\./)
  const signedOut = await withStandIns(TAILSCALE_STEP.script(FACTS), { tailscale: '{"BackendState": "NeedsLogin"}' })
  assert.equal(signedOut.code, 1)
  assert.match(signedOut.said, /^Tailscale is not signed in on this computer\./)
  const ready = await withStandIns(TAILSCALE_STEP.script(FACTS), { tailscale: '{"BackendState": "Running", "Self": {}}' })
  assert.equal(ready.code, 0, ready.said)
  assert.deepEqual(ready.asked, ['tailscale status --json', 'tailscale set --operator=openagent'])
})

test('the door step puts the door behind Tailscale at the PC\'s name, is done when it is, and says what is in the way with where Serve is turned on', async () => {
  const open = `{"on":false,"listening":true,"tailscale":{"address":"${PC.address}"},"devices":[]}`
  const done = await withStandIns(TAILSCALE_DOOR_STEP.script(FACTS), { status: [open] })
  assert.deepEqual([done.code, done.asked], [0, ['door status']])

  const opened = await withStandIns(TAILSCALE_DOOR_STEP.script(FACTS), { status: ['{"on":false,"listening":false}', '{"on":false,"listening":false}', open] })
  assert.equal(opened.code, 0, opened.said)
  assert.deepEqual(opened.asked, ['door status', 'door tailscale on', 'door status', 'door status'])

  // Open at another name is not open at this one.
  const elsewhere = await withStandIns(TAILSCALE_DOOR_STEP.script(FACTS), { status: [open.replace(PC.address, 'other.tail1234.ts.net')] })
  assert.equal(elsewhere.code, 1)

  const off = `{"on":false,"listening":false,"problem":"Serve is off on your Tailscale network.","tailscale":{"address":"${PC.address}"},"fixAt":"https://login.tailscale.com/f/serve?node=n1"}`
  const blocked = await withStandIns(TAILSCALE_DOOR_STEP.script(FACTS), { status: [off] })
  assert.equal(blocked.code, 1)
  assert.equal(blocked.said, 'Serve is off on your Tailscale network. Turn Serve on once at https://login.tailscale.com/f/serve?node=n1, then try again.')
})

/** The command line as a test runs it. */
async function cli(env: NodeJS.ProcessEnv, args: string[], over: Partial<CliIO> = {}): Promise<{ code: number; out: unknown; err: string[] }> {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli(args, { env, stdout: line => out.push(line), stderr: line => err.push(line), startWork: () => process.pid, ...over })
  return { code, out: out.length ? (JSON.parse(out.join('\n')) as unknown) : undefined, err }
}

test('connect --tailscale saves a PC on Tailscale by its name there; an update keeps it so; no line is kept to it; a name that is none on Tailscale is refused', async () => {
  const home = await testHome()
  try {
    const refused = await cli(home.env, ['connect', '192.168.1.20', PC.user, '1.2.3', '--tailscale'])
    assert.deepEqual([refused.code, refused.err], [1, ['192.168.1.20 is not a name on Tailscale: connect it by its name there, like name.tail1234.ts.net']])

    const connected = await cli(home.env, ['connect', PC.address, PC.user, '1.2.3', '--tailscale'])
    assert.equal(connected.code, 0, connected.err.join('\n'))
    const [row] = (connected.out as Status).servers
    assert.equal(row!.tailscale, true)
    assert.equal(row!.url, `https://${PC.address}`)
    assert.deepEqual(row!.steps.map(step => [step.id, step.label]).slice(-2), [
      ['tailscale', 'Tailscale'],
      ['door', 'The door, on your Tailscale network'],
    ])

    await update(home.env, store => void delete store.servers[0]!.worker)
    await cli(home.env, ['connect', PC.address, PC.user, '1.2.3'])
    const updated = (await readStore(home.env)).servers[0]!
    assert.equal(updated.tailscale, true)
    assert.deepEqual(updated.steps.map(step => step.id), [...TAILSCALE_STEP_IDS])

    await update(home.env, store => void delete store.servers[0]!.worker)
    assert.deepEqual((await cli(home.env, ['reach', PC.address, 'full'])).err, [`${PC.address} is on your Tailscale network: this computer keeps no line to it`])
  } finally {
    await home.remove()
  }
})

test('the file keeps a server on Tailscale only by a name there, and never one reached through a server', () => {
  const server = { address: PC.address, user: 'rom', steps: [], adding: false, tailscale: true }
  assert.equal(sanitize({ servers: [server] }).servers[0]!.tailscale, true)
  assert.deepEqual(sanitize({ servers: [server] }).servers[0]!.steps.map(step => step.id), [...TAILSCALE_STEP_IDS])
  assert.equal(sanitize({ servers: [{ ...server, address: '203.0.113.5' }] }).servers[0]!.tailscale, undefined)
  assert.equal(sanitize({ servers: [{ ...server, through: 'https://165.245.244.10' }] }).servers[0]!.tailscale, undefined)
})

test('the install of a PC on Tailscale runs every step as the person\'s own user there, opens nothing to the internet, and makes Tailscale ready before the door', async () => {
  const home = await testHome()
  try {
    await update(home.env, store => void store.servers.push({ ...PC, tailscale: true, steps: freshSteps('tailscale'), adding: true }))
    const { exec, calls } = pretendServer()
    await install({ env: home.env, address: PC.address, version: '1.2.3', exec, ask: async () => undefined })
    const [server] = (await readStore(home.env)).servers
    assert.deepEqual(server!.steps.map(step => `${step.id}:${step.state}`), TAILSCALE_STEP_IDS.map(id => `${id}:done`))
    const scripts = calls.map(call => call.script)
    assert.ok(!scripts.some(script => script.includes('ufw allow')), 'nothing is opened to the internet')
    assert.ok(scripts.some(script => script.includes('tailscale set --operator=openagent')))
    assert.match(calls.find(call => call.script.includes('DESKTOP='))!.script, /^DESKTOP='rom'$/m)
  } finally {
    await home.remove()
  }
})
