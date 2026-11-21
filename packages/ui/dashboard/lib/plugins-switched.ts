import type { Again } from './use-async.js'

// A plugin switched in Settings › Plugins changes what the whole page shows: the sidebar's pages
// and the Overview's cards (the modules), the Skills count (the skill choices), and the other
// group's rows. Every read of the plugins' state listens here, and reads again the moment a switch
// is saved rather than at its next poll.

const listeners = new Set<(change: number) => void>()
let change = 0

/** Tell every read of the plugins' state that a plugin was switched. */
export function tellPluginsSwitched(): void {
  change++
  for (const listener of [...listeners]) listener(change)
}

/** For a read of the plugins' state: read again each time a plugin is switched on this page. */
export const pluginsAgain: Again = read => {
  listeners.add(read)
  return () => void listeners.delete(read)
}
