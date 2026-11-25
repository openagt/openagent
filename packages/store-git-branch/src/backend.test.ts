import { strict as assert } from 'node:assert'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { nodeGitRunner } from '@openagt/git-branches'
import { writeSharing, filesystemBackend, foldersOf, type Folders } from '@openagt/store-filesystem'
import { chainStore, projectScope, type ProjectRef, type Store } from '@openagt/hooks'
import { gitBranchBackend } from './backend.js'

// A shared project's data on its agent-data branch: saves committed and pushed there, reads off
// the branch, what another machine pushed taken in before a save is made, a command that keeps no
// checkout, and every project not shared passed to the store below.

const git = nodeGitRunner()
const RETRIED_RM = { recursive: true, force: true, maxRetries: 10 } as const
const there = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

/** A committed repository at `dir`. */
async function initRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await git(['init', '-q', '-b', 'main'], dir)
  await git(['config', 'user.email', 't@t'], dir)
  await git(['config', 'user.name', 't'], dir)
  await writeFile(join(dir, 'README.md'), '# t\n')
  await git(['add', '-A'], dir)
  await git(['commit', '-q', '-m', 'init'], dir)
}

interface World {
  /** The shared project here, and the same project's clone on another machine. */
  shop: ProjectRef
  elsewhere: ProjectRef
  /** A project of this computer's that is not shared. */
  notes: ProjectRef
  bare: string
  folders: Folders
  store: (opts?: { oneShot?: boolean }) => Store
  cleanup: () => Promise<void>
}

async function setup(): Promise<World> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'store-git-branch-')))
  const bare = join(base, 'origin.git')
  const repo = join(base, 'shop')
  const other = join(base, 'elsewhere', 'shop')
  const notes = join(base, 'notes')
  await initRepo(repo)
  await initRepo(notes)
  await git(['init', '-q', '--bare', bare], base)
  await git(['remote', 'add', 'origin', bare], repo)
  await git(['push', '-q', 'origin', 'main'], repo)
  await mkdir(join(base, 'elsewhere'))
  await git(['clone', '-q', bare, other], base)
  await git(['config', 'user.email', 'o@o'], other)
  await git(['config', 'user.name', 'o'], other)
  for (const clone of [repo, other]) await writeSharing(clone, true)
  const folders = foldersOf({ XDG_CONFIG_HOME: join(base, 'config') })
  const remote = 'example.com/acme/shop'
  return {
    shop: { id: 'shop-1', name: 'shop', dir: repo, remote },
    elsewhere: { id: 'shop-2', name: 'shop', dir: other, remote },
    notes: { id: 'notes-1', name: 'notes', dir: notes },
    bare,
    folders,
    store: (opts = {}) => chainStore([filesystemBackend({ folders }), gitBranchBackend()], { oneShot: opts.oneShot ?? false }),
    cleanup: () => rm(base, RETRIED_RM),
  }
}

const onOrigin = async (bare: string, path: string): Promise<string | undefined> => git(['show', `agent-data:${path}`], bare).catch(() => undefined)

test("a shared project's save is a commit on its agent-data branch, pushed, and read back off the branch; a project not shared goes to the store below", async () => {
  const w = await setup()
  try {
    const store = w.store()
    const shop = projectScope(w.shop)
    await store.save(shop, { 'tickets/a.md': '# A\n', 'tickets/old/b.md': '# B\n' }, 'two tickets')
    assert.equal(await onOrigin(w.bare, 'tickets/a.md'), '# A\n', 'the save reached origin')
    assert.equal((await git(['log', '-1', '--format=%s', 'agent-data'], w.bare)).trim(), 'two tickets')
    assert.equal(await readFile(join(w.shop.dir, '.branches', 'agent-data', 'tickets', 'a.md'), 'utf8'), '# A\n', "the clone's checkout of the branch holds it")
    assert.equal(await store.read(shop, 'tickets/a.md'), '# A\n')
    assert.deepEqual(await store.list(shop, 'tickets'), ['tickets/a.md', 'tickets/old/b.md'])
    await store.save(shop, { 'tickets/old/b.md': null }, 'b closed')
    assert.deepEqual(await store.list(shop, ''), ['tickets/a.md'])
    assert.equal(await onOrigin(w.bare, 'tickets/old/b.md'), undefined)
    assert.equal((await git(['log', '-1', '--format=%s', 'main'], w.shop.dir)).trim(), 'init', 'the code branch is untouched')

    await store.save(projectScope(w.notes), { 'queue.md': '- one\n' }, 'queue')
    assert.equal(await readFile(join(w.folders.personal, 'projects', 'local', ...w.notes.dir.split('/').filter(Boolean), 'queue.md'), 'utf8'), '- one\n')
    assert.ok(!(await there(join(w.notes.dir, '.branches'))), 'a project not shared gets no branch')
  } finally {
    await w.cleanup()
  }
})

