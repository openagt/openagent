import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onMachinePerson, sendMachineLineLink, sendRemoveMachineDevice } from './machines.js'
import { runComputerCommandOn } from './modules.js'
import { addMachine } from '../registry.js'

// A computer several people use, as this computer meets it through its door: the door says who
// this computer's person is there, takes one of their devices out, gives a link for a line, and
// passes a page's call on to the OpenAgent of that person. Run against the real registry, in a
// temp $XDG_CONFIG_HOME.

async function withHome(run: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'oa-machine-person-'))
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
const ME = { account: 'rom', owner: false, devices: [{ id: 'd1abcd', name: 'OpenAgent on Roms-Mac', added: '2026-10-19T00:00:00.000Z' }] }

interface Asked {
  method: string
  url: string
  authorization?: string
  body: string
}

/** The door of a computer several people use, as far as this computer meets it; `old` is one from before persons. */
async function door(opts: { old?: boolean } = {}): Promise<{ url: string; asked: Asked[]; close: () => Promise<void> }> {
  const asked: Asked[] = []
  const srv: Server = createServer((req: IncomingMessage, res) => {
    let body = ''
    req.on('data', chunk => (body += chunk))
    req.on('end', () => {
      asked.push({ method: req.method ?? '', url: req.url ?? '', ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}), body })
      const json = (value: unknown): void => void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value))
      if (req.headers.authorization !== `Bearer ${KEY}`) return void res.writeHead(401).end()
      if (opts.old && req.url?.startsWith('/_remote-access/')) return void res.writeHead(404).end('not found')
      if (req.url === '/_remote-access/me' && req.method === 'GET') return json(ME)
      if (req.url === '/_remote-access/me/remove' && req.method === 'POST') {
        const { id } = JSON.parse(body) as { id: string }
        return id === 'd1abcd' ? json({ ...ME, devices: [] }) : void res.writeHead(404).end('That device is not yours.')
      }
      if (req.url === '/_remote-access/me/line' && req.method === 'POST') return json({ url: 'https://203.0.113.9/_remote-access/enter#c0de.pin', expires: '2026-10-19T00:05:00.000Z' })
      if (req.url === '/_rpc/runComputerCommand' && req.method === 'POST') {
        const [pkg, args, command, input] = JSON.parse(body) as unknown[]
        return json({ ret: { ok: true, output: { pkg, args, command, input } } })
      }
      res.writeHead(404).end()
    })
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()))
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`
  return { url, asked, close: () => new Promise<void>(r => srv.close(() => r())) }
}

test('a saved machine\'s door is asked who this computer\'s person is there, with this computer\'s key, and what it said is answered as it said it', async () => {
  await withHome(async () => {
    const server = await door()
    try {
      await addMachine({ url: server.url, key: KEY, door: `${server.url}/_remote-access/enter` })
      assert.deepEqual(await onMachinePerson(server.url), { ok: true, said: ME })
      assert.deepEqual(server.asked.at(-1), { method: 'GET', url: '/_remote-access/me', authorization: `Bearer ${KEY}`, body: '' })
      // One of the person's devices out, and the door's refusal of another's, in its own words.
      assert.deepEqual(await sendRemoveMachineDevice(server.url, 'd1abcd'), { ok: true, said: { ...ME, devices: [] } })
      assert.deepEqual(server.asked.at(-1)?.body, JSON.stringify({ id: 'd1abcd' }))
      assert.deepEqual(await sendRemoveMachineDevice(server.url, 'd2abcd'), { ok: false, error: 'That device is not yours.' })
      // A word that is no device id is not sent anywhere.
      const before = server.asked.length
      assert.deepEqual(await sendRemoveMachineDevice(server.url, '../enter'), { ok: false, error: 'That is no device id.' })
      assert.equal(server.asked.length, before)
      // A line's link, for this person.
      assert.deepEqual(await sendMachineLineLink(server.url), { ok: true, url: 'https://203.0.113.9/_remote-access/enter#c0de.pin' })
      assert.equal(server.asked.at(-1)?.url, '/_remote-access/me/line')
      assert.deepEqual(await onMachinePerson('http://10.9.9.9:4201'), { ok: false, error: 'That machine is no longer saved.' })
    } finally {
      await server.close()
    }
  })
})

test('a machine from before persons does not say, and one whose key is out says so', async () => {
  await withHome(async () => {
    const old = await door({ old: true })
    try {
      await addMachine({ url: old.url, key: KEY, door: `${old.url}/_remote-access/enter` })
      assert.deepEqual(await onMachinePerson(old.url), { ok: false, error: 'the machine does not say who this computer is there', unknown: true })
      await addMachine({ url: old.url, key: 'd9.other', door: `${old.url}/_remote-access/enter` })
      const out = await onMachinePerson(old.url)
      assert.equal(out.ok, false)
      assert.match((out as { error: string }).error, /no longer in on the machine/)
    } finally {
      await old.close()
    }
  })
})

test('a computer reached through a server says nothing of persons, and is not asked', async () => {
  await withHome(async () => {
    const server = await door()
    try {
      const through = `${server.url}/_remote-access/via/abc123def456`
      await addMachine({ url: through, key: KEY, door: `${through}/_remote-access/enter` })
      assert.deepEqual(await onMachinePerson(through), { ok: false, error: 'A computer reached through a server says nothing of persons.', unknown: true })
      assert.deepEqual(await runComputerCommandOn('@openagt/servers', through, ['own']), { ok: false, error: 'That machine is no longer saved.' })
      assert.equal(server.asked.length, 0)
    } finally {
      await server.close()
    }
  })
})

test('a computer package\'s command is run on a saved machine as its page runs it there, with what it reads on standard input in the body', async () => {
  await withHome(async () => {
    const server = await door()
    try {
      await addMachine({ url: server.url, key: KEY, door: `${server.url}/_remote-access/enter` })
      assert.deepEqual(await runComputerCommandOn('@openagt/servers', server.url, ['own', 'login', 'github'], null, 'gho_secret'), {
        ok: true,
        output: { pkg: '@openagt/servers', args: ['own', 'login', 'github'], command: null, input: 'gho_secret' },
      })
      const call = server.asked.at(-1)!
      assert.equal(call.url, '/_rpc/runComputerCommand')
      assert.equal(call.authorization, `Bearer ${KEY}`)
      // In the body only, never in the address.
      assert.equal(call.url.includes('gho_secret'), false)
      // Only a package that is this computer's, and only words.
      assert.deepEqual(await runComputerCommandOn('@openagt/files', server.url, ['x']), { ok: false, error: "@openagt/files is not this computer's" })
      assert.deepEqual(await runComputerCommandOn('@openagt/servers', server.url, [1] as unknown as string[]), { ok: false, error: 'arguments must be a list of words' })
      assert.deepEqual(await runComputerCommandOn('@openagt/servers', 'http://10.9.9.9:4201', ['own']), { ok: false, error: 'That machine is no longer saved.' })
    } finally {
      await server.close()
    }
  })
})
