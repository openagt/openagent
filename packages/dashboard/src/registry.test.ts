import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import { computerName } from './computer-name.js'
import {
  addMachine,
  machineNamed,
  nameMachine,
  noteSeen,
  noteServer,
  noteProjects,
  noteName,
  renameThisComputer,
  thisComputerName,
  addProject,
  addRepoFolder,
  listRepoFolders,
  ensureBridgeToken,
  ensureComputerId,
  listMachines,
  listProjects,
  projectId,
  readBridgeToken,
  readPreferences,
  removeMachine,
  removeProject,
  tellMachine,
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
  forgetMachine,
  listForgotten,
  unforgetMachine,
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
  assert.deepEqual(await listProjects(ENV, memFs()), [])
})

test('listProjects on an empty / malformed / non-array file is []', async () => {
  for (const raw of ['', 'not json', '{"id":"x"}', '42']) {
    assert.deepEqual(await listProjects(ENV, memFs({ [FILE]: raw })), [])
  }
})

test('a read of the registry never fails, whatever the disk does or the file holds: its callers do not guard it', async () => {
  const unreadable: RegistryFs = {
    ...memFs(),
    read: async () => {
      throw new Error('EACCES: permission denied')
    },
  }
  assert.deepEqual(await readRegistry(ENV, unreadable), { projects: [], preferences: {} })
  assert.deepEqual(await readPreferences(ENV, unreadable), {})
  assert.deepEqual(await listMachines(ENV, unreadable), [])
  assert.equal(await readBridgeToken(ENV, unreadable), undefined)
  assert.equal(await thisComputerName(ENV, unreadable), computerName())
  // Every field of the wrong shape, as a hand edit could leave it.
  const junk = { projects: [1, null, {}], preferences: { model: 3, startFrom: [1], overviewLayouts: 'x', customPresets: {} }, machines: [null, 5, { label: 1 }], forgotten: 'x', repoFolders: [3], computer: {}, name: [] }
  assert.deepEqual(await readRegistry(ENV, memFs({ [FILE]: JSON.stringify(junk) })), { projects: [], preferences: {} })
})

test('listProjects round-trips a well-formed file and drops malformed records', async () => {
  const raw = JSON.stringify({ projects: [APP_A, { id: 'no-path' }, 'nope', APP_B], preferences: {} })
  assert.deepEqual(await listProjects(ENV, memFs({ [FILE]: raw })), [APP_A, APP_B])
})

test('listProjects dedupes by resolved path, first wins', async () => {
  const dupe = { ...APP_B, path: '/repos/app-a/', addedAt: '2026-07-10T11:00:00.000Z' }
  const raw = JSON.stringify({ projects: [APP_A, dupe, APP_B], preferences: {} })
  assert.deepEqual(await listProjects(ENV, memFs({ [FILE]: raw })), [APP_A, APP_B])
})

test('addProject appends a record and writes pretty JSON that parses back', async () => {
  const fs = memFs()
  const record = await addProject('/repos/app-a', APP_A.addedAt, ENV, fs)
  assert.deepEqual(record, APP_A)
  assert.deepEqual(fs.dirs, ['/home/u']) // the single dotfile's parent is $HOME itself
  assert.deepEqual(JSON.parse(fs.files.get(FILE)!), { projects: [APP_A], preferences: {} })

  await addProject('/repos/app-b', APP_B.addedAt, ENV, fs)
  assert.deepEqual(await listProjects(ENV, fs), [APP_A, APP_B])
})

test('removeProject takes one project off the list by its id, answers its record, and keeps the others and the preferences', async () => {
  const fs = memFs()
  await addProject('/repos/app-a', APP_A.addedAt, ENV, fs)
  await addProject('/repos/app-b', APP_B.addedAt, ENV, fs)
  await writePreferences({ model: 'opus' }, ENV, fs)

  assert.deepEqual(await removeProject(APP_A.id, ENV, fs), APP_A)
  assert.deepEqual(await listProjects(ENV, fs), [APP_B])
  assert.deepEqual(await readPreferences(ENV, fs), { model: 'opus' })

  // An id no project has changes nothing and says so.
  const before = fs.files.get(FILE)
  assert.equal(await removeProject('nope-123', ENV, fs), undefined)
  assert.equal(fs.files.get(FILE), before)

  // Added again, the folder is the same project: the id is its path's.
  assert.equal((await addProject('/repos/app-a', '2027-01-01T00:00:00.000Z', ENV, fs)).id, APP_A.id)
})

test('addProject is idempotent by resolved path and keeps the original addedAt', async () => {
  const fs = memFs()
  await addProject('/repos/app-a', APP_A.addedAt, ENV, fs)
  for (const variant of ['/repos/app-a', '/repos/app-a/', '/repos/other/../app-a']) {
    const again = await addProject(variant, '2027-01-01T00:00:00.000Z', ENV, fs)
    assert.deepEqual(again, APP_A) // existing record, addedAt untouched
  }
  assert.deepEqual(JSON.parse(fs.files.get(FILE)!), { projects: [APP_A], preferences: {} })
})

test('addProject normalizes the stored path to an absolute one', async () => {
  const fs = memFs()
  const record = await addProject('/repos/app-a/', APP_A.addedAt, ENV, fs)
  assert.equal(record.path, '/repos/app-a')
})

// Preferences (#410): stored in the same file next to the project list.

test('readRegistry reads only the object form; a shape it no longer writes is an empty registry', async () => {
  // The bare `ProjectRecord[]` #410 replaced is read as nothing, like any other file this cannot
  // make sense of: with no users to carry, a second accepted shape is a permanent branch in the
  // one reader every surface goes through.
  const raw = JSON.stringify([APP_A, APP_B])
  assert.deepEqual(await readRegistry(ENV, memFs({ [FILE]: raw })), { projects: [], preferences: {} })
})

