import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { DriverQuota } from '@openagt/agent-driver'
import { QUOTA_KEPT_MS } from './names.js'
import { keepQuota, startScheduler } from './scheduler.js'
import { readState } from './state.js'
import { removeRepo, testRepo } from './test-repo.js'

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

test('a stop ends the scheduler after the tick in flight: ticks that outlasted the interval do not wait in a line it has to run first', async () => {
  const repo = await testRepo()
  try {
    // An interval far shorter than a tick, as a slow pull or a check at its limit makes of the real minute.
    const ticks: number[] = []
    const running = startScheduler(repo, { foreground: true, everyMs: 1, log: line => void (line.startsWith('[scheduler] tick') && ticks.push(Date.now())) })
    while (ticks.length < 3) await new Promise(resolve => setTimeout(resolve, 5))
    await new Promise(resolve => setTimeout(resolve, 300))
    const stoppedAt = Date.now()
    process.emit('SIGINT', 'SIGINT')
    await running
    assert.equal(ticks.filter(at => at > stoppedAt).length <= 1, true, `only the tick in flight ends after the stop, not ${ticks.filter(at => at > stoppedAt).length}`)
    assert.equal((await readState(repo)).pid, undefined)
  } finally {
    await removeRepo(repo)
  }
})
