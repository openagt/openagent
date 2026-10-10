import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import {
  addMachine,
  addProject,
  ensureDaemonToken,
  listMachines,
  listProjects,
  projectId,
  readDaemonToken,
  readPreferences,
  removeMachine,
  removeProject,
  readRegistry,
  registryPreferencesStore,
  registryPath,
  writePreferences,
  patchPreferences,
  REGISTRY_FILE,
  REGISTRY_FILE_MODE,
  type Preferences,
  type ProjectRecord,
  type RegistryFs,
} from './registry.js'

/**
 * An in-memory {@link RegistryFs} so the registry logic is tested without touching disk.
 *
 * `write` truncates before it stores, as a real `writeFile` does. That is what makes the
 * atomicity of #991 observable: `failWritesTo` models a crash or a full disk between the
 * truncate and the flush, leaving the file it truncated empty.
 */
function memFs(
  seed: Record<string, string> = {},
  options: { failWritesTo?: string; slow?: boolean } = {},
): RegistryFs & { files: Map<string, string>; dirs: string[]; written: string[]; modes: Map<string, number> } {
  const files = new Map<string, string>(Object.entries(seed))
  const dirs: string[] = []
  const written: string[] = []
  // Permission bits, so the owner-only write (#1095) is observable without a real filesystem.
  const modes = new Map<string, number>()
  // An await point inside read and write, so concurrent callers interleave rather than each
  // running start to finish.
  const pause = async () => {
    if (options.slow) await new Promise(resolve => setTimeout(resolve, 1))
  }
  return {
    files,
    dirs,
    written,
    modes,
    async read(path) {
      await pause()
      const v = files.get(path)
      if (v === undefined) throw new Error(`ENOENT: ${path}`)
      return v
    },
    async write(path, contents) {
      written.push(path)
      files.set(path, '') // truncate, as `writeFile` does
      await pause()
      if (options.failWritesTo === path) throw new Error(`ENOSPC: ${path}`)
      files.set(path, contents)
    },
    async mkdir(path) {
      dirs.push(path) // no-op: the memory fs has no directories
    },
    async rename(from, to) {
      const contents = files.get(from)
      if (contents === undefined) throw new Error(`ENOENT: ${from}`)
      files.delete(from)
      files.set(to, contents)
      const mode = modes.get(from)
      modes.delete(from)
      if (mode !== undefined) modes.set(to, mode)
    },
    async chmod(path, mode) {
      if (!files.has(path)) throw new Error(`ENOENT: ${path}`)
      modes.set(path, mode)
    },
  }
}

const ENV = { HOME: '/home/u' }
const FILE = registryPath(ENV)

const APP_A: ProjectRecord = {
  id: projectId('/repos/app-a'),
  path: '/repos/app-a',
  addedAt: '2026-07-10T09:00:00.000Z',
}

const APP_B: ProjectRecord = {
  id: projectId('/repos/app-b'),
  path: '/repos/app-b',
  addedAt: '2026-07-10T10:00:00.000Z',
}

test('registryPath prefers XDG_CONFIG_HOME over HOME', () => {
  assert.equal(registryPath({ XDG_CONFIG_HOME: '/cfg' }), join('/cfg', REGISTRY_FILE))
  assert.equal(registryPath({ XDG_CONFIG_HOME: '/cfg', HOME: '/home/u' }), join('/cfg', REGISTRY_FILE))
})

test('registryPath falls back to a single dotfile under HOME (empty XDG counts as unset)', () => {
  assert.equal(registryPath(ENV), join('/home/u', '.' + REGISTRY_FILE))
  // The name itself, said once: a person finds this file by hand.
  assert.equal(registryPath(ENV), '/home/u/.openagent.json')
  assert.equal(registryPath({ XDG_CONFIG_HOME: '', HOME: '/home/u' }), join('/home/u', '.' + REGISTRY_FILE))
})

test('projectId is deterministic and distinct per path', () => {
  assert.equal(projectId('/repos/app-a'), projectId('/repos/app-a'))
  assert.notEqual(projectId('/repos/app-a'), projectId('/repos/app-b'))
  assert.notEqual(projectId('/repos/app-a'), projectId('/other/app-a')) // same basename, different path
})

test('projectId is URL-safe, even for a messy basename', () => {
  for (const path of ['/repos/app-a', '/repos/My App (v2)!', '/repos/ÜMLAUT.dir']) {
    assert.match(projectId(path), /^[a-z0-9-]+$/)
  }
})

