import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { CODE_LIFETIME_MS, MAX_DEVICES, Unreadable, nameOf, addCode, addPerson, computerWordFor, enter, isComputerId, isIn, nameOwner, personLinePorts, personOf, portOf, portsOf, readStore, readStoreStrict, removeComputer, removeDevice, removePerson, sanitize, sha256, shareLine, shownCode, storePath, update } from './store.js'
import { testHome } from './test-home.js'

test('no file reads as a closed door with nobody in', async () => {
  const home = await testHome()
  try {
    assert.deepEqual(await readStore(home.env), { on: false, persons: [], devices: [], codes: [], lines: [] })
  } finally {
    await home.remove()
  }
})

test('the file sits beside OpenAgent\'s own home file, and only its owner reads it', async () => {
  const home = await testHome()
  try {
    assert.equal(storePath({ HOME: '/home/ada' }), '/home/ada/.openagent-devices.json')
    assert.equal(storePath({ HOME: '/home/ada', XDG_CONFIG_HOME: '/cfg' }), '/cfg/openagent-devices.json')
    await update(home.env, store => {
      store.on = true
    })
    assert.equal((await stat(storePath(home.env))).mode & 0o777, 0o600)
  } finally {
    await home.remove()
  }
})

test('a code lets one device in, once; the file keeps neither the code nor the key', async () => {
  const home = await testHome()
  try {
    const { code } = await addCode(home.env, 1_000)
    const entry = await enter(home.env, code, 'iPhone, Safari', 2_000)
    assert.ok(entry)
    const store = await readStore(home.env)
    assert.deepEqual(store.devices.map(({ id, name, added }) => ({ id, name, added })), [{ id: entry.id, name: 'iPhone, Safari', added: new Date(2_000).toISOString() }])
    assert.equal(store.devices[0]!.key, sha256(entry.key))
    assert.deepEqual(store.codes, [], 'the code is spent')
    const file = await readFile(storePath(home.env), 'utf8')
    assert.ok(!file.includes(code) && !file.includes(entry.key))
    assert.equal(isIn(store, entry), true)
    assert.equal(isIn(store, { id: entry.id, key: 'another key' }), false)
    assert.equal(isIn(store, { id: 'nobody', key: entry.key }), false)

    assert.equal(await enter(home.env, code, 'A second phone', 3_000), undefined, 'a code works once')
    assert.equal((await readStore(home.env)).devices.length, 1)
  } finally {
    await home.remove()
  }
})

test('a code is eight letters and digits that read as no other, typed in any case, with a dash or spaces', async () => {
  const home = await testHome()
  try {
    const { code } = await addCode(home.env)
    assert.match(code, /^[2-9A-HJKMNP-TV-Z]{8}$/)
    assert.equal(shownCode(code), `${code.slice(0, 4)}-${code.slice(4)}`)
    assert.ok(await enter(home.env, ` ${shownCode(code).toLowerCase().replace('-', ' - ')} `, 'a computer'))
  } finally {
    await home.remove()
  }
})

test('a code is good for ten minutes, and an unknown one for nothing', async () => {
  const home = await testHome()
  try {
    const { code, expires } = await addCode(home.env, 0)
    assert.equal(expires, new Date(10 * 60 * 1000).toISOString())
    assert.equal(await enter(home.env, 'not a code', 'x', 1), undefined)
    assert.equal(await enter(home.env, code, 'x', CODE_LIFETIME_MS), undefined, 'too old at ten minutes')
    await addCode(home.env, CODE_LIFETIME_MS)
    assert.equal((await readStore(home.env)).codes.length, 1, 'a code that ran out leaves the file when the next one is made')
  } finally {
    await home.remove()
  }
})

test('a device is removed alone, and is out', async () => {
  const home = await testHome()
  try {
    const first = (await enter(home.env, (await addCode(home.env)).code, 'first'))!
    const second = (await enter(home.env, (await addCode(home.env)).code, 'second'))!
    assert.equal(await removeDevice(home.env, first.id), true)
    assert.equal(await removeDevice(home.env, first.id), false, 'no such device any more')
    const store = await readStore(home.env)
    assert.equal(isIn(store, first), false)
    assert.equal(isIn(store, second), true)
  } finally {
    await home.remove()
  }
})