test('readRegistry reads the object form with preferences and drops unknown/non-boolean fields', async () => {
  const raw = JSON.stringify({
    projects: [APP_A],
    preferences: { bridge: true, notifyNewActivity: 'yes', bogus: 1, notifyBrowser: true, bridgeBrowser: true },
  })
  assert.deepEqual(await readRegistry(ENV, memFs({ [FILE]: raw })), {
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
    nameRuns: true,
    showThinking: true,
  }
  const fs = memFs()
  await writePreferences(allOn, ENV, fs)
  assert.deepEqual(await readPreferences(ENV, fs), allOn)
})

test('the Overview\'s layouts survive a save, kept only as well-formed', async () => {
  const stored = (preferences: Record<string, unknown>) => readPreferences(ENV, memFs({ [FILE]: JSON.stringify({ projects: [], preferences }) }))
  assert.deepEqual(await stored({ overviewLayouts: { '*': [{ id: 'usage', hidden: true }], p1: [{ id: 'summary', width: '1/2' }] } }), {
    overviewLayouts: { '*': [{ id: 'usage', hidden: true }], p1: [{ id: 'summary', width: '1/2' }] },
  })
  assert.deepEqual(await stored({ overviewLayouts: 'all' }), {}, 'junk is dropped')
  assert.deepEqual(await stored({ overviewLayouts: {} }), {}, 'no layout left: the key is left out')
})

test('sanitizePreferences reads only the current spellings', async () => {
  // A renamed key is an unknown key, and an unknown key is dropped — the same answer the sanitizer
  // gives junk. `driver` does not read the `agent` D5 renamed, nor the old name of Claude Code
  // (#1774: the names are agent-driver's own now), and the options only the daemon's own runner
  // read are gone: a stored file written before is rewritten by hand, not by code that would then
  // have to stay forever.
  const stored = (preferences: Record<string, unknown>) =>
    readPreferences(ENV, memFs({ [FILE]: JSON.stringify({ projects: [], preferences }) }))
  assert.deepEqual(await stored({ handoff: 'local', vanilla: true, transparent: true, browser: true, target: 'actions', autoPm: true }), {})
  assert.deepEqual(await stored({ driver: 'claude' }), {})
  assert.deepEqual(await stored({ driver: 'claude-code' }), { driver: 'claude-code' })
  // The agent a run is on, by its id; the default agent is the absent entry, and a word that is no id is dropped.
  assert.deepEqual(await stored({ agent: 'reviewer' }), { agent: 'reviewer' })
  assert.deepEqual(await stored({ agent: ' social-media ' }), { agent: 'social-media' })
  assert.deepEqual(await stored({ agent: 'default' }), {})
  for (const off of ['', 'Not An Id', '../etc', 42, null]) assert.deepEqual(await stored({ agent: off }), {}, String(off))
  assert.deepEqual(await stored({ publish: 'merge' }), { publish: 'merge' })
  assert.deepEqual(await stored({ publish: 'nothing' }), { publish: 'nothing' })
  assert.deepEqual(await stored({ publish: 'push' }), {}, 'a word the launcher\'s menu does not list is dropped')
  // Where an agent starts, per project: the local branch or a branch of origin's, the main branch is the absent entry.
  const local = { kind: 'local' }
  const published = { kind: 'published', branch: 'local' }
  assert.deepEqual(await stored({ startFrom: { 'app-1a2b': local, 'web-3c4d': 'main', '': local, 'api-5e6f': true } }), { startFrom: { 'app-1a2b': local } })
  assert.deepEqual(await stored({ startFrom: { 'app-1a2b': published, 'web-3c4d': local } }), { startFrom: { 'app-1a2b': published, 'web-3c4d': local } }, 'a branch literally named local is no local pick')
  assert.deepEqual(await stored({ startFrom: { 'app-1a2b': 'local' } }), {}, 'a bare word is no pick')
  assert.deepEqual(await stored({ startFrom: { a: { kind: 'published' }, b: { kind: 'published', branch: '--upload-pack=x' }, c: { kind: 'published', branch: 'a b' }, d: { kind: 'main' } } }), {}, 'a pick names a branch')
  assert.deepEqual(await stored({ startFrom: {} }), {}, 'no project left: the key is left out')
  assert.deepEqual(await stored({ startFrom: ['app-1a2b'] }), {})
  assert.deepEqual(await stored({ startFrom: 'local' }), {})
  const many = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`p-${i}`, local]))
  assert.equal(Object.keys((await stored({ startFrom: many })).startFrom ?? {}).length, 200, 'bounded, like the presets')
  // Where a run goes: a saved machine by its id, its address; this machine is the absent entry.
  assert.deepEqual(await stored({ runOn: ' https://165.245.244.10 ' }), { runOn: 'https://165.245.244.10' })
  assert.deepEqual(await stored({ runOn: 'http://127.0.0.1:4300/_devices/via/c1' }), { runOn: 'http://127.0.0.1:4300/_devices/via/c1' })
  for (const off of ['', 'This machine', 'javascript:alert(1)', 'https://a b', 42, null, `https://${'a'.repeat(2048)}`]) assert.deepEqual(await stored({ runOn: off }), {}, String(off))
})

test('the sidebar\'s order keeps only the orders it offers; the default, by creation, is stored as nothing', async () => {
  const stored = (preferences: Record<string, unknown>) =>
    readPreferences(ENV, memFs({ [FILE]: JSON.stringify({ projects: [], preferences }) }))
  assert.deepEqual(await stored({ recentsSort: 'updated' }), { recentsSort: 'updated' })
  assert.deepEqual(await stored({ recentsSort: 'name' }), { recentsSort: 'name' })
  assert.deepEqual(await stored({ recentsSort: 'created' }), {})
  assert.deepEqual(await stored({ recentsSort: 'random' }), {})
})

test('patchPreferences merges only the keys it is given (#1148)', async () => {
  // The dashboard used to send its whole cached object, so a tab that had been open since before
  // someone else's change wrote the old value back over it. A patch touches only what it names.
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [], preferences: { theme: 'dark', driver: 'codex' } }) })

  const stored = await patchPreferences({ notifyBrowser: true }, ENV, fs)

  assert.deepEqual(stored, { theme: 'dark', driver: 'codex', notifyBrowser: true })
  assert.deepEqual(await readPreferences(ENV, fs), stored)
})

