/**
 * A scheduled command's pace (#2022): how often at most it starts. A skill gives a starting pace;
 * each person may set another for their own machine, kept in the tool's state. No node imports:
 * the dashboard part reads the same rules.
 *
 * A pace is an interval, a number and a unit: minutes, hours, days, weeks or months. A week is 7
 * days and a month 30. The interval is the least time since the command last started, on any
 * machine. A pace in days, weeks or months may also name a time of day, like a calendar event:
 * the command is then due from that time on, on a day at least that many days after the day it
 * last started. The time is the machine's own local time.
 */

/** An interval's unit, as written: `m`, `h`, `d`, `w`, `mo`. */
export type PaceUnit = 'm' | 'h' | 'd' | 'w' | 'mo'

export const PACE_UNITS: readonly PaceUnit[] = ['m', 'h', 'd', 'w', 'mo']

/** How many days one of a unit is, for the units a time of day may go with. */
const UNIT_DAYS: Readonly<Partial<Record<PaceUnit, number>>> = { d: 1, w: 7, mo: 30 }

const MINUTE_MS = 60_000
const UNIT_MS: Readonly<Record<PaceUnit, number>> = { m: MINUTE_MS, h: 60 * MINUTE_MS, d: 1440 * MINUTE_MS, w: 7 * 1440 * MINUTE_MS, mo: 30 * 1440 * MINUTE_MS }

/** An interval as read: its count, its unit, and its length. */
export interface Interval {
  count: number
  unit: PaceUnit
  ms: number
  /** As written, without a leading zero: `15m`, `2w`. */
  text: string
}

/** The largest count an interval takes: past it nobody means a pace, and far past it a date stops being one. */
export const MAX_COUNT = 9999

/** An interval out of its text (`15m`, `6h`, `7d`, `2w`, `1mo`); nothing for text that is none, for a count of 0, which would spell "always", and for one above 9999. */
export function parseInterval(text: string): Interval | undefined {
  const read = /^(\d+)(mo|m|h|d|w)$/.exec(text)
  const count = Number(read?.[1])
  if (!read || count < 1 || count > MAX_COUNT) return undefined
  const unit = read[2] as PaceUnit
  return { count, unit, ms: count * UNIT_MS[unit], text: `${count}${unit}` }
}

/** Whether a time of day may go with the interval: only with days, weeks or months. */
export function takesTimeOfDay(interval: Interval): boolean {
  return UNIT_DAYS[interval.unit] !== undefined
}

/** A time of day out of its text, `HH:MM` on a 24-hour clock (`9:05`, `10:00`); nothing for text that is none. */
export function parseTimeOfDay(text: string): { hour: number; minute: number; text: string } | undefined {
  const read = /^(\d{1,2}):(\d{2})$/.exec(text)
  const hour = Number(read?.[1])
  const minute = Number(read?.[2])
  if (!read || hour > 23 || minute > 59) return undefined
  return { hour, minute, text: `${String(hour).padStart(2, '0')}:${read[2]}` }
}

/** A pick with its time of day counted from now on: what switching the command on does, so a row ticked after its time waits for the next one. Any other pick is unchanged. */
export function sinceNow(pick: PacePick | undefined, now: Date): PacePick | undefined {
  if (typeof pick !== 'object' || pick === null || !('every' in pick) || typeof pick.at !== 'string') return pick
  return { ...pick, since: now.toISOString() }
}

/**
 * A person's pick of a pace for one scheduled command, on their machine: `work` for "whenever
 * there is work", which takes the interval away and leaves the check alone to say when; else an
 * interval, with a time of day when it has one and when the pick was made, or the command last
 * switched on with it.
 */
export type PacePick = { work: true } | { every: string; at?: string; since: string }

/** The pace a command runs at: its interval, and the time of day when it has one, with when that pick was made. Absent for a command its check alone paces. */
export interface Pace {
  every: Interval
  at?: { hour: number; minute: number; text: string }
  since?: string
}

/**
 * The pace in force for a command: this machine's pick, else the skill's. A pick that cannot be
 * read (a state file edited by hand) is no pick. "Whenever there is work" holds only while the
 * command has a check: without one nothing would say when, so the skill's pace stands.
 */
export function paceInForce(pick: PacePick | undefined, skill: { every?: Interval; when?: string }): Pace | undefined {
  const skills = skill.every ? { every: skill.every } : undefined
  if (pick === undefined || typeof pick !== 'object' || pick === null) return skills
  if ('work' in pick && pick.work === true) return skill.when !== undefined ? undefined : skills
  const every = 'every' in pick && typeof pick.every === 'string' ? parseInterval(pick.every) : undefined
  if (!every) return skills
  const timed = pick as { at?: unknown; since?: unknown }
  const at = typeof timed.at === 'string' && takesTimeOfDay(every) ? parseTimeOfDay(timed.at) : undefined
  return { every, ...(at ? { at, ...(typeof timed.since === 'string' ? { since: timed.since } : {}) } : {}) }
}

/**
 * From when a command is due, by its pace: a time already past means it is due now.
 *
 * Without a time of day: the interval after its last start, and at once when it never started.
 *
 * With a time of day: that time on the day the interval's days after the day it last started, so
 * a time that was missed (the scheduler not running then) is still due when the scheduler next
 * looks, once, since the start that follows moves the next day on. Never earlier than the first
 * such time after the pick was made, or after the command was last switched on with it: setting
 * "every day at 10:00" at 11:00, or ticking its switch at 11:00, starts nothing until tomorrow's
 * 10:00, like a calendar event. Days are the machine's own local days.
 */
export function dueFrom(pace: Pace, lastStart: Date | undefined, now: Date): Date {
  if (!pace.at) return lastStart ? new Date(lastStart.getTime() + pace.every.ms) : new Date(0)
  const { hour, minute } = pace.at
  const atOn = (day: Date, daysLater: number): Date => new Date(day.getFullYear(), day.getMonth(), day.getDate() + daysLater, hour, minute)
  const picked = pace.since !== undefined && !Number.isNaN(Date.parse(pace.since)) ? new Date(pace.since) : undefined
  // The first such time at or after the pick: the same day's when it had not passed yet.
  const firstAfterPick = picked && (atOn(picked, 0).getTime() >= picked.getTime() ? atOn(picked, 0) : atOn(picked, 1))
  if (!lastStart) return firstAfterPick ?? atOn(now, 0)
  const afterLast = atOn(lastStart, pace.every.count * UNIT_DAYS[pace.every.unit]!)
  return firstAfterPick && firstAfterPick.getTime() > afterLast.getTime() ? firstAfterPick : afterLast
}

/** A pace as a tick's decision says it: `6h`, `2d at 10:00`. */
export function paceText(pace: Pace): string {
  return pace.at ? `${pace.every.text} at ${pace.at.text}` : pace.every.text
}

/** A local time as a tick's decision says it: `2026-10-10 10:00`. */
export function localStamp(date: Date): string {
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}
