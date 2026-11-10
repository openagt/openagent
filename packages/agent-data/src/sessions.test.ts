import { strict as assert } from 'node:assert'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { personalFolder } from './personal-folder.js'
import { projectDataPlace, withProjectData } from './project-data.js'
import { listSessionFolders, runsRootOf, sessionFolder, sessionsHome, sessionsHomeOf, SESSIONS_DIR } from './sessions.js'

test('the sessions home sits beside the personal folder, never in it', () => {
  assert.equal(sessionsHome({ XDG_CONFIG_HOME: '/x' }), '/x/openagent-sessions')
  assert.equal(sessionsHome({ HOME: '/home/me' }), '/home/me/.openagent-sessions')
})

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

test('the sessions keep their records in the personal folder, one directory for all of them', async () => {
  const home = sessionsHome()
  const folder = sessionFolder(home, '2026-11-06T10-00-00-000Z')
  await mkdir(folder, { recursive: true })
  try {
    const place = await projectDataPlace(folder)
    assert.deepEqual(place, { kind: 'personal', repo: home, folder: personalFolder(), dir: join(personalFolder(), SESSIONS_DIR) })
    const written = await withProjectData(folder, 'a session record', async dir => {
      await mkdir(join(dir, 'agents'), { recursive: true })
      await writeFile(join(dir, 'agents', 'card.json'), '{}')
    })
    assert.equal(written.ok, true)
    assert.equal(await readFile(join(personalFolder(), SESSIONS_DIR, 'agents', 'card.json'), 'utf8'), '{}')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
