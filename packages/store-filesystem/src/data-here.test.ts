import { strict as assert } from 'node:assert'
import { execFile } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import type { ProjectRef } from '@openagt/hooks'
import { dataHere } from './data-here.js'
import { writeSharing } from './file-branch.js'

const git = promisify(execFile)

const SHOP: ProjectRef = { id: 'shop-1', name: 'shop', dir: '/home/me/shop' }

test("why a project's data stays on this computer is a note under its name; data that goes to origin says nothing", async () => {
  assert.deepEqual(await dataHere(SHOP, async () => 'no-remote'), [{ kind: 'note', scope: 'project', id: 'data-here', words: 'Local only, no remote' }])
  assert.deepEqual(await dataHere(SHOP, async () => 'kept'), [{ kind: 'note', scope: 'project', id: 'data-here', words: 'Records kept on this machine' }])
  assert.deepEqual(await dataHere(SHOP, async () => 'origin'), [])
  assert.deepEqual(
    await dataHere(SHOP, async () => {
      throw new Error('no git')
    }),
    [],
    'a reach that cannot be read says nothing',
  )
})

test("the reach is the clone's: no remote, then a remote whose records the person keeps here, then none once they are shared", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'openagent-reach-')))
  const dir = join(base, 'project')
  try {
    await git('git', ['init', '-q', '-b', 'main', dir])
    const words = async () => (await dataHere({ ...SHOP, dir }))[0]?.words
    assert.equal(await words(), 'Local only, no remote')
    await git('git', ['remote', 'add', 'origin', join(base, 'remote.git')], { cwd: dir })
    assert.equal(await words(), 'Records kept on this machine')
    await writeSharing(dir, true)
    assert.equal(await words(), undefined)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
