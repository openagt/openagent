import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { boundaryFromResetsAt, parseResetsAt, quotaBoundaryStatus, QUOTA_WEEK_MS } from './quota-boundary.js'
import type { DriverQuotaWindow } from '@openagt/agent-driver'

const DAY = 24 * 60 * 60 * 1000

/** 2026-07-20T12:00:00Z, a Monday. */
const NOW = Date.UTC(2026, 6, 20, 12, 0, 0)

function weekWindow(percentUsed: number, resetsAtText = 'Jul 25 at 7am (UTC)'): DriverQuotaWindow {
  return { label: 'Current week (all models)', kind: 'week', percentUsed, resetsAtText }
}

test('parses the agent\'s reset prose to an epoch', () => {
  assert.equal(parseResetsAt('Jul 25 at 7am (UTC)', NOW), Date.UTC(2026, 6, 25, 7, 0))
  assert.equal(parseResetsAt('Jul 20 at 7:30pm (UTC)', NOW), Date.UTC(2026, 6, 20, 19, 30))
  assert.equal(parseResetsAt('Jul 25 at 12am (UTC)', NOW), Date.UTC(2026, 6, 25, 0, 0))
  assert.equal(parseResetsAt('Jul 25 at 12pm (UTC)', NOW), Date.UTC(2026, 6, 25, 12, 0))
})

test('parses the comma phrasing newer Claude Code prints instead of `at`', () => {
  assert.equal(parseResetsAt('Jul 25, 7am (UTC)', NOW), Date.UTC(2026, 6, 25, 7, 0))
  assert.equal(parseResetsAt('Jul 26, 4:50am (Europe/Berlin)', NOW), Date.UTC(2026, 6, 26, 2, 50))
})

test('picks the year that puts the reset near now, across the new year', () => {
  const newYearsEve = Date.UTC(2026, 11, 31, 12, 0)
  assert.equal(parseResetsAt('Jan 3 at 7am (UTC)', newYearsEve), Date.UTC(2027, 0, 3, 7, 0))
  const newYear = Date.UTC(2027, 0, 2, 12, 0)
  assert.equal(parseResetsAt('Dec 30 at 7am (UTC)', newYear), Date.UTC(2026, 11, 30, 7, 0))
})

test('resolves a named zone, including across a DST change', () => {
  // Europe/Berlin is UTC+2 in July.
  assert.equal(parseResetsAt('Jul 25 at 7am (Europe/Berlin)', NOW), Date.UTC(2026, 6, 25, 5, 0))
  // ...and UTC+1 in January, on the other side of the change.
  const winter = Date.UTC(2027, 0, 2, 12, 0)
  assert.equal(parseResetsAt('Jan 5 at 7am (Europe/Berlin)', winter), Date.UTC(2027, 0, 5, 6, 0))
})

test('refuses prose it cannot place rather than guessing', () => {
  assert.equal(parseResetsAt('soon', NOW), undefined)
  assert.equal(parseResetsAt('Foo 25 at 7am (UTC)', NOW), undefined)
  assert.equal(parseResetsAt('Jul 25 at 13am (UTC)', NOW), undefined)
  assert.equal(parseResetsAt('Jul 25 at 7am (Not/AZone)', NOW), undefined)
})

test('percent rises continuously with the elapsed share of the week (#960 Edit)', () => {
  const resetsAt = NOW + 5 * DAY
  const start = resetsAt - QUOTA_WEEK_MS
  // The first instant of the week: nothing has elapsed yet, so nothing is allowed yet either —
  // no once-a-day jump hands out a whole seventh up front.
  assert.deepEqual(boundaryFromResetsAt(resetsAt, start), { startsAt: start, resetsAt, day: 1, percent: 0 })
  // A quarter of the way into the week (1.75 of 7 days) is a plain 25%, not rounded to a day.
  assert.equal(boundaryFromResetsAt(resetsAt, start + 1.75 * DAY).percent, 25)
  assert.equal(boundaryFromResetsAt(resetsAt, start + 3.5 * DAY).percent, 50)
})

test('day still names which day of the week now falls on, independently of percent', () => {
  const resetsAt = NOW + 5 * DAY
  const start = resetsAt - QUOTA_WEEK_MS
  assert.equal(boundaryFromResetsAt(resetsAt, start).day, 1)
  assert.equal(boundaryFromResetsAt(resetsAt, start + DAY - 1).day, 1)
  // It steps at the second the week's own day rolls over, not at midnight.
  assert.equal(boundaryFromResetsAt(resetsAt, start + DAY).day, 2)
  assert.equal(boundaryFromResetsAt(resetsAt, start + 2.5 * DAY).day, 3)
})

