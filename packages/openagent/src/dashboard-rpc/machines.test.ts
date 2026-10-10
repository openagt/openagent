import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onMachines, onMachinesReachable, sendAddMachine, sendRemoveMachine } from './machines.js'
import { REGISTRY_FILE } from '../registry.js'

// These run against the real registry, pointed at a temp $XDG_CONFIG_HOME so the person's own
// home file is never read or written.
async function withHome(run: (file: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'oa-machines-'))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = dir
  try {
    await run(join(dir, REGISTRY_FILE))
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
}

// A throwaway daemon that answers /_relay/ping with a fixed status, and records the cookie it was sent.
async function machine(status: number): Promise<{ url: string; cookies: string[]; close: () => Promise<void> }> {
  const cookies: string[] = []
  const srv: Server = createServer((req, res) => {
    cookies.push(req.headers.cookie ?? '')
    res.writeHead(status)
    res.end()
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()))
  const port = (srv.address() as AddressInfo).port
  return { url: `http://127.0.0.1:${port}`, cookies, close: () => new Promise<void>(r => srv.close(() => r())) }
}

test('a pasted address is saved in the home file, and the browser is answered without its key', async () => {
  await withHome(async file => {
    const added = await sendAddMachine('http://192.168.1.5:4200/?token=sekret', ' Studio ')
    assert.deepEqual(added, { ok: true, machine: { id: 'http://192.168.1.5:4200', label: 'Studio', url: 'http://192.168.1.5:4200' } })
    const listed = await onMachines()
    assert.deepEqual(listed, [{ id: 'http://192.168.1.5:4200', label: 'Studio', url: 'http://192.168.1.5:4200' }])
    assert.equal(JSON.stringify([added, listed]).includes('sekret'), false)
    // The key is where the daemon reads it: the person's own file.
    assert.equal(JSON.parse(await readFile(file, 'utf8')).machines[0].token, 'sekret')
  })
})

test('a paste that is no address, or carries no key, is refused and nothing is saved', async () => {
  await withHome(async () => {
    assert.deepEqual(await sendAddMachine('not a url'), { ok: false, error: 'That is not a web address.' })
    const noKey = await sendAddMachine('http://192.168.1.5:4200/')
    assert.equal(noKey.ok, false)
    assert.deepEqual(await sendAddMachine(42 as never), { ok: false, error: 'That is not a web address.' })
    assert.deepEqual(await onMachines(), [])
  })
})

test('a removed machine is off the list', async () => {
  await withHome(async () => {
    await sendAddMachine('http://192.168.1.5:4200/?token=a')
    await sendAddMachine('http://10.0.0.2:4200/?token=b')
    await sendRemoveMachine('http://192.168.1.5:4200')
    assert.deepEqual((await onMachines()).map(saved => saved.id), ['http://10.0.0.2:4200'])
  })
})

test('each saved machine is asked with its own key, and the answer says which ones are there (#1072)', async () => {
  await withHome(async () => {
    const up = await machine(200)
    const refused = await machine(401)
    try {
      await sendAddMachine(`${up.url}/?token=up-key`)
      await sendAddMachine(`${refused.url}/?token=old-key`)
      await sendAddMachine('http://127.0.0.1:1/?token=x') // nothing listening
      assert.deepEqual(await onMachinesReachable(), { [up.url]: true, [refused.url]: false, 'http://127.0.0.1:1': false })
      assert.deepEqual(up.cookies, ['oa_daemon=up-key'])
      assert.deepEqual(refused.cookies, ['oa_daemon=old-key'])
    } finally {
      await up.close()
      await refused.close()
    }
  })
})

test('with no saved machine nothing is asked', async () => {
  await withHome(async () => {
    assert.deepEqual(await onMachinesReachable(), {})
  })
})
