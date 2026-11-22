import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { ProjectRef } from './project.js'
import { chainStore, checkPath, isStorePath, isUnder, PERSON, COMPUTER, projectScope, type Scope, type Store, type StoreBackend } from './store.js'
import { memoryStore } from './testing.js'

// The store's chain: which backend sees a call first, what a backend passes on, what reaches the
// end of the chain, and the paths a store takes.

const SHARED: ProjectRef = { id: 'shared', name: 'Shared', dir: '/projects/shared', remote: 'github.com/acme/shared' }
const MINE: ProjectRef = { id: 'mine', name: 'Mine', dir: '/projects/mine' }

/** A backend that passes every call on, writing its name down for each read it sees, and the context it was given. */
function tap(name: string, order: number, seen: string[]): StoreBackend {
  return {
    order,
    wrap: (next, context) => ({
      read: async (scope, path, opts) => {
        seen.push(context.oneShot ? `${name} (one shot)` : name)
        return next.read(scope, path, opts)
      },
      list: (scope, dir, opts) => next.list(scope, dir, opts),
      save: (scope, changes, message) => next.save(scope, changes, message),
      watch: (scope, path, onChange) => next.watch(scope, path, onChange),
    }),
  }
}

/** A backend that keeps one project's data in a store of its own and passes every other scope on, as a git branch store does. */
function keeps(project: ProjectRef, order: number): StoreBackend & { own: ReturnType<typeof memoryStore> } {
  const own = memoryStore()
  return {
    order,
    own,
    wrap(next, context) {
      const mine = own.wrap(next, context)
      const pick = (scope: Scope): Store => (scope.kind === 'project' && scope.project.id === project.id ? mine : next)
      return {
        read: (scope, path, opts) => pick(scope).read(scope, path, opts),
        list: (scope, dir, opts) => pick(scope).list(scope, dir, opts),
        save: (scope, changes, message) => pick(scope).save(scope, changes, message),
        watch: (scope, path, onChange) => pick(scope).watch(scope, path, onChange),
      }
    },
  }
}

test('a lower order wraps a higher one, and at the same order the first one given sees a call first', async () => {
  const seen: string[] = []
  const base = memoryStore()
  const store = chainStore([base, tap('inner', -100, seen), tap('outer', -200, seen), tap('outer-second', -200, seen)])
  await store.save(PERSON, { 'a.json': '{}' }, 'a')
  assert.equal(await store.read(PERSON, 'a.json'), '{}', 'the call went through to the end of the chain')
  assert.deepEqual(seen, ['outer', 'outer-second', 'inner'])
  const once: string[] = []
  await chainStore([base, tap('git', -100, once)], { oneShot: true }).read(PERSON, 'a.json')
  assert.deepEqual(once, ['git (one shot)'], 'every backend is told what process it runs in')
})

test('a backend keeps the scope it owns and passes every other one on', async () => {
  const branch = keeps(SHARED, -200)
  const base = memoryStore()
  const store = chainStore([base, branch])
  await store.save(projectScope(SHARED), { 'tickets/a.md': '# A' }, 'ticket a')
  await store.save(projectScope(MINE), { 'tickets/b.md': '# B' }, 'ticket b')
  await store.save(PERSON, { 'profiles/default.json': '{}' }, 'profile')
  assert.deepEqual(branch.own.files(projectScope(SHARED)), { 'tickets/a.md': '# A' })
  assert.deepEqual(base.files(projectScope(SHARED)), {}, 'the shared project never reached the store below')
  assert.deepEqual(base.files(projectScope(MINE)), { 'tickets/b.md': '# B' })
  assert.deepEqual(base.files(PERSON), { 'profiles/default.json': '{}' })
})

test('a call no backend keeps is refused, naming its scope', async () => {
  const store = chainStore([])
  await assert.rejects(store.read(projectScope(MINE), 'a.json'), /No store keeps the project:mine data/)
  await assert.rejects(store.save(COMPUTER, { 'a.json': '' }, 'a'), /No store keeps the computer data/)
  assert.throws(() => store.watch(PERSON, '', () => {}), /No store keeps the person data/)
})

