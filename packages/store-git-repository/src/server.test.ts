import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeGitRunner, writeRemoteAccount } from '@openagt/git-branches'
import { personalFolder, withPersonalFolder } from '@openagt/store-filesystem'
import { computerRpcHost } from '@openagt/hooks/testing'
import { backupAttention } from './backup-attention.js'
import { backup, sendAs, sync } from './server.js'

// What is not backed up, and the folder's sync, through the module's own functions: the personal
// folder under a temp $XDG_CONFIG_HOME, synced with a repository at GitHub with no account of
// OpenAgent's named. No talk with GitHub happens: with no account, git is never asked to go.

async function withComputer(body: (folder: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'oa-backup-'))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  mkdirSync(process.env.XDG_CONFIG_HOME, { recursive: true })
  try {
    await body(personalFolder())
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    rmSync(dir, { recursive: true, force: true })
  }
}

const git = nodeGitRunner()
const host = computerRpcHost()

/** A change saved in the person's folder, as any module's save makes it. */
const save = (folder: string, name: string) => withPersonalFolder(folder, 'save the name', () => writeFile(join(folder, 'name.txt'), name))

test('a folder only on this computer, or backed up as an account of OpenAgent, is no gap; one at GitHub with none is, with what waits', async () => {
  await withComputer(async folder => {
    assert.equal((await save(folder, 'Ada')).ok, true)
    assert.deepEqual(await backup(host, {}), { gaps: [], hosts: [] })

    await git(['remote', 'add', 'origin', 'https://github.com/ada/agent.git'], folder)
    // The bug the notice is for: a change made with no account named is made, not failed.
    assert.equal((await save(folder, 'Ada Lovelace')).ok, true)
    assert.equal(readFileSync(join(folder, 'name.txt'), 'utf8'), 'Ada Lovelace')
    const { gaps } = await backup(host, {})
    assert.equal(gaps.length, 1)
    assert.deepEqual({ ...gaps[0], waiting: undefined }, { kind: 'personal', address: 'github.com/ada/agent', url: 'https://github.com/ada/agent', host: 'github.com', waiting: undefined })
    assert.ok((gaps[0]!.waiting ?? 0) >= 1, 'the change waits')
    // Said about this computer, with the Settings entry that fixes it; asked about a project, not said again.
    const [item, ...more] = await backupAttention({})
    assert.deepEqual({ ...item, detail: undefined }, { kind: 'setup', scope: 'computer', id: 'not-backed-up', words: 'Your agent data is not backed up', detail: undefined, fix: { label: 'Back up your agent data…', settings: 'agent-data' } })
    assert.match(item!.detail!, /^To github\.com\/ada\/agent · \d+ changes? waiting$/)
    assert.deepEqual(more, [])
    assert.deepEqual(await backupAttention({ project: { id: 'p', name: 'p', dir: folder } }), [])

    await writeRemoteAccount(folder, { login: 'ada-agent', host: 'github.com', config: [] }, git)
    assert.deepEqual(await backup(host, {}), { gaps: [], hosts: [] })
    assert.deepEqual(await backupAttention({}), [])
  })
})

test("with no account of OpenAgent's at the host, the personal folder is not synced, and keeps no remote", async () => {
  await withComputer(async folder => {
    // A GitHub address: the repository there is never reached as the person's own login.
    const refused = await sync(host, { address: 'github.com/me/agent' })
    assert.deepEqual(refused, { ok: false, error: 'OpenAgent has no account at github.com' })
    assert.deepEqual(await sendAs(host, { login: 'octo-agent' }), { ok: false, error: 'Your folder syncs with no repository on a git host.' })
    assert.equal(await git(['remote'], folder).catch(() => ''), '')
    assert.deepEqual(await sync(host, { address: '/a/folder' }), { ok: false, error: 'That is not a repository address. Paste one like github.com/you/agent.' })
  })
})
