import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import {
  readPreferences,
  readRegistry,
  registryPreferencesStore,
  registryPath,
  writePreferences,
  patchPreferences,
  REGISTRY_FILE,
  REGISTRY_FILE_MODE,
  type Preferences,
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

test('a read of the registry never fails, whatever the disk does or the file holds: its callers do not guard it', async () => {
  const unreadable: RegistryFs = {
    ...memFs(),
    read: async () => {
      throw new Error('EACCES: permission denied')
    },
  }
  assert.deepEqual(await readRegistry(ENV, unreadable), { preferences: {} })
  assert.deepEqual(await readPreferences(ENV, unreadable), {})
  // Every field of the wrong shape, as a hand edit could leave it.
  const junk = { preferences: { model: 3, startFrom: [1], overviewLayouts: 'x' } }
  assert.deepEqual(await readRegistry(ENV, memFs({ [FILE]: JSON.stringify(junk) })), { preferences: {} })
})

test('readRegistry reads only the object form; a shape it no longer writes is an empty registry', async () => {
  // A bare list, as the file once was, is read as nothing, like any other file this cannot make
  // sense of: with no users to carry, a second accepted shape is a permanent branch in the one
  // reader every surface goes through.
  const raw = JSON.stringify([{ nameRuns: false }])
  assert.deepEqual(await readRegistry(ENV, memFs({ [FILE]: raw })), { preferences: {} })
})

test('readRegistry reads the object form with preferences and drops unknown/non-boolean fields', async () => {
  const raw = JSON.stringify({
    preferences: { onboardingDismissed: true, nameRuns: 'yes', bogus: 1, showThinking: true },
  })
  assert.deepEqual(await readRegistry(ENV, memFs({ [FILE]: raw })), {
    preferences: { onboardingDismissed: true, showThinking: true }, // nameRuns (non-boolean) + bogus dropped
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
    onboardingDismissed: true,
    nameRuns: true,
    showThinking: true,
    recentsPerson: true,
    recentsAgent: true,
  }
  const fs = memFs()
  await writePreferences(allOn, ENV, fs)
  assert.deepEqual(await readPreferences(ENV, fs), allOn)
})

test('the Overview\'s layouts survive a save, kept only as well-formed', async () => {
  const stored = (preferences: Record<string, unknown>) => readPreferences(ENV, memFs({ [FILE]: JSON.stringify({ preferences }) }))
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
    readPreferences(ENV, memFs({ [FILE]: JSON.stringify({ preferences }) }))
  assert.deepEqual(await stored({ handoff: 'local', vanilla: true, transparent: true, browser: true, target: 'actions', autoPm: true }), {})
  assert.deepEqual(await stored({ driver: 'claude' }), {})
  assert.deepEqual(await stored({ driver: 'claude-code' }), { driver: 'claude-code' })
  // The profile a run is on, by its id; Default is the absent entry, and a word that is no id is dropped.
  assert.deepEqual(await stored({ profile: 'reviewer' }), { profile: 'reviewer' })
  assert.deepEqual(await stored({ profile: ' social-media ' }), { profile: 'social-media' })
  assert.deepEqual(await stored({ profile: 'default' }), {})
  for (const off of ['', 'Not An Id', '../etc', 42, null]) assert.deepEqual(await stored({ profile: off }), {}, String(off))
  assert.deepEqual(await stored({ agent: 'reviewer' }), {}, 'the agent it was on before profiles is no profile')
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
  assert.equal(Object.keys((await stored({ startFrom: many })).startFrom ?? {}).length, 200, 'bounded, like the profiles')
})

test('the sidebar\'s order keeps only the orders it offers; the default, by creation, is stored as nothing', async () => {
  const stored = (preferences: Record<string, unknown>) =>
    readPreferences(ENV, memFs({ [FILE]: JSON.stringify({ preferences }) }))
  assert.deepEqual(await stored({ recentsSort: 'updated' }), { recentsSort: 'updated' })
  assert.deepEqual(await stored({ recentsSort: 'name' }), { recentsSort: 'name' })
  assert.deepEqual(await stored({ recentsSort: 'created' }), {})
  assert.deepEqual(await stored({ recentsSort: 'random' }), {})
  // What the list's rows show, each a yes or no, and what it is grouped by, one list being stored as nothing.
  assert.deepEqual(await stored({ recentsPerson: true, recentsAgent: true, recentsGroup: 'day' }), { recentsPerson: true, recentsAgent: true, recentsGroup: 'day' })
  assert.deepEqual(await stored({ recentsPerson: false, recentsAgent: 'yes', recentsGroup: 'none' }), { recentsPerson: false })
  assert.deepEqual(await stored({ recentsGroup: 'project' }), { recentsGroup: 'project' })
})

test('patchPreferences merges only the keys it is given (#1148)', async () => {
  // The dashboard used to send its whole cached object, so a tab that had been open since before
  // someone else's change wrote the old value back over it. A patch touches only what it names.
  const fs = memFs({ [FILE]: JSON.stringify({ preferences: { theme: 'dark', driver: 'codex' } }) })

  const stored = await patchPreferences({ showThinking: true }, ENV, fs)

  assert.deepEqual(stored, { theme: 'dark', driver: 'codex', showThinking: true })
  assert.deepEqual(await readPreferences(ENV, fs), stored)
})

test('a patched key still clears the way it always has (#1148)', async () => {
  // No sentinel for "remove": the sanitizer already drops blanks, which is how the dashboard
  // clears the editor.
  const seed = { preferences: { editor: 'code', theme: 'dark' } }
  const fs = memFs({ [FILE]: JSON.stringify(seed) })

  assert.deepEqual(await patchPreferences({ editor: '' }, ENV, fs), { theme: 'dark' })
})

test('patchPreferences sanitizes the merged result, not just the patch (#1148)', async () => {
  // The one rule, applied once to the merge: an unknown key never lands, and a value outside the
  // known set drops the key rather than being stored — the same answer `writePreferences` gives.
  const fs = memFs({ [FILE]: JSON.stringify({ preferences: { theme: 'dark', driver: 'codex' } }) })
  assert.deepEqual(await patchPreferences({ theme: 'moon', bogus: 3 } as never, ENV, fs), { driver: 'codex' })
})

test('the preferences store exposes the patch the dashboard writes through (#1148)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ preferences: { theme: 'dark' } }) })
  const store = registryPreferencesStore(ENV, fs)

  assert.deepEqual(await store.patch!({ driver: 'codex' }), { theme: 'dark', driver: 'codex' })
})

test('readPreferences on a missing file, or one with no preferences block, is {}', async () => {
  assert.deepEqual(await readPreferences(ENV, memFs()), {})
  assert.deepEqual(await readPreferences(ENV, memFs({ [FILE]: JSON.stringify({ other: [1] }) })), {})
})

test('writePreferences persists sanitized prefs', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ preferences: {} }) })
  await writePreferences({ nameRuns: false, showThinking: true, bogus: 3 } as never, ENV, fs)
  assert.deepEqual(JSON.parse(fs.files.get(FILE)!), { preferences: { nameRuns: false, showThinking: true } })
})

