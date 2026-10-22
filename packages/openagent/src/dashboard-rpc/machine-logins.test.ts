import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onComputersThrough, onMachineLogins, onMachines, sendAddComputerThrough, sendMachineLogins, sendMachineTold } from './machines.js'
import { addMachine } from '../registry.js'

// Another person's computer shared with everyone on a server (#2140), as this computer meets it:
// the server lists it with whose it is, it is saved with that, the person is told once that their
// logins are copied there, and the logins there are read and made through the server. Run against
// the real registry, in a temp $XDG_CONFIG_HOME.

async function withHome(run: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'oa-machine-logins-'))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = dir
  try {
    await run()
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
}

const KEY = 'd1.key'
const BOX = 'b0x1d2'

/** A server's door: it lists one computer of another person's, and passes calls about the logins down its line. */
async function server(): Promise<{ url: string; posted: unknown[]; close: () => Promise<void> }> {
  const posted: unknown[] = []
  const srv: Server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => (body += chunk))
    req.on('end', () => {
      const json = (value: unknown): void => void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value))
      if (req.headers.authorization !== `Bearer ${KEY}`) return void res.writeHead(401).end()
      if (req.url === '/_devices/computers') return json({ computers: [{ id: BOX, name: 'rom-desktop', online: true, owner: 'rom' }, { id: 'h0me12', name: 'my-box', online: false, owner: '-no account' }] })
      if (req.url === `/_devices/via/${BOX}/_relay/logins` && req.method === 'GET') return json({ github: { source: 'copied', from: 'vps-1', account: 'sul' } })
      if (req.url === `/_devices/via/${BOX}/_relay/logins` && req.method === 'POST') {
        posted.push(JSON.parse(body))
        return json({ github: { source: 'made', account: 'sul' } })
      }
      res.writeHead(404).end('not found')
    })
  })
  await new Promise<void>(resolve => srv.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, posted, close: () => new Promise(resolve => srv.close(() => resolve())) }
}

test('a computer of another person\'s is listed and saved with whose it is; the person is told once', async () => {
  await withHome(async () => {
    const vps = await server()
    try {
      await addMachine({ url: vps.url, key: KEY, door: `${vps.url}/_devices/enter`, label: 'vps' })
      const listed = await onComputersThrough(vps.url)
      assert.deepEqual(listed, { ok: true, computers: [{ id: BOX, name: 'rom-desktop', online: true, owner: 'rom', added: false }, { id: 'h0me12', name: 'my-box', online: false, added: false }] })
      const added = await sendAddComputerThrough(vps.url, BOX)
      assert.equal(added.ok && added.machine.owner, 'rom')
      const id = `${vps.url}/_devices/via/${BOX}`
      assert.equal((await onMachines()).find(machine => machine.id === id)?.told, undefined)
      assert.deepEqual(await sendMachineTold(id), { ok: true })
      assert.equal((await onMachines()).find(machine => machine.id === id)?.told, true)
    } finally {
      await vps.close()
    }
  })
})

test('the logins on another person\'s computer are read through the server, and one made here is handed over as no copy; a machine of no one else\'s has none to ask', async () => {
  await withHome(async () => {
    const vps = await server()
    try {
      await addMachine({ url: vps.url, key: KEY, door: `${vps.url}/_devices/enter`, label: 'vps' })
      await sendAddComputerThrough(vps.url, BOX)
      const id = `${vps.url}/_devices/via/${BOX}`
      assert.deepEqual(await onMachineLogins(id), { ok: true, logins: { github: { source: 'copied', from: 'vps-1', account: 'sul' } } })
      assert.deepEqual(await sendMachineLogins(id, { github: 'gho_mine123' }), { ok: true, logins: { github: { source: 'made', account: 'sul' } } })
      // No `from`: the login is the person's own, made for there.
      assert.deepEqual(vps.posted, [{ github: 'gho_mine123' }])
      assert.deepEqual(await sendMachineLogins(id, { github: 'two words' }), { ok: false, error: 'That is no login.' })
      assert.deepEqual(await sendMachineLogins(id, {}), { ok: false, error: 'That is no login.' })
      assert.equal(vps.posted.length, 1)
      assert.deepEqual(await onMachineLogins(vps.url), { ok: false, error: "That machine is no other person's computer." })
    } finally {
      await vps.close()
    }
  })
})
