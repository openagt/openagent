/**
 * The spend boundary: how much of the account's week unattended work may have spent by now.
 *
 * The boundary is OpenAgent's (its `quota-boundary.ts`, #879/#960), copied here as it is,
 * and the stand-down is this tool's own: the boundary is the pro-rated share of the week's
 * allowance that has elapsed, rising continuously with the clock, and unattended work stands
 * down once a window in force passes it plus the user's cushion. Two properties fall out of it: nothing is left on the floor, since the boundary
 * reaches the full allowance exactly as the week resets; and work a person asks for cannot be
 * starved by work nobody asked for. Copied rather than imported because this tool depends on
 * @openagt/agent-driver-claude, which reads the windows, and not on OpenAgent, which only draws the boundary.
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

/** One quota window measured against the boundary. */
export interface BoundaryWindow {
  /** The window's own label, as the agent phrased it. */
  label: string
  /** How much of it is gone, 0-100. */
  percentUsed: number
  /** Whether it has reached the limit in force. */
  reached: boolean
}

/**
 * The line unattended work actually stops at (#960).
 *
 * The boundary is the policy; this is the policy plus whatever the user asked for with the
 * slider. They are separate values because the panel draws both: moving your own limit should
 * not silently redraw the boundary it is measured against.
 */
export interface QuotaLimit {
  /** Where the limit sits, 0-100. */
  percent: number
  /** How far it is from the boundary, in percentage points. `0` is the default policy. */
  offset: number
}

/** Where the account stands against its boundary. */
export interface QuotaBoundaryStatus {
  boundary: QuotaBoundary
  /** The line in force, which is the boundary unless the user moved it (#960). */
  limit: QuotaLimit
  /** The windows in force: the account's week, plus the selected model's own week when we can tell which it is. */
  windows: BoundaryWindow[]
  /** The window that has reached the limit, or `null` while there is room. */
  reached: BoundaryWindow | null
}

/** The model name a `week-model` window is about, e.g. `Current week (Fable)` -> `fable`. */
function windowModel(label: string): string | undefined {
  return /\(([^)]+)\)/.exec(label)?.[1]?.trim().toLowerCase()
}

/**
 * Measure the account's windows against the boundary (#879).
 *
 * Both weekly windows bind at once — the account's week and, per Rom's edit, the
 * selected model's own week — so each is measured against the same boundary and
 * whichever reaches it first is the one that stops the work. The model's window
 * is only included when we can tell which model it belongs to; an unrecognized
 * one is left out rather than allowed to stop work for a model nobody selected.
 *
 * `undefined` when there is no reading, or when the week's reset cannot be
 * placed. That is "we do not know", and each caller decides what to do with it:
 * the per-agent guard carries on, unattended work stands down.
 */
export function quotaBoundaryStatus(input: {
  windows: DriverQuotaWindow[]
  now: number
  /** The model the work will run on, e.g. `claude-fable-5`. Its own week joins the gate when given. */
  model?: string
  /**
   * How far the automatic-consumption limit sits from the boundary, in percentage points (#960).
   * Omitted or `0` is the spend-boundary policy (#879): the limit *is* the boundary.
   */
  limitOffset?: number
}): QuotaBoundaryStatus | undefined {
  const week = input.windows.find(w => w.kind === 'week')
  if (!week?.resetsAtText) return undefined
  const resetsAt = parseResetsAt(week.resetsAtText, input.now)
  if (resetsAt === undefined) return undefined
  const boundary = boundaryFromResetsAt(resetsAt, input.now)

  const model = input.model?.toLowerCase()
  const inForce = input.windows.filter(w => {
    if (w.kind === 'week') return true
    if (w.kind !== 'week-model' || !model) return false
    const name = windowModel(w.label)
    return name !== undefined && model.includes(name)
  })

  // Clamped, so a limit dragged past either end of the week stops at the week rather than
  // becoming unreachable (which would read as "never stop") or negative (as "always stopped").
  const offset = input.limitOffset ?? 0
  const limit: QuotaLimit = { percent: Math.min(Math.max(boundary.percent + offset, 0), 100), offset }

  const windows = inForce.map(w => ({
    label: w.label,
    percentUsed: w.percentUsed,
    reached: w.percentUsed >= limit.percent,
  }))
  return { boundary, limit, windows, reached: windows.find(w => w.reached) ?? null }
}

/** Whether a run may start against the boundary, and the one line that says why not. */
export type QuotaDecision = { start: true } | { start: false; reason: string }

/**
 * The gate the tick asks before it spends: no reading, or a week the reader cannot place, is
 * "we do not know", and unattended work stands down on not knowing. A reached window names the
 * line it stopped at, the offset included, so a stand-down reads as a setting and not as a bug.
 */
export function quotaHeadroom(quota: QuotaBoundaryStatus | undefined): QuotaDecision {
  if (!quota) return { start: false, reason: 'the quota could not be read, so there is no way to tell what is spare' }
  const reached = quota.reached
  if (!reached) return { start: true }
  const { limit, boundary } = quota
  const offsetText = `${limit.offset > 0 ? '+' : ''}${Math.round(limit.offset * 10) / 10}`
  const line = limit.offset === 0
    ? `the week's ${Math.round(boundary.percent)}%`
    : `the ${Math.round(limit.percent)}% line (${offsetText} on the week's ${Math.round(boundary.percent)}%)`
  return { start: false, reason: `${reached.label} is ${Math.round(reached.percentUsed)}% used, at or past day ${boundary.day} of ${line}` }
}
