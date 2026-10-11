import { useSyncExternalStore } from 'react'
import { setSidePanelOpen } from './side-panel.js'

// What a row of the chat asks the side panel to show. A changed file: the row of a file at the
// end of a turn opens the side panel on the tab that lists what the agent changed, with that file
// picked. A live screen: its row opens the side panel on the tab that shows it. An ask is kept
// for the page it was made on (`sidePanelName`), for the page's life; `at` tells one ask from
// the next for the same thing.

/** The file asked for, and which ask it is. */
export interface RevealedChange {
  path: string
  at: number
}

const asked = new Map<string, RevealedChange>()
const screens = new Map<string, number>()
const listeners = new Set<() => void>()
let asks = 0

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Open the side panel of the page with this name, on this changed file. */
export function revealChange(name: string, path: string): void {
  asked.set(name, { path, at: ++asks })
  setSidePanelOpen(name, true)
  for (const listener of listeners) listener()
}

/** The file last asked for on the page with this name, as reactive state; none when none was. */
export function useRevealedChange(name: string): RevealedChange | undefined {
  return useSyncExternalStore(subscribe, () => asked.get(name), () => undefined)
}

/** Open the side panel of the page with this name, on the run's live screen. */
export function revealScreen(name: string): void {
  screens.set(name, ++asks)
  setSidePanelOpen(name, true)
  for (const listener of listeners) listener()
}

/** Which ask last asked for the live screen on the page with this name, as reactive state; none when none did. */
export function useRevealedScreen(name: string): number | undefined {
  return useSyncExternalStore(subscribe, () => screens.get(name), () => undefined)
}

/** Forget every ask (for tests). */
export function forgetRevealedChanges(): void {
  asked.clear()
  screens.clear()
  for (const listener of listeners) listener()
}