test('writePreferences keeps the model string but drops a blank one (#628)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ preferences: {} }) })
  await writePreferences({ model: '  opus  ' }, ENV, fs)
  assert.deepEqual(await readPreferences(ENV, fs), { model: 'opus' }) // trimmed
  await writePreferences({ model: '   ' }, ENV, fs)
  assert.deepEqual(await readPreferences(ENV, fs), {}) // blank -> no choice, dropped
})

test('the word "Default" is not a model, however a file came to hold it (#1143)', async () => {
  // It was a picker label whose stored value was empty. A file carrying it as the *value* would
  // otherwise reach the CLI as `--model Default` and fail the turn on a word nobody chose.
  const fs = memFs({ [FILE]: JSON.stringify({ preferences: {} }) })
  await writePreferences({ model: 'opus' }, ENV, fs)
  await writePreferences({ model: 'Default' }, ENV, fs)
  assert.deepEqual(await readPreferences(ENV, fs), {})
  await writePreferences({ model: ' default ' }, ENV, fs)
  assert.deepEqual(await readPreferences(ENV, fs), {})
})

test('writePreferences keeps a known agent and drops an unknown one (#650)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ preferences: {} }) })
  await writePreferences({ driver: 'codex' }, ENV, fs)
  assert.deepEqual(await readPreferences(ENV, fs), { driver: 'codex' })
  await writePreferences({ driver: 'gpt-9000' } as never, ENV, fs) // not in the known set
  assert.deepEqual(await readPreferences(ENV, fs), {}) // dropped
})

