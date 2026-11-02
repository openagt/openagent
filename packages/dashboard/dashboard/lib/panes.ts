import { useSyncExternalStore } from 'react'

// The panes beside the chat (Changes, Files, the Browser, …), for each page that has them: an
// agent's page, or the "New agent" page. Which panes are open there, in the order they were
// opened, and how the room is shared: between the chat and the panes, and between the open panes.
// A page is found as it was left on coming back, and a page that was never sized starts with the
// sizes last set on any page. Remembered in this browser: it is how one person left this screen,
// not a setting of the project, and it is read at once, so the panes are where they were left from
// the first frame.

/** localStorage key holding the pages' panes, oldest page first, and the sizes last set anywhere. */
const PANES_KEY = 'oa.panes'

/** How many pages are remembered; one more forgets the oldest. */
const REMEMBERED = 200

/** How a group's room is shared: each part's share in percent, by its id. */
export type Sizes = Record<string, number>

/** One page's panes: the open ones, first opened first, and the sizes set there, by group. */
interface Page {
  open: string[]
  sizes: Record<string, Sizes>
}

interface Kept {
  pages: Record<string, Page>
  /** The sizes last set on any page, by group: where a page that was never sized starts. */
  last: Record<string, Sizes>
}

const listeners = new Set<() => void>()
const NONE: readonly string[] = []

/** The name the panes of a page are kept under: the agent's, or the "New agent" page's own. */
export function panesPage(projectId: string, agentId: string | null | undefined): string {
  return agentId ? `${projectId}/${agentId}` : 'new'
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function sizesOf(value: unknown): Record<string, Sizes> {
  if (!isRecord(value)) return {}
  const groups: Record<string, Sizes> = {}
  for (const [group, shares] of Object.entries(value)) {
    if (isRecord(shares) && Object.values(shares).every(share => typeof share === 'number')) groups[group] = shares as Sizes
  }
  return groups
}

/** What the browser holds, read as far as it is well formed: anything else is as if never kept. */
function parse(raw: string | null): Kept {
  let kept: unknown
  try {
    kept = JSON.parse(raw ?? 'null')
  } catch {
    kept = null
  }
  const pages: Record<string, Page> = {}
  if (isRecord(kept) && isRecord(kept['pages'])) {
    for (const [name, page] of Object.entries(kept['pages'])) {
      if (!isRecord(page)) continue
      pages[name] = { open: Array.isArray(page['open']) ? page['open'].filter(id => typeof id === 'string') : [], sizes: sizesOf(page['sizes']) }
    }
  }
  return { pages, last: isRecord(kept) ? sizesOf(kept['last']) : {} }
}

/** The last text read and what it holds: the same text gives the same object, as a store's reader must. */
let read: { raw: string | null; kept: Kept } | undefined
/** What a browser that keeps nothing was last told, so the panes still work there. */
let fallback: string | undefined

function kept(): Kept {
  let raw: string | null = fallback ?? null
  if (fallback === undefined) {
    try {
      raw = globalThis.localStorage?.getItem(PANES_KEY) ?? null
    } catch {
      raw = null
    }
  }
  if (read?.raw !== raw) read = { raw, kept: parse(raw) }
  return read.kept
}

/** Keep the page as `change` leaves it, as the newest page; a page with nothing open and nothing sized is not kept. */
function write(name: string, change: (page: Page) => Page, last?: Record<string, Sizes>): void {
  const now = kept()
  const { [name]: was, ...others } = now.pages
  const page = change(was ?? { open: [], sizes: {} })
  const pages = page.open.length > 0 || Object.keys(page.sizes).length > 0 ? { ...others, [name]: page } : others
  const names = Object.keys(pages)
  for (const old of names.slice(0, Math.max(0, names.length - REMEMBERED))) delete pages[old]
  const raw = JSON.stringify({ pages, last: last ?? now.last } satisfies Kept)
  try {
    globalThis.localStorage?.setItem(PANES_KEY, raw)
    fallback = undefined
  } catch {
    // A browser that keeps nothing: the panes still open, for this page load.
    fallback = raw
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Open or close one pane of the page with this name, and remember it. A pane just opened is the last of the open ones. */
export function setPaneOpen(name: string, id: string, open: boolean): void {
  if (!open && expanded.get(name) === id) expanded.delete(name)
  write(name, page => {
    if (page.open.includes(id) === open) return page
    return { ...page, open: open ? [...page.open, id] : page.open.filter(other => other !== id) }
  })
}

/** Close every pane of the page with this name. */
export function closePanes(name: string): void {
  expanded.delete(name)
  write(name, page => ({ ...page, open: [] }))
}

/** The open panes of the page with this name, first opened first, as reactive state. */
export function useOpenPanes(name: string): readonly string[] {
  return useSyncExternalStore(subscribe, () => kept().pages[name]?.open ?? NONE, () => NONE)
}

/** How the room of this group was last shared on the page with this name; else on any page; none when it never was. */
export function paneSizes(name: string, group: string): Sizes | undefined {
  const now = kept()
  return now.pages[name]?.sizes[group] ?? now.last[group]
}

/** How many times shares were set in this page load: it tells the last shares set anywhere from the ones before. */
let set = 0

/**
 * Whose shares `paneSizes` answers with for this group, as a name: the page's own while it has
 * some; else the last set anywhere, by how many were set in this page load. The resize library
 * remembers a layout by the names of its panels: panels named for this too are other panels to
 * it on another page, and after shares are set anew, so it lays them out by the shares they are
 * given, not by what it remembers.
 */
export function paneSizesOwner(name: string, group: string): string {
  return kept().pages[name]?.sizes[group] ? name : `~${set}`
}

/** Remember how the room of this group is shared on the page with this name: for the page, and as the last set anywhere. */
export function setPaneSizes(name: string, group: string, sizes: Sizes): void {
  set++
  write(name, page => ({ ...page, sizes: { ...page.sizes, [group]: sizes } }), { ...kept().last, [group]: sizes })
}

/** The pane that fills each page, by the page's name: for the page's life, not remembered. */
const expanded = new Map<string, string>()

/** Let one pane of the page with this name fill the page, or (`undefined`) bring it back to its place. */
export function setExpandedPane(name: string, id: string | undefined): void {
  if (id === undefined) expanded.delete(name)
  else expanded.set(name, id)
  for (const listener of listeners) listener()
}

/** The pane that fills the page with this name, as reactive state; none when none does. */
export function useExpandedPane(name: string): string | undefined {
  return useSyncExternalStore(subscribe, () => expanded.get(name), () => undefined)
}

/** Forget every page's panes (for tests). */
export function forgetPanes(): void {
  expanded.clear()
  set = 0
  fallback = undefined
  read = undefined
  try {
    globalThis.localStorage?.removeItem(PANES_KEY)
  } catch {
    // Nothing was kept.
  }
  for (const listener of listeners) listener()
}
