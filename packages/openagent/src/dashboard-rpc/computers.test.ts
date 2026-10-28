import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onOwnComputers, sendAddComputer, sendForgetComputers } from './computers.js'
import { sendAddMachine, sendRemoveMachine } from './machines.js'
import { computersWiring, type OwnDoor } from '../dashboard/computers-sync.js'
import { setDashboardContext } from './context.js'
import { NO_ELSEWHERE, testDashboardContext } from './test-context.js'
import { addMachine, listForgotten, listMachines } from '../registry.js'

// Against the real registry, pointed at a temp $XDG_CONFIG_HOME, with this computer's door said
// by the test: what the person's computers ask each other to keep the same computers.
async function withHome(run: () => Promise<void>, door: OwnDoor = { lines: [] }): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'oa-computers-'))
  const previous = process.env.XDG_CONFIG_HOME
  const ownDoor = computersWiring.door
  process.env.XDG_CONFIG_HOME = dir
  computersWiring.door = async () => door
  try {
    await run()
  } finally {
    computersWiring.door = ownDoor
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
}

/** A machine's door that lets in once with each of its codes, and is left again: as far as saving it goes. */
async function door(codes: string[]): Promise<{ url: string; link: (code: string) => string; close: () => Promise<void> }> {
  const good = new Set(codes)
  const srv: Server = createServer((req, res) => {
    if (req.method === 'DELETE') return void res.writeHead(200).end()
    let raw = ''
    req.on('data', chunk => (raw += chunk))
    req.on('end', () => {
      const said = JSON.parse(raw || '{}') as { code?: string }
      if (said.code === undefined || !good.delete(said.code)) return void res.writeHead(403).end('this code no longer works')
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, key: `d1.key-${said.code}` }))
    })
  })
  await new Promise<void>(resolve => srv.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`
  return { url, link: code => `${url}/_devices/enter#${code}`, close: () => new Promise<void>(resolve => srv.close(() => resolve())) }
}

/** Save a machine as a test has it, at an address another computer reaches too. */
const keep = (url: string, over: { owner?: string } = {}) => addMachine({ url, key: `key-${url}`, door: `${url}/_devices/enter`, ...over })

test("a computer says the person's computers it reaches at their addresses, with when each was saved, its own door, and what the person removed; never another person's", async () => {
  await withHome(
    async () => {
      await keep('https://box.example')
      await keep('https://studio.tail1234.ts.net')
      await keep('https://rom.example', { owner: 'rom' })
      await keep('http://studio.local:4201')
      await keep('https://box.example/_devices/via/home00')
      const said = await onOwnComputers()
      assert.equal(said.door, 'https://laptop.tail1234.ts.net')
      assert.deepEqual(
        said.computers.map(computer => computer.url),
        ['https://studio.tail1234.ts.net', 'https://box.example'],
      )
      assert.ok(said.computers.every(computer => !Number.isNaN(Date.parse(computer.added!))))
      assert.deepEqual(said.forgotten, [])
    },
    { address: 'https://laptop.tail1234.ts.net', lines: [] },
  )
})

test('a computer the person removes is remembered as removed, and saved again by the person it no longer is', async () => {
  await withHome(async () => {
    const studio = await door(['first', 'second'])
    try {
      assert.equal((await sendAddMachine(studio.link('first'), 'Studio')).ok, true)
      const before = Date.now()
      assert.deepEqual(await sendRemoveMachine(studio.url), { ok: true })
      const [removed] = await listForgotten()
      assert.equal(removed!.url, studio.url)
      assert.ok(Date.parse(removed!.at) >= before - 1000)
      // Saved again, by the person's own press.
      assert.equal((await sendAddMachine(studio.link('second'))).ok, true)
      assert.deepEqual(await listForgotten(), [])
    } finally {
      await studio.close()
    }
  })
})

test('a computer handed by another is not this one, not one the person removed here since the other saved it, and one saved already is kept as it is', async () => {
  await withHome(
    async () => {
      assert.deepEqual(await sendAddComputer('http://studio.local:4201/_devices/enter#CODE', 'Studio', null), { ok: false, error: 'That is no link of a computer reached at its address.' })
      assert.deepEqual(await sendAddComputer('not a link', 'Studio', null), { ok: false, error: 'That is no link of a computer reached at its address.' })
      assert.deepEqual(await sendAddComputer('https://laptop.tail1234.ts.net/_devices/enter#CODE', 'Laptop', null), { ok: false, error: 'That is this computer.' })

      await keep('https://box.example')
      await sendForgetComputers([{ url: 'https://old.tail1234.ts.net', at: '2026-10-21T10:00:00.000Z' }])
      // Saved there before the removal here, or with no time: removed. Saved there after it: taken.
      assert.deepEqual(await sendAddComputer('https://old.tail1234.ts.net/_devices/enter#CODE', 'Old', '2026-10-20T10:00:00.000Z'), { ok: false, error: 'The person removed that computer here.' })
      assert.deepEqual(await sendAddComputer('https://old.tail1234.ts.net/_devices/enter#CODE', 'Old', null), { ok: false, error: 'The person removed that computer here.' })
      const taken = await sendAddComputer('https://old.tail1234.ts.net/_devices/enter#CODE', 'Old', '2026-10-22T10:00:00.000Z')
      // Past the removal, it is asked of the computer's door: none answers at that name in a test.
      assert.equal(taken.ok, false)
      assert.notEqual((taken as { error: string }).error, 'The person removed that computer here.')

      const before = await listMachines()
      assert.deepEqual(await sendAddComputer('https://box.example/_devices/enter#CODE', 'Box', null), { ok: true })
      assert.deepEqual(await listMachines(), before)
    },
    { address: 'https://laptop.tail1234.ts.net', lines: [] },
  )
})

test('a removal another computer hands is taken out here when it came after the computer was saved here, with the ones saved through it; one saved since, or a run at work on, stays', async () => {
  await withHome(async () => {
    let working = ''
    setDashboardContext(testDashboardContext({ remote: { ...NO_ELSEWHERE, target: () => undefined, list: () => [], working: url => url === working, rekey: () => {}, sent: () => true, home: async () => undefined, follow: async () => {}, machineNames: async () => () => undefined, machineRuns: async () => [], followRuns: () => () => {} } }))
    try {
      await keep('https://127.0.0.1:9')
      await keep('https://127.0.0.1:9/_devices/via/home00')
      await keep('https://127.0.0.2:9')
      await keep('https://127.0.0.3:9')
      const savedAt = Date.parse((await listMachines()).find(machine => machine.url === 'https://127.0.0.2:9')!.added!)
      working = 'https://127.0.0.3:9'
      await sendForgetComputers([
        { url: 'https://127.0.0.1:9', at: new Date(savedAt + 60_000).toISOString() },
        { url: 'https://127.0.0.2:9', at: new Date(savedAt - 60_000).toISOString() },
        { url: 'https://127.0.0.3:9', at: new Date(savedAt + 60_000).toISOString() },
        { url: 'https://never.example', at: new Date(savedAt).toISOString() },
        { url: 'not an address', at: new Date(savedAt).toISOString() },
      ])
      assert.deepEqual(
        (await listMachines()).map(machine => machine.url).sort(),
        ['https://127.0.0.2:9', 'https://127.0.0.3:9'],
      )
      // What was taken out is remembered as removed, and one never saved here too: it is not brought here.
      assert.deepEqual(
        (await listForgotten()).map(gone => gone.url),
        ['https://127.0.0.1:9', 'https://never.example'],
      )
    } finally {
      setDashboardContext(testDashboardContext())
    }
  })
})