test('a patched key still clears the way it always has (#1148)', async () => {
  // No sentinel for "remove": the sanitizer already drops blanks and empty lists, which is how
  // the dashboard clears the editor and the last custom preset.
  const seed = { projects: [], preferences: { editor: 'code', theme: 'dark', customPresets: [{ id: 'a', label: 'A', prompt: 'p' }] } }
  const fs = memFs({ [FILE]: JSON.stringify(seed) })

  assert.deepEqual(await patchPreferences({ editor: '' }, ENV, fs), {
    theme: 'dark',
    customPresets: [{ id: 'a', label: 'A', prompt: 'p' }],
  })
  assert.deepEqual(await patchPreferences({ customPresets: [] }, ENV, fs), { theme: 'dark' })
})

test('patchPreferences sanitizes the merged result, not just the patch (#1148)', async () => {
  // The one rule, applied once to the merge: an unknown key never lands, and a value outside the
  // known set drops the key rather than being stored — the same answer `writePreferences` gives.
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [], preferences: { theme: 'dark', driver: 'codex' } }) })
  assert.deepEqual(await patchPreferences({ theme: 'moon', bogus: 3 } as never, ENV, fs), { driver: 'codex' })
})

test('the preferences store exposes the patch the dashboard writes through (#1148)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A], preferences: { theme: 'dark' } }) })
  const store = registryPreferencesStore(ENV, undefined, fs)

  assert.deepEqual(await store.patch!({ driver: 'codex' }), { theme: 'dark', driver: 'codex' })
})

test('readPreferences on a missing file, or one with no preferences block, is {}', async () => {
  assert.deepEqual(await readPreferences(ENV, memFs()), {})
  assert.deepEqual(await readPreferences(ENV, memFs({ [FILE]: JSON.stringify({ projects: [APP_A] }) })), {})
})

test('writePreferences persists sanitized prefs and preserves the project list', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A, APP_B], preferences: {} }) })
  await writePreferences({ bridge: false, bridgeBrowser: true, bogus: 3 } as never, ENV, fs)
  assert.deepEqual(JSON.parse(fs.files.get(FILE)!), {
    projects: [APP_A, APP_B],
    preferences: { bridge: false, bridgeBrowser: true },
  })
  // The project list still reads back unchanged.
  assert.deepEqual(await listProjects(ENV, fs), [APP_A, APP_B])
})

test('writePreferences round-trips the notifyNewActivity toggle (#627)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A], preferences: {} }) })
  await writePreferences({ notifyNewActivity: true }, ENV, fs)
  assert.deepEqual(await readPreferences(ENV, fs), { notifyNewActivity: true })
})

test('writePreferences round-trips the notifyHumanIntervention toggle (#627)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A], preferences: {} }) })
  // Default is on, so the persisted value that matters is the explicit opt-out.
  await writePreferences({ notifyHumanIntervention: false }, ENV, fs)
  assert.deepEqual(await readPreferences(ENV, fs), { notifyHumanIntervention: false })
})

test('writePreferences keeps the model string but drops a blank one (#628)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A], preferences: {} }) })
  await writePreferences({ model: '  opus  ' }, ENV, fs)
  assert.deepEqual(await readPreferences(ENV, fs), { model: 'opus' }) // trimmed
  await writePreferences({ model: '   ' }, ENV, fs)
  assert.deepEqual(await readPreferences(ENV, fs), {}) // blank -> no choice, dropped
})

test('the word "Default" is not a model, however a file came to hold it (#1143)', async () => {
  // It was a picker label whose stored value was empty. A file carrying it as the *value* would
  // otherwise reach the CLI as `--model Default` and fail the turn on a word nobody chose.
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A], preferences: {} }) })
  await writePreferences({ model: 'opus' }, ENV, fs)
  await writePreferences({ model: 'Default' }, ENV, fs)
  assert.deepEqual(await readPreferences(ENV, fs), {})
  await writePreferences({ model: ' default ' }, ENV, fs)
  assert.deepEqual(await readPreferences(ENV, fs), {})
})

test('writePreferences keeps a known agent and drops an unknown one (#650)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A], preferences: {} }) })
  await writePreferences({ driver: 'codex' }, ENV, fs)
  assert.deepEqual(await readPreferences(ENV, fs), { driver: 'codex' })
  await writePreferences({ driver: 'gpt-9000' } as never, ENV, fs) // not in the known set
  assert.deepEqual(await readPreferences(ENV, fs), {}) // dropped
})

test('writePreferences trims a preferred editor and drops a blank one (#727)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A], preferences: {} }) })
  await writePreferences({ editor: '  cursor  ' }, ENV, fs)
  assert.deepEqual(await readPreferences(ENV, fs), { editor: 'cursor' }) // trimmed
  await writePreferences({ editor: '   ' }, ENV, fs) // blank = no choice
  assert.deepEqual(await readPreferences(ENV, fs), {}) // dropped
})

test('writePreferences keeps a known theme and drops an unknown one (#725)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A], preferences: {} }) })
  await writePreferences({ theme: 'dark' }, ENV, fs)
  assert.deepEqual(await readPreferences(ENV, fs), { theme: 'dark' })
  await writePreferences({ theme: 'solarized' } as never, ENV, fs) // not in the known set
  assert.deepEqual(await readPreferences(ENV, fs), {}) // dropped, falls back to system
})

