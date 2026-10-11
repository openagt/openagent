import type { OpenAgentEvent } from './events.js'

/**
 * Which of a run's `screen` lines are live and which are hidden. Live: the newest line at its
 * address with no `ended` line for it after, and no run `end` after it other than one waiting on
 * an answer. Every `ended` line is hidden: the screen going is said by its line no longer being
 * live.
 */
export function foldScreenRows(events: readonly OpenAgentEvent[]): { live: Set<OpenAgentEvent>; hidden: Set<OpenAgentEvent> } {
  const hidden = new Set<OpenAgentEvent>()
  const newest = new Map<string, number>()
  let lastEnd = -1
  events.forEach((e, at) => {
    // A run waiting on an answer keeps its screens: the page is what its question is about.
    if (e.kind === 'end' && !e.waiting) lastEnd = at
    if (e.kind !== 'screen') return
    if (e.ended) {
      hidden.add(e)
      newest.delete(e.url)
    } else newest.set(e.url, at)
  })
  const live = new Set<OpenAgentEvent>()
  for (const at of newest.values()) if (at > lastEnd) live.add(events[at]!)
  return { live, hidden }
}

/** Where a run's live screen answers: the address of its newest live `screen` line, or nothing. */
export function liveScreen(events: readonly OpenAgentEvent[]): string | undefined {
  const { live } = foldScreenRows(events)
  for (let at = events.length - 1; at >= 0; at--) {
    const e = events[at]!
    if (e.kind === 'screen' && live.has(e)) return e.url
  }
  return undefined
}