test('the boundary reaches the full allowance exactly as the week resets, not a day early', () => {
  const resetsAt = NOW + DAY
  const start = resetsAt - QUOTA_WEEK_MS
  // A day before the reset (day 7 of 7), only six sevenths have actually elapsed — the whole
  // week's allowance is not handed out in a lump the moment day 7 begins.
  const dayBefore = boundaryFromResetsAt(resetsAt, NOW)
  assert.equal(dayBefore.day, 7)
  assert.equal(dayBefore.percent, (6 / 7) * 100)
  // Only at the exact instant the week resets does it reach 100.
  assert.equal(boundaryFromResetsAt(resetsAt, resetsAt).percent, 100)
  assert.equal(boundaryFromResetsAt(resetsAt, start).percent, 0)
})

test('a week already over reads as its last day, not as day eight', () => {
  const resetsAt = NOW - DAY
  assert.equal(boundaryFromResetsAt(resetsAt, NOW).day, 7)
})

test('measures the account week against the boundary', () => {
  // Reset in 5 days => 2 days 5 hours elapsed => day 3, ~31.5% allowed continuously (#960 Edit).
  const status = quotaBoundaryStatus({ windows: [weekWindow(16)], now: NOW })
  assert.ok(status)
  assert.equal(status.boundary.day, 3)
  assert.equal(status.reached, null)

  const spent = quotaBoundaryStatus({ windows: [weekWindow(50)], now: NOW })
  assert.equal(spent?.reached?.label, 'Current week (all models)')
})

test('the selected model\'s own week binds too, and only that model\'s', () => {
  const fable: DriverQuotaWindow = { label: 'Current week (Fable)', kind: 'week-model', percentUsed: 90 }
  const opus: DriverQuotaWindow = { label: 'Current week (Opus)', kind: 'week-model', percentUsed: 95 }

  const onFable = quotaBoundaryStatus({ windows: [weekWindow(10), fable, opus], now: NOW, model: 'claude-fable-5' })
  assert.equal(onFable?.windows.length, 2)
  assert.equal(onFable?.reached?.label, 'Current week (Fable)')

  // A spent Fable week must not stop work on another model.
  const onSonnet = quotaBoundaryStatus({ windows: [weekWindow(10), fable, opus], now: NOW, model: 'claude-sonnet-5' })
  assert.equal(onSonnet?.windows.length, 1)
  assert.equal(onSonnet?.reached, null)

  // With no model to match, only the account's own week is in force.
  const noModel = quotaBoundaryStatus({ windows: [weekWindow(10), fable], now: NOW })
  assert.equal(noModel?.windows.length, 1)
})

test('reports nothing when the week cannot be placed', () => {
  assert.equal(quotaBoundaryStatus({ windows: [], now: NOW }), undefined)
  // A week window with no reset prose: the percentage alone says nothing about
  // where in the week we are.
  assert.equal(quotaBoundaryStatus({ windows: [{ label: 'Current week (all models)', kind: 'week', percentUsed: 16 }], now: NOW }), undefined)
  assert.equal(quotaBoundaryStatus({ windows: [weekWindow(16, 'later')], now: NOW }), undefined)
})

test('the limit is the boundary until the user moves it (#960)', () => {
  const status = quotaBoundaryStatus({ windows: [weekWindow(16)], now: NOW })!
  assert.equal(status.limit.offset, 0)
  assert.equal(status.limit.percent, status.boundary.percent)
})

test('the slider moves the line work stops at, without moving the boundary (#960)', () => {
  // 16% used against a boundary that has not reached it yet: room to spare.
  const base = quotaBoundaryStatus({ windows: [weekWindow(16)], now: NOW })!
  assert.equal(base.reached, null)

  // Pulled back below what is already spent, the same reading is now over the line. The boundary
  // itself is untouched — that is the whole reason limit and boundary are separate values.
  const strict = quotaBoundaryStatus({ windows: [weekWindow(16)], now: NOW, limitOffset: -base.boundary.percent })!
  assert.equal(strict.boundary.percent, base.boundary.percent)
  assert.equal(strict.limit.percent, 0)
  assert.equal(strict.limit.offset, -base.boundary.percent)
  assert.equal(strict.reached?.percentUsed, 16)

  // Pushed forward, an account that had reached the boundary gets room again.
  const spent = quotaBoundaryStatus({ windows: [weekWindow(50)], now: NOW })!
  assert.notEqual(spent.reached, null)
  const lenient = quotaBoundaryStatus({ windows: [weekWindow(50)], now: NOW, limitOffset: 40 })!
  assert.equal(lenient.reached, null)
})

test('a limit dragged past either end of the week stops at the week (#960)', () => {
  // Unclamped, a negative limit would read as "always stopped" and one over 100 as "never stops".
  const low = quotaBoundaryStatus({ windows: [weekWindow(0)], now: NOW, limitOffset: -500 })!
  assert.equal(low.limit.percent, 0)
  const high = quotaBoundaryStatus({ windows: [weekWindow(99)], now: NOW, limitOffset: 500 })!
  assert.equal(high.limit.percent, 100)
  // 99% used is still under a limit pinned at the top of the week, so work may still run.
  assert.equal(high.reached, null)
})