test('writePreferences keeps a known look, stores the default look as nothing, and drops an unknown one', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A], preferences: {} }) })
  await writePreferences({ palette: 'neutral', accent: 'blue', font: 'inter', codeFont: 'geist-mono', documentFont: 'app' }, ENV, fs)
  assert.deepEqual(await readPreferences(ENV, fs), { palette: 'neutral', accent: 'blue', font: 'inter', codeFont: 'geist-mono', documentFont: 'app' })
  await writePreferences({ palette: 'openagent', font: 'ibm-plex-sans', codeFont: 'jetbrains-mono', documentFont: 'source-serif-4' }, ENV, fs)
  assert.deepEqual(await readPreferences(ENV, fs), {})
  await writePreferences({ palette: 'solarized', accent: 'beige', font: 'comic', codeFont: 'toString', documentFont: 'constructor' } as never, ENV, fs)
  assert.deepEqual(await readPreferences(ENV, fs), {})  // A primary colour is kept only with the palette it belongs to.
  await writePreferences({ accent: 'aqua' }, ENV, fs)
  assert.deepEqual(await readPreferences(ENV, fs), { accent: 'aqua' })
  await writePreferences({ accent: 'blue' }, ENV, fs)
  assert.deepEqual(await readPreferences(ENV, fs), {})
  await writePreferences({ palette: 'neutral', accent: 'aqua' }, ENV, fs)
  assert.deepEqual(await readPreferences(ENV, fs), { palette: 'neutral' })
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
    ENV,
    fs,
  )
  assert.deepEqual(await readPreferences(ENV, fs), {
    customPresets: [{ id: 'a', label: 'Deep review', prompt: 'Audit this PR.' }],
  })
})

test('writePreferences omits customPresets entirely when none survive (#626)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A], preferences: {} }) })
  await writePreferences({ customPresets: [{ id: '', label: 'x', prompt: 'y' }] } as never, ENV, fs)
  assert.deepEqual(await readPreferences(ENV, fs), {}) // empty list -> field left off
})

test('addProject preserves existing preferences', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A], preferences: { bridge: false } }) })
  await addProject('/repos/app-b', APP_B.addedAt, ENV, fs)
  assert.deepEqual(JSON.parse(fs.files.get(FILE)!), {
    projects: [APP_A, APP_B],
    preferences: { bridge: false },
  })
})

test('registryPreferencesStore round-trips through the same file', async () => {
  const fs = memFs()
  const store = registryPreferencesStore(ENV, undefined, fs)
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
  const store = registryPreferencesStore(ENV, patch => written.push(patch), fs)
  await store.save({ notifyNewActivity: true })
  await store.patch?.({ bridge: true })
  assert.deepEqual(written, [{ notifyNewActivity: true }, { bridge: true }])
  // The patch still merged, so the listener's narrower view is not the stored one.
  assert.deepEqual(await store.read(), { notifyNewActivity: true, bridge: true })
})

test('a preferences listener that throws does not fail the write (#1161)', async () => {
  // The write already landed; a listener must not be able to report otherwise.
  const fs = memFs()
  const store = registryPreferencesStore(
    ENV,
    () => {
      throw new Error('the daemon is mid-shutdown')
    },
    fs,
  )
  await store.save({ notifyNewActivity: true })
  assert.deepEqual(await store.read(), { notifyNewActivity: true })
})

test('the registry file is never written in place, only renamed over (#991)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A], preferences: {} }) })
  await writePreferences({ bridge: true }, ENV, fs)
  assert.deepEqual(
    fs.written.filter(path => path === FILE),
    [],
    'the live file must only ever be replaced by a rename, so a reader sees the whole old or the whole new one',
  )
  assert.ok(fs.written.every(path => path.startsWith(`${FILE}.`) && path.endsWith('.tmp')))
  assert.deepEqual(await readRegistry(ENV, fs), {
    projects: [APP_A],
    preferences: { bridge: true },
  })
  assert.equal([...fs.files.keys()].length, 1, 'the temp file is renamed away, not left beside the real one')
})

test('a write that dies partway leaves the previous registry intact (#991)', async () => {
  const stored = JSON.stringify({ projects: [APP_A, APP_B], preferences: { bridge: false } })
  // The disk fills between the truncate and the flush. Whatever it truncated must not be the live file.
  const fs = memFs({ [FILE]: stored }, { failWritesTo: `${FILE}.${process.pid}.tmp` })
  await assert.rejects(() => writePreferences({ bridge: true }, ENV, fs), /ENOSPC/)
  assert.equal(fs.files.get(FILE), stored, 'the live file is untouched by a failed write')
  assert.deepEqual(await readRegistry(ENV, fs), {
    projects: [APP_A, APP_B],
    preferences: { bridge: false },
  })
})

test('concurrent addProject calls both survive rather than the later one dropping the earlier (#991)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [], preferences: {} }) }, { slow: true })
  await Promise.all([addProject('/repos/app-a', APP_A.addedAt, ENV, fs), addProject('/repos/app-b', APP_B.addedAt, ENV, fs)])
  assert.deepEqual(await listProjects(ENV, fs), [APP_A, APP_B])
})

test('a concurrent addProject and writePreferences do not drop each other (#991)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [], preferences: {} }) }, { slow: true })
  await Promise.all([addProject('/repos/app-a', APP_A.addedAt, ENV, fs), writePreferences({ bridge: true }, ENV, fs)])
  assert.deepEqual(await readRegistry(ENV, fs), {
    projects: [APP_A],
    preferences: { bridge: true },
  })
})

test('a rejected mutation does not wedge the queue for the next caller (#991)', async () => {
  const temp = `${FILE}.${process.pid}.tmp`
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [], preferences: {} }) }, { failWritesTo: temp })
  await assert.rejects(() => addProject('/repos/app-a', APP_A.addedAt, ENV, fs), /ENOSPC/)
  const healthy = memFs({ [FILE]: JSON.stringify({ projects: [], preferences: {} }) })
  await addProject('/repos/app-b', APP_B.addedAt, ENV, healthy)
  assert.deepEqual(await listProjects(ENV, healthy), [APP_B])
})