test('listProjects on a missing file is []', async () => {
  assert.deepEqual(await listProjects(memFs(), ENV), [])
})

test('listProjects on an empty / malformed / non-array file is []', async () => {
  for (const raw of ['', 'not json', '{"id":"x"}', '42']) {
    assert.deepEqual(await listProjects(memFs({ [FILE]: raw }), ENV), [])
  }
})

test('listProjects round-trips a well-formed file and drops malformed records', async () => {
  const raw = JSON.stringify({ projects: [APP_A, { id: 'no-path' }, 'nope', APP_B], preferences: {} })
  assert.deepEqual(await listProjects(memFs({ [FILE]: raw }), ENV), [APP_A, APP_B])
})

test('listProjects dedupes by resolved path, first wins', async () => {
  const dupe = { ...APP_B, path: '/repos/app-a/', addedAt: '2026-07-10T11:00:00.000Z' }
  const raw = JSON.stringify({ projects: [APP_A, dupe, APP_B], preferences: {} })
  assert.deepEqual(await listProjects(memFs({ [FILE]: raw }), ENV), [APP_A, APP_B])
})

test('addProject appends a record and writes pretty JSON that parses back', async () => {
  const fs = memFs()
  const record = await addProject('/repos/app-a', APP_A.addedAt, fs, ENV)
  assert.deepEqual(record, APP_A)
  assert.deepEqual(fs.dirs, ['/home/u']) // the single dotfile's parent is $HOME itself
  assert.deepEqual(JSON.parse(fs.files.get(FILE)!), { projects: [APP_A], preferences: {} })

  await addProject('/repos/app-b', APP_B.addedAt, fs, ENV)
  assert.deepEqual(await listProjects(fs, ENV), [APP_A, APP_B])
})

test('removeProject takes one project off the list by its id, answers its record, and keeps the others and the preferences', async () => {
  const fs = memFs()
  await addProject('/repos/app-a', APP_A.addedAt, fs, ENV)
  await addProject('/repos/app-b', APP_B.addedAt, fs, ENV)
  await writePreferences({ model: 'opus' }, fs, ENV)

  assert.deepEqual(await removeProject(APP_A.id, fs, ENV), APP_A)
  assert.deepEqual(await listProjects(fs, ENV), [APP_B])
  assert.deepEqual(await readPreferences(fs, ENV), { model: 'opus' })

  // An id no project has changes nothing and says so.
  const before = fs.files.get(FILE)
  assert.equal(await removeProject('nope-123', fs, ENV), undefined)
  assert.equal(fs.files.get(FILE), before)

  // Added again, the folder is the same project: the id is its path's.
  assert.equal((await addProject('/repos/app-a', '2027-01-01T00:00:00.000Z', fs, ENV)).id, APP_A.id)
})

test('addProject is idempotent by resolved path and keeps the original addedAt', async () => {
  const fs = memFs()
  await addProject('/repos/app-a', APP_A.addedAt, fs, ENV)
  for (const variant of ['/repos/app-a', '/repos/app-a/', '/repos/other/../app-a']) {
    const again = await addProject(variant, '2027-01-01T00:00:00.000Z', fs, ENV)
    assert.deepEqual(again, APP_A) // existing record, addedAt untouched
  }
  assert.deepEqual(JSON.parse(fs.files.get(FILE)!), { projects: [APP_A], preferences: {} })
})

test('addProject normalizes the stored path to an absolute one', async () => {
  const fs = memFs()
  const record = await addProject('/repos/app-a/', APP_A.addedAt, fs, ENV)
  assert.equal(record.path, '/repos/app-a')
})

// Preferences (#410): stored in the same file next to the project list.

test('readRegistry reads only the object form; a shape it no longer writes is an empty registry', async () => {
  // The bare `ProjectRecord[]` #410 replaced is read as nothing, like any other file this cannot
  // make sense of: with no users to carry, a second accepted shape is a permanent branch in the
  // one reader every surface goes through.
  const raw = JSON.stringify([APP_A, APP_B])
  assert.deepEqual(await readRegistry(memFs({ [FILE]: raw }), ENV), { projects: [], preferences: {} })
})

