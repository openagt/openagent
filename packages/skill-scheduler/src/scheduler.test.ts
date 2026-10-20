import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { DriverQuota } from '@openagt/agent-driver'
import { QUOTA_KEPT_MS } from './names.js'
import { keepQuota } from './scheduler.js'

// Claude's quota, read once and used again for a while: a read spawns the CLI and takes seconds.

test('a reading is used again while it is young, read anew once it is old, and never kept when it could not be made', async () => {
  let reads = 0
  let answer: DriverQuota = { available: true, windows: [] }
  let now = 1_000_000
  const quota = keepQuota(async () => (reads++, answer), () => now)
  await quota()
  now += QUOTA_KEPT_MS - 1
  await quota()
  assert.equal(reads, 1, 'young: used again')
  now += 1
  await quota()
  assert.equal(reads, 2, 'old: read anew')
  answer = { available: false, reason: 'fetch-failed' }
  now += QUOTA_KEPT_MS
  assert.deepEqual(await quota(), answer)
  assert.deepEqual(await quota(), answer)
  assert.equal(reads, 4, 'a reading that could not be made is asked again')
})