test('ensureBridgeToken generates a base64url token, persists it, and reuses it (#1237)', async () => {
  const fs = memFs()
  const first = await ensureBridgeToken(ENV, fs)
  assert.match(first, /^[A-Za-z0-9_-]+$/) // base64url
  assert.ok(first.length >= 43) // 32 random bytes as base64url
  // Persisted as a top-level field, never under preferences (never shipped to the browser bundle).
  const stored = JSON.parse(fs.files.get(FILE)!)
  assert.equal(stored.bridgeToken, first)
  assert.equal(stored.preferences.bridgeToken, undefined)
  // A second call reuses the persisted one rather than rotating it.
  assert.equal(await ensureBridgeToken(ENV, fs), first)
})

test('which computer this is is a word made once and kept, beside the projects and the machines; what is no such word in the file is not read as one', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [], preferences: { theme: 'dark' }, bridgeToken: 'kept' }) })
  const first = await ensureComputerId(ENV, fs)
  assert.match(first, /^[a-f0-9]{32}$/)
  const stored = JSON.parse(fs.files.get(FILE)!)
  // Top-level, never among the preferences a browser is handed; what the file held stays.
  assert.equal(stored.computer, first)
  assert.equal(stored.preferences.computer, undefined)
  assert.equal(stored.bridgeToken, 'kept')
  assert.equal(await ensureComputerId(ENV, fs), first)
  // Asked for twice at once on a new home: one word, not two.
  const fresh = memFs()
  const [a, b] = await Promise.all([ensureComputerId(ENV, fresh), ensureComputerId(ENV, fresh)])
  assert.equal(a, b)
  for (const bad of [42, '', 'short', 'A'.repeat(32), `${'a'.repeat(31)};`, null]) {
    const edited = memFs({ [FILE]: JSON.stringify({ projects: [], preferences: {}, computer: bad }) })
    assert.match(await ensureComputerId(ENV, edited), /^[a-f0-9]{32}$/)
  }
})

test('readBridgeToken returns undefined until one is generated, then the persisted token (#1237)', async () => {
  const fs = memFs()
  assert.equal(await readBridgeToken(ENV, fs), undefined)
  const token = await ensureBridgeToken(ENV, fs)
  assert.equal(await readBridgeToken(ENV, fs), token)
})

test('a non-string / empty bridgeToken in a hand-edited file is dropped (#1237)', async () => {
  for (const bad of [42, '', null, {}]) {
    const fs = memFs({ [FILE]: JSON.stringify({ projects: [], preferences: {}, bridgeToken: bad }) })
    assert.equal(await readBridgeToken(ENV, fs), undefined)
  }
})

test('the bridge token survives the other registry mutators (#1237)', async () => {
  const fs = memFs()
  const token = await ensureBridgeToken(ENV, fs)
  await addProject('/repos/app-a', APP_A.addedAt, ENV, fs)
  await writePreferences({ bridge: true }, ENV, fs)
  await patchPreferences({ theme: 'dark' }, ENV, fs)
  assert.equal(await readBridgeToken(ENV, fs), token)
})

test('two concurrent first starts settle on one bridge token, not two (#1237)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [], preferences: {} }) }, { slow: true })
  const [a, b] = await Promise.all([ensureBridgeToken(ENV, fs), ensureBridgeToken(ENV, fs)])
  assert.equal(a, b)
})

test('the registry file is written owner-only, and the mode is set before the rename (#1095)', async () => {
  const fs = memFs()
  await ensureBridgeToken(ENV, fs)

  assert.equal(fs.modes.get(FILE), REGISTRY_FILE_MODE)
  // The temp file carried the mode across the rename, so the real path was never world-readable.
  assert.deepEqual([...fs.modes.keys()], [FILE])
})

test('a filesystem that cannot narrow a mode still writes the registry (#1095)', async () => {
  const fs = memFs()
  const noModes: RegistryFs = {
    ...fs,
    chmod: async () => {
      throw new Error('EPERM: the volume keeps no permission bits')
    },
  }
  const token = await ensureBridgeToken(ENV, noModes)

  assert.equal(await readBridgeToken(ENV, noModes), token)
})

const STUDIO = 'http://192.168.1.5:4201'
const DOOR = `${STUDIO}/_devices/enter`
const OFFICE = 'http://10.0.0.2:4201'

test('addMachine saves a machine with its key, newest first, named by its host when no name is given', async () => {
  const fs = memFs()
  const before = Date.now()
  const saved = await addMachine({ url: STUDIO, key: 'aaa', door: DOOR }, ENV, fs)
  const { added, ...record } = saved.record
  assert.deepEqual({ record, displaced: saved.displaced }, { record: { id: STUDIO, label: '192.168.1.5:4201', url: STUDIO, key: 'aaa', door: DOOR }, displaced: [] })
  // When it was saved here: what a removal on another of the person's computers is weighed against.
  assert.ok(Date.parse(added!) >= before - 1000)
  await addMachine({ url: OFFICE, key: 'bbb', door: `${OFFICE}/_devices/enter`, label: '  Office  ' }, ENV, fs)
  assert.deepEqual((await listMachines(ENV, fs)).map(machine => machine.label), ['Office', '192.168.1.5:4201'])
  // The file itself holds the list, top-level, beside the projects and the preferences.
  const stored = JSON.parse(fs.files.get(FILE)!)
  assert.equal(stored.machines.length, 2)
  assert.equal(stored.preferences.machines, undefined)
})

test('saving an address again replaces its name and its key and keeps one entry', async () => {
  const fs = memFs()
  const first = await addMachine({ url: STUDIO, key: 'old', door: DOOR, label: 'Studio' }, ENV, fs)
  const added = first.record.added!
  await new Promise(resolve => setTimeout(resolve, 5))
  const again = await addMachine({ url: STUDIO, key: 'new', door: DOOR, label: 'Studio 2' }, ENV, fs)
  // Saved again with a new key, it was saved here since the first time all the same.
  assert.deepEqual(await listMachines(ENV, fs), [{ id: STUDIO, label: 'Studio 2', url: STUDIO, key: 'new', door: DOOR, added }])
  // The record it took the place of is answered: its key is the caller's to take out of the machine.
  assert.deepEqual(again.displaced, [{ id: STUDIO, label: 'Studio', url: STUDIO, key: 'old', door: DOOR, added }])
})

