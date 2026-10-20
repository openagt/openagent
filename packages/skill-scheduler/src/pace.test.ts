import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { dueFrom, localStamp, paceInForce, paceText, parseInterval, parseTimeOfDay, sinceNow, takesTimeOfDay, type Pace, type PacePick } from './pace.js'

// The pace's rules, pure. Every time here is the machine's own local time, made with the local
// constructor, so the tests say the same thing in any time zone.

const at = (day: number, hour: number, minute = 0): Date => new Date(2026, 9, day, hour, minute)
const HOUR = 3_600_000

test('an interval is a number from 1 to 9999 and a unit: minutes, hours, days, weeks of 7 days, months of 30', () => {
  assert.deepEqual(parseInterval('15m'), { count: 15, unit: 'm', ms: 15 * 60_000, text: '15m' })
  assert.equal(parseInterval('6h')!.ms, 6 * HOUR)
  assert.equal(parseInterval('2d')!.ms, 48 * HOUR)
  assert.equal(parseInterval('2w')!.ms, 14 * 24 * HOUR)
  assert.deepEqual(parseInterval('1mo'), { count: 1, unit: 'mo', ms: 30 * 24 * HOUR, text: '1mo' })
  // A leading zero is dropped from the text; zero would spell "always".
  assert.equal(parseInterval('06h')!.text, '6h')
  assert.equal(parseInterval('9999mo')!.count, 9999)
  // Past 9999 nobody means a pace, and far past it a date stops being one: such a count must never read as "due".
  for (const text of ['0h', '0mo', 'h', '6', '6 h', '1y', '-2d', '1.5h', 'often', '', '10000d', '100000000d', '99999999999999999999h']) assert.equal(parseInterval(text), undefined, text)
})

test('a time of day is hours and minutes on a 24-hour clock, and goes only with days, weeks or months', () => {
  assert.deepEqual(parseTimeOfDay('10:00'), { hour: 10, minute: 0, text: '10:00' })
  assert.deepEqual(parseTimeOfDay('9:05'), { hour: 9, minute: 5, text: '09:05' })
  assert.deepEqual(parseTimeOfDay('23:59'), { hour: 23, minute: 59, text: '23:59' })
  for (const text of ['24:00', '10:60', '10', '10:0', '10am', '']) assert.equal(parseTimeOfDay(text), undefined, text)
  assert.deepEqual(['15m', '6h', '2d', '2w', '1mo'].map(text => takesTimeOfDay(parseInterval(text)!)), [false, false, true, true, true])
})

test("the pace in force is this machine's pick, else the skill's; a pick that cannot be read is no pick", () => {
  const skill = { every: parseInterval('6h')!, when: 'npx queue' }
  assert.deepEqual(paceInForce(undefined, skill), { every: skill.every })
  assert.equal(paceInForce(undefined, { when: 'npx queue' }), undefined, 'a command its check alone paces')

  const since = '2026-10-08T07:00:00.000Z'
  assert.deepEqual(paceInForce({ every: '30m', since }, skill), { every: parseInterval('30m')! })
  assert.deepEqual(paceInForce({ every: '2d', at: '10:00', since }, skill), { every: parseInterval('2d')!, at: { hour: 10, minute: 0, text: '10:00' }, since })
  // A time of day beside minutes or hours is not followed: the interval alone paces.
  assert.deepEqual(paceInForce({ every: '6h', at: '10:00', since }, skill), { every: parseInterval('6h')! })

  // "Whenever there is work" takes the interval away, and holds only while the command has a check.
  assert.equal(paceInForce({ work: true }, skill), undefined)
  assert.deepEqual(paceInForce({ work: true }, { every: skill.every }), { every: skill.every }, 'no check: the skill\'s pace stands')

  // A state edited by hand.
  for (const odd of [{ every: 'often', since }, { every: 7 }, { work: 'yes' }, { every: '100000000d', since }, 'daily', 7, null, []]) assert.deepEqual(paceInForce(odd as unknown as PacePick, skill), { every: skill.every }, JSON.stringify(odd))
  // Only `work: true` is "whenever there is work": beside anything else the interval is read.
  assert.deepEqual(paceInForce({ work: false, every: '2d', since } as unknown as PacePick, skill), { every: parseInterval('2d')! })
})

test('without a time of day a command is due the interval after its last start, and at once when it never started', () => {
  const pace: Pace = { every: parseInterval('6h')! }
  assert.equal(dueFrom(pace, undefined, at(8, 12)).getTime(), 0)
  assert.deepEqual(dueFrom(pace, at(8, 9), at(8, 12)), at(8, 15))
  // Days without a time of day count hours, like any interval.
  assert.deepEqual(dueFrom({ every: parseInterval('2d')! }, at(8, 9, 30), at(9, 12)), at(10, 9, 30))
})

