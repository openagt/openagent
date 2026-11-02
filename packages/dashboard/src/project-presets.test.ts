import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import {
  readProjectPresets,
  writeProjectPresets,
  PROJECT_PRESETS_FILE,
} from './project-presets.js'
import type { StoreFs } from './store/index.js'

/** A minimal in-memory {@link StoreFs}: `read` throws on a missing path, like the node one. */
function memFs(seed: Record<string, string> = {}): StoreFs & { files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(seed))
  return {
    files,
    async read(path) {
      const v = files.get(path)
      if (v === undefined) throw new Error(`ENOENT: ${path}`)
      return v
    },
    async write(path, contents) { files.set(path, contents) },
    async append(path, contents) { files.set(path, (files.get(path) ?? '') + contents) },
    async exists(path) { return files.has(path) },
    async mkdir() {},
    async readdir() { return [] },
  }
}

const GITIGNORE = join('/repo', '.openagent', '.gitignore')
const PRESETS = join('/repo', PROJECT_PRESETS_FILE)

test('readProjectPresets is empty for a missing file (never throws)', async () => {
  assert.deepEqual(await readProjectPresets('/repo', memFs()), [])
})

test('readProjectPresets is empty for malformed JSON', async () => {
  const fs = memFs({ [PRESETS]: '{ not json' })
  assert.deepEqual(await readProjectPresets('/repo', fs), [])
})

test('writeProjectPresets round-trips through readProjectPresets', async () => {
  const fs = memFs()
  const presets = [{ id: 'a', label: 'Ship it', prompt: 'do the thing' }]
  await writeProjectPresets('/repo', presets, fs)
  assert.deepEqual(await readProjectPresets('/repo', fs), presets)
})

test('writeProjectPresets sanitizes: drops malformed entries and trims', async () => {
  const fs = memFs()
  await writeProjectPresets(
    '/repo',
    [
      { id: 'a', label: '  Keep  ', prompt: '  body  ' },
      { id: '', label: 'no id', prompt: 'x' } as never,
      { id: 'a', label: 'dup id', prompt: 'x' }, // duplicate id dropped
      { id: 'b', label: 'no prompt', prompt: '' } as never,
    ],
    fs,
  )
  assert.deepEqual(await readProjectPresets('/repo', fs), [{ id: 'a', label: 'Keep', prompt: 'body' }])
})

test('writeProjectPresets un-ignores the file in .openagent/.gitignore', async () => {
  const fs = memFs({ [GITIGNORE]: '*\n!.gitignore\n!LOGS.md\n' })
  await writeProjectPresets('/repo', [{ id: 'a', label: 'l', prompt: 'p' }], fs)
  const gitignore = fs.files.get(GITIGNORE) ?? ''
  assert.ok(gitignore.split('\n').includes('!custom-presets.json'), 'adds the negation')
})

test('writeProjectPresets does not duplicate the negation on a second save', async () => {
  const fs = memFs({ [GITIGNORE]: '*\n!.gitignore\n!LOGS.md\n' })
  await writeProjectPresets('/repo', [{ id: 'a', label: 'l', prompt: 'p' }], fs)
  await writeProjectPresets('/repo', [{ id: 'a', label: 'l2', prompt: 'p2' }], fs)
  const count = (fs.files.get(GITIGNORE) ?? '')
    .split('\n')
    .filter(line => line.trim() === '!custom-presets.json').length
  assert.equal(count, 1)
})

test('writing an empty list keeps the file and the negation', async () => {
  const fs = memFs({ [GITIGNORE]: '*\n!.gitignore\n!LOGS.md\n' })
  await writeProjectPresets('/repo', [], fs)
  assert.equal(fs.files.get(PRESETS), '[]\n')
  assert.ok((fs.files.get(GITIGNORE) ?? '').includes('!custom-presets.json'))
})