test('readRegistry reads the object form with preferences and drops unknown/non-boolean fields', async () => {
  const raw = JSON.stringify({
    projects: [APP_A],
    preferences: { bridge: true, notifyNewActivity: 'yes', bogus: 1, notifyBrowser: true, bridgeBrowser: true },
  })
  assert.deepEqual(await readRegistry(memFs({ [FILE]: raw }), ENV), {
    projects: [APP_A],
    preferences: { bridge: true, notifyBrowser: true, bridgeBrowser: true }, // notifyNewActivity (non-boolean) + bogus dropped
  })
})

test('every boolean preference survives a save; the sanitizer cannot silently drop one (#944)', async () => {
  // `allOn` is typed over the boolean keys computed from `Preferences` itself, so adding a
  // boolean preference without listing it here is a compile error in this test — and a key the
  // sanitizer's list misses fails the round-trip below, the write-then-vanish shape #944 closes.
  type BooleanKey = {
    [K in keyof Preferences]-?: NonNullable<Preferences[K]> extends boolean ? K : never
  }[keyof Preferences]
  const allOn: Record<BooleanKey, boolean> = {
    notifyBrowser: true,
    notifyNewActivity: true,
    notifyHumanIntervention: true,
    bridge: true,
    bridgeBrowser: true,
    onboardingDismissed: true,
    postMergeCleanup: true,
  }
  const fs = memFs()
  await writePreferences(allOn, fs, ENV)
  assert.deepEqual(await readPreferences(fs, ENV), allOn)
})

test('sanitizePreferences reads only the current spellings', async () => {
  // A renamed key is an unknown key, and an unknown key is dropped — the same answer the sanitizer
  // gives junk. `driver` does not read the `agent` D5 renamed, nor the old name of Claude Code
  // (#1774: the names are agent-driver's own now), and the options only the daemon's own runner
  // read are gone: a stored file written before is rewritten by hand, not by code that would then
  // have to stay forever.
  const stored = (preferences: Record<string, unknown>) =>
    readPreferences(memFs({ [FILE]: JSON.stringify({ projects: [], preferences }) }), ENV)
  assert.deepEqual(await stored({ handoff: 'local', vanilla: true, transparent: true, browser: true, target: 'actions', autoPm: true }), {})
  assert.deepEqual(await stored({ agent: 'codex' }), {})
  assert.deepEqual(await stored({ driver: 'claude' }), {})
  // The key that replaced it still reads, beside the ignored one.
  assert.deepEqual(await stored({ driver: 'claude-code', agent: 'gpt-9000' }), { driver: 'claude-code' })
  assert.deepEqual(await stored({ publish: 'merge' }), { publish: 'merge' })
  assert.deepEqual(await stored({ publish: 'nothing' }), { publish: 'nothing' })
  assert.deepEqual(await stored({ publish: 'push' }), {}, 'a word the launcher\'s menu does not list is dropped')
  // Where an agent starts, per project: only the word `local` is stored, the main branch is the absent entry.
  assert.deepEqual(await stored({ startFrom: { 'app-1a2b': 'local', 'web-3c4d': 'main', '': 'local', 'api-5e6f': true } }), { startFrom: { 'app-1a2b': 'local' } })
  assert.deepEqual(await stored({ startFrom: {} }), {}, 'no project left: the key is left out')
  assert.deepEqual(await stored({ startFrom: ['app-1a2b'] }), {})
  assert.deepEqual(await stored({ startFrom: 'local' }), {})
  const many = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`p-${i}`, 'local']))
  assert.equal(Object.keys((await stored({ startFrom: many })).startFrom ?? {}).length, 200, 'bounded, like the presets')
})

test('patchPreferences merges only the keys it is given (#1148)', async () => {
  // The dashboard used to send its whole cached object, so a tab that had been open since before
  // someone else's change wrote the old value back over it. A patch touches only what it names.
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [], preferences: { theme: 'dark', driver: 'codex' } }) })

  const stored = await patchPreferences({ notifyBrowser: true }, fs, ENV)

  assert.deepEqual(stored, { theme: 'dark', driver: 'codex', notifyBrowser: true })
  assert.deepEqual(await readPreferences(fs, ENV), stored)
})

test('a patched key still clears the way it always has (#1148)', async () => {
  // No sentinel for "remove": the sanitizer already drops blanks and empty lists, which is how
  // the dashboard clears the editor and the last custom preset.
  const seed = { projects: [], preferences: { editor: 'code', theme: 'dark', customPresets: [{ id: 'a', label: 'A', prompt: 'p' }] } }
  const fs = memFs({ [FILE]: JSON.stringify(seed) })

  assert.deepEqual(await patchPreferences({ editor: '' }, fs, ENV), {
    theme: 'dark',
    customPresets: [{ id: 'a', label: 'A', prompt: 'p' }],
  })
  assert.deepEqual(await patchPreferences({ customPresets: [] }, fs, ENV), { theme: 'dark' })
})

