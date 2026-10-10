import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { CODE_LIFETIME_MS, MAX_DEVICES, Unreadable, addCode, enter, isIn, readStore, readStoreStrict, removeDevice, sanitize, sha256, storePath, update } from './store.js'
import { testHome } from './test-home.js'

test('no file reads as a closed door with nobody in', async () => {
  const home = await testHome()
  try {
    assert.deepEqual(await readStore(home.env), { on: false, devices: [], codes: [] })
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
    assert.deepEqual(await readStore(home.env), { on: false, devices: [{ ...good, name: 'My phone' }], codes: [] })
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
