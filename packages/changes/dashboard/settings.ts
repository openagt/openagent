import { useSyncExternalStore } from 'react'

// The Changes pane's settings from its ⋮ menu, the same on every page and kept in this browser:
// whether the list groups files by folder, and whether long lines wrap. And, per page for this
// page load, the files whose diff is folded away and the ones shown whole.

export interface ChangesSettings {
  group: boolean
  wrap: boolean
}

export interface PageDiffs {
  folded: ReadonlySet<string>
  /** The diffs shown whole, by {@link wholeKey}. */
  whole: ReadonlySet<string>
}

const DEFAULTS: ChangesSettings = { group: true, wrap: true }
const NONE: PageDiffs = { folded: new Set(), whole: new Set() }
const KEY = 'oa.changes'

let settings = readSettings()
const pages = new Map<string, PageDiffs>()
const listeners = new Set<() => void>()

function readSettings(): ChangesSettings {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ChangesSettings>
    return { group: typeof kept.group === 'boolean' ? kept.group : DEFAULTS.group, wrap: typeof kept.wrap === 'boolean' ? kept.wrap : DEFAULTS.wrap }
  } catch {
    return DEFAULTS
  }
}

function changed() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export function useChangesSettings(): ChangesSettings {
  return useSyncExternalStore(subscribe, () => settings)
}

export function setChangesSetting(name: keyof ChangesSettings, value: boolean) {
  settings = { ...settings, [name]: value }
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // Kept for this page load only.
  }
  changed()
}

export function usePageDiffs(page: string): PageDiffs {
  return useSyncExternalStore(subscribe, () => pages.get(page) ?? NONE)
}

/** Fold a file's diff away, or show it again. */
export function foldDiff(page: string, path: string, folded: boolean) {
  const diffs = pages.get(page) ?? NONE
  const next = new Set(diffs.folded)
  if (folded) next.add(path)
  else next.delete(path)
  pages.set(page, { ...diffs, folded: next })
  changed()
}

/** Fold every listed file's diff away, or none. */
export function foldAll(page: string, paths: string[] | null) {
  pages.set(page, { ...(pages.get(page) ?? NONE), folded: new Set(paths ?? []) })
  changed()
}

/** The name a diff shown whole is kept under: its file, in one commit or in all changes. */
export const wholeKey = (path: string, commit: string | undefined) => `${commit ?? ''}:${path}`

/** Show every line of a file's diff, not only those around its changes: in the commit shown, or in all changes. */
export function showWhole(page: string, path: string, commit: string | undefined) {
  const diffs = pages.get(page) ?? NONE
  pages.set(page, { ...diffs, whole: new Set([...diffs.whole, wholeKey(path, commit)]) })
  changed()
}

/** Forget every page's diffs and the settings: for tests. */
export function forgetChangesState() {
  pages.clear()
  settings = DEFAULTS
  changed()
}
