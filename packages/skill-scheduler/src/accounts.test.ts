import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { DriverQuota } from '@openagt/agent-driver'
import { accountWindows, accountWithRoom, readClaudeAccount, readCodexAccount } from './accounts.js'

const NOW = Date.parse('2026-09-16T14:01:00.000Z')
const HOUR = 60 * 60_000
const DAY = 24 * HOUR

/** The person's own week, four days from its reset, read live as `/usage` says it. */
const own = (percentUsed: number) => readClaudeAccount(async (): Promise<DriverQuota> => ({ available: true, windows: [{ label: 'Current week (all models)', kind: 'week', percentUsed, resetsAt: NOW + 4 * DAY }] }))

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
  const dani = { name: 'Dani', login: 't', windows: [{ window: 'seven_day', percentUsed: 10, resetsAt: NOW + 4 * DAY }] }
  assert.deepEqual(await accountWithRoom([{ name: 'Rom' }, dani], own(10), { now: NOW }), { account: 'Rom' })
  assert.deepEqual(await accountWithRoom([{ name: 'Rom' }, dani], own(90), { now: NOW }), { account: 'Dani' })
  assert.deepEqual(await accountWithRoom([{ name: 'Rom', limitedUntil: NOW + 2 * HOUR }, { name: 'New', login: 't' }], own(10), { now: NOW }), { account: 'New' })
  const none = await accountWithRoom([{ name: 'Rom' }, { ...dani, windows: [{ window: 'seven_day', percentUsed: 95, resetsAt: NOW + 4 * DAY }] }, { name: 'Out', login: 't', limitedUntil: NOW + 3 * HOUR }], own(90), { now: NOW })
  assert.ok('reason' in none)
  assert.match(none.reason, /^every Claude account is past its line \(Rom: Current week \(all models\) is 90% used, at or past day \d of the week's \d+%; Dani: Current week \(all models\) is 95% used, .*; Out is at its limit, free again in 3 h\)$/)
  // The person's own unread is no room on it; another account may still have some.
  assert.deepEqual(await accountWithRoom([{ name: 'Rom' }, dani], readClaudeAccount(async () => ({ available: false, reason: 'timeout' })), { now: NOW }), { account: 'Dani' })
})

test('a month is no week: Codex\'s 30-day window keeps its own length, and is never measured against the week\'s boundary', () => {
  assert.deepEqual(accountWindows([{ window: 'thirty_day', percentUsed: 80, resetsAt: NOW - DAY }], NOW), [{ label: 'Current month', kind: 'unknown', percentUsed: 0, resetsAt: NOW + 29 * DAY }])
})

test('unattended Codex work goes on the first account with room, each read live: a month has room until it is full, a week is measured as Claude\'s is, and one that cannot be read is passed over', async () => {
  const month = (percentUsed: number) => [{ window: 'thirty_day', percentUsed, resetsAt: NOW + 20 * DAY }]
  const week = (percentUsed: number) => [{ window: 'five_hour', percentUsed: 5, resetsAt: NOW + HOUR }, { window: 'seven_day', percentUsed, resetsAt: NOW + 4 * DAY }]
  const usage: Record<string, Awaited<ReturnType<Parameters<typeof readCodexAccount>[0]>>> = { Rom: month(99), Dani: month(100), Lea: week(90), Max: week(10) }
  const read = readCodexAccount(async account => {
    const windows = usage[account.name]
    if (windows === undefined) throw new Error('unreadable')
    return windows
  })
  assert.deepEqual(await accountWithRoom([{ name: 'Rom' }, { name: 'Dani', login: 'codex-dani' }], read, { now: NOW }, 'Codex'), { account: 'Rom' })
  assert.deepEqual(await accountWithRoom([{ name: 'Dani', login: 'codex-dani' }, { name: 'Gone', login: 'codex-gone' }, { name: 'Lea', login: 'codex-lea' }, { name: 'Max', login: 'codex-max' }], read, { now: NOW }, 'Codex'), { account: 'Max' })
  const none = await accountWithRoom([{ name: 'Dani', login: 'codex-dani' }, { name: 'Gone', login: 'codex-gone' }, { name: 'Lea', login: 'codex-lea' }], read, { now: NOW }, 'Codex')
  assert.ok('reason' in none)
  assert.match(none.reason, /^every Codex account is past its line \(Dani: Current month is used up; Gone's usage could not be read; Lea: Current week \(all models\) is 90% used, .*\)$/)
})
