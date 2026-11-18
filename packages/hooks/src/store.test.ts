import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { chainStore, checkPath, isStorePath, isUnder, PERSON, COMPUTER, projectScope, type Scope, type Store, type StoreBackend } from './store.js'
import { memoryStore } from './testing.js'

// The store's chain: which backend sees a call first, what a backend passes on, what reaches the
// end of the chain, and the paths a store takes.

/** A backend that passes every call on, writing its name down for each read it sees. */
function tap(name: string, order: number, seen: string[]): StoreBackend {
  return {
    order,
    wrap: next => ({
      read: async (scope, path, opts) => {
        seen.push(name)
        return next.read(scope, path, opts)
      },
      list: (scope, dir, opts) => next.list(scope, dir, opts),
      save: (scope, changes, message) => next.save(scope, changes, message),
      append: (scope, path, line) => next.append(scope, path, line),
      watch: (scope, path, onChange) => next.watch(scope, path, onChange),
    }),
  }
}

/** A backend that keeps one project's data in a store of its own and passes every other scope on, as a git branch store does. */
function keeps(project: string, order: number): StoreBackend & { own: ReturnType<typeof memoryStore> } {
  const own = memoryStore()
  return {
    order,
    own,
    wrap(next) {
      const mine = own.wrap(next)
      const pick = (scope: Scope): Store => (scope.kind === 'project' && scope.project === project ? mine : next)
      return {
        read: (scope, path, opts) => pick(scope).read(scope, path, opts),
        list: (scope, dir, opts) => pick(scope).list(scope, dir, opts),
        save: (scope, changes, message) => pick(scope).save(scope, changes, message),
        append: (scope, path, line) => pick(scope).append(scope, path, line),
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
})

test('a backend keeps the scope it owns and passes every other one on', async () => {
  const branch = keeps('shared', -200)
  const base = memoryStore()
  const store = chainStore([base, branch])
  await store.save(projectScope('shared'), { 'tickets/a.md': '# A' }, 'ticket a')
  await store.save(projectScope('mine'), { 'tickets/b.md': '# B' }, 'ticket b')
  await store.save(PERSON, { 'presets/default.json': '{}' }, 'preset')
  assert.deepEqual(branch.own.files(projectScope('shared')), { 'tickets/a.md': '# A' })
  assert.deepEqual(base.files(projectScope('shared')), {}, 'the shared project never reached the store below')
  assert.deepEqual(base.files(projectScope('mine')), { 'tickets/b.md': '# B' })
  assert.deepEqual(base.files(PERSON), { 'presets/default.json': '{}' })
})

test('a call no backend keeps is refused, naming its scope', async () => {
  const store = chainStore([])
  await assert.rejects(store.read(projectScope('p1'), 'a.json'), /No store keeps the project:p1 data/)
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

test('the memory store: saves several files at once, removes with null, lists under a folder, appends lines and tells its watchers', async () => {
  const backend = memoryStore()
  const store = chainStore([backend])
  const scope = projectScope('p1')
  const changed: string[] = []
  const stop = store.watch(scope, 'runs', path => changed.push(path))
  await store.save(scope, { 'runs/1.json': '{"id":"1"}', 'runs/2.json': '{"id":"2"}', 'tickets/a.md': '# A' }, 'two runs and a ticket')
  await store.save(scope, { 'runs/2.json': null }, 'run 2 deleted')
  await store.append(scope, 'runs/1.jsonl', '{"type":"text","text":"hi"}')
  await store.append(scope, 'runs/1.jsonl', '{"type":"text","text":"there"}')
  assert.deepEqual(await store.list(scope, 'runs'), ['runs/1.json', 'runs/1.jsonl'])
  assert.deepEqual(await store.list(scope, ''), ['runs/1.json', 'runs/1.jsonl', 'tickets/a.md'])
  assert.equal(await store.read(scope, 'runs/1.jsonl'), '{"type":"text","text":"hi"}\n{"type":"text","text":"there"}\n')
  assert.equal(await store.read(scope, 'runs/2.json'), undefined)
  assert.deepEqual(changed, ['runs/1.json', 'runs/2.json', 'runs/2.json', 'runs/1.jsonl', 'runs/1.jsonl'], 'the ticket is not under runs')
  stop()
  await store.save(scope, { 'runs/3.json': '{}' }, 'run 3')
  assert.equal(changed.length, 5, 'a watcher that stopped hears nothing more')
  assert.deepEqual(
    backend.saves.map(save => [save.message, save.paths]),
    [
      ['two runs and a ticket', ['runs/1.json', 'runs/2.json', 'tickets/a.md']],
      ['run 2 deleted', ['runs/2.json']],
      ['run 3', ['runs/3.json']],
    ],
    'appends are no saves',
  )
  assert.deepEqual(await store.list(projectScope('p2'), ''), [], 'each scope has its own files')
  await assert.rejects(store.read(scope, '../p2/a.json'), /is no path in a store/)
})
