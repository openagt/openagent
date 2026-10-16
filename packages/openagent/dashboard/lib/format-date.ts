// Timestamps reach the UI as plain strings: an agent's `startedAt` from the store, a
// ticket's date read verbatim out of its filename. Nothing validates them on the way
// in, and `new Date(...).toLocaleString()` renders anything it cannot parse as the literal
// "Invalid Date" (#759). So every display site formats through here, and an absent or
// unparseable timestamp reads as the fallback instead.

/** The parsed date, or undefined when there is nothing usable to show. */
function parse(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** A timestamp as local date + time, e.g. a project's last activity. */
export function formatDateTime(value: string | undefined, fallback = '—'): string {
  const date = parse(value)
  return date ? date.toLocaleString() : fallback
}

/**
 * A short local date + time, e.g. "Jul 18, 10:35 PM". For places where the timestamp is standing
 * in as a name (an unnamed session in the rail), where seconds are noise on the line that has to
 * identify the row.
 */
export function formatDateTimeShort(value: string | undefined, fallback = '—'): string {
  const date = parse(value)
  return date
    ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : fallback
}

/** A timestamp as a local date alone, for the denser table columns. */
export function formatDate(value: string | undefined, fallback = '—'): string {
  const date = parse(value)
  return date ? date.toLocaleDateString() : fallback
}

/**
 * A compact age (#1139): "22s ago" / "30m ago" / "5d ago" / "2w ago", the units the Agents list
 * dates its rows in. Finer than {@link formatRelative} at both ends — it names seconds (a session
 * that ended moments ago) and never falls back to a bare date (weeks, then years, stay relative) —
 * so a row reads the same whether it finished this minute or last month. Pair it with
 * {@link formatDateTime} in a `title` for the exact moment.
 *
 * Floored, not rounded: "1m ago" should mean at least a minute has passed, not "closer to a minute
 * than to two".
 */
export function formatAge(value: string | undefined, fallback = '—'): string {
  const date = parse(value)
  if (!date) return fallback
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  // Gate on days, not weeks: at 364 days `weeks` is 52 but `days/365` floors to 0, which would
  // read "0y ago" for a full day before the year rolls over.
  if (days < 365) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 365)}y ago`
}

/**
 * A timestamp as freshness (#948): "just now" / "12m ago" / "3h ago" / "2d ago", falling back
 * to the local date past a week. An at-a-glance board wants "2m ago", not today's date.
 */
export function formatRelative(value: string | undefined, fallback = '—'): string {
  const date = parse(value)
  if (!date) return fallback
  const seconds = Math.round((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days <= 7) return `${days}d ago`
  return date.toLocaleDateString()
}

/**
 * A plain duration, floored to its largest whole unit: "2s" / "10m" / "2h" / "1d" (#960 Edit) — no
 * "ago", and no weeks: this backs the pace-deviation figure, which can never exceed the week
 * itself. Floored for the reason {@link formatAge} is: "1d" should mean a full day has passed, not
 * "close enough to one".
 */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/** A span of work to the second, as a live count reads it: "9s", then "1m 5s", then "1h 2m". */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** `1 day` / `2 days`, singular only at exactly one. */
function pluralize(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

/**
 * The same duration spelled out — "1 day" / "2 hours" / "10 minutes" / "2 seconds" (#960 Edit) —
 * for a sentence (a tooltip explaining the figure {@link formatDuration} renders as "1d"), where an
 * abbreviation reads as a label rather than as prose.
 */
export function formatDurationLong(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return pluralize(seconds, 'second')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return pluralize(minutes, 'minute')
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return pluralize(hours, 'hour')
  return pluralize(Math.floor(hours / 24), 'day')
}

/** `8:59pm`, lowercase and unspaced — the hour and minute the reset formatters share. */
function timeOfDay(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(/\s+/g, '')
}

/**
 * A quota reset, as the week it sits under already places it: "Tuesday 8:59pm" (#960 Edit), not a
 * date — the bar above says which day of the week it is; naming the date again would be the
 * calendar repeating itself. Pair with {@link formatResetTooltip} for the exact moment.
 */
export function formatResetDay(at: number): string {
  const date = new Date(at)
  return `${date.toLocaleDateString(undefined, { weekday: 'long' })} ${timeOfDay(date)}`
}

/**
 * The same moment in full, for a tooltip: "Quota resets on Jul 28, 8:59pm (Europe/Berlin)". Names
 * the zone rather than leaving it implicit, since the reset is the account's own clock, and a
 * viewer working from a different one should not have to guess whether the two agree.
 */
export function formatResetTooltip(at: number): string {
  const date = new Date(at)
  const monthDay = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return `Quota resets on ${monthDay}, ${timeOfDay(date)} (${zone})`
}