test('with a time of day a command is due from that time on, on a day at least that many days after the day it last started', () => {
  const pace: Pace = { every: parseInterval('2d')!, at: parseTimeOfDay('10:00')!, since: at(1, 8).toISOString() }
  // Started on the 8th, whatever the hour: due from the 10th at 10:00.
  assert.deepEqual(dueFrom(pace, at(8, 10, 2), at(9, 12)), at(10, 10))
  assert.deepEqual(dueFrom(pace, at(8, 23, 50), at(9, 12)), at(10, 10))
  // Weeks are 7 days and months 30, across the end of a month and of a year.
  assert.deepEqual(dueFrom({ ...pace, every: parseInterval('1w')! }, at(8, 10), at(9, 12)), at(15, 10))
  assert.deepEqual(dueFrom({ ...pace, every: parseInterval('1mo')! }, at(1, 10), at(9, 12)), at(31, 10))
  assert.deepEqual(dueFrom({ ...pace, every: parseInterval('1mo')! }, new Date(2027, 0, 31, 10), new Date(2027, 1, 1)), new Date(2027, 2, 2, 10))
  assert.deepEqual(dueFrom({ ...pace, every: parseInterval('1d')! }, new Date(2026, 11, 31, 23, 50), new Date(2027, 0, 1)), new Date(2027, 0, 1, 10))
  // A last start in the future (another machine's clock runs ahead): it waits, by the same rule.
  assert.deepEqual(dueFrom(pace, at(9, 10), at(8, 12)), at(11, 10))
})

test('a time that was missed is due as soon as the scheduler looks, and once: the start that follows moves the next day on', () => {
  const pace: Pace = { every: parseInterval('1d')!, at: parseTimeOfDay('10:00')!, since: at(1, 8).toISOString() }
  // Last started on the 5th; the machine slept through the 6th and the 7th and wakes on the 8th at 08:00.
  const woke = at(8, 8)
  const from = dueFrom(pace, at(5, 10), woke)
  assert.deepEqual(from, at(6, 10))
  assert.ok(from.getTime() <= woke.getTime(), 'due now, before today\'s 10:00')
  // It starts then, once: the next one is tomorrow at 10:00, not today's 10:00 as well.
  assert.deepEqual(dueFrom(pace, woke, at(8, 10, 5)), at(9, 10))
})

test('a pick starts nothing before its first time of day: like a calendar event, setting it at 11:00 waits for tomorrow\'s 10:00', () => {
  const daily = { every: parseInterval('1d')!, at: parseTimeOfDay('10:00')! }
  // Picked at 11:00 on the 8th, never started.
  assert.deepEqual(dueFrom({ ...daily, since: at(8, 11).toISOString() }, undefined, at(8, 11, 1)), at(9, 10))
  // Picked at 09:00, or at 10:00 sharp: the same day's 10:00. Half a minute past it: tomorrow's.
  assert.deepEqual(dueFrom({ ...daily, since: at(8, 9).toISOString() }, undefined, at(8, 9, 1)), at(8, 10))
  assert.deepEqual(dueFrom({ ...daily, since: at(8, 10).toISOString() }, undefined, at(8, 10)), at(8, 10))
  assert.deepEqual(dueFrom({ ...daily, since: new Date(2026, 9, 8, 10, 0, 30).toISOString() }, undefined, at(8, 10, 1)), at(9, 10))
  // The time moved from 10:00 to 16:00 at 11:00, after today's start: tomorrow 16:00, no second start today.
  assert.deepEqual(dueFrom({ ...daily, at: parseTimeOfDay('16:00')!, since: at(8, 11).toISOString() }, at(8, 10), at(8, 11, 1)), at(9, 16))
  // Last started long ago, picked at 11:00 today: still tomorrow's 10:00, not at once.
  assert.deepEqual(dueFrom({ ...daily, since: at(8, 11).toISOString() }, at(1, 10), at(8, 11, 1)), at(9, 10))
  // No record of when it was picked (a state edited by hand): today's time when it never started.
  assert.deepEqual(dueFrom(daily, undefined, at(8, 9)), at(8, 10))
})

test('switching a command on counts its time of day from then: ticked after the time, it waits for the next one; a pick with no time of day is unchanged', () => {
  const picked = at(5, 11).toISOString()
  const timed: PacePick = { every: '1d', at: '10:00', since: picked }
  const on = sinceNow(timed, at(7, 15))
  assert.deepEqual(on, { every: '1d', at: '10:00', since: at(7, 15).toISOString() })
  // Without it the 6th's 10:00, long past, would start it at once at 15:00.
  assert.deepEqual(dueFrom(paceInForce(on, {})!, undefined, at(7, 15, 1)), at(8, 10))
  assert.deepEqual(dueFrom(paceInForce(timed, {})!, undefined, at(7, 15, 1)), at(6, 10))
  for (const other of [{ every: '6h', since: picked }, { work: true }, undefined, null, 'daily'] as unknown as PacePick[]) assert.deepEqual(sinceNow(other, at(7, 15)), other)
})

test('a pace and a local time, as a decision writes them', () => {
  assert.equal(paceText({ every: parseInterval('6h')! }), '6h')
  assert.equal(paceText({ every: parseInterval('2d')!, at: parseTimeOfDay('9:05')! }), '2d at 09:05')
  assert.equal(localStamp(at(10, 9, 5)), '2026-10-10 09:05')
})
