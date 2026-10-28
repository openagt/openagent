import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { computersWiring, isServer, lacking, ownComputersOf, reachedAtAddress, removedSince, syncComputers, type OwnComputers, type OwnDoor } from './computers-sync.js'
import type { ForgottenMachine, MachineRecord } from '../registry.js'

const saved = (url: string, over: Partial<MachineRecord> = {}): MachineRecord => ({ id: url, url, label: new URL(url).host, key: `key-${url}`, door: `${url}/_devices/enter`, ...over })

test('a computer reached at its address is a server or one on Tailscale; one through a server, on a Wi-Fi or on a line here is not', () => {
  assert.equal(reachedAtAddress({ url: 'https://203.0.113.7' }), true)
  assert.equal(reachedAtAddress({ url: 'https://studio.tail1234.ts.net' }), true)
  assert.equal(reachedAtAddress({ url: 'https://203.0.113.7/_devices/via/abc123' }), false)
  assert.equal(reachedAtAddress({ url: 'http://studio.local:4201' }), false)
  assert.equal(reachedAtAddress({ url: 'http://127.0.0.1:4210' }), false)
  assert.equal(isServer({ url: 'https://203.0.113.7' }), true)
  assert.equal(isServer({ url: 'https://studio.tail1234.ts.net' }), false)
})

test('what a computer says of its computers keeps only addresses another computer reaches, and times that read as times', () => {
  const read = ownComputersOf({
    door: 'https://laptop.tail1234.ts.net',
    computers: [
      { url: 'https://203.0.113.7', label: ' Box ', host: 'box', added: '2026-10-20T10:00:00.000Z' },
      { url: 'http://studio.local:4201', label: 'on a Wi-Fi' },
      { url: 'https://203.0.113.7/_devices/via/abc', label: 'through a server' },
      { url: 'https://box.example/somewhere', label: 'an address with a path' },
      { url: 'https://studio.tail1234.ts.net', added: 'not a time' },
      'not a computer',
    ],
    forgotten: [{ url: 'https://old.example', at: '2026-10-21T10:00:00.000Z' }, { url: 'javascript:x', at: '2026-10-21T10:00:00.000Z' }, { url: 'https://x.example', at: 'never' }],
  })
  assert.deepEqual(read, {
    door: 'https://laptop.tail1234.ts.net',
    computers: [
      { url: 'https://203.0.113.7', label: 'Box', host: 'box', added: '2026-10-20T10:00:00.000Z' },
      { url: 'https://studio.tail1234.ts.net', label: 'studio.tail1234.ts.net' },
    ],
    forgotten: [{ url: 'https://old.example', at: '2026-10-21T10:00:00.000Z' }],
  })
  assert.deepEqual(ownComputersOf('nonsense'), { computers: [], forgotten: [] })
  assert.equal(ownComputersOf({ door: 'http://studio.local:4201' }).door, undefined)
})

test('a removal stands over a computer saved before it, and over one with no time of its own; not over one saved after', () => {
  assert.equal(removedSince('2026-10-20T10:00:00.000Z', '2026-10-21T10:00:00.000Z'), true)
  assert.equal(removedSince(undefined, '2026-10-21T10:00:00.000Z'), true)
  assert.equal(removedSince('2026-10-22T10:00:00.000Z', '2026-10-21T10:00:00.000Z'), false)
})