test('changes made at the same moment are all kept', async () => {
  const home = await testHome()
  try {
    const codes = await Promise.all(Array.from({ length: 8 }, () => addCode(home.env)))
    const entries = await Promise.all(codes.map(({ code }, i) => enter(home.env, code, `device ${i}`)))
    assert.equal(entries.filter(Boolean).length, 8)
    assert.equal((await readStore(home.env)).devices.length, 8)
  } finally {
    await home.remove()
  }
})

test('a full list lets nobody else in', async () => {
  const home = await testHome()
  try {
    await update(home.env, store => {
      store.devices = Array.from({ length: MAX_DEVICES }, (_, i) => ({ id: `device${String(i).padStart(2, '0')}`, name: 'x', key: sha256(String(i)), added: new Date(0).toISOString() }))
    })
    assert.equal(await enter(home.env, (await addCode(home.env)).code, 'one more'), undefined)
  } finally {
    await home.remove()
  }
})

test('a file edited by hand is read forgivingly', async () => {
  const home = await testHome()
  try {
    const good = { id: 'abcdef123456', name: '  My phone  ', key: sha256('k'), added: '2026-01-01T00:00:00.000Z' }
    await writeFile(
      storePath(home.env),
      JSON.stringify({ on: 'yes', devices: [good, { ...good }, { id: 'x', key: 'short', added: 'never' }, null], codes: [{ code: 'nope', expires: 'never' }], listening: { pid: 'a' }, extra: 1 }),
    )
    assert.deepEqual(await readStore(home.env), { on: false, persons: [], devices: [{ ...good, name: 'My phone' }], codes: [], lines: [] })
  } finally {
    await home.remove()
  }
})

test('a file that cannot be read lets nobody in and is never written over', async () => {
  const home = await testHome()
  try {
    const entry = (await enter(home.env, (await addCode(home.env)).code, 'a phone'))!
    const good = await readFile(storePath(home.env), 'utf8')
    // A typo made by hand: one comma too many.
    const typo = good.replace('"on": false,', '"on": false,,')
    assert.notEqual(typo, good)
    for (const broken of [typo, 'not json', '[]', '']) {
      await writeFile(storePath(home.env), broken)
      assert.equal(await readStoreStrict(home.env), 'unreadable')
      assert.deepEqual(await readStore(home.env), sanitize(undefined), 'nobody is in on a doubt')
      await assert.rejects(update(home.env, store => void (store.on = true)), Unreadable)
      await assert.rejects(addCode(home.env), Unreadable)
      assert.equal(await removeDevice(home.env, entry.id).catch(() => 'refused'), 'refused')
      assert.equal(await readFile(storePath(home.env), 'utf8'), broken, 'the file is as the person left it')
    }
    await writeFile(storePath(home.env), good)
    assert.equal(isIn(await readStore(home.env), entry), true, 'corrected, every device is still in it')
  } finally {
    await home.remove()
  }
})

test('a wrong code changes nothing in the file', async () => {
  const home = await testHome()
  try {
    await addCode(home.env)
    const before = (await stat(storePath(home.env))).mtimeMs
    await new Promise(resolve => setTimeout(resolve, 15))
    assert.equal(await enter(home.env, 'a guess', 'x'), undefined)
    assert.equal((await stat(storePath(home.env))).mtimeMs, before)
  } finally {
    await home.remove()
  }
})

test('a lock left by a writer that is gone is taken over, and a writer removes only its own', async () => {
  const home = await testHome()
  try {
    const lock = `${storePath(home.env)}.lock`
    await writeFile(lock, `${2 ** 31 - 1}:left-behind`) // an impossibly high, unused pid
    const started = Date.now()
    await update(home.env, store => void (store.on = true))
    assert.ok(Date.now() - started < 2_000, 'not waited out')
    assert.equal((await readStore(home.env)).on, true)
    await assert.rejects(stat(lock), 'its own lock is gone after the change')

    // A lock of a writer that is alive is waited for, and is still its holder's after the wait ran out.
    await writeFile(lock, `${process.pid}:someone-else`)
    await assert.rejects(update(home.env, store => void (store.on = false)), /held by another writer/)
    assert.equal(await readFile(lock, 'utf8'), `${process.pid}:someone-else`)
    assert.equal((await readStore(home.env)).on, true)
  } finally {
    await home.remove()
  }
})

