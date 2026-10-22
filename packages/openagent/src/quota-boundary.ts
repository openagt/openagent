/**
 * The quota boundary (#879): how much of the account's week OpenAgent may
 * have spent by now.
 *
 * The whole policy is one line — the boundary is the pro-rated share of the week's allowance that
 * has elapsed, rising continuously with the clock rather than once a day (#960 Edit) — and it
 * replaces the configurable limits of #519. There is nothing to configure: the boundary is derived
 * from the account's own week, which the agent reports.
 *
 * Nothing is left on the floor: the boundary rises on its own and reaches the full allowance
 * exactly as the week resets, so a quiet week still gets spent rather than expiring.
 *
 * OpenAgent only draws it. Whether work stops at it, or how far past it, is the business of
 * whatever starts unattended work, which puts its own stop line on the usage bar.
 */

import type { DriverQuotaWindow } from '@openagt/agent-driver'

/** The quota week, in ms. */
export const QUOTA_WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** A day of it, in ms. */
const ONE_DAY_MS = 24 * 60 * 60 * 1000

/** Days in the quota week, i.e. the denominator of `n/7`. */
const WEEK_DAYS = 7

/** Where the boundary sits, and the week it is derived from. */
export interface QuotaBoundary {
  /** When the current quota week began, epoch ms. */
  startsAt: number
  /** When it resets, epoch ms. */
  resetsAt: number
  /** Which day of the week we are on, 1-7. */
  day: number
  /** The share of the week's allowance that may be spent by now, 0-100. */
  percent: number
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * `Jul 25 at 7am (Asia/Jerusalem)`, with the minutes and the zone both optional. Newer Claude
 * Code prints a comma where older versions print `at` — `Jul 25, 7am` — and both are in the wild.
 */
const RESETS_AT = /^([a-z]{3})\s+(\d{1,2})(?:\s+at\s+|,\s*)(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:\(([^)]+)\))?$/i

/** How far `zone` is ahead of UTC at `at`, in ms. */
function zoneOffsetMs(at: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(p => p.type === type)?.value)
  // `hour: '2-digit'` with hour12 off prints midnight as 24 in some runtimes.
  const hour = read('hour') % 24
  const asUtc = Date.UTC(read('year'), read('month') - 1, read('day'), hour, read('minute'), read('second'))
  return asUtc - at
}

/** The epoch of a wall-clock time in `zone`, resolving the offset at that instant rather than now. */
function zonedTimeToEpoch(year: number, month: number, day: number, hour: number, minute: number, zone: string): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  const first = wall - zoneOffsetMs(wall, zone)
  // One correction settles it: the first guess is only wrong when it landed on
  // the far side of a DST change, and the second offset is the right one.
  const second = wall - zoneOffsetMs(first, zone)
  return second
}

/**
 * Parse the agent's reset prose into an epoch.
 *
 * The agent prints no year (`Jul 25 at 7am (Asia/Jerusalem)`), which is why the
 * driver keeps this as text. It is recoverable here because we know something
 * the driver does not: a *weekly* window resets within seven days, so of the
 * candidate years exactly one lands anywhere near now.
 *
 * `undefined` for anything that does not parse, which the callers treat as "we
 * do not know where the week is" rather than as a boundary of zero.
 */
export function parseResetsAt(text: string, now: number): number | undefined {
  const match = RESETS_AT.exec(text.trim())
  if (!match) return undefined
  const [, monthName, dayText, hourText, minuteText, meridiem, zoneText] = match
  const month = MONTHS.indexOf((monthName ?? '').toLowerCase()) + 1
  if (month === 0) return undefined
  const day = Number(dayText)
  const hour12 = Number(hourText)
  if (hour12 < 1 || hour12 > 12) return undefined
  const hour = (hour12 % 12) + ((meridiem ?? '').toLowerCase() === 'pm' ? 12 : 0)
  const minute = minuteText === undefined ? 0 : Number(minuteText)
  const zone = zoneText?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone

  const nowYear = new Date(now).getUTCFullYear()
  let best: number | undefined
  for (const year of [nowYear - 1, nowYear, nowYear + 1]) {
    let at: number
    try {
      at = zonedTimeToEpoch(year, month, day, hour, minute, zone)
    } catch {
      // An unknown zone name. Nothing to fall back to that wouldn't be a guess.
      return undefined
    }
    // Feb 29 in a non-leap year rolls into March; that candidate isn't the date
    // the agent printed.
    if (new Date(at + zoneOffsetMs(at, zone)).getUTCDate() !== day) continue
    if (best === undefined || Math.abs(at - now) < Math.abs(best - now)) best = at
  }
  return best
}

/**
 * Where the boundary sits, given when the week resets.
 *
 * `percent` is continuous — the plain elapsed share of the week (#960 Edit) — rather than a value
 * that jumps once a day, so it always names the actual instant `now` falls on, on any axis that
 * measures the week the same way. A stepped version once unlocked a whole day's allowance the
 * moment a new day began (including the entire week's worth on the last day), which read as
 * generous on paper but let a burst of spending land the instant the clock ticked over rather than
 * pacing with it; continuous keeps the line honest about what has actually elapsed at the cost of
 * that burst.
 *
 * `day` is 1-based and still names which day of the week `now` falls on — for callers that want to
 * say "day 4 of 7" rather than a percentage — and steps at the exact second the week's own day
 * rolls over, independently of `percent`.
 */
export function boundaryFromResetsAt(resetsAt: number, now: number): QuotaBoundary {
  const startsAt = resetsAt - QUOTA_WEEK_MS
  const elapsedMs = Math.min(Math.max(now - startsAt, 0), QUOTA_WEEK_MS)
  const day = Math.min(WEEK_DAYS, Math.floor(elapsedMs / ONE_DAY_MS) + 1)
  return { startsAt, resetsAt, day, percent: (elapsedMs / QUOTA_WEEK_MS) * 100 }
}

/** When the week resets: the exact time where the reading has it (a turn's rate-limit line), else read off the agent's words. */
function weekResetsAt(week: DriverQuotaWindow, now: number): number | undefined {
  if (week.resetsAt !== undefined) return week.resetsAt
  return week.resetsAtText ? parseResetsAt(week.resetsAtText, now) : undefined
}

/**
 * Where the boundary sits for the account's own week, as the agent reported it (#879).
 *
 * `undefined` when there is no reading of the week, or when its reset cannot be placed. That is
 * "we do not know", never a boundary of zero.
 */
export function weekBoundary(windows: readonly DriverQuotaWindow[], now: number): QuotaBoundary | undefined {
  const week = windows.find(w => w.kind === 'week')
  const resetsAt = week && weekResetsAt(week, now)
  return resetsAt === undefined ? undefined : boundaryFromResetsAt(resetsAt, now)
}