test('a machine saved past the cap takes the place of the oldest, which is answered too', async () => {
  const fs = memFs()
  for (let i = 0; i < 50; i++) await addMachine({ url: `http://10.1.0.${i}:4201`, key: `k${i}`, door: `http://10.1.0.${i}:4201/_devices/enter` }, ENV, fs)
  const over = await addMachine({ url: STUDIO, key: 'aaa', door: DOOR }, ENV, fs)
  assert.deepEqual(over.displaced.map(machine => machine.key), ['k0'])
  assert.equal((await listMachines(ENV, fs)).length, 50)
})

test('removeMachine takes one machine off the list and answers the one that was there', async () => {
  const fs = memFs()
  await addMachine({ url: STUDIO, key: 'aaa', door: DOOR }, ENV, fs)
  await addMachine({ url: OFFICE, key: 'bbb', door: `${OFFICE}/_devices/enter` }, ENV, fs)
  const { added: _added, ...removed } = (await removeMachine(STUDIO, ENV, fs))!
  assert.deepEqual(removed, { id: STUDIO, label: '192.168.1.5:4201', url: STUDIO, key: 'aaa', door: DOOR })
  assert.deepEqual((await listMachines(ENV, fs)).map(machine => machine.id), [OFFICE])
  assert.equal(await removeMachine(STUDIO, ENV, fs), undefined)
})

test('what a server\'s key is known by is kept with the machine, and left out for a machine whose link named none', async () => {
  const fs = memFs()
  const server = { url: 'https://203.0.113.5', key: 'kkk', door: 'https://203.0.113.5/_devices/enter', pin: 'Zm9v' }
  const { added: _added, ...record } = (await addMachine(server, ENV, fs)).record
  assert.deepEqual(record, { id: server.url, label: '203.0.113.5', ...server })
  await addMachine({ url: STUDIO, key: 'aaa', door: DOOR }, ENV, fs)
  const [studio, saved] = await listMachines(ENV, fs)
  assert.equal(saved!.pin, 'Zm9v')
  assert.equal('pin' in studio!, false)
})

test('a hand-edited machines list keeps only well-formed entries, one per address', async () => {
  const machines = [
    { label: 'Studio', url: STUDIO, key: 'aaa', door: DOOR },
    { label: 'Twice', url: STUDIO, key: 'zzz', door: DOOR },
    { label: 'No key', url: OFFICE, key: '', door: DOOR },
    { label: 'No door', url: 'http://10.0.0.4:4201', key: 'ddd' },
    // What an OpenAgent that was opened with a shared key saved: it lets nobody in any more.
    { label: 'Shared key', url: 'http://10.0.0.5:4200', token: 'eee' },
    { label: 7, url: 'http://10.0.0.3:4201', key: 'ccc', door: DOOR },
    'junk',
  ]
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [], preferences: {}, machines }) })
  assert.deepEqual(await listMachines(ENV, fs), [{ id: STUDIO, label: 'Studio', url: STUDIO, key: 'aaa', door: DOOR }])
  assert.deepEqual(await listMachines(ENV, memFs({ [FILE]: JSON.stringify({ projects: [], preferences: {}, machines: 'x' }) })), [])
})

test('another person\'s computer is saved with whose it is, and that the person was told once; anything else under those names is left out', async () => {
  const fs = memFs()
  const line = 'http://127.0.0.1:4311'
  const saved = await addMachine({ url: line, key: 'line', door: `${line}/_devices/enter`, label: 'rom-desktop', owner: 'rom' }, ENV, fs)
  assert.equal(saved.record.owner, 'rom')
  assert.equal(saved.record.told, undefined)
  assert.equal(await tellMachine(line, ENV, fs), true)
  assert.equal(await tellMachine(line, ENV, fs), true, 'told twice is told')
  assert.equal(await tellMachine(STUDIO, ENV, fs), false, 'no such machine')
  const [kept] = await listMachines(ENV, fs)
  assert.equal(kept!.owner, 'rom')
  assert.equal(kept!.told, true)
  // Saved anew, it is told anew: the record is the new one.
  await addMachine({ url: line, key: 'line', door: `${line}/_devices/enter`, owner: 'Not an account!' }, ENV, fs)
  const [again] = await listMachines(ENV, fs)
  assert.equal('owner' in again!, false)
  assert.equal('told' in again!, false)
  const edited = memFs({ [FILE]: JSON.stringify({ projects: [], preferences: {}, machines: [{ label: 'x', url: STUDIO, key: 'k', door: DOOR, owner: '-x', told: 'yes' }] }) })
  assert.deepEqual(await listMachines(ENV, edited), [{ id: STUDIO, label: 'x', url: STUDIO, key: 'k', door: DOOR }])
})

test('the saved machines survive the other registry mutators, and an emptied list is not written', async () => {
  const fs = memFs()
  await addProject('/repos/alpha', '2026-10-11T00:00:00.000Z', ENV, fs)
  await writePreferences({ model: 'opus' }, ENV, fs)
  const token = await ensureBridgeToken(ENV, fs)
  await addMachine({ url: STUDIO, key: 'aaa', door: DOOR }, ENV, fs)
  await addProject('/repos/beta', '2026-10-11T00:00:00.000Z', ENV, fs)
  await patchPreferences({ theme: 'dark' }, ENV, fs)
  const registry = await readRegistry(ENV, fs)
  assert.equal(registry.machines?.length, 1)
  assert.equal(registry.projects.length, 2)
  assert.deepEqual(registry.preferences, { model: 'opus', theme: 'dark' })
  assert.equal(registry.bridgeToken, token)
  await removeMachine(STUDIO, ENV, fs)
  assert.equal(fs.files.get(FILE)!.includes('machines'), false) // an empty list is not written
})

