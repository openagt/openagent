import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { servedAt, serveDoor, stopServing, tailscaleName, tailscaleRun } from './tailscale.js'
import { fakeTailscale } from './test-home.js'

test("this computer's name on the person's Tailscale network, or why there is none, in words the person acts on", async () => {
  assert.deepEqual(await tailscaleName(fakeTailscale('Laptop.tail1234.ts.net').run), { ok: true, value: 'laptop.tail1234.ts.net' })
  const signedOut = await tailscaleName(fakeTailscale('laptop.tail1234.ts.net', { state: 'NeedsLogin' }).run)
  assert.deepEqual(signedOut, { ok: false, problem: 'Tailscale is not signed in on this computer. Sign in to Tailscale, then turn this on again.' })
  const noName = await tailscaleName(async () => ({ code: 0, out: JSON.stringify({ BackendState: 'Running', Self: { DNSName: '' } }) }))
  assert.equal(noName.ok, false)
  assert.match((noName as { problem: string }).problem, /MagicDNS/)
  // Tailscale not running at all answers no JSON.
  assert.equal((await tailscaleName(async () => ({ code: 1, out: 'failed to connect to local tailscaled' }))).ok, false)
})

test('a computer with no tailscale command is told to install it; OPENAGENT_TAILSCALE names the command', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'devices-tailscale-'))
  try {
    const missing = await tailscaleName(tailscaleRun({ ...process.env, OPENAGENT_TAILSCALE: join(dir, 'none') }))
    assert.deepEqual(missing, { ok: false, problem: 'Tailscale is not installed on this computer. Install it from tailscale.com and sign in, then turn this on again.' })
    const named = join(dir, 'tailscale')
    await writeFile(named, `#!/bin/sh\necho '{"BackendState":"Running","Self":{"DNSName":"box.tail9.ts.net."}}'\n`)
    await chmod(named, 0o755)
    assert.deepEqual(await tailscaleName(tailscaleRun({ ...process.env, OPENAGENT_TAILSCALE: named })), { ok: true, value: 'box.tail9.ts.net' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Serve is asked to serve the door, said off with the page that turns it on, and let go of', async () => {
  const tailscale = fakeTailscale('laptop.tail1234.ts.net', { serveOff: true })
  assert.deepEqual(await servedAt(tailscale.run, 'laptop.tail1234.ts.net'), { ok: true, value: undefined })
  assert.deepEqual(await serveDoor(tailscale.run, 4201), {
    ok: false,
    problem: 'Serve is off on your Tailscale network. Turn it on once in your Tailscale account; the door opens by itself then.',
    enable: 'https://login.tailscale.com/f/serve?node=n1234CNTRL',
  })
  tailscale.enable()
  assert.deepEqual(await serveDoor(tailscale.run, 4201), { ok: true, value: undefined })
  assert.deepEqual(tailscale.calls.at(-1), ['serve', '--bg', '--https=443', 'http://127.0.0.1:4201'])
  assert.deepEqual(await servedAt(tailscale.run, 'laptop.tail1234.ts.net'), { ok: true, value: 'http://127.0.0.1:4201' })
  assert.deepEqual(await stopServing(tailscale.run), { ok: true, value: undefined })
  assert.deepEqual(tailscale.calls.at(-1), ['serve', '--https=443', 'off'])
  assert.equal(tailscale.served(), undefined)
})

test('what the person serves on that port themselves is told apart from the door', async () => {
  const tailscale = fakeTailscale()
  tailscale.serveOther('http://127.0.0.1:3000')
  assert.deepEqual(await servedAt(tailscale.run, 'laptop.tail1234.ts.net'), { ok: true, value: 'http://127.0.0.1:3000' })
  // More than one path served there is the person's, whatever is at /.
  const paths = async () => ({ code: 0, out: JSON.stringify({ Web: { 'laptop.tail1234.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:4201' }, '/docs': { Path: '/srv' } } } } }) })
  assert.deepEqual(await servedAt(paths, 'laptop.tail1234.ts.net'), { ok: true, value: 'something else' })
})