test('a computer is handed what it lacks of what this one reaches at an address, this computer too when it has a door there; not itself, not what it has by address or by name, not what it removed since', () => {
  const box = saved('https://203.0.113.7', { host: 'box', added: '2026-10-20T10:00:00.000Z' })
  const studio = saved('https://studio.tail1234.ts.net', { host: 'studio' })
  const office = saved('https://office.tail1234.ts.net', { host: 'office', added: '2026-10-25T10:00:00.000Z' })
  const old = saved('https://old.tail1234.ts.net', { added: '2026-10-01T10:00:00.000Z' })
  const theirs: OwnComputers = {
    door: 'https://studio.tail1234.ts.net',
    // It has the box by another address, under the same name.
    computers: [{ url: 'https://box.example', label: 'Box', host: 'box' }],
    forgotten: [
      { url: old.url, at: '2026-10-10T10:00:00.000Z' },
      // Removed there before this computer saved it anew: handed again.
      { url: office.url, at: '2026-10-21T10:00:00.000Z' },
    ],
  }
  const handed = lacking(studio, theirs, [box, studio, office, old], 'https://laptop.tail1234.ts.net')
  assert.deepEqual(
    handed.map(one => (one.self ? `self ${one.url}` : one.machine.url)),
    [office.url, 'self https://laptop.tail1234.ts.net'],
  )
  // A computer that has this one, or removed it, is not handed it; with no door, this computer is never handed.
  assert.deepEqual(lacking(studio, { ...theirs, computers: [...theirs.computers, { url: 'https://laptop.tail1234.ts.net', label: 'Laptop' }] }, [], 'https://laptop.tail1234.ts.net'), [])
  assert.deepEqual(lacking(studio, { ...theirs, forgotten: [{ url: 'https://laptop.tail1234.ts.net', at: '2026-10-01T10:00:00.000Z' }] }, [], 'https://laptop.tail1234.ts.net'), [])
  assert.deepEqual(lacking(studio, theirs, [], undefined), [])
})

/** The wiring of one round, as a test has it: what each machine answers, and what was asked of whom. */
function wired(over: { machines: MachineRecord[]; forgotten?: ForgottenMachine[]; door?: OwnDoor; said?: Record<string, OwnComputers | 'offline'>; lines?: Record<string, { id: string; name: string; added: boolean; owner?: string }[]>; takes?: (link: string) => boolean }) {
  const asked: { to: string; fn: string; args: unknown[] }[] = []
  const codes: string[] = []
  const forgot: ForgottenMachine[][] = []
  const through: string[] = []
  let clock = Date.parse('2026-10-28T03:00:00.000Z')
  Object.assign(computersWiring, {
    machines: async () => over.machines,
    forgotten: async () => over.forgotten ?? [],
    door: async () => over.door ?? { lines: [] },
    call: async (machine: MachineRecord, fn: string, args: unknown[]) => {
      asked.push({ to: machine.url, fn, args })
      const said = over.said?.[machine.url]
      if (said === 'offline' || said === undefined) return { ok: false, error: 'it does not answer' }
      if (fn === 'onOwnComputers') return { ok: true, ret: said }
      if (fn === 'sendAddComputer') return { ok: true, ret: (over.takes ?? (() => true))(args[0] as string) ? { ok: true } : { ok: false, error: 'it could not get in' } }
      return { ok: true, ret: { ok: true } }
    },
    ownCode: async () => (codes.push('self'), 'https://laptop.tail1234.ts.net/_devices/enter#SELFCODE'),
    codeAt: async (machine: MachineRecord) => (codes.push(machine.url), `${machine.url}/_devices/enter#CODE`),
    name: async () => 'Laptop',
    forget: async (gone: readonly ForgottenMachine[]) => void forgot.push([...gone]),
    lineComputers: async (server: MachineRecord) => over.lines?.[server.url],
    saveThrough: async (server: MachineRecord, id: string) => void through.push(`${server.url} ${id}`),
    now: () => clock,
  })
  return { asked, codes, forgot, through, later: (ms: number) => void (clock += ms) }
}