// Which computer an entry is, as the file keeps it: the SHA-256 of the word the computer said.
const MAC = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const PORTS = { from: 4300, count: 3 }
const code = async (env: NodeJS.ProcessEnv): Promise<string> => (await addCode(env)).code

test('a computer that gets in again takes the place of what it had: its key for OpenAgent, or its line, never the other, and never another computer\'s', async () => {
  const home = await testHome()
  try {
    const phone = (await enter(home.env, await code(home.env), 'iPhone, Safari'))!
    const first = (await enter(home.env, await code(home.env), 'OpenAgent on Mac', undefined, undefined, MAC))!
    const line = (await enter(home.env, await code(home.env), 'Mac', undefined, PORTS, MAC))!
    const other = (await enter(home.env, await code(home.env), 'OpenAgent on Mac', undefined, undefined, OTHER))!
    // A computer that does not say which one it is replaces nothing, whatever it is called.
    const unsaid = (await enter(home.env, await code(home.env), 'OpenAgent on Mac'))!
    assert.deepEqual((await readStore(home.env)).devices.map(device => device.id), [phone.id, first.id, line.id, other.id, unsaid.id])

    const again = (await enter(home.env, await code(home.env), 'OpenAgent on Mac', undefined, undefined, MAC))!
    let store = await readStore(home.env)
    assert.deepEqual(store.devices.map(device => device.id), [phone.id, line.id, other.id, unsaid.id, again.id])
    // The key it had no longer opens anything; the new one does, and so does everybody else's.
    assert.equal(isIn(store, first), false)
    for (const entry of [phone, line, other, unsaid, again]) assert.equal(isIn(store, entry), true)

    // A line asked for anew keeps the port it had: the address OpenAgent saved the computer under stays good.
    const lineOfOther = (await enter(home.env, await code(home.env), 'Studio', undefined, PORTS, OTHER))!
    const lineAgain = (await enter(home.env, await code(home.env), 'Mac', undefined, PORTS, MAC))!
    store = await readStore(home.env)
    assert.equal(isIn(store, line), false)
    assert.deepEqual(store.devices.filter(device => device.line).map(device => [device.id, device.line!.port]), [[lineOfOther.id, 4301], [lineAgain.id, 4300]])
    assert.equal(isIn(store, again), true, 'its key for OpenAgent stays')

    // A port from outside the lines' own is not kept: a file edited by hand names no port a line may have.
    await update(home.env, kept => void (kept.devices.find(device => device.id === lineAgain.id)!.line = { port: 80 }))
    const moved = (await enter(home.env, await code(home.env), 'Mac', undefined, PORTS, MAC))!
    assert.equal((await readStore(home.env)).devices.find(device => device.id === moved.id)!.line!.port, 4300)
  } finally {
    await home.remove()
  }
})

test('a full list still lets a computer in again in its own place, and nobody new', async () => {
  const home = await testHome()
  try {
    const mac = (await enter(home.env, await code(home.env), 'OpenAgent on Mac', undefined, undefined, MAC))!
    for (let at = 1; at < MAX_DEVICES; at++) assert.ok(await enter(home.env, await code(home.env), `phone ${at}`))
    assert.equal(await enter(home.env, await code(home.env), 'one more'), undefined)
    assert.equal(await enter(home.env, await code(home.env), 'OpenAgent on Studio', undefined, undefined, OTHER), undefined)
    const again = await enter(home.env, await code(home.env), 'OpenAgent on Mac', undefined, undefined, MAC)
    assert.ok(again)
    const store = await readStore(home.env)
    assert.equal(store.devices.length, MAX_DEVICES)
    assert.equal(isIn(store, mac), false)
  } finally {
    await home.remove()
  }
})