test('the preferences the browser is handed never carry the saved machines', async () => {
  const fs = memFs()
  await addMachine({ url: STUDIO, key: 'aaa', door: DOOR }, ENV, fs)
  assert.equal(JSON.stringify(await readPreferences(ENV, fs)).includes('aaa'), false)
})

test("a machine's own computer name follows what it says, the old one kept for its earlier runs; a new link starts without one, and an answer to the old key does not name it", async () => {
  const fs = memFs()
  await addMachine({ url: STUDIO, key: 'aaa', door: DOOR, label: 'Studio' }, ENV, fs)
  const asked = { id: STUDIO, key: 'aaa' }
  for (const none of ['', 'a'.repeat(254), 'This machine', '<b>x</b>']) assert.equal(await nameMachine(asked, none, ENV, fs), false, none.slice(0, 20))
  assert.equal(await nameMachine({ id: 'http://nowhere.local:1', key: 'aaa' }, 'studio-box', ENV, fs), false)
  assert.equal(await nameMachine(asked, 'studio-box', ENV, fs), true)
  assert.equal((await listMachines(ENV, fs))[0]!.host, 'studio-box')
  // Renamed: it goes by the new name, and the runs under its old one are still its. Back again, the name is not kept twice.
  assert.equal(await nameMachine(asked, 'renamed-box', ENV, fs), true)
  assert.deepEqual((await listMachines(ENV, fs)).map(m => [m.host, m.formerHosts]), [['renamed-box', ['studio-box']]])
  assert.equal(machineNamed(await listMachines(ENV, fs), 'studio-box')?.id, STUDIO)
  assert.equal(machineNamed(await listMachines(ENV, fs), 'renamed-box')?.id, STUDIO)
  assert.equal(machineNamed(await listMachines(ENV, fs), 'nobody'), undefined)
  assert.equal(await nameMachine(asked, 'renamed-box', ENV, fs), false)
  assert.equal(await nameMachine(asked, 'studio-box', ENV, fs), true)
  assert.deepEqual((await listMachines(ENV, fs)).map(m => [m.host, m.formerHosts]), [['studio-box', ['renamed-box']]])
  // Added again with a new link: it is asked its name anew, and an answer to the old key does not name it.
  await addMachine({ url: STUDIO, key: 'bbb', door: DOOR, label: 'Studio' }, ENV, fs)
  assert.equal((await listMachines(ENV, fs))[0]!.host, undefined)
  assert.equal(await nameMachine(asked, 'studio-box', ENV, fs), false)
  assert.equal(await nameMachine({ id: STUDIO, key: 'bbb' }, 'studio-box', ENV, fs), true)
})

test('a machine renamed does not get the runs of another saved machine, and another person\'s computer keeps the name it first said', async () => {
  const fs = memFs()
  const other = 'https://other.example'
  await addMachine({ url: STUDIO, key: 'aaa', door: DOOR, label: 'Studio' }, ENV, fs)
  await addMachine({ url: other, key: 'ccc', door: DOOR, label: 'Other' }, ENV, fs)
  assert.equal(await nameMachine({ id: STUDIO, key: 'aaa' }, 'studio-box', ENV, fs), true)
  assert.equal(await nameMachine({ id: other, key: 'ccc' }, 'other-box', ENV, fs), true)
  assert.equal(await nameMachine({ id: STUDIO, key: 'aaa' }, 'other-box', ENV, fs), false)
  assert.equal(await nameMachine({ id: other, key: 'ccc' }, 'other-new', ENV, fs), true)
  // The name it left is still its runs': another does not take it.
  assert.equal(await nameMachine({ id: STUDIO, key: 'aaa' }, 'other-box', ENV, fs), false)
  const dani = 'https://dani.example'
  await addMachine({ url: dani, key: 'ddd', door: DOOR, label: 'Dani', owner: 'Dani' }, ENV, fs)
  assert.equal(await nameMachine({ id: dani, key: 'ddd' }, 'dani-box', ENV, fs), true)
  assert.equal(await nameMachine({ id: dani, key: 'ddd' }, 'suleimans-mac', ENV, fs), false)
  assert.equal((await listMachines(ENV, fs)).find(m => m.id === dani)!.host, 'dani-box')
})

test('whether a machine is a server is kept, and changes with what it says, only for the machine as it was asked', async () => {
  const fs = memFs()
  await addMachine({ url: STUDIO, key: 'aaa', door: DOOR, label: 'Studio' }, ENV, fs)
  await noteServer({ id: STUDIO, key: 'old' }, true, ENV, fs)
  assert.equal((await listMachines(ENV, fs))[0]!.server, undefined)
  await noteServer({ id: STUDIO, key: 'aaa' }, true, ENV, fs)
  assert.equal((await listMachines(ENV, fs))[0]!.server, true)
  await noteServer({ id: STUDIO, key: 'aaa' }, false, ENV, fs)
  assert.equal((await listMachines(ENV, fs))[0]!.server, undefined)
})

test('when a machine last answered is kept to the minute, for while it does not answer, and only for the machine as it was asked', async () => {
  const fs = memFs()
  await addMachine({ url: STUDIO, key: 'aaa', door: DOOR, label: 'Studio' }, ENV, fs)
  const asked = { id: STUDIO, key: 'aaa' }
  await noteSeen(asked, '2026-10-25T10:00:00.000Z', ENV, fs)
  assert.equal((await listMachines(ENV, fs))[0]!.seenAt, '2026-10-25T10:00:00.000Z')
  // Within the minute the file is not written again.
  await noteSeen(asked, '2026-10-25T10:00:30.000Z', ENV, fs)
  assert.equal((await listMachines(ENV, fs))[0]!.seenAt, '2026-10-25T10:00:00.000Z')
  await noteSeen(asked, '2026-10-25T10:01:00.000Z', ENV, fs)
  assert.equal((await listMachines(ENV, fs))[0]!.seenAt, '2026-10-25T10:01:00.000Z')
  // An answer to a key the machine no longer has is not its.
  await noteSeen({ id: STUDIO, key: 'old' }, '2026-10-25T11:00:00.000Z', ENV, fs)
  assert.equal((await listMachines(ENV, fs))[0]!.seenAt, '2026-10-25T10:01:00.000Z')
})

