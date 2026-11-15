import { useMemo, useSyncExternalStore } from 'react'
import { panesPage } from './panes.js'
import { useMountedModules } from './use-modules.js'

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

/** A file asked for, by its path as the agent named it, and which ask it is. */
export interface RevealedFile {
  path: string
  at: number
}

/** Which ask asked for the live screen. */
export interface RevealedScreen {
  at: number
}

/** The subagent asked for, by its row's key, and which ask it is. */
export interface RevealedSubagent {
  key: string
  at: number
}

const listeners = new Set<() => void>()
const kinds: Map<string, unknown>[] = []
let asks = 0

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** One kind of ask, kept by the page it was made on: the last one made there, numbered among every ask. */
function askedFor<Asked extends { at: number }>() {
  const byPage = new Map<string, Asked>()
  kinds.push(byPage)
  return {
    ask(name: string, what: Omit<Asked, 'at'>): void {
      byPage.set(name, { ...what, at: ++asks } as Asked)
      for (const listener of listeners) listener()
    },
    /** The last ask on the page with this name, as reactive state; none when none was made. */
    useLast(name: string): Asked | undefined {
      return useSyncExternalStore(subscribe, () => byPage.get(name), () => undefined)
    },
  }
}

const changes = askedFor<RevealedChange>()
const files = askedFor<RevealedFile>()
const screens = askedFor<RevealedScreen>()
const subagents = askedFor<RevealedSubagent>()

/** Ask the page with this name for this changed file, or with no path for all of them. */
export function revealChange(name: string, path?: string): void {
  changes.ask(name, path === undefined ? {} : { path })
}

/** The file last asked for on the page with this name, as reactive state; none when none was. */
export function useRevealedChange(name: string): RevealedChange | undefined {
  return changes.useLast(name)
}

/** Ask the page with this name for a file, by its path as the agent named it: whole, or in the run's checkout. */
export function revealFile(name: string, path: string): void {
  files.ask(name, { path })
}

/** The file last asked for on the page with this name, as reactive state; none when none was. */
export function useRevealedFile(name: string): RevealedFile | undefined {
  return files.useLast(name)
}

/** Ask the page with this name for the run's live screen. */
export function revealScreen(name: string): void {
  screens.ask(name, {})
}

/** The last ask for the live screen on the page with this name, as reactive state; none when none was. */
export function useRevealedScreen(name: string): RevealedScreen | undefined {
  return screens.useLast(name)
}

/** Ask the page with this name for one of its run's subagents, by its row's key. */
export function revealSubagent(name: string, key: string): void {
  subagents.ask(name, { key })
}

/** The subagent last asked for on the page with this name, as reactive state; none when none was. */
export function useRevealedSubagent(name: string): RevealedSubagent | undefined {
  return subagents.useLast(name)
}

/**
 * What the rows of a run's chat open beside it, on the run's page: a changed file, a file a step
 * names and a live screen, each only where a module of the project has a pane that takes it
 * (without one, that row opens nothing); and a subagent, in a pane of its own.
 */
export function usePaneOpeners(projectId: string, agentId: string): {
  onOpenChange: ((path?: string) => void) | undefined
  onOpenFile: ((path: string) => void) | undefined
  onOpenScreen: (() => void) | undefined
  onOpenSubagent: (key: string) => void
} {
  const { panels } = useMountedModules()
  const takes = (kind: 'changes' | 'files' | 'screen'): boolean => panels.some(panel => panel[kind] && panel.projects.includes(projectId))
  const listsChanges = takes('changes')
  const showsFiles = takes('files')
  const showsScreen = takes('screen')
  const page = panesPage(projectId, agentId)
  const onOpenChange = useMemo(() => (listsChanges ? (path?: string) => revealChange(page, path) : undefined), [listsChanges, page])
  const onOpenFile = useMemo(() => (showsFiles ? (path: string) => revealFile(page, path) : undefined), [showsFiles, page])
  const onOpenScreen = useMemo(() => (showsScreen ? () => revealScreen(page) : undefined), [showsScreen, page])
  const onOpenSubagent = useMemo(() => (key: string) => revealSubagent(page, key), [page])
  return { onOpenChange, onOpenFile, onOpenScreen, onOpenSubagent }
}

/** Forget every ask (for tests). */
export function forgetRevealedChanges(): void {
  for (const byPage of kinds) byPage.clear()
  for (const listener of listeners) listener()
}
