import { useSyncExternalStore } from 'react'

// What the Files pane has open, as Claude Code's editor tabs are: per page, the opened files as
// tabs in the order they were opened, the one shown, and at most one preview. A preview is the file
// one click opened: its tab is in italics, and the next file one click opens takes its place. A
// double click keeps a file: its tab stays until it is closed. Kept for this page load, per page.
//
// And the pane's three settings from its ⋮ menu, the same on every page and kept in this browser:
// whether the tree shows, whether one click opens a preview, and whether long lines wrap.

export interface OpenTab {
  path: string
  /** Kept by a double click, or by a click while previews are off; a preview's tab is in italics. */
  kept: boolean
}

export interface OpenFiles {
  tabs: OpenTab[]
  /** The file shown; absent with no tab open. */
  active?: string
  /** The Markdown files shown as their source rather than rendered. */
  source?: ReadonlySet<string>
}

export interface FilesSettings {
  tree: boolean
  previews: boolean
  wrap: boolean
}

const NONE: OpenFiles = { tabs: [] }
const DEFAULTS: FilesSettings = { tree: true, previews: true, wrap: true }
const SETTINGS_KEY = 'oa.files'

const pages = new Map<string, OpenFiles>()
let settings: FilesSettings = readSettings()
const listeners = new Set<() => void>()

function readSettings(): FilesSettings {
  try {
    const kept = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<FilesSettings>
    return {
      tree: typeof kept.tree === 'boolean' ? kept.tree : DEFAULTS.tree,
      previews: typeof kept.previews === 'boolean' ? kept.previews : DEFAULTS.previews,
      wrap: typeof kept.wrap === 'boolean' ? kept.wrap : DEFAULTS.wrap,
    }
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

/** The page's open files. */
export function useOpenFiles(page: string): OpenFiles {
  return useSyncExternalStore(subscribe, () => pages.get(page) ?? NONE)
}

/** The pane's settings. */
export function useFilesSettings(): FilesSettings {
  return useSyncExternalStore(subscribe, () => settings)
}

export function setFilesSetting(name: keyof FilesSettings, value: boolean) {
  settings = { ...settings, [name]: value }
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Kept for this page load only.
  }
  changed()
}

/**
 * Open `path` on the page and show it. `keep` keeps its tab; otherwise, while previews are on, it
 * is the page's preview, in place of the one before. A file already open is shown, and kept when
 * `keep` says so.
 */
export function openFile(page: string, path: string, keep: boolean) {
  const { tabs } = pages.get(page) ?? NONE
  const kept = keep || !settings.previews
  const at = tabs.findIndex(tab => tab.path === path)
  let next: OpenTab[]
  if (at !== -1) next = kept && !tabs[at]!.kept ? tabs.map((tab, i) => (i === at ? { path, kept: true } : tab)) : tabs
  else {
    const preview = kept ? -1 : tabs.findIndex(tab => !tab.kept)
    next = preview === -1 ? [...tabs, { path, kept }] : tabs.map((tab, i) => (i === preview ? { path, kept } : tab))
  }
  pages.set(page, { ...(pages.get(page) ?? NONE), tabs: next, active: path })
  changed()
}

/** Show a Markdown file as its source, or rendered again. */
export function showSource(page: string, path: string, source: boolean) {
  const open = pages.get(page) ?? NONE
  const shown = new Set(open.source)
  if (source) shown.add(path)
  else shown.delete(path)
  pages.set(page, { ...open, source: shown })
  changed()
}

/** Show an open file. */
export function showFile(page: string, path: string) {
  const open = pages.get(page)
  if (!open || open.active === path || !open.tabs.some(tab => tab.path === path)) return
  pages.set(page, { ...open, active: path })
  changed()
}

/** Close a file's tab; the tab beside it is shown when it was the one shown. */
export function closeFile(page: string, path: string) {
  const open = pages.get(page)
  if (!open) return
  const at = open.tabs.findIndex(tab => tab.path === path)
  if (at === -1) return
  const tabs = open.tabs.filter(tab => tab.path !== path)
  const active = open.active === path ? (tabs[at] ?? tabs[at - 1])?.path : open.active
  const source = open.source && new Set([...open.source].filter(p => p !== path))
  pages.set(page, { tabs, ...(active === undefined ? {} : { active }), ...(source ? { source } : {}) })
  changed()
}

/** Forget every page's open files and the settings: for tests. */
export function forgetOpenFiles() {
  pages.clear()
  settings = DEFAULTS
  changed()
}