test("what a machine said of its own projects is kept with it, read back as projects only, and only for the machine as it was asked", async () => {
  const fs = memFs()
  await addMachine({ url: STUDIO, key: 'aaa', door: DOOR, label: 'Studio' }, ENV, fs)
  const shop = { id: 'shop-1abc', name: 'shop', path: '/Users/me/shop', address: 'github.com/acme/shop', share: true, gitHost: true, activated: true }
  await noteProjects({ id: STUDIO, key: 'aaa' }, [shop], ENV, fs)
  assert.deepEqual((await listMachines(ENV, fs))[0]!.projects, [shop])
  // An answer to a key the machine no longer has is not its.
  await noteProjects({ id: STUDIO, key: 'old' }, [], ENV, fs)
  assert.deepEqual((await listMachines(ENV, fs))[0]!.projects, [shop])
  // What the file holds is read as projects: anything else in it is dropped.
  const file = JSON.parse(await fs.read(FILE))
  file.machines[0].projects.push({ id: '../x', name: 'x', path: '/x' }, 'nope')
  await fs.write(FILE, JSON.stringify(file))
  assert.deepEqual((await listMachines(ENV, fs))[0]!.projects, [shop])
})

test('a computer the person removed is remembered once by its address, the later removal standing; let go, it is no longer one; the file keeps it', async () => {
  const fs = memFs()
  await forgetMachine(STUDIO, '2026-10-27T10:00:00.000Z', ENV, fs)
  // An earlier removal of it, heard later, does not take the later one's place.
  await forgetMachine(STUDIO, '2026-10-26T10:00:00.000Z', ENV, fs)
  assert.deepEqual(await listForgotten(ENV, fs), [{ url: STUDIO, at: '2026-10-27T10:00:00.000Z' }])
  await forgetMachine(OFFICE, '2026-10-27T11:00:00.000Z', ENV, fs)
  await forgetMachine(STUDIO, '2026-10-28T10:00:00.000Z', ENV, fs)
  assert.deepEqual(await listForgotten(ENV, fs), [
    { url: OFFICE, at: '2026-10-27T11:00:00.000Z' },
    { url: STUDIO, at: '2026-10-28T10:00:00.000Z' },
  ])
  // Written whole: a write of anything else keeps it.
  await addMachine({ url: 'http://10.0.0.9:4201', key: 'k', door: 'http://10.0.0.9:4201/_devices/enter' }, ENV, fs)
  assert.equal((await listForgotten(ENV, fs)).length, 2)
  await unforgetMachine(STUDIO, ENV, fs)
  assert.deepEqual(await listForgotten(ENV, fs), [{ url: OFFICE, at: '2026-10-27T11:00:00.000Z' }])
  // What is no address or no time is not kept.
  fs.files.set(FILE, JSON.stringify({ projects: [], preferences: {}, forgotten: [{ url: 'javascript:x', at: '2026-10-27T11:00:00.000Z' }, { url: STUDIO, at: 'never' }, { url: OFFICE, at: '2026-10-27T11:00:00.000Z' }] }))
  assert.deepEqual(await listForgotten(ENV, fs), [{ url: OFFICE, at: '2026-10-27T11:00:00.000Z' }])
})

test('this computer is named by its host name until the person names it, kept cut to the length a name may have; any write keeps the name', async () => {
  const fs = memFs()
  assert.equal(await thisComputerName(ENV, fs), computerName())
  assert.equal(await renameThisComputer('  Studio\nMac  ', ENV, fs), 'Studio Mac')
  assert.equal(await thisComputerName(ENV, fs), 'Studio Mac')
  assert.equal(await renameThisComputer('   ', ENV, fs), undefined)
  assert.equal(await renameThisComputer('x'.repeat(100), ENV, fs), 'x'.repeat(60))
  // Written whole: a write of anything else keeps it.
  await addMachine({ url: STUDIO, key: 'aaa', door: DOOR, label: 'Studio' }, ENV, fs)
  assert.equal(await thisComputerName(ENV, fs), 'x'.repeat(60))
})

test('a saved machine keeps the name it says it has now, asked with the key it is saved with; a machine saved anew since keeps its own', async () => {
  const fs = memFs()
  await addMachine({ url: STUDIO, key: 'aaa', door: DOOR, label: 'Studio' }, ENV, fs)
  await noteName({ id: STUDIO, key: 'aaa' }, '  Studio Mac ', ENV, fs)
  assert.equal((await listMachines(ENV, fs))[0]!.label, 'Studio Mac')
  await noteName({ id: STUDIO, key: 'old' }, 'Old name', ENV, fs)
  await noteName({ id: STUDIO, key: 'aaa' }, '   ', ENV, fs)
  // The key and where it was let in stay.
  assert.deepEqual(
    (await listMachines(ENV, fs)).map(({ added: _added, ...machine }) => machine),
    [{ id: STUDIO, label: 'Studio Mac', url: STUDIO, key: 'aaa', door: DOOR }],
  )
})

test('the folders to look for repos in: added once each, absolute, and kept beside the projects', async () => {
  const fs = memFs()
  await addProject('/repos/app-a', APP_A.addedAt, ENV, fs)
  await addRepoFolder('/work/clients', ENV, fs)
  await addRepoFolder('/work/clients', ENV, fs)
  await addRepoFolder('/work/oss', ENV, fs)
  assert.deepEqual(await listRepoFolders(ENV, fs), ['/work/clients', '/work/oss'])
  assert.deepEqual(await listProjects(ENV, fs), [APP_A])
  // A hand-edited file keeps only absolute paths, each once.
  const raw = JSON.stringify({ projects: [], preferences: {}, repoFolders: ['/a', 'relative', 7, '/a', '/b'] })
  assert.deepEqual(await listRepoFolders(ENV, memFs({ [FILE]: raw })), ['/a', '/b'])
})