test('a computer is taken out whole by the id of anything it holds; a device takes only itself out', async () => {
  const home = await testHome()
  try {
    const phone = (await enter(home.env, await code(home.env), 'iPhone, Safari'))!
    const key = (await enter(home.env, await code(home.env), 'OpenAgent on Mac', undefined, undefined, MAC))!
    const line = (await enter(home.env, await code(home.env), 'Mac', undefined, PORTS, MAC))!
    const other = (await enter(home.env, await code(home.env), 'OpenAgent on Studio', undefined, undefined, OTHER))!
    const ids = async (): Promise<string[]> => (await readStore(home.env)).devices.map(device => device.id)

    // What a device does when it takes itself out: the one entry, and no other of its computer.
    assert.equal(await removeDevice(home.env, key.id), true)
    assert.deepEqual(await ids(), [phone.id, line.id, other.id])
    const back = (await enter(home.env, await code(home.env), 'OpenAgent on Mac', undefined, undefined, MAC))!

    // What a person does: the computer, by either id.
    assert.equal(await removeComputer(home.env, line.id), true)
    assert.deepEqual(await ids(), [phone.id, other.id])
    assert.equal(isIn(await readStore(home.env), back), false)
    assert.equal(await removeComputer(home.env, 'nobody'), false)
    // A phone, which says no computer, is the one entry: taking it out takes nobody else's.
    assert.equal(await removeComputer(home.env, phone.id), true)
    assert.deepEqual(await ids(), [other.id])

    // A second key of the same kind under a computer's word, which only a file written by hand holds, is a row of its own
    // in the list: taking that row out takes it alone, and taking the computer out leaves it.
    const lineOfOther = (await enter(home.env, await code(home.env), 'Studio', undefined, PORTS, OTHER))!
    await update(home.env, store => void store.devices.push({ id: 'byhand000001', name: 'OpenAgent on Studio', key: 'f'.repeat(64), added: new Date(0).toISOString(), computer: OTHER }))
    assert.equal(await removeComputer(home.env, 'byhand000001'), true)
    assert.deepEqual(await ids(), [other.id])
    await update(home.env, store => void store.devices.push({ id: 'byhand000001', name: 'OpenAgent on Studio', key: 'f'.repeat(64), added: new Date(0).toISOString(), computer: OTHER }))
    const again = (await enter(home.env, await code(home.env), 'Studio', undefined, PORTS, OTHER))!
    assert.equal(await removeComputer(home.env, other.id), true)
    assert.deepEqual(await ids(), ['byhand000001'])
    assert.equal(isIn(await readStore(home.env), lineOfOther), false)
    assert.equal(isIn(await readStore(home.env), again), false)
  } finally {
    await home.remove()
  }
})

test('which computer an entry is, and that a line was refused, are kept only when they read as such', () => {
  for (const word of ['a'.repeat(16), 'a1b2'.repeat(16)]) assert.equal(isComputerId(word), true, word)
  for (const word of ['a'.repeat(15), 'a'.repeat(65), 'A'.repeat(32), `${'a'.repeat(31)}.`, `${'a'.repeat(20)}\n`, '', 7, undefined]) assert.equal(isComputerId(word), false, String(word))
  const device = { id: 'abcdef', name: 'Mac', key: 'f'.repeat(64), added: new Date(0).toISOString() }
  const line = { url: 'https://box.example.com', pin: 'p', key: 'abcdef.secret', mode: 'full' }
  // In the file a computer is the SHA-256 of its word: the word itself, kept by a hand that edited the file, is not read as one.
  const read = sanitize({ devices: [{ ...device, computer: MAC }, { ...device, id: 'abcdeg', computer: 'a'.repeat(32) }], lines: [{ ...line, refused: true }, { ...line, url: 'https://other.example.com', refused: 'yes' }] })
  assert.deepEqual(read.devices.map(kept => kept.computer), [MAC, undefined])
  assert.deepEqual(read.lines.map(kept => kept.refused), [true, undefined])
})

