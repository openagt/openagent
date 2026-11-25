import { strict as assert } from 'node:assert'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { nodeGitRunner } from '@openagt/git-branches'
import { writeSharing } from '@openagt/store-filesystem'
import gitBranch, { SHARE_ENTRY } from './module.js'

// store-git-branch's row: whether the person shares the project's data on its branch, the clone's
// own answer, switched on the project's Agent data entry.

test("the plugin is on in a project whose clone shares its data, off in one that does not and with no project; it is switched on the project's Agent data entry", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'store-git-branch-row-')))
  try {
    const row = gitBranch.plugin?.row
    assert.equal(gitBranch.plugin?.scope, 'project')
    assert.equal(row?.settings, SHARE_ENTRY)
    assert.equal(SHARE_ENTRY, 'project-agent-data')
    const shop = join(base, 'shop')
    await mkdir(shop)
    await nodeGitRunner()(['init', '-q'], shop)
    const project = { id: 'shop-1', name: 'shop', dir: shop }
    assert.equal(await row?.read(project), false, 'not shared until the person says')
    await writeSharing(shop, true)
    assert.equal(await row?.read(project), true)
    await writeSharing(shop, false)
    assert.equal(await row?.read(project), false)
    assert.equal(await row?.read({ id: 'gone-1', name: 'gone', dir: join(base, 'gone') }), false, 'a folder that is no repository shares nothing')
    assert.equal(await row?.read(), false, 'a session with no project shares nothing')
  } finally {
    await rm(base, { recursive: true, force: true, maxRetries: 10 })
  }
})
