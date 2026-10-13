import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { devicesIn, isDeviceId, readDevices, removeDevice } from './devices.js'
import { pretendServer } from './test-home.js'

const SERVER = { address: '203.0.113.5', user: 'root' }
const PHONE = { id: 'a1b2c3d4e5f6', name: 'iPhone, Safari', added: '2026-10-12T17:50:00.000Z', seen: '2026-10-13T19:24:00.000Z' }
const LAPTOP = { id: '0f9e8d7c6b5a', name: 'Studio', added: '2026-10-13T19:20:00.000Z', line: true }
/** What a door's `status` prints: more than its devices. */
const status = (devices: unknown): string => JSON.stringify({ on: false, listening: true, https: { address: SERVER.address }, devices, lines: [] }) + '\n'

test('the server\'s door is asked which devices are in, as the server\'s own user', async () => {
  const server = pretendServer(() => ({ out: status([PHONE, LAPTOP]) }))
  assert.deepEqual(await readDevices(SERVER, { exec: server.exec }), { ok: true, devices: [PHONE, LAPTOP] })
  assert.deepEqual(server.calls.map(call => call.remote), ["runuser -l openagent -c 'bash -s'"])
  assert.match(server.calls[0]!.script, /remote-access\/bin\/remote-access status\n/)

  assert.deepEqual(await readDevices(SERVER, { exec: pretendServer(() => ({ out: status([]) })).exec }), { ok: true, devices: [] })
  const NOT_DEVICES = { ok: false, error: 'The server answered something else than the devices that are in.' }
  for (const out of ['Welcome to Debian\n', '{}\n', JSON.stringify({ devices: 'none' }), 'null\n']) assert.deepEqual(await readDevices(SERVER, { exec: pretendServer(() => ({ out })).exec }), NOT_DEVICES, out)
  assert.deepEqual(await readDevices(SERVER, { exec: pretendServer(() => ({ code: 1, err: 'the door is not installed' })).exec }), { ok: false, error: 'the door is not installed' })
  // A server that says a great deal about a failure is told only by its end.
  const wordy = await readDevices(SERVER, { exec: pretendServer(() => ({ code: 1, err: `${'x'.repeat(50_000)} the end` })).exec })
  assert.ok(!wordy.ok && wordy.error.length <= 2_000 && wordy.error.endsWith('the end'))
})

test('what a server lists is read as data: only what a device is, as many as a door keeps, and a name as words', () => {
  const listed = devicesIn(
    status([
      PHONE,
      // No id a door makes, no time, a second device under an id already listed: none of them is a device.
      { ...PHONE, id: '$(reboot)' },
      { ...PHONE, id: 'b1b2c3d4e5f6', added: 'yesterday' },
      { ...PHONE, name: 'The same again' },
      'a device',
      null,
      // A name with what is no letter of a line, a name far too long, no name; a time that is none is left out.
      { id: 'c1b2c3d4e5f6', name: 'Mac\u001b[31m,\nChrome', added: PHONE.added, seen: 'never', line: 'yes' },
      { id: 'd1b2c3d4e5f6', name: 'x'.repeat(500), added: PHONE.added },
      { id: 'e1b2c3d4e5f6', added: PHONE.added, key: 'f'.repeat(64) },
      // Letters that turn a line around or break it, and a time written another way: the name is plain words, the time is written anew.
      { id: 'f1b2c3d4e5f6', name: 'evil\u202Egnp\u2028.exe', added: '2026-10-12T17:50:00Z', seen: '2026-10-13 (<img src=x>)' },
    ]),
  )!
  assert.deepEqual(listed.slice(0, 4), [
    PHONE,
    { id: 'c1b2c3d4e5f6', name: 'Mac [31m, Chrome', added: PHONE.added },
    { id: 'd1b2c3d4e5f6', name: 'x'.repeat(80), added: PHONE.added },
    { id: 'e1b2c3d4e5f6', name: 'A device', added: PHONE.added },
  ])
  assert.equal(listed[4]!.name, 'evil gnp .exe')
  assert.equal(listed[4]!.added, '2026-10-12T17:50:00.000Z')
  // Whatever a server wrote around a time, only the time is kept.
  for (const device of listed) for (const time of [device.added, device.seen]) if (time !== undefined) assert.match(time, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
  const many = Array.from({ length: 80 }, (_, index) => ({ ...PHONE, id: `device${String(index).padStart(3, '0')}` }))
  assert.equal(devicesIn(status(many))!.length, 50)
})

test('a device is taken out by its id, which goes to the server as one word of the script; what is no id never reaches a server', async () => {
  const server = pretendServer(() => ({ out: status([LAPTOP]) }))
  assert.deepEqual(await removeDevice(SERVER, PHONE.id, { exec: server.exec }), { ok: true, devices: [LAPTOP] })
  assert.match(server.calls[0]!.script, /^ID='a1b2c3d4e5f6'$/m)
  assert.match(server.calls[0]!.script, /remote-access\/bin\/remote-access remove "\$ID"\n/)

  const untouched = pretendServer()
  for (const id of ["x'; reboot; '", '$(reboot)', '-rf', 'abc', 'A1B2C3D4E5F6', 'a'.repeat(33), '']) {
    assert.equal(isDeviceId(id), false, id)
    assert.deepEqual(await removeDevice(SERVER, id, { exec: untouched.exec }), { ok: false, error: `${id} is not a device's id` })
  }
  assert.deepEqual(untouched.calls, [])
  // The door's own words for an id it does not have.
  assert.deepEqual(await removeDevice(SERVER, PHONE.id, { exec: pretendServer(() => ({ code: 1, err: `no device has the id ${PHONE.id}` })).exec }), { ok: false, error: `no device has the id ${PHONE.id}` })
})
