import { strict as assert } from 'node:assert'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { nodeGitRunner } from './git.js'
import { readPersonRecord, removePersonRecord, writePersonRecord } from './person.js'

test("the person's own name and picture: one file in the personal folder, committed there, read strictly", async () => {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'person-')))
  try {
    assert.equal(await readPersonRecord(folder), undefined)
    assert.deepEqual(await writePersonRecord({ name: ' Ada Lovelace ', picture: 'https://avatars.example/ada.png', github: 'ada' }, { folder }), { ok: true, changed: true, pushed: false })
    assert.deepEqual(await readPersonRecord(folder), { name: 'Ada Lovelace', picture: 'https://avatars.example/ada.png', github: 'ada' })
    assert.match(await nodeGitRunner()(['log', '-1', '--format=%s'], folder), /update the person/)

    // Only a picture on the web; a file that names nobody is no person.
    await writeFile(join(folder, 'person.json'), JSON.stringify({ name: 'Ada', picture: 'file:///etc/passwd' }))
    assert.deepEqual(await readPersonRecord(folder), { name: 'Ada' })
    await writeFile(join(folder, 'person.json'), JSON.stringify({ name: '' }))
    assert.equal(await readPersonRecord(folder), undefined)

    await removePersonRecord({ folder })
    assert.equal(await readPersonRecord(folder), undefined)
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})
