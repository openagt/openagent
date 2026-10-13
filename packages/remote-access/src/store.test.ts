import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { CODE_LIFETIME_MS, MAX_DEVICES, Unreadable, addCode, computerWordFor, enter, isComputerId, isIn, readStore, readStoreStrict, removeComputer, removeDevice, sanitize, sha256, storePath, update } from './store.js'
import { testHome } from './test-home.js'

test('no file reads as a closed door with nobody in', async () => {
  const home = await testHome()
  try {
    assert.deepEqual(await readStore(home.env), { on: false, devices: [], codes: [], lines: [] })
  } finally {
    await home.remove()
  }
})

test('the file sits beside OpenAgent\'s own home file, and only its owner reads it', async () => {
  const home = await testHome()
  try {
    assert.equal(storePath({ HOME: '/home/ada' }), '/home/ada/.openagent-remote-access.json')
    assert.equal(storePath({ HOME: '/home/ada', XDG_CONFIG_HOME: '/cfg' }), '/cfg/openagent-remote-access.json')
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

test('a code is good for five minutes, and an unknown one for nothing', async () => {
  const home = await testHome()
  try {
    const { code, expires } = await addCode(home.env, 0)
    assert.equal(expires, new Date(CODE_LIFETIME_MS).toISOString())
    assert.equal(await enter(home.env, 'not a code', 'x', 1), undefined)
    assert.equal(await enter(home.env, code, 'x', CODE_LIFETIME_MS), undefined, 'too old at five minutes')
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
    assert.deepEqual(await readStore(home.env), { on: false, devices: [{ ...good, name: 'My phone' }], codes: [], lines: [] })
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
  assert.equal(computerWordFor(word, 'https://203.0.113.5/_remote-access/enter'), '46613e5444e67e384ccb7c7ba693c92e')
  assert.equal(computerWordFor(word, 'http://studio.local:4201/x'), 'c72e4164c235580bb030ea4b32ffb51b')
  assert.notEqual(computerWordFor('b'.repeat(32), 'https://203.0.113.5'), computerWordFor(word, 'https://203.0.113.5'))
  assert.equal(isComputerId(computerWordFor(word, 'https://203.0.113.5')), true)
})
