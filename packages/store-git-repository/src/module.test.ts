import { strict as assert } from 'node:assert'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { nodeGitRunner } from '@openagt/git-branches'
import { stopSyncingPersonalFolder, syncPersonalFolder } from './folder-sync.js'
import { withPersonalFolder } from '@openagt/store-filesystem'
import gitRepository, { SYNC_ENTRY } from './module.js'

// store-git-repository's row: whether the person's folder syncs with a repository of theirs, its
// remote, switched on Settings › Your agent data.

test('the plugin is on where the folder syncs with a repository, and off again once it stops; it is switched on Settings › Your agent data', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'store-git-repository-row-')))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(base, 'config')
  try {
    const row = gitRepository.plugin?.row
    assert.equal(gitRepository.plugin?.scope, 'computer')
    assert.equal(row?.settings, SYNC_ENTRY)
    assert.equal(SYNC_ENTRY, 'agent-data')
    assert.equal(await row?.read(), false, 'no folder yet')
    await withPersonalFolder(join(base, 'config', 'openagent'), 'a note', async () => {})
    assert.equal(await row?.read(), false, 'a folder with no remote syncs with nothing')
    const remote = join(base, 'records.git')
    await nodeGitRunner()(['init', '-q', '--bare', '-b', 'main', remote], base)
    assert.deepEqual(await syncPersonalFolder(remote, undefined), { ok: true })
    assert.equal(await row?.read(), true)
    assert.deepEqual(await stopSyncingPersonalFolder(), { ok: true })
    assert.equal(await row?.read(), false)
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(base, { recursive: true, force: true, maxRetries: 10 })
  }
})
