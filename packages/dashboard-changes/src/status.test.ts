import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFileStatuses } from './status.js'

const fakeGit = (out: string) => async () => out

test('readFileStatuses maps porcelain codes to untracked/modified/deleted', async () => {
  const out = [' M src/a.ts', '?? src/new.ts', ' D src/gone.ts', 'A  src/added.ts', 'R  old.ts -> src/renamed.ts'].join('\n')
  const map = await readFileStatuses('/repo', fakeGit(out))
  assert.deepEqual(map, {
    'src/a.ts': 'modified',
    'src/new.ts': 'untracked',
    'src/gone.ts': 'deleted',
    'src/added.ts': 'modified',
    'src/renamed.ts': 'modified', // a rename dots the new path
  })
})

test('readFileStatuses yields {} when git fails (not a repo)', async () => {
  const map = await readFileStatuses('/repo', async () => {
    throw new Error('fatal: not a git repository')
  })
  assert.deepEqual(map, {})
})
