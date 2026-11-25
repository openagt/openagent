import type { Again } from './use-async.js'

// A pick made for every next run (a module's setting, such as the profile picked under the message
// box) changes what the box's other controls say of the next run: the skills a run on that profile
// gets. The control that saves such a pick tells it here, and every read of what it decides listens,
// reading again the moment it is saved rather than at its next poll.

const listeners = new Set<(change: number) => void>()
let change = 0

/** Tell every read of what the picks for every next run decide that one of them was saved. */
export function tellNextRunPicked(): void {
  change++
  for (const listener of [...listeners]) listener(change)
}

/** For a read of what a pick for every next run decides: read again each time one is saved on this page. */
export const nextRunAgain: Again = read => {
  listeners.add(read)
  return () => void listeners.delete(read)
}