test('writePreferences trims a preferred editor and drops a blank one (#727)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ preferences: {} }) })
  await writePreferences({ editor: '  cursor  ' }, ENV, fs)
  assert.deepEqual(await readPreferences(ENV, fs), { editor: 'cursor' }) // trimmed
  await writePreferences({ editor: '   ' }, ENV, fs) // blank = no choice
  assert.deepEqual(await readPreferences(ENV, fs), {}) // dropped
})

test('writePreferences keeps a known theme and drops an unknown one (#725)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ preferences: {} }) })
  await writePreferences({ theme: 'dark' }, ENV, fs)
  assert.deepEqual(await readPreferences(ENV, fs), { theme: 'dark' })
  await writePreferences({ theme: 'solarized' } as never, ENV, fs) // not in the known set
  assert.deepEqual(await readPreferences(ENV, fs), {}) // dropped, falls back to system
})

test('writePreferences keeps a known look, stores the default look as nothing, and drops an unknown one', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ preferences: {} }) })
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

test('registryPreferencesStore round-trips through the same file', async () => {
  const fs = memFs()
  const store = registryPreferencesStore(ENV, fs)
  assert.deepEqual(await store.read(), {})
  await store.save({ showThinking: true })
  assert.deepEqual(await store.read(), { showThinking: true })
})

test('the registry file is never written in place, only renamed over (#991)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ preferences: {} }) })
  await writePreferences({ showThinking: true }, ENV, fs)
  assert.deepEqual(
    fs.written.filter(path => path === FILE),
    [],
    'the live file must only ever be replaced by a rename, so a reader sees the whole old or the whole new one',
  )
  assert.ok(fs.written.every(path => path.startsWith(`${FILE}.`) && path.endsWith('.tmp')))
  assert.deepEqual(await readRegistry(ENV, fs), { preferences: { showThinking: true } })
  assert.equal([...fs.files.keys()].length, 1, 'the temp file is renamed away, not left beside the real one')
})

test('a write that dies partway leaves the previous registry intact (#991)', async () => {
  const stored = JSON.stringify({ preferences: { nameRuns: false } })
  // The disk fills between the truncate and the flush. Whatever it truncated must not be the live file.
  const fs = memFs({ [FILE]: stored }, { failWritesTo: `${FILE}.${process.pid}.tmp` })
  await assert.rejects(() => writePreferences({ showThinking: true }, ENV, fs), /ENOSPC/)
  assert.equal(fs.files.get(FILE), stored, 'the live file is untouched by a failed write')
  assert.deepEqual(await readRegistry(ENV, fs), { preferences: { nameRuns: false } })
})

test('two concurrent patches do not drop each other (#991)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ preferences: {} }) }, { slow: true })
  await Promise.all([patchPreferences({ nameRuns: false }, ENV, fs), patchPreferences({ showThinking: true }, ENV, fs)])
  assert.deepEqual(await readRegistry(ENV, fs), { preferences: { nameRuns: false, showThinking: true } })
})

test('a rejected mutation does not wedge the queue for the next caller (#991)', async () => {
  const temp = `${FILE}.${process.pid}.tmp`
  const fs = memFs({ [FILE]: JSON.stringify({ preferences: {} }) }, { failWritesTo: temp })
  await assert.rejects(() => patchPreferences({ nameRuns: false }, ENV, fs), /ENOSPC/)
  const healthy = memFs({ [FILE]: JSON.stringify({ preferences: {} }) })
  await patchPreferences({ showThinking: true }, ENV, healthy)
  assert.deepEqual(await readPreferences(ENV, healthy), { showThinking: true })
})


test('the registry file is written owner-only, and the mode is set before the rename (#1095)', async () => {
  const fs = memFs()
  await writePreferences({ showThinking: true }, ENV, fs)

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
  await writePreferences({ showThinking: true }, ENV, noModes)

  assert.deepEqual(await readPreferences(ENV, noModes), { showThinking: true })
})

