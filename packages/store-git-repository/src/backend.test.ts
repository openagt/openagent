import { strict as assert } from 'node:assert'
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { nodeGitRunner } from '@openagt/git-branches'
import { syncPersonalFolder } from './folder-sync.js'
import { chainStore, COMPUTER, PERSON, projectScope, type ProjectRef, type Store } from '@openagt/hooks'
import { filesystemBackend, foldersOf, type Folders } from '@openagt/store-filesystem'
import { gitRepositoryBackend } from './backend.js'

// The person's own folder as a git repository: a commit per save, pushed when it syncs with a
// repository of theirs, what another computer pushed taken in before a fresh read, and a save
// made from the files once that is in.

const git = nodeGitRunner()
const SHOP: ProjectRef = { id: 'shop-1', name: 'shop', dir: '/home/me/shop', remote: 'github.com/acme/shop' }

/** A computer of the person's: its folders, and its store as the dashboard's chain makes it. */
function computer(base: string, name: string): { folders: Folders; store: Store } {
  const folders = foldersOf({ XDG_CONFIG_HOME: join(base, name) })
  return { folders, store: chainStore([filesystemBackend({ folders }), gitRepositoryBackend({ folders })]) }
}

async function setup(): Promise<{ base: string; cleanup: () => Promise<void> }> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'store-git-repository-')))
  return { base, cleanup: () => rm(base, { recursive: true, force: true, maxRetries: 10 }) }
}

const subjects = async (folder: string): Promise<string[]> => (await git(['log', '--format=%s'], folder)).trim().split('\n')

test("every save kept in the person's folder is a commit there, a project's too; this computer's scope is no commit", async () => {
  const { base, cleanup } = await setup()
  try {
    const { folders, store } = computer(base, 'laptop')
    await store.save(PERSON, { 'profiles/default.json': '{}\n' }, 'the default profile')
    await store.save(projectScope(SHOP), { 'tickets/a.md': '# A\n' }, () => 'ticket a')
    await store.save(COMPUTER, { 'settings.json': '{}\n' }, 'a setting of this computer')
    assert.deepEqual(await subjects(folders.personal), ['ticket a', 'the default profile', 'create the personal folder'])
    assert.equal((await git(['status', '--porcelain'], folders.personal)).trim(), '', 'nothing is left uncommitted')
    assert.equal(await store.read(COMPUTER, 'settings.json'), '{}\n')
    assert.ok(!(await readdir(folders.computer)).includes('.git'), "this computer's folder is no repository")
  } finally {
    await cleanup()
  }
})

test('with a repository of the person\'s, a save is pushed there, and a fresh read takes in what another computer pushed', async () => {
  const { base, cleanup } = await setup()
  try {
    const remote = join(base, 'records.git')
    await git(['init', '-q', '--bare', '-b', 'main', remote], base)
    const laptop = computer(base, 'laptop')
    const desktop = computer(base, 'desktop')
    for (const each of [laptop, desktop]) assert.deepEqual(await syncPersonalFolder(remote, undefined, { folder: each.folders.personal }), { ok: true })
    await laptop.store.save(projectScope(SHOP), { 'queue.md': '- one\n' }, 'queue one')
    assert.ok((await git(['log', '--format=%s', 'main'], remote)).includes('queue one'), 'the save reached the repository')
    assert.equal(await desktop.store.read(projectScope(SHOP), 'queue.md'), undefined, 'a read that is not fresh reads what this computer has')
    assert.equal(await desktop.store.read(projectScope(SHOP), 'queue.md', { fresh: true }), '- one\n')
    assert.deepEqual(await desktop.store.list(projectScope(SHOP), ''), ['queue.md'])
  } finally {
    await cleanup()
  }
})

test('a save made from the files reads what another computer pushed first, and one that throws keeps nothing and says why', async () => {
  const { base, cleanup } = await setup()
  try {
    const remote = join(base, 'records.git')
    await git(['init', '-q', '--bare', '-b', 'main', remote], base)
    const laptop = computer(base, 'laptop')
    const desktop = computer(base, 'desktop')
    for (const each of [laptop, desktop]) await syncPersonalFolder(remote, undefined, { folder: each.folders.personal })
    const scope = projectScope(SHOP)
    await laptop.store.save(scope, { 'tickets/a.md': '# A\n' }, 'ticket a')
    await desktop.store.read(scope, 'tickets/a.md', { fresh: true })
    await laptop.store.save(scope, { 'tickets/a.lock.md': 'CLAIMED: laptop\n' }, 'claim a')
    const claim = (holder: string) =>
      desktop.store.save(
        scope,
        async files => {
          const lock = await files.read('tickets/a.lock.md')
          if (lock !== undefined) throw new Error(`a is held: ${lock.trim()}`)
          return { 'tickets/a.lock.md': `CLAIMED: ${holder}\n` }
        },
        'claim a',
      )
    await assert.rejects(claim('desktop'), /a is held: CLAIMED: laptop/, "the desktop's claim is made from the laptop's, taken in first")
    assert.equal(await desktop.store.read(scope, 'tickets/a.lock.md'), 'CLAIMED: laptop\n')
    assert.equal((await git(['status', '--porcelain'], desktop.folders.personal)).trim(), '', 'the claim that threw left nothing behind')
    assert.deepEqual((await git(['log', '--format=%s', 'main'], remote)).trim().split('\n').slice(0, 2), ['claim a', 'ticket a'])
  } finally {
    await cleanup()
  }
})
