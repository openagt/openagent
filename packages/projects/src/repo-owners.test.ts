import { strict as assert } from 'node:assert'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { isRepoOwner, readRepoOwners, writeRepoOwners } from './repo-owners.js'

test('the owners whose repositories are listed: one file in the personal folder, as host/name, read strictly', async () => {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'repo-owners-')))
  try {
    assert.deepEqual(await readRepoOwners(folder), [])
    assert.deepEqual(await writeRepoOwners(['github.com/vikejs', 'github.com/vikejs', 'vikejs', 'github.com/../x'], { folder }), { ok: true, changed: true, pushed: false })
    assert.deepEqual(await readRepoOwners(folder), ['github.com/vikejs'], 'once, and only host/name')
    await writeFile(join(folder, 'repo-owners.json'), '{"owners": ["github.com/brillout", 7, "evil"]}')
    assert.deepEqual(await readRepoOwners(folder), ['github.com/brillout'])
    assert.equal(isRepoOwner('gitlab.example.com/team'), true)
    assert.equal(isRepoOwner('github.com/a/b'), false)
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})