test('a computer says another word to each door, made from the word it keeps and the door\'s address; OpenAgent makes the same', () => {
  const word = 'a'.repeat(32)
  // The same answer as OpenAgent's own `computerWordFor`, pinned in its tests too: the two must agree, or a computer is two rows.
  assert.equal(computerWordFor(word, 'https://203.0.113.5'), '46613e5444e67e384ccb7c7ba693c92e')
  assert.equal(computerWordFor(word, 'https://203.0.113.5/_devices/enter'), '46613e5444e67e384ccb7c7ba693c92e')
  assert.equal(computerWordFor(word, 'http://studio.local:4201/x'), 'c72e4164c235580bb030ea4b32ffb51b')
  assert.notEqual(computerWordFor('b'.repeat(32), 'https://203.0.113.5'), computerWordFor(word, 'https://203.0.113.5'))
  assert.equal(isComputerId(computerWordFor(word, 'https://203.0.113.5')), true)
})

test('a person is a name in any language, spaces made one; a name with nothing but letters, digits, spaces, dots, apostrophes and dashes', () => {
  assert.deepEqual(['Rom', ' Rom  Brillout ', 'רום', "Dani O'Neil", 'José', 'a'.repeat(40)].map(nameOf), ['Rom', 'Rom Brillout', 'רום', "Dani O'Neil", 'José', 'a'.repeat(40)])
  assert.deepEqual(['-rom', 'a'.repeat(41), 'rom\nx', 'rom/x', '<rom>', ''].map(nameOf), [undefined, undefined, undefined, undefined, undefined, undefined])
})

test('the owner is named once, then persons are added; the devices in before are the owner\'s; removing a person takes their devices and codes', async () => {
  const home = await testHome()
  try {
    const mine = (await enter(home.env, (await addCode(home.env)).code, 'my phone'))!
    assert.equal(await addPerson(home.env, 'rom'), undefined, 'no person before the owner')
    assert.equal(personOf(await readStore(home.env), (await readStore(home.env)).devices[0]!), undefined)

    assert.ok(await nameOwner(home.env, 'ada'))
    assert.ok(await nameOwner(home.env, 'ada'), 'the same owner again changes nothing')
    assert.equal(await nameOwner(home.env, 'eve'), false, 'never a second owner')
    assert.ok(await addPerson(home.env, 'rom'))
    assert.ok(await addPerson(home.env, 'rom'), 'once')

    const roms = (await enter(home.env, (await addCode(home.env, Date.now(), 'rom')).code, 'rom\'s phone'))!
    await addCode(home.env, Date.now(), 'rom')
    let store = await readStore(home.env)
    assert.deepEqual(store.persons.map(person => [person.name, person.owner === true]), [['ada', true], ['rom', false]])
    assert.deepEqual(store.devices.map(device => [device.id, personOf(store, device)]), [[mine.id, 'ada'], [roms.id, 'rom']])

    assert.equal(await removePerson(home.env, 'ada'), false, 'the owner stays')
    assert.ok(await removePerson(home.env, 'rom'))
    store = await readStore(home.env)
    assert.deepEqual([store.persons.map(person => person.name), store.devices.map(device => device.id), store.codes.length], [['ada'], [mine.id], 0])
  } finally {
    await home.remove()
  }
})

test('persons edited by hand are read forgivingly: no owner means no persons, and a device for nobody known is the owner\'s', () => {
  const added = new Date().toISOString()
  const device = { id: 'abc123', name: 'x', key: 'a'.repeat(64), added }
  assert.deepEqual(sanitize({ persons: [{ name: 'rom', added }], devices: [{ ...device, person: 'rom' }] }).persons, [])
  const read = sanitize({ persons: [{ name: 'rom', added }, { name: 'ada', owner: true, added }, { name: '<bad>', added }], devices: [{ ...device, person: 'eve' }, { ...device, id: 'def456', person: 'rom' }, { ...device, id: 'ghi789', person: 'ada' }] })
  assert.deepEqual(read.persons.map(person => person.name), ['ada', 'rom'])
  assert.deepEqual(read.devices.map(entry => entry.person), [undefined, 'rom', undefined])
})