test('patchPreferences sanitizes the merged result, not just the patch (#1148)', async () => {
  // The one rule, applied once to the merge: an unknown key never lands, and a value outside the
  // known set drops the key rather than being stored — the same answer `writePreferences` gives.
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [], preferences: { theme: 'dark', driver: 'codex' } }) })
  assert.deepEqual(await patchPreferences({ theme: 'moon', bogus: 3 } as never, fs, ENV), { driver: 'codex' })
})

test('the preferences store exposes the patch the dashboard writes through (#1148)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A], preferences: { theme: 'dark' } }) })
  const store = registryPreferencesStore(fs, ENV)

  assert.deepEqual(await store.patch!({ driver: 'codex' }), { theme: 'dark', driver: 'codex' })
})

test('readPreferences on a missing file, or one with no preferences block, is {}', async () => {
  assert.deepEqual(await readPreferences(memFs(), ENV), {})
  assert.deepEqual(await readPreferences(memFs({ [FILE]: JSON.stringify({ projects: [APP_A] }) }), ENV), {})
})

test('writePreferences persists sanitized prefs and preserves the project list', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A, APP_B], preferences: {} }) })
  await writePreferences({ bridge: false, bridgeBrowser: true, bogus: 3 } as never, fs, ENV)
  assert.deepEqual(JSON.parse(fs.files.get(FILE)!), {
    projects: [APP_A, APP_B],
    preferences: { bridge: false, bridgeBrowser: true },
  })
  // The project list still reads back unchanged.
  assert.deepEqual(await listProjects(fs, ENV), [APP_A, APP_B])
})

test('writePreferences round-trips the notifyNewActivity toggle (#627)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A], preferences: {} }) })
  await writePreferences({ notifyNewActivity: true }, fs, ENV)
  assert.deepEqual(await readPreferences(fs, ENV), { notifyNewActivity: true })
})

test('writePreferences round-trips the notifyHumanIntervention toggle (#627)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A], preferences: {} }) })
  // Default is on, so the persisted value that matters is the explicit opt-out.
  await writePreferences({ notifyHumanIntervention: false }, fs, ENV)
  assert.deepEqual(await readPreferences(fs, ENV), { notifyHumanIntervention: false })
})

test('writePreferences keeps the model string but drops a blank one (#628)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A], preferences: {} }) })
  await writePreferences({ model: '  opus  ' }, fs, ENV)
  assert.deepEqual(await readPreferences(fs, ENV), { model: 'opus' }) // trimmed
  await writePreferences({ model: '   ' }, fs, ENV)
  assert.deepEqual(await readPreferences(fs, ENV), {}) // blank -> no choice, dropped
})

test('the word "Default" is not a model, however a file came to hold it (#1143)', async () => {
  // It was a picker label whose stored value was empty. A file carrying it as the *value* would
  // otherwise reach the CLI as `--model Default` and fail the turn on a word nobody chose.
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A], preferences: {} }) })
  await writePreferences({ model: 'opus' }, fs, ENV)
  await writePreferences({ model: 'Default' }, fs, ENV)
  assert.deepEqual(await readPreferences(fs, ENV), {})
  await writePreferences({ model: ' default ' }, fs, ENV)
  assert.deepEqual(await readPreferences(fs, ENV), {})
})

test('writePreferences keeps a known agent and drops an unknown one (#650)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A], preferences: {} }) })
  await writePreferences({ driver: 'codex' }, fs, ENV)
  assert.deepEqual(await readPreferences(fs, ENV), { driver: 'codex' })
  await writePreferences({ driver: 'gpt-9000' } as never, fs, ENV) // not in the known set
  assert.deepEqual(await readPreferences(fs, ENV), {}) // dropped
})

test('writePreferences trims a preferred editor and drops a blank one (#727)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A], preferences: {} }) })
  await writePreferences({ editor: '  cursor  ' }, fs, ENV)
  assert.deepEqual(await readPreferences(fs, ENV), { editor: 'cursor' }) // trimmed
  await writePreferences({ editor: '   ' }, fs, ENV) // blank = no choice
  assert.deepEqual(await readPreferences(fs, ENV), {}) // dropped
})

