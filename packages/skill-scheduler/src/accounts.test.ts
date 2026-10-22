import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { DriverQuota } from '@openagt/agent-driver'
import { accountWindows, accountWithRoom } from './accounts.js'

const NOW = Date.parse('2026-09-16T14:01:00.000Z')
const HOUR = 60 * 60_000
const DAY = 24 * HOUR

/** The person's own week, four days from its reset, read live as `/usage` says it. */
const own = (percentUsed: number) => async (): Promise<DriverQuota> => ({ available: true, windows: [{ label: 'Current week (all models)', kind: 'week', percentUsed, resetsAt: NOW + 4 * DAY }] })

test("an added account's windows read as /usage names them; one whose reset has passed is empty again until its next", () => {
  assert.deepEqual(
    accountWindows([
      { window: 'five_hour', percentUsed: 40, resetsAt: NOW + HOUR },
      { window: 'seven_day', percentUsed: 61, resetsAt: NOW + 4 * DAY },
      { window: 'seven_day_opus', percentUsed: 12, resetsAt: NOW + 4 * DAY },
      { window: 'overage', percentUsed: 3, resetsAt: NOW + DAY },
    ], NOW),
    [
      { label: 'Current session', kind: 'session', percentUsed: 40, resetsAt: NOW + HOUR },
      { label: 'Current week (all models)', kind: 'week', percentUsed: 61, resetsAt: NOW + 4 * DAY },
      { label: 'Current week (Opus)', kind: 'week-model', percentUsed: 12, resetsAt: NOW + 4 * DAY },
      { label: 'overage', kind: 'unknown', percentUsed: 3, resetsAt: NOW + DAY },
    ],
  )
  assert.deepEqual(accountWindows([{ window: 'five_hour', percentUsed: 100, resetsAt: NOW - HOUR }, { window: 'seven_day', percentUsed: 97, resetsAt: NOW - DAY }], NOW), [
    { label: 'Current session', kind: 'session', percentUsed: 0, resetsAt: NOW + 4 * HOUR },
    { label: 'Current week (all models)', kind: 'week', percentUsed: 0, resetsAt: NOW + 6 * DAY },
  ])
})

test('unattended work goes on the first account under its line: one at its limit is passed over, one nothing was said of yet has room, and with none it says each one', async () => {
  const dani = { name: 'Dani', token: 't', windows: [{ window: 'seven_day', percentUsed: 10, resetsAt: NOW + 4 * DAY }] }
  assert.deepEqual(await accountWithRoom([{ name: 'Rom' }, dani], own(10), { now: NOW }), { account: 'Rom' })
  assert.deepEqual(await accountWithRoom([{ name: 'Rom' }, dani], own(90), { now: NOW }), { account: 'Dani' })
  assert.deepEqual(await accountWithRoom([{ name: 'Rom', limitedUntil: NOW + 2 * HOUR }, { name: 'New', token: 't' }], own(10), { now: NOW }), { account: 'New' })
  const none = await accountWithRoom([{ name: 'Rom' }, { ...dani, windows: [{ window: 'seven_day', percentUsed: 95, resetsAt: NOW + 4 * DAY }] }, { name: 'Out', token: 't', limitedUntil: NOW + 3 * HOUR }], own(90), { now: NOW })
  assert.ok('reason' in none)
  assert.match(none.reason, /^every Claude account is past its line \(Rom: Current week \(all models\) is 90% used, at or past day \d of the week's \d+%; Dani: Current week \(all models\) is 95% used, .*; Out is at its limit, free again in 3 h\)$/)
  // The person's own unread is no room on it; another account may still have some.
  assert.deepEqual(await accountWithRoom([{ name: 'Rom' }, dani], async () => ({ available: false, reason: 'timeout' }), { now: NOW }), { account: 'Dani' })
})