test('a save made from the files is made from what origin has: a claim another machine pushed is taken in first, and a save that throws keeps nothing', async () => {
  const w = await setup()
  try {
    const here = w.store()
    const there = w.store()
    const shop = projectScope(w.shop)
    await here.save(shop, { 'tickets/a.md': '# A\n' }, 'ticket a')
    await there.save(projectScope(w.elsewhere), { 'tickets/a.lock.md': 'CLAIMED: elsewhere\n' }, 'claim a')
    assert.equal(await here.read(shop, 'tickets/a.lock.md'), undefined, "a read that is not fresh reads this clone's checkout")
    assert.equal(await here.read(shop, 'tickets/a.lock.md', { fresh: true }), 'CLAIMED: elsewhere\n')
    assert.deepEqual(await here.list(shop, 'tickets', { fresh: true }), ['tickets/a.lock.md', 'tickets/a.md'])
    await assert.rejects(
      here.save(
        shop,
        async files => {
          const lock = await files.read('tickets/a.lock.md')
          if (lock !== undefined) throw new Error(`a is held: ${lock.trim()}`)
          return { 'tickets/a.lock.md': 'CLAIMED: here\n' }
        },
        'claim a',
      ),
      /a is held: CLAIMED: elsewhere/,
    )
    assert.equal(await here.read(shop, 'tickets/a.lock.md'), 'CLAIMED: elsewhere\n', "the save took the other machine's claim in")
    assert.equal((await git(['status', '--porcelain'], join(w.shop.dir, '.branches', 'agent-data'))).trim(), '', 'the save that threw left nothing behind')
  } finally {
    await w.cleanup()
  }
})

test("a command keeps no checkout: it writes through a throwaway one at origin's tip, and reads origin's copy, its own writes included", async () => {
  const w = await setup()
  try {
    const command = w.store({ oneShot: true })
    const shop = projectScope(w.shop)
    await command.save(shop, { 'queue.md': '- one\n' }, 'queue one')
    assert.equal(await onOrigin(w.bare, 'queue.md'), '- one\n')
    assert.ok(!(await there(join(w.shop.dir, '.branches', 'agent-data'))), 'no checkout was kept')
    assert.equal(await command.read(shop, 'queue.md'), '- one\n')
    await w.store().save(projectScope(w.elsewhere), { 'queue.md': '- one\n- two\n' }, 'queue two')
    assert.equal(await command.read(shop, 'queue.md'), '- one\n', 'origin is fetched once, not for every read')
    await command.save(shop, async files => ({ 'queue.md': `${(await files.read('queue.md')) ?? ''}- three\n` }), 'queue three')
    assert.equal(await command.read(shop, 'queue.md'), '- one\n- two\n- three\n', "the save was made from origin's tip, and the read after it fetched again")
    assert.deepEqual(await command.list(shop, ''), ['queue.md'])
    await assert.rejects(
      command.save(
        shop,
        () => {
          throw new Error('nothing to change')
        },
        'nothing',
      ),
      /nothing to change/,
    )
    assert.throws(() => command.watch(shop, '', () => {}), /A command keeps no checkout of a shared project to watch/)
  } finally {
    await w.cleanup()
  }
})

test("a watcher of a shared project hears the files a save changed in the clone's checkout", async () => {
  const w = await setup()
  try {
    const store = w.store()
    const shop = projectScope(w.shop)
    const heard: string[] = []
    let told: () => void = () => {}
    const arrived = new Promise<void>(resolve => (told = resolve))
    const stop = store.watch(shop, 'tickets', path => {
      heard.push(path)
      if (path === 'tickets/a.md') told()
    })
    // The watch starts once the checkout is made: a moment after it is asked.
    for (let waited = 0; !(await there(join(w.shop.dir, '.branches', 'agent-data', '.git'))) && waited < 5000; waited += 50) await new Promise(resolve => setTimeout(resolve, 50))
    await new Promise(resolve => setTimeout(resolve, 100))
    await store.save(shop, { 'tickets/a.md': '# A\n', 'queue.md': '- a\n' }, 'ticket a')
    let timer: NodeJS.Timeout | undefined
    await Promise.race([arrived, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('the watcher heard nothing')), 5000)))]).finally(() => clearTimeout(timer))
    stop()
    assert.ok(heard.every(path => path === 'tickets' || path.startsWith('tickets/')), heard.join(', '))
  } finally {
    await w.cleanup()
  }
})