test('writePreferences keeps a known theme and drops an unknown one (#725)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A], preferences: {} }) })
  await writePreferences({ theme: 'dark' }, fs, ENV)
  assert.deepEqual(await readPreferences(fs, ENV), { theme: 'dark' })
  await writePreferences({ theme: 'solarized' } as never, fs, ENV) // not in the known set
  assert.deepEqual(await readPreferences(fs, ENV), {}) // dropped, falls back to system
})

test('writePreferences keeps well-formed custom presets and drops malformed ones (#626)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A], preferences: {} }) })
  await writePreferences(
    {
      customPresets: [
        { id: 'a', label: '  Deep review  ', prompt: '  Audit this PR.  ' }, // trimmed
        { id: 'b', label: '', prompt: 'no label' }, // dropped (empty label)
        { id: 'c', label: 'no prompt', prompt: '  ' }, // dropped (empty prompt)
        { id: 'a', label: 'dup id', prompt: 'x' }, // dropped (duplicate id)
        { label: 'no id', prompt: 'x' }, // dropped (missing id)
        'nonsense', // dropped (not an object)
      ],
    } as never,
    fs,
    ENV,
  )
  assert.deepEqual(await readPreferences(fs, ENV), {
    customPresets: [{ id: 'a', label: 'Deep review', prompt: 'Audit this PR.' }],
  })
})

test('writePreferences omits customPresets entirely when none survive (#626)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A], preferences: {} }) })
  await writePreferences({ customPresets: [{ id: '', label: 'x', prompt: 'y' }] } as never, fs, ENV)
  assert.deepEqual(await readPreferences(fs, ENV), {}) // empty list -> field left off
})

test('addProject preserves existing preferences', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A], preferences: { bridge: false } }) })
  await addProject('/repos/app-b', APP_B.addedAt, fs, ENV)
  assert.deepEqual(JSON.parse(fs.files.get(FILE)!), {
    projects: [APP_A, APP_B],
    preferences: { bridge: false },
  })
})

test('registryPreferencesStore round-trips through the same file', async () => {
  const fs = memFs()
  const store = registryPreferencesStore(fs, ENV)
  assert.deepEqual(await store.read(), {})
  await store.save({ bridge: true })
  assert.deepEqual(await store.read(), { bridge: true })
})

test('registryPreferencesStore tells its listener which keys were written (#1161)', async () => {
  // The daemon launches or closes the bridge browser only on the write that switched it, so it
  // needs the caller's own keys — the merged result would say "on" every time anything else was
  // saved while it was on.
  const fs = memFs()
  const written: Preferences[] = []
  const store = registryPreferencesStore(fs, ENV, patch => written.push(patch))
  await store.save({ notifyNewActivity: true })
  await store.patch?.({ bridge: true })
  assert.deepEqual(written, [{ notifyNewActivity: true }, { bridge: true }])
  // The patch still merged, so the listener's narrower view is not the stored one.
  assert.deepEqual(await store.read(), { notifyNewActivity: true, bridge: true })
})

test('a preferences listener that throws does not fail the write (#1161)', async () => {
  // The write already landed; a listener must not be able to report otherwise.
  const fs = memFs()
  const store = registryPreferencesStore(fs, ENV, () => {
    throw new Error('the daemon is mid-shutdown')
  })
  await store.save({ notifyNewActivity: true })
  assert.deepEqual(await store.read(), { notifyNewActivity: true })
})

test('the registry file is never written in place, only renamed over (#991)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A], preferences: {} }) })
  await writePreferences({ bridge: true }, fs, ENV)
  assert.deepEqual(
    fs.written.filter(path => path === FILE),
    [],
    'the live file must only ever be replaced by a rename, so a reader sees the whole old or the whole new one',
  )
  assert.ok(fs.written.every(path => path.startsWith(`${FILE}.`) && path.endsWith('.tmp')))
  assert.deepEqual(await readRegistry(fs, ENV), {
    projects: [APP_A],
    preferences: { bridge: true },
  })
  assert.equal([...fs.files.keys()].length, 1, 'the temp file is renamed away, not left beside the real one')
})

