import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { cachedRead, clearCache, invalidate } from './cache.js'

/** What a cached read answered, without the moment it was read: these tests are about the answer. */
const answer = <T>(read: { value: T | undefined; pending: boolean }): { value: T | undefined; pending: boolean } => ({ value: read.value, pending: read.pending })

// A promise you resolve by hand, so a "slow" read is slow on purpose rather than by sleeping.
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const settle = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

beforeEach(() => clearCache())

test('concurrent asks for the same key share one call (#1028)', async () => {
  let calls = 0
  const gate = deferred<string>()
  const load = async (): Promise<string> => {
    calls++
    return gate.promise
  }
  const both = Promise.all([cachedRead('k', load, { budgetMs: 50 }), cachedRead('k', load, { budgetMs: 50 })])
  gate.resolve('pr-1')
  const [a, b] = await both
  assert.equal(calls, 1) // two panels and a poll tick must not become three subprocesses
  assert.deepEqual([a.value, b.value], ['pr-1', 'pr-1'])
})

test('a known value answers without calling again, until it is stale', async () => {
  let calls = 0
  const load = async (): Promise<number> => ++calls
  let now = 1000
  const opts = { ttlMs: 100, budgetMs: 50, now: () => now }

  assert.deepEqual(answer(await cachedRead('k', load, opts)), { value: 1, pending: false })
  assert.deepEqual(answer(await cachedRead('k', load, opts)), { value: 1, pending: false })
  assert.equal(calls, 1)

  // Past the TTL the caller still gets the old value at once; the refresh happens behind it.
  now += 200
  assert.deepEqual(answer(await cachedRead('k', load, opts)), { value: 1, pending: false })
  await settle()
  assert.equal(calls, 2)
  assert.deepEqual(answer(await cachedRead('k', load, opts)), { value: 2, pending: false })
})

test('a first ask slower than the budget reports pending, and the answer lands for the next one', async () => {
  const gate = deferred<string>()
  const load = (): Promise<string> => gate.promise
  const first = await cachedRead('k', load, { budgetMs: 5 })
  // Not "there is no PR" — "not known yet", which is what a caller needs to tell them apart.
  assert.deepEqual(first, { value: undefined, pending: true })

  gate.resolve('pr-9')
  await settle()
  assert.deepEqual(answer(await cachedRead('k', load, { budgetMs: 5 })), { value: 'pr-9', pending: false })
})

test('a failed read keeps the last good value rather than dropping it', async () => {
  let attempt = 0
  const load = async (): Promise<string> => {
    attempt++
    if (attempt === 2) throw new Error('gh exploded')
    return `v${attempt}`
  }
  let now = 0
  const opts = { ttlMs: 10, budgetMs: 50, now: () => now }
  assert.equal((await cachedRead('k', load, opts)).value, 'v1')

  now += 100 // stale: the background refresh runs and fails
  assert.equal((await cachedRead('k', load, opts)).value, 'v1')
  await settle()
  // The panel keeps showing the PR it knew about instead of losing it to one bad call.
  assert.equal((await cachedRead('k', load, opts)).value, 'v1')
})

test('invalidate forces the next read to go again', async () => {
  let calls = 0
  const load = async (): Promise<number> => ++calls
  assert.equal((await cachedRead('k', load, { budgetMs: 50 })).value, 1)
  invalidate('k')
  assert.equal((await cachedRead('k', load, { budgetMs: 50 })).value, 2)
})

test('a cached answer says when it was read, for a caller that knows of something that happened since', async () => {
  let clock = 1_000
  const now = (): number => clock
  const read = await cachedRead('when', async () => 'first', { now })
  assert.equal(read.at, 1_000, 'the moment the value landed')
  clock = 2_000
  const again = await cachedRead('when', async () => 'second', { now })
  assert.deepEqual([again.value, again.at], ['first', 1_000], 'still the first answer, still its own age')
  // Thrown away and read anew: the age is the new read's.
  invalidate('when')
  const fresh = await cachedRead('when', async () => 'third', { now })
  assert.deepEqual([fresh.value, fresh.at], ['third', 2_000])
})
