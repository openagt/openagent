import { useSyncExternalStore } from 'react'

// What a row of the chat asks the page's panes to show. A changed file: the row of a file at the
// end of a turn opens the pane that lists what the agent changed, with that file picked; the
// card's "See all" opens it on all of them, from the first. A file: a step's file name ("Read
// index.html") opens the pane that shows the run's files, on that file. A live
// screen: its row opens the pane that shows it. A subagent: its row opens the pane that shows it,
// with its prompt and its transcript. An ask is kept for the page it was made on
// (`panesPage`), for the page's life; `at` tells one ask from the next for the same thing. The
// panes act on it (Panes): they know which pane lists changes and which shows a screen.

/** The file asked for, none for all of them, and which ask it is. */
export interface RevealedChange {
  path?: string
  at: number
}

const asked = new Map<string, RevealedChange>()
const files = new Map<string, RevealedFile>()
const screens = new Map<string, number>()
const subagents = new Map<string, RevealedSubagent>()
const listeners = new Set<() => void>()
let asks = 0

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Ask the page with this name for this changed file, or with no path for all of them. */
export function revealChange(name: string, path?: string): void {
  asked.set(name, path === undefined ? { at: ++asks } : { path, at: ++asks })
  for (const listener of listeners) listener()
}

/** The file last asked for on the page with this name, as reactive state; none when none was. */
export function useRevealedChange(name: string): RevealedChange | undefined {
  return useSyncExternalStore(subscribe, () => asked.get(name), () => undefined)
}

/** A file asked for, by its path as the agent named it, and which ask it is. */
export interface RevealedFile {
  path: string
  at: number
}

/** Ask the page with this name for a file, by its path as the agent named it: whole, or in the run's checkout. */
export function revealFile(name: string, path: string): void {
  files.set(name, { path, at: ++asks })
  for (const listener of listeners) listener()
}

/** The file last asked for on the page with this name, as reactive state; none when none was. */
export function useRevealedFile(name: string): RevealedFile | undefined {
  return useSyncExternalStore(subscribe, () => files.get(name), () => undefined)
}

/** Ask the page with this name for the run's live screen. */
export function revealScreen(name: string): void {
  screens.set(name, ++asks)
  for (const listener of listeners) listener()
}

/** Which ask last asked for the live screen on the page with this name, as reactive state; none when none did. */
export function useRevealedScreen(name: string): number | undefined {
  return useSyncExternalStore(subscribe, () => screens.get(name), () => undefined)
}

/** The subagent asked for, by its row's key, and which ask it is. */
export interface RevealedSubagent {
  key: string
  at: number
}

/** Ask the page with this name for one of its run's subagents, by its row's key. */
export function revealSubagent(name: string, key: string): void {
  subagents.set(name, { key, at: ++asks })
  for (const listener of listeners) listener()
}

/** The subagent last asked for on the page with this name, as reactive state; none when none was. */
export function useRevealedSubagent(name: string): RevealedSubagent | undefined {
  return useSyncExternalStore(subscribe, () => subagents.get(name), () => undefined)
}

/** Forget every ask (for tests). */
export function forgetRevealedChanges(): void {
  asked.clear()
  files.clear()
  screens.clear()
  subagents.clear()
  for (const listener of listeners) listener()
}
