import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { pollerQuotaSource } from './quota.js'
import { QuotaPoller } from '../quota-poller.js'
import type { DriverQuota } from '@openagt/agent-driver'

/** 2026-07-20T12:00:00Z. The week below resets in 5 days, so this is day 3 of 7. */
const T0 = Date.UTC(2026, 6, 20, 12, 0, 0)
const HOUR = 60 * 60 * 1000

function week(percentUsed: number): DriverQuota {
  return {
    available: true,
    windows: [
      { label: 'Current session', kind: 'session', percentUsed: 2, resetsAtText: 'in 2h 53m' },
      { label: 'Current week (all models)', kind: 'week', percentUsed, resetsAtText: 'Jul 25 at 7am (UTC)' },
    ],
  }
}

function sourceOf(script: DriverQuota[]) {
  let at = T0
  let i = 0
  const poller = new QuotaPoller({ read: () => Promise.resolve(script[Math.min(i++, script.length - 1)] as DriverQuota), now: () => at })
  return { source: pollerQuotaSource(poller, () => at), poller, advance: (ms: number) => (at += ms) }
}

test('the usage panel gets the account windows and where the boundary stands (#533/#879)', async () => {
  const { source, poller, advance } = sourceOf([week(10), week(16)])
  await poller.poll()
  advance(HOUR)
  await poller.poll()
  const view = await source.read()
  // The account's own bars, as Traycer shows them.
  assert.equal(view.windows.length, 2)
  assert.equal(view.windows.find(w => w.kind === 'week')?.percentUsed, 16)
  assert.equal(view.readAt, T0 + HOUR)
  assert.equal(view.unavailable, undefined)
  // And the boundary: day 3 of the week allows three sevenths of it, and 16% is under that.
  assert.equal(view.boundary?.day, 3)
})

test('the boundary moves with the clock rather than with the reading (#879)', async () => {
  const { source, poller, advance } = sourceOf([week(50)])
  await poller.poll()
  const before = (await source.read()).boundary
  assert.equal(before?.day, 3)
  // Two days later the boundary has moved on, with no new reading.
  advance(2 * 24 * HOUR)
  const later = await source.read()
  assert.equal(later.boundary?.day, 5)
  assert.ok(later.boundary!.percent > before!.percent)
})

test('the usage panel keeps the last reading and marks it stale on a blip (#533)', async () => {
  const { source, poller, advance } = sourceOf([week(10), { available: false, reason: 'fetch-failed' }])
  await poller.poll()
  advance(1000)
  await poller.poll()
  const view = await source.read()
  // The number is a second old; blanking it would read as "nothing used".
  assert.equal(view.windows.find(w => w.kind === 'week')?.percentUsed, 10)
  assert.equal(view.readAt, T0)
  assert.equal(view.unavailable, 'fetch-failed')
})

test('the usage panel reports no reading rather than an empty one (#533)', async () => {
  const { source } = sourceOf([{ available: false, reason: 'no-subscription' }])
  const view = await source.read()
  assert.deepEqual(view.windows, [])
  // Absent, not a boundary of zero: we cannot read the account at all.
  assert.equal(view.boundary, undefined)
})

test('an unplaceable week leaves the boundary absent rather than guessed (#879)', async () => {
  const { source, poller } = sourceOf([
    { available: true, windows: [{ label: 'Current week (all models)', kind: 'week', percentUsed: 10 }] },
  ])
  await poller.poll()
  const view = await source.read()
  assert.equal(view.windows.length, 1)
  assert.equal(view.boundary, undefined)
})

test('stopping the source ends the polling (#533)', () => {
  const { source, poller } = sourceOf([week(10)])
  source.stop()
  assert.equal(poller.isStopped, true)
})