test('on a computer with users per person, each person gets the first free block of ports and keeps it; elsewhere none', async () => {
  const home = await testHome()
  try {
    await nameOwner(home.env, 'ada')
    assert.deepEqual(await addPerson(home.env, 'eve'), { name: 'eve', added: (await readStore(home.env)).persons[1]!.added }, 'no block where nobody gets a user')
    assert.equal((await addPerson(home.env, 'rom', Date.now(), true))?.port, 4300)
    assert.equal((await addPerson(home.env, 'kim', Date.now(), true))?.port, 4400)
    assert.equal((await addPerson(home.env, 'rom', Date.now(), true))?.port, 4300, 'kept')
    assert.equal((await addPerson(home.env, 'eve', Date.now(), true))?.port, 4500, 'one who had none gets one once they get a user')
    assert.equal((await addPerson(home.env, 'ada', Date.now(), true))?.port, undefined, 'never the owner: the owner\'s OpenAgent is the one that started the door')
    assert.ok(await removePerson(home.env, 'rom'))
    assert.equal((await addPerson(home.env, 'lee', Date.now(), true))?.port, 4300, 'a block that was freed is given again')
    const store = await readStore(home.env)
    assert.equal(portOf(store, 'kim'), 4400)
    assert.equal(portOf(store, 'ada'), undefined)
    assert.equal(portOf(store, undefined), undefined)
    assert.deepEqual(personLinePorts(4400), { from: 4410, count: 50 })
  } finally {
    await home.remove()
  }
})

test('a block of ports edited by hand is one person\'s: a second person naming it has none, and the owner never has one', () => {
  const added = new Date().toISOString()
  const read = sanitize({ persons: [{ name: 'ada', owner: true, added, port: 4300 }, { name: 'rom', added, port: 4300 }, { name: 'kim', added, port: 4300 }, { name: 'eve', added, port: 'x' }] })
  assert.deepEqual(read.persons.map(person => [person.name, person.port]), [['ada', undefined], ['rom', 4300], ['kim', undefined], ['eve', undefined]])
})

test('a code made for a line lets in a line of that person, in their block of ports, and nothing else; what it does not let in does not spend it', async () => {
  const home = await testHome()
  try {
    await nameOwner(home.env, 'ada')
    await addPerson(home.env, 'rom', Date.now(), true)
    const owners = { from: 4210, count: 50 }
    const { code } = await addCode(home.env, Date.now(), 'rom', true)
    assert.equal(await enter(home.env, code, 'a browser'), undefined, 'not a browser')
    const line = await enter(home.env, code, 'rom-laptop', Date.now(), owners)
    assert.equal(line?.person, 'rom')
    assert.equal((await readStore(home.env)).devices.find(device => device.id === line!.id)?.line?.port, 4310, 'in rom\'s block, not the owner\'s')
    assert.equal(await enter(home.env, code, 'again', Date.now(), owners), undefined, 'once')
    // The owner's line, and a person with no block, are in the owner's ports as before.
    const own = await enter(home.env, (await addCode(home.env, Date.now(), undefined, true)).code, 'ada-laptop', Date.now(), owners)
    assert.equal((await readStore(home.env)).devices.find(device => device.id === own!.id)?.line?.port, 4210)
  } finally {
    await home.remove()
  }
})

test('a person takes out only devices of their own, and a computer\'s other entry only when it is theirs too', async () => {
  const home = await testHome()
  try {
    await nameOwner(home.env, 'ada')
    await addPerson(home.env, 'rom')
    const computer = sha256('one computer')
    const adas = (await enter(home.env, (await addCode(home.env)).code, 'ada laptop', Date.now(), undefined, computer))!
    const romsLine = (await enter(home.env, (await addCode(home.env, Date.now(), 'rom')).code, 'rom line', Date.now(), { from: 4210, count: 50 }, computer))!
    assert.equal(await removeComputer(home.env, adas.id, { person: 'rom' }), false, 'not rom\'s')
    assert.ok(await removeComputer(home.env, romsLine.id, { person: 'rom' }))
    assert.deepEqual((await readStore(home.env)).devices.map(device => device.id), [adas.id], 'the owner\'s entry of the same computer stays')
  } finally {
    await home.remove()
  }
})

