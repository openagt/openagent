import { strict as assert } from 'node:assert'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { sessionsHome } from '@openagt/hooks'
import { listSessionFolders, runsRootOf, sessionFolder, sessionsHomeOf } from './sessions.js'

test('a folder in the sessions home is about the home; any other is not', async () => {
  const home = sessionsHome()
  const folder = sessionFolder(home, '2026-11-06T10-00-00-000Z')
  await mkdir(folder, { recursive: true })
  try {
    assert.equal(await sessionsHomeOf(home), home)
    assert.equal(await sessionsHomeOf(folder), home)
    assert.equal(await sessionsHomeOf(`${home}-other`), undefined)
    assert.equal(await runsRootOf(folder), home)
    assert.deepEqual(await listSessionFolders(home), [{ id: '2026-11-06T10-00-00-000Z', path: folder }])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('outside the sessions home and outside a repository, there is no root of runs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oa-no-repo-'))
  try {
    await assert.rejects(runsRootOf(dir), /not a git repository/i)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