test('a store takes relative paths separated by /, without empty, . or .. parts', () => {
  for (const path of ['a.json', 'tickets/a.md', '.openagent/settings.json']) assert.ok(isStorePath(path), path)
  for (const path of ['', '/etc/passwd', 'a//b', './a', 'a/../b', '..', 'a\\b', 'a/']) assert.ok(!isStorePath(path), JSON.stringify(path))
  assert.equal(checkPath('', { dir: true }), '', "a folder may be the scope's top")
  assert.throws(() => checkPath(''), /is no path in a store/)
  assert.ok(isUnder('tickets/a.md', 'tickets') && isUnder('tickets', 'tickets') && isUnder('a', ''))
  assert.ok(!isUnder('tickets-old/a.md', 'tickets'), 'a folder whose name starts the same is another folder')
})

test('the memory store: saves several files at once, removes with null, lists under a folder and tells its watchers', async () => {
  const backend = memoryStore()
  const store = chainStore([backend])
  const scope = projectScope(MINE)
  const changed: string[] = []
  const stop = store.watch(scope, 'runs', path => changed.push(path))
  await store.save(scope, { 'runs/1.json': '{"id":"1"}', 'runs/2.json': '{"id":"2"}', 'tickets/a.md': '# A' }, 'two runs and a ticket')
  await store.save(scope, { 'runs/2.json': null }, 'run 2 deleted')
  assert.deepEqual(await store.list(scope, 'runs'), ['runs/1.json'])
  assert.deepEqual(await store.list(scope, ''), ['runs/1.json', 'tickets/a.md'])
  assert.equal(await store.read(scope, 'runs/2.json'), undefined)
  assert.deepEqual(changed, ['runs/1.json', 'runs/2.json', 'runs/2.json'], 'the ticket is not under runs')
  stop()
  await store.save(scope, { 'runs/3.json': '{}' }, 'run 3')
  assert.equal(changed.length, 3, 'a watcher that stopped hears nothing more')
  assert.deepEqual(
    backend.saves.map(save => [save.message, save.paths]),
    [
      ['two runs and a ticket', ['runs/1.json', 'runs/2.json', 'tickets/a.md']],
      ['run 2 deleted', ['runs/2.json']],
      ['run 3', ['runs/3.json']],
    ],
  )
  assert.deepEqual(await store.list(projectScope(SHARED), ''), [], 'each scope has its own files')
  await assert.rejects(store.read(scope, '../p2/a.json'), /is no path in a store/)
})

test('a save made from the files as they are: its message once it is made, and nothing saved when it throws', async () => {
  const backend = memoryStore()
  const store = chainStore([backend])
  const scope = projectScope(MINE)
  await store.save(scope, { 'tickets/a.md': '# A', 'tickets/b.md': '# B', 'tickets/b.lock.md': 'CLAIMED: run-1\n' }, 'tickets')
  let claimed: string[] = []
  await store.save(
    scope,
    async files => {
      const tickets = (await files.list('tickets')).filter(path => !path.endsWith('.lock.md'))
      const free: string[] = []
      for (const ticket of tickets) if ((await files.read(ticket.replace(/\.md$/, '.lock.md'))) === undefined) free.push(ticket)
      claimed = free
      return Object.fromEntries(free.map(ticket => [ticket.replace(/\.md$/, '.lock.md'), 'CLAIMED: run-2\n']))
    },
    () => `claim ${claimed.length} ticket`,
  )
  assert.deepEqual(claimed, ['tickets/a.md'])
  assert.equal(await store.read(scope, 'tickets/a.lock.md'), 'CLAIMED: run-2\n')
  assert.equal(backend.saves.at(-1)?.message, 'claim 1 ticket')
  await assert.rejects(
    store.save(
      scope,
      () => {
        throw new Error('run-1 holds tickets/b.md')
      },
      'release b',
    ),
    /run-1 holds tickets\/b.md/,
  )
  assert.equal(backend.saves.length, 2, 'an update that threw saves nothing')
  await assert.rejects(store.save(scope, () => ({ '../x': 'y' }), 'escape'), /is no path in a store/)
})