test('a line for everyone, who it is for and the persons a server last said are kept only when they read as such', () => {
  const added = new Date().toISOString()
  const key = sha256('k')
  const store = sanitize({
    persons: [
      { name: 'ada', owner: true, added },
      { name: 'rom', added, port: 4300, from: 'https://203.0.113.7', kept: true },
      { name: 'kim', added, port: 4400, from: 'http://203.0.113.7', kept: 'yes' },
    ],
    devices: [
      { id: 'aaaaaa', name: 'studio', key, added, line: { port: 4310, others: { ada: 4210, kim: 4410, eve: 4211, rom: 4311, bad: 'x', 'NOT AN ACCOUNT': 4212 } }, person: 'rom' },
      { id: 'bbbbbb', name: 'laptop', key, added, line: { port: 4410, others: { rom: 4310 } }, person: 'kim' },
      { id: 'cccccc', name: 'desk', key, added, line: { port: 4211, others: [4212] } },
    ],
    lines: [
      { url: 'https://203.0.113.7', pin: 'p', key: 'id.k', mode: 'full', for: 'everyone', person: 'rom', persons: ['ada', 'rom', 'rom', '<not one>', 7] },
      { url: 'https://203.0.113.8', pin: 'p', key: 'id.k', mode: 'full', for: 'some', person: '-x', persons: ['ada'] },
    ],
  })
  assert.deepEqual(
    store.persons.map(({ name, from, kept }) => ({ name, from, kept })),
    [
      { name: 'ada', from: undefined, kept: undefined },
      { name: 'rom', from: 'https://203.0.113.7', kept: true },
      { name: 'kim', from: undefined, kept: undefined },
    ],
  )
  // Each port is one address: the second computer's own port was the first one's for kim already, so it has no line.
  assert.deepEqual(
    store.devices.map(device => device.line),
    [{ port: 4310, others: { ada: 4210, kim: 4410 } }, undefined, { port: 4211 }],
  )
  assert.deepEqual(portsOf(store.devices[0]!), [4310, 4210, 4410])
  assert.deepEqual(store.lines, [
    { url: 'https://203.0.113.7', pin: 'p', key: 'id.k', mode: 'full', for: 'everyone', person: 'rom', persons: ['ada', 'rom'] },
    { url: 'https://203.0.113.8', pin: 'p', key: 'id.k', mode: 'full' },
  ])
})

test('a computer whose line is for everyone gets an address in the block of each other person with an OpenAgent of their own, and the owner\'s; given ports are kept, a person gone loses theirs', () => {
  const added = new Date().toISOString()
  const key = sha256('k')
  const owner = { from: 4210, count: 50 }
  const store = sanitize({
    persons: [
      { name: 'ada', owner: true, added },
      { name: 'rom', added, port: 4300 },
      { name: 'kim', added, port: 4400 },
      { name: 'eve', added },
    ],
    devices: [
      { id: 'aaaaaa', name: 'studio', key, added, line: { port: 4310 }, person: 'rom' },
      { id: 'bbbbbb', name: 'laptop', key, added, line: { port: 4210 } },
      { id: 'cccccc', name: 'kim', key, added, line: { port: 4410 }, person: 'kim' },
    ],
  })
  const studio = store.devices[0]!
  assert.equal(shareLine(store, studio, owner), true)
  // Not its own person, nobody without an OpenAgent of their own, and never a port another address has.
  assert.deepEqual(studio.line!.others, { ada: 4211, kim: 4411 })
  assert.equal(shareLine(store, studio, owner), false, 'the same again changes nothing')
  store.persons = store.persons.filter(person => person.name !== 'kim')
  assert.equal(shareLine(store, studio, owner), true)
  assert.deepEqual(studio.line!.others, { ada: 4211 })
  // A line for everyone on a computer with nobody else yet is one all the same.
  const alone = sanitize({ persons: [], devices: [{ id: 'dddddd', name: 'box', key, added, line: { port: 4210 } }] })
  assert.equal(shareLine(alone, alone.devices[0]!, owner), true)
  assert.deepEqual(alone.devices[0]!.line, { port: 4210, others: {} })
  assert.deepEqual(sanitize(JSON.parse(JSON.stringify(alone))).devices[0]!.line, { port: 4210, others: {} })
})