test('a write that dies partway leaves the previous registry intact (#991)', async () => {
  const stored = JSON.stringify({ projects: [APP_A, APP_B], preferences: { bridge: false } })
  // The disk fills between the truncate and the flush. Whatever it truncated must not be the live file.
  const fs = memFs({ [FILE]: stored }, { failWritesTo: `${FILE}.${process.pid}.tmp` })
  await assert.rejects(() => writePreferences({ bridge: true }, fs, ENV), /ENOSPC/)
  assert.equal(fs.files.get(FILE), stored, 'the live file is untouched by a failed write')
  assert.deepEqual(await readRegistry(fs, ENV), {
    projects: [APP_A, APP_B],
    preferences: { bridge: false },
  })
})

test('concurrent addProject calls both survive rather than the later one dropping the earlier (#991)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [], preferences: {} }) }, { slow: true })
  await Promise.all([addProject('/repos/app-a', APP_A.addedAt, fs, ENV), addProject('/repos/app-b', APP_B.addedAt, fs, ENV)])
  assert.deepEqual(await listProjects(fs, ENV), [APP_A, APP_B])
})

test('a concurrent addProject and writePreferences do not drop each other (#991)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [], preferences: {} }) }, { slow: true })
  await Promise.all([addProject('/repos/app-a', APP_A.addedAt, fs, ENV), writePreferences({ bridge: true }, fs, ENV)])
  assert.deepEqual(await readRegistry(fs, ENV), {
    projects: [APP_A],
    preferences: { bridge: true },
  })
})

test('a rejected mutation does not wedge the queue for the next caller (#991)', async () => {
  const temp = `${FILE}.${process.pid}.tmp`
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [], preferences: {} }) }, { failWritesTo: temp })
  await assert.rejects(() => addProject('/repos/app-a', APP_A.addedAt, fs, ENV), /ENOSPC/)
  const healthy = memFs({ [FILE]: JSON.stringify({ projects: [], preferences: {} }) })
  await addProject('/repos/app-b', APP_B.addedAt, healthy, ENV)
  assert.deepEqual(await listProjects(healthy, ENV), [APP_B])
})


test('ensureDaemonToken generates a base64url token, persists it, and reuses it (#1051)', async () => {
  const fs = memFs()
  const first = await ensureDaemonToken(fs, ENV)
  assert.match(first, /^[A-Za-z0-9_-]+$/) // base64url: URL-safe, so it drops into ?token= unencoded
  assert.ok(first.length >= 43) // 32 random bytes as base64url
  // Persisted as a top-level field, never under preferences (never shipped to the browser bundle).
  const stored = JSON.parse(fs.files.get(FILE)!)
  assert.equal(stored.daemonToken, first)
  assert.equal(stored.preferences.daemonToken, undefined)
  // A second call reuses the persisted one rather than rotating it.
  assert.equal(await ensureDaemonToken(fs, ENV), first)
})

test('readDaemonToken returns undefined until one is generated, then the persisted token (#1051)', async () => {
  const fs = memFs()
  assert.equal(await readDaemonToken(fs, ENV), undefined)
  const token = await ensureDaemonToken(fs, ENV)
  assert.equal(await readDaemonToken(fs, ENV), token)
})

test('a non-string / empty daemonToken in a hand-edited file is dropped (#1051)', async () => {
  for (const bad of [42, '', null, {}]) {
    const fs = memFs({ [FILE]: JSON.stringify({ projects: [], preferences: {}, daemonToken: bad }) })
    assert.equal(await readDaemonToken(fs, ENV), undefined)
  }
})

test('the daemon token survives the other registry mutators (#1051)', async () => {
  const fs = memFs()
  const token = await ensureDaemonToken(fs, ENV)
  await addProject('/repos/app-a', APP_A.addedAt, fs, ENV)
  await writePreferences({ bridge: true }, fs, ENV)
  await patchPreferences({ theme: 'dark' }, fs, ENV)
  assert.equal(await readDaemonToken(fs, ENV), token)
})

test('two concurrent first-binds settle on one shared token, not two (#1051)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [], preferences: {} }) }, { slow: true })
  const [a, b] = await Promise.all([ensureDaemonToken(fs, ENV), ensureDaemonToken(fs, ENV)])
  assert.equal(a, b)
})

test('the registry file is written owner-only, and the mode is set before the rename (#1095)', async () => {
  const fs = memFs()
  await ensureDaemonToken(fs, ENV)

  assert.equal(fs.modes.get(FILE), REGISTRY_FILE_MODE)
  // The temp file carried the mode across the rename, so the real path was never world-readable.
  assert.deepEqual([...fs.modes.keys()], [FILE])
})

