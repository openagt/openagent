import { strict as assert } from 'node:assert'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { nodeGitRunner, syncPersonalFolder, withPersonalFolder } from '@openagt/agent-data'
import type { AppContext, ProjectRef } from '@openagt/hooks'
import { fakeApp, memorySettings } from '@openagt/hooks/testing'
import { NOT_SYNCING, folderSync, type SyncFolder } from './sync.js'

/** The app as a module's life is told it. */
function app(): AppContext {
  return { projects: async () => [], store: undefined as never, settings: memorySettings(), signal: new AbortController().signal }
}

/** Wait until `done` says so, asking every few milliseconds. */
async function until(done: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const by = Date.now() + 10_000
  while (!(await done())) {
    if (Date.now() > by) throw new Error(`never: ${what}`)
    await new Promise(resolvePromise => setTimeout(resolvePromise, 5))
  }
}

const kept: ProjectRef = { id: 'notes-1', name: 'notes', dir: '/work/notes' }
const shared: ProjectRef = { id: 'shop-1', name: 'shop', dir: '/work/shop' }

test('a folder that does not converge with its repository needs the person, about this computer and each project kept in it, until a turn goes through; one that syncs with none is not synced', async () => {
  let syncs = false
  let said: { ok: true } | { ok: false; error: string } = { ok: false, error: 'the personal folder could not be sent to its remote: Permission denied (publickey)' }
  let synced = 0
  const sync: SyncFolder = async () => (synced++, said)
  let clock = Date.parse('2026-11-20T10:00:00Z')
  const logged: string[] = []
  const folder = folderSync({ syncs: async () => syncs, sync, keptHere: async dir => dir === kept.dir, everyMs: 10, now: () => new Date(clock), log: line => logged.push(line) })
  folder.lifecycle.started?.(app())
  try {
    await new Promise(resolvePromise => setTimeout(resolvePromise, 40))
    assert.equal(synced, 0, 'a folder with no repository is not synced')
    assert.deepEqual(await folder.attention({}, fakeApp()), [])
    // The row turns on while the app runs: the next turn syncs.
    syncs = true
    await until(async () => (await folder.attention({}, fakeApp())).length === 1, 'a folder that does not converge needs the person')
    const item = { kind: 'setup', scope: 'computer', id: 'folder-sync', words: NOT_SYNCING, detail: said.ok ? '' : said.error, since: '2026-11-20T10:00:00.000Z' }
    assert.deepEqual(await folder.attention({}, fakeApp()), [item])
    assert.deepEqual(await folder.attention({ project: kept }, fakeApp()), [item], 'a project kept in the folder says it too')
    assert.deepEqual(await folder.attention({ project: shared }, fakeApp()), [], 'a shared project keeps its data on its own branch')
    // Still failing a minute later: since the first turn that failed.
    clock += 60_000
    said = { ok: false, error: 'the repository is out of reach' }
    await until(async () => (await folder.attention({}, fakeApp()))[0]?.detail === 'the repository is out of reach', 'the next turn says what went wrong then')
    assert.equal((await folder.attention({}, fakeApp()))[0]?.since, '2026-11-20T10:00:00.000Z')
    said = { ok: true }
    await until(async () => (await folder.attention({}, fakeApp())).length === 0, 'a turn that goes through takes it back')
    assert.deepEqual(
      logged,
      ['[openagent] your agent data is not syncing: the personal folder could not be sent to its remote: Permission denied (publickey)', '[openagent] your agent data is not syncing: the repository is out of reach'],
      'told once for each new way it fails',
    )
    // A failure, then the folder stops syncing with a repository: there is nothing left to fix.
    said = { ok: false, error: 'no answer' }
    await until(async () => (await folder.attention({}, fakeApp())).length === 1, 'failing again')
    syncs = false
    await until(async () => (await folder.attention({}, fakeApp())).length === 0, 'a folder that syncs with none says nothing')
  } finally {
    await folder.lifecycle.stopping?.()
  }
  const after = synced
  await new Promise(resolvePromise => setTimeout(resolvePromise, 40))
  assert.equal(synced, after, 'no turn after the stop')
})

test('the real sync: a folder whose repository is out of reach needs the person, and converges once it is back', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'store-git-repository-sync-')))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(base, 'config')
  const git = nodeGitRunner()
  const remote = join(base, 'records.git')
  const personal = join(base, 'config', 'openagent')
  try {
    await git(['init', '-q', '--bare', '-b', 'main', remote], base)
    assert.deepEqual(await syncPersonalFolder(remote, undefined), { ok: true })
    // One turn as it starts, and none after it for a minute: each start below is one turn.
    const folder = folderSync({ keptHere: async () => true, log: () => {} })
    const turn = async (done: () => Promise<boolean>, what: string): Promise<void> => {
      folder.lifecycle.started?.(app())
      try {
        await until(done, what)
      } finally {
        await folder.lifecycle.stopping?.()
      }
    }
    await git(['remote', 'set-url', 'origin', join(base, 'gone.git')], personal)
    // A save made while the repository is away: committed here, and waiting to be sent.
    const saved = await withPersonalFolder(personal, 'a note made while the repository was away', () => writeFile(join(personal, 'note.md'), 'made here\n'))
    assert.deepEqual(saved.ok ? undefined : saved.committed, true)
    await turn(async () => (await folder.attention({}, fakeApp())).length === 1, 'a repository out of reach needs the person')
    await git(['remote', 'set-url', 'origin', remote], personal)
    await turn(async () => (await folder.attention({}, fakeApp())).length === 0, 'once it is back, a turn converges')
    assert.equal((await git(['rev-parse', 'HEAD'], personal)).trim(), (await git(['rev-parse', 'main'], remote)).trim(), 'what waited here was sent')
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(base, { recursive: true, force: true, maxRetries: 10 })
  }
})
