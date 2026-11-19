import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { DEFAULT_POLL_MS, MAX_POLL_MS, QuotaPoller } from './quota-poller.js'
import type { DriverQuota } from '@openagt/agent-driver'

const T0 = 1_800_000_000_000

function goodAt(weeklyPercent: number, agentPercent = 1): DriverQuota {
  return {
    available: true,
    windows: [
      { label: 'Current session', kind: 'session', percentUsed: agentPercent },
      { label: 'Current week (all models)', kind: 'week', percentUsed: weeklyPercent },
      { label: 'Current week (Fable)', kind: 'week-model', percentUsed: 3 },
    ],
  }
}

/** A poller reading a scripted sequence, one entry per poll, on a fake clock. */
function pollerOf(script: DriverQuota[], startAt = T0) {
  let at = startAt
  let i = 0
  const poller = new QuotaPoller({
    read: () => Promise.resolve(script[Math.min(i++, script.length - 1)] as DriverQuota),
    now: () => at,
  })
  return { poller, advance: (ms: number) => (at += ms) }
}

test('QuotaPoller keeps the last good reading through a transient failure (#525)', async () => {
  const { poller, advance } = pollerOf([goodAt(10), { available: false, reason: 'fetch-failed' }])
  await poller.poll()
  advance(1000)
  await poller.poll()
  const env = poller.current()
  // The blip is the latest attempt, but a minute-old real number still stands:
  // blanking the bar would read as "nothing used".
  assert.deepEqual(env.latest, { available: false, reason: 'fetch-failed' })
  assert.ok(env.lastGood?.available)
  assert.equal(env.lastGoodAt, T0)
  assert.equal(env.lastFailureAt, T0 + 1000)
  assert.equal(poller.isStopped, false)
})

test('QuotaPoller backs off when the fetch keeps being refused (#525)', async () => {
  const { poller } = pollerOf([{ available: false, reason: 'fetch-failed' }])
  assert.equal(poller.intervalMs, DEFAULT_POLL_MS)
  await poller.poll()
  assert.equal(poller.intervalMs, DEFAULT_POLL_MS * 2)
  await poller.poll()
  // Retrying harder would sit inside the upstream penalty window and keep the
  // number permanently unavailable.
  assert.equal(poller.intervalMs, DEFAULT_POLL_MS * 4)
})

test('QuotaPoller stops stretching the gap at the ceiling (#525)', async () => {
  const { poller } = pollerOf([{ available: false, reason: 'timeout' }])
  for (let i = 0; i < 20; i++) await poller.poll()
  assert.equal(poller.intervalMs, MAX_POLL_MS)
})

test('QuotaPoller returns to the normal gap once the fetch works again (#525)', async () => {
  const { poller } = pollerOf([{ available: false, reason: 'fetch-failed' }, { available: false, reason: 'fetch-failed' }, goodAt(9)])
  await poller.poll()
  await poller.poll()
  assert.ok(poller.intervalMs > DEFAULT_POLL_MS)
  await poller.poll()
  assert.equal(poller.intervalMs, DEFAULT_POLL_MS)
})

test('QuotaPoller drops the reading on an authoritative failure and heals on the next good one', async () => {
  const { poller } = pollerOf([goodAt(10), { available: false, reason: 'no-subscription' }, goodAt(12)])
  await poller.poll()
  await poller.poll()
  // The retained reading would misrepresent an account with no subscription.
  assert.equal(poller.current().lastGood, undefined)
  assert.equal(poller.current().lastGoodAt, undefined)
  // It keeps asking, slower: a login, or an update swapping the CLI, changes the answer.
  assert.equal(poller.isStopped, false)
  assert.equal(poller.intervalMs, DEFAULT_POLL_MS * 2)
  await poller.poll()
  assert.equal(poller.current().lastGood?.available, true)
  assert.equal(poller.intervalMs, DEFAULT_POLL_MS)
})

test('QuotaPoller keeps asking when the agent is missing: an update swapping the CLI looks the same', async () => {
  const { poller } = pollerOf([{ available: false, reason: 'agent-not-found' }, goodAt(10)])
  await poller.poll()
  assert.equal(poller.isStopped, false)
  await poller.poll()
  assert.equal(poller.current().lastGood?.available, true)
})

test('QuotaPoller keeps polling after a readout it did not recognize (#960)', async () => {
  const { poller, advance } = pollerOf([goodAt(10), { available: false, reason: 'unrecognized' }])
  await poller.poll()
  advance(1000)
  await poller.poll()
  // One unhandled answer is not a verdict on the account: an update notice ahead
  // of the JSON reads exactly like this and is gone by the next read.
  assert.equal(poller.isStopped, false)
  assert.ok(poller.current().lastGood?.available)
})

test('QuotaPoller recovers once the readout is recognized again (#960)', async () => {
  const { poller } = pollerOf([{ available: false, reason: 'unrecognized' }, goodAt(42)])
  await poller.poll()
  await poller.poll()
  // The bug this pins: a single bad first read used to stop the poller for the
  // daemon's whole life, so the usage bar never came back and looked reverted.
  assert.equal(poller.isStopped, false)
  assert.equal(poller.current().lastGood?.windows.find(w => w.kind === 'week')?.percentUsed, 42)
  assert.equal(poller.intervalMs, DEFAULT_POLL_MS)
})

test('QuotaPoller survives a driver that throws (#525)', async () => {
  const poller = new QuotaPoller({ read: () => Promise.reject(new Error('spawn exploded')), now: () => T0 })
  const quota = await poller.poll()
  // A throw is the same story as a failed fetch: this attempt told us nothing.
  assert.deepEqual(quota, { available: false, reason: 'fetch-failed' })
  assert.equal(poller.isStopped, false)
})

test('QuotaPoller.stop is idempotent and start does not revive it (#525)', () => {
  const { poller } = pollerOf([goodAt(1)])
  poller.stop()
  poller.stop()
  poller.start()
  assert.equal(poller.isStopped, true)
})