test('a filesystem with no chmod still writes the registry (#1095)', async () => {
  const fs = memFs()
  const { chmod: _dropped, ...noChmod } = fs
  const token = await ensureDaemonToken(noChmod, ENV)

  assert.equal(await readDaemonToken(noChmod, ENV), token)
})

const STUDIO = 'http://192.168.1.5:4200'

test('addMachine saves a machine with its key, newest first, named by its host when no name is given', async () => {
  const fs = memFs()
  const saved = await addMachine({ url: STUDIO, token: 'aaa' }, fs, ENV)
  assert.deepEqual(saved, { id: STUDIO, label: '192.168.1.5:4200', url: STUDIO, token: 'aaa' })
  await addMachine({ url: 'http://10.0.0.2:4200', token: 'bbb', label: '  Office  ' }, fs, ENV)
  assert.deepEqual((await listMachines(fs, ENV)).map(machine => machine.label), ['Office', '192.168.1.5:4200'])
  // The file itself holds the list, top-level, beside the projects and the preferences.
  const stored = JSON.parse(fs.files.get(FILE)!)
  assert.equal(stored.machines.length, 2)
  assert.equal(stored.preferences.machines, undefined)
})

test('saving an address again replaces its name and its key and keeps one entry', async () => {
  const fs = memFs()
  await addMachine({ url: STUDIO, token: 'old', label: 'Studio' }, fs, ENV)
  await addMachine({ url: STUDIO, token: 'new', label: 'Studio 2' }, fs, ENV)
  assert.deepEqual(await listMachines(fs, ENV), [{ id: STUDIO, label: 'Studio 2', url: STUDIO, token: 'new' }])
})

test('removeMachine takes one machine off the list and says whether it was there', async () => {
  const fs = memFs()
  await addMachine({ url: STUDIO, token: 'aaa' }, fs, ENV)
  await addMachine({ url: 'http://10.0.0.2:4200', token: 'bbb' }, fs, ENV)
  assert.equal(await removeMachine(STUDIO, fs, ENV), true)
  assert.deepEqual((await listMachines(fs, ENV)).map(machine => machine.id), ['http://10.0.0.2:4200'])
  assert.equal(await removeMachine(STUDIO, fs, ENV), false)
})

test('a hand-edited machines list keeps only well-formed entries, one per address', async () => {
  const machines = [
    { label: 'Studio', url: STUDIO, token: 'aaa' },
    { label: 'Twice', url: STUDIO, token: 'zzz' },
    { label: 'No key', url: 'http://10.0.0.2:4200', token: '' },
    { label: 7, url: 'http://10.0.0.3:4200', token: 'ccc' },
    'junk',
  ]
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [], preferences: {}, machines }) })
  assert.deepEqual(await listMachines(fs, ENV), [{ id: STUDIO, label: 'Studio', url: STUDIO, token: 'aaa' }])
  assert.deepEqual(await listMachines(memFs({ [FILE]: JSON.stringify({ projects: [], preferences: {}, machines: 'x' }) }), ENV), [])
})

test('the saved machines survive the other registry mutators, and an emptied list is not written', async () => {
  const fs = memFs()
  await addProject('/repos/alpha', '2026-10-11T00:00:00.000Z', fs, ENV)
  await writePreferences({ model: 'opus' }, fs, ENV)
  const token = await ensureDaemonToken(fs, ENV)
  await addMachine({ url: STUDIO, token: 'aaa' }, fs, ENV)
  await addProject('/repos/beta', '2026-10-11T00:00:00.000Z', fs, ENV)
  await patchPreferences({ theme: 'dark' }, fs, ENV)
  const registry = await readRegistry(fs, ENV)
  assert.equal(registry.machines?.length, 1)
  assert.equal(registry.projects.length, 2)
  assert.deepEqual(registry.preferences, { model: 'opus', theme: 'dark' })
  assert.equal(registry.daemonToken, token)
  await removeMachine(STUDIO, fs, ENV)
  assert.equal(fs.files.get(FILE)!.includes('machines'), false) // an empty list is not written
})

test('the preferences the browser is handed never carry the saved machines', async () => {
  const fs = memFs()
  await addMachine({ url: STUDIO, token: 'aaa' }, fs, ENV)
  assert.equal(JSON.stringify(await readPreferences(fs, ENV)).includes('aaa'), false)
})
