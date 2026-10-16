import type { OpenAgentEvent } from './events.js'

/**
 * Which of a run's `screen` lines are live and which are hidden. Live: the newest line at its
 * address with no `ended` line for it after, and, once the run has ended, a `until` line for it
 * after that end whose time has not passed — a browser outlives its run for a while, so the
 * person can still look at the page and click in it, and the screen that shows it says for how
 * long. Every `ended` and `until` line is hidden: the screen going, and it staying, are said by
 * its line being live or not.
 */
export function foldScreenRows(events: readonly OpenAgentEvent[], now: number = Date.now()): { live: Set<OpenAgentEvent>; hidden: Set<OpenAgentEvent> } {
  const hidden = new Set<OpenAgentEvent>()
  const newest = new Map<string, number>()
  /** Per address, where the newest line that keeps it past the run's end is, and until when. */
  const kept = new Map<string, { at: number; until: number }>()
  let lastEnd = -1
  events.forEach((e, at) => {
    // A run waiting on an answer keeps its screens: the page is what its question is about.
    if (e.kind === 'end' && !e.waiting) lastEnd = at
    if (e.kind !== 'screen') return
    if (e.ended) {
      hidden.add(e)
      newest.delete(e.url)
      kept.delete(e.url)
    } else if (e.until !== undefined) {
      hidden.add(e)
      kept.set(e.url, { at, until: Date.parse(e.until) })
    } else newest.set(e.url, at)
  })
  const live = new Set<OpenAgentEvent>()
  for (const [url, at] of newest) {
    const stays = kept.get(url)
    if (at > lastEnd || (stays !== undefined && stays.at > lastEnd && stays.until > now)) live.add(events[at]!)
  }
  return { live, hidden }
}

/** Where a run's live screen answers: the address of its newest live `screen` line, or nothing. */
export function liveScreen(events: readonly OpenAgentEvent[], now: number = Date.now()): string | undefined {
  const { live } = foldScreenRows(events, now)
  for (let at = events.length - 1; at >= 0; at--) {
    const e = events[at]!
    if (e.kind === 'screen' && live.has(e)) return e.url
  }
  return undefined
}