test('a round hands each computer reached at an address what it lacks, by a code from the door it is for, with the name and the time it was saved here', async () => {
  const box = saved('https://203.0.113.7', { label: 'Box', added: '2026-10-20T10:00:00.000Z' })
  const studio = saved('https://studio.tail1234.ts.net', { label: 'Studio' })
  const theirs = (has: string[]): OwnComputers => ({ computers: has.map(url => ({ url, label: url })), forgotten: [] })
  const w = wired({
    machines: [box, studio, saved('https://rom.example', { owner: 'rom' }), saved('http://studio.local:4201')],
    door: { address: 'https://laptop.tail1234.ts.net', lines: [] },
    said: { [box.url]: theirs([]), [studio.url]: theirs([box.url, 'https://laptop.tail1234.ts.net']) },
  })
  await syncComputers()
  const handed = w.asked.filter(call => call.fn === 'sendAddComputer').map(call => [call.to, ...call.args])
  assert.deepEqual(handed, [
    [box.url, `${studio.url}/_devices/enter#CODE`, 'Studio', null],
    [box.url, 'https://laptop.tail1234.ts.net/_devices/enter#SELFCODE', 'Laptop', null],
  ])
  // Another person's computer, and one on a Wi-Fi, are never asked or handed.
  assert.equal(w.asked.some(call => call.to === 'https://rom.example' || call.to === 'http://studio.local:4201'), false)
  assert.deepEqual(w.codes, [studio.url, 'self'])
})

test('a computer that could not take one is not handed it again for an hour: each try makes a code at a door', async () => {
  const box = saved('https://203.0.113.70')
  const studio = saved('https://studio2.tail1234.ts.net')
  const w = wired({ machines: [box, studio], said: { [box.url]: { computers: [], forgotten: [] }, [studio.url]: 'offline' }, takes: () => false })
  await syncComputers()
  await syncComputers()
  assert.deepEqual(w.codes, [studio.url])
  w.later(61 * 60_000)
  await syncComputers()
  assert.deepEqual(w.codes, [studio.url, studio.url])
})

test('what another computer removed is taken out here, and what was removed here after it saved it, it takes out', async () => {
  const box = saved('https://203.0.113.71')
  const removedThere = { url: 'https://gone.tail1234.ts.net', at: '2026-10-27T10:00:00.000Z' }
  const removedHere = { url: 'https://old.tail1234.ts.net', at: '2026-10-27T11:00:00.000Z' }
  const w = wired({
    machines: [box],
    forgotten: [removedHere, { url: 'https://never-there.example', at: '2026-10-27T11:00:00.000Z' }],
    said: { [box.url]: { computers: [{ url: removedHere.url, label: 'Old', added: '2026-10-01T10:00:00.000Z' }, { url: 'https://kept.tail1234.ts.net', label: 'Kept' }], forgotten: [removedThere] } },
  })
  await syncComputers()
  assert.deepEqual(w.forgot, [[removedThere]])
  assert.deepEqual(
    w.asked.filter(call => call.fn === 'sendForgetComputers').map(call => call.args),
    [[[removedHere]]],
  )
})

test('each server of the person\'s: their own computers on a line there are saved here through it; not another person\'s, not this computer, not one already saved or removed', async () => {
  const box = saved('https://203.0.113.72')
  const w = wired({
    machines: [box, saved('https://studio3.tail1234.ts.net')],
    door: { lines: [{ url: box.url, id: 'mine00' }] },
    forgotten: [{ url: `${box.url}/_devices/via/gone00`, at: '2026-10-27T10:00:00.000Z' }],
    lines: {
      [box.url]: [
        { id: 'home00', name: 'Home PC', added: false },
        { id: 'roms00', name: "Rom's PC", added: false, owner: 'rom' },
        { id: 'mine00', name: 'Laptop', added: false },
        { id: 'kept00', name: 'Kept', added: true },
        { id: 'gone00', name: 'Gone', added: false },
      ],
      // A computer on Tailscale keeps no lines: it is not asked.
      'https://studio3.tail1234.ts.net': [{ id: 'nope00', name: 'Nope', added: false }],
    },
  })
  await syncComputers()
  assert.deepEqual(w.through, [`${box.url} home00`])
})
