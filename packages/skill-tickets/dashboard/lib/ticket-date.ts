// A ticket is dated by a day: its filename's (`<DATE>_<SLUG>.md`, the day it was written on, on the
// computer that named it), which the command reads as that day's midnight in UTC. Counted in hours,
// that day reads "20h ago" for a ticket written a minute ago anywhere west of UTC; counted in
// days, it reads as the day it is.

const FILENAME_DAY = /^(\d{4})-(\d{2})-(\d{2})_/

/** The local day a ticket is dated by: its filename's day as written, else the day of its date (a ticket named otherwise is dated by its file). */
function dayOf(ticket: { file: string; date: string }): Date | undefined {
  const named = FILENAME_DAY.exec(ticket.file)
  if (named) return new Date(Number(named[1]), Number(named[2]) - 1, Number(named[3]))
  const date = new Date(ticket.date)
  return Number.isNaN(date.getTime()) ? undefined : new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** How old a ticket is, in days: "today", "yesterday", "3d ago", then weeks and years as the other ages read. */
export function ticketAge(ticket: { file: string; date: string }, now = new Date()): string {
  const day = dayOf(ticket)
  if (!day) return '—'
  // Rounded: a day across a change of the clocks is 23 or 25 hours long.
  const days = Math.max(0, Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - day.getTime()) / 86_400_000))
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 365)}y ago`
}

/** The day a ticket is dated by, as a local date, for the age's tooltip: a day has no hour to show. */
export function ticketDay(ticket: { file: string; date: string }): string {
  return dayOf(ticket)?.toLocaleDateString() ?? '—'
}
