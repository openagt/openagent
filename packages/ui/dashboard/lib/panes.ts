import { useSyncExternalStore } from 'react'

// The side panel beside the chat, as Claude Code on the web has it, for each page that has one: an
// agent's page, or the "New agent session" page. Whether the panel is open, its tabs (Changes,
// Files, the Browser, …) in the order they were opened, the tab it shows, and how the room is
// shared between the chat and the panel. A page is found as it was left on coming back, and a page
// that was never sized starts with the share last set on any page. Remembered in this browser: it
// is how one person left this screen, not a setting of the project, and it is read at once, so the
// panel is where it was left from the first frame.
//
// And, for every page at once, whether the session's Activity panel (where it runs, its repos, its
// context and its changes) stands beside the chat while the side panel is closed.

/** localStorage key holding the pages' panes, oldest page first, and the sizes last set anywhere. */
const PANES_KEY = 'oa.panes'

/** How many pages are remembered; one more forgets the oldest. */
const REMEMBERED = 200

/** How a group's room is shared: each part's share in percent, by its id. */
export type Sizes = Record<string, number>

/** One page's panel: its tabs, first opened first, the one it shows, whether it is open, and the sizes set there, by group. */
interface Page {
  open: string[]
  active?: string | undefined
  shown?: boolean | undefined
  sizes: Record<string, Sizes>
}

interface Kept {
  pages: Record<string, Page>
  /** The sizes last set on any page, by group: where a page that was never sized starts. */
  last: Record<string, Sizes>
}

const listeners = new Set<() => void>()
const NONE: readonly string[] = []

/** The name the panes of a page are kept under: the agent's, or the "New agent session" page's own. */
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
      const open = Array.isArray(page['open']) ? page['open'].filter(id => typeof id === 'string') : []
      const active = typeof page['active'] === 'string' && open.includes(page['active']) ? page['active'] : open.at(-1)
      pages[name] = { open, ...(active !== undefined ? { active } : {}), ...(page['shown'] === true ? { shown: true } : {}), sizes: sizesOf(page['sizes']) }
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

/** Keep the page as `change` leaves it, as the newest page; a page with the panel closed, no tab and nothing sized is not kept. */
function write(name: string, change: (page: Page) => Page, last?: Record<string, Sizes>): void {
  const now = kept()
  const { [name]: was, ...others } = now.pages
  const page = change(was ?? { open: [], sizes: {} })
  const pages = page.open.length > 0 || page.shown === true || Object.keys(page.sizes).length > 0 ? { ...others, [name]: page } : others
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

/**
 * Open a tab of the page with this name, or close it, and remember it. A tab opened is the last of
 * the tabs (one open already stays where it is), the one shown, and opens the panel. A tab closed
 * that was shown hands its place to the tab before it, or else after it; the last one closed
 * leaves the panel open on what it can show.
 */
export function setPaneOpen(name: string, id: string, open: boolean): void {
  if (!open && expanded.get(name) && kept().pages[name]?.open.length === 1) expanded.delete(name)
  write(name, page => {
    if (open) return { ...page, open: page.open.includes(id) ? page.open : [...page.open, id], active: id, shown: true }
    if (!page.open.includes(id)) return page
    const at = page.open.indexOf(id)
    const rest = page.open.filter(other => other !== id)
    return { ...page, open: rest, active: page.active === id ? (rest[at - 1] ?? rest[at]) : page.active }
  })
}

/** Show this tab of the page with this name. */
export function setActivePane(name: string, id: string): void {
  write(name, page => (page.open.includes(id) ? { ...page, active: id } : page))
}

/** Open the panel of the page with this name, on the tabs it had, or close it, keeping them. */
export function setPanelShown(name: string, shown: boolean): void {
  if (!shown) expanded.delete(name)
  write(name, page => ({ ...page, shown }))
}

/** Close the panel of the page with this name; its tabs are kept for when it opens again. */
export function closePanes(name: string): void {
  setPanelShown(name, false)
}

/** The tabs of the page with this name, first opened first, as reactive state. */
export function useOpenPanes(name: string): readonly string[] {
  return useSyncExternalStore(subscribe, () => kept().pages[name]?.open ?? NONE, () => NONE)
}

/** The tab the page with this name shows, as reactive state. */
export function useActivePane(name: string): string | undefined {
  return useSyncExternalStore(subscribe, () => kept().pages[name]?.active, () => undefined)
}

/** Whether the panel of the page with this name is open, as reactive state. */
export function usePanelShown(name: string): boolean {
  return useSyncExternalStore(subscribe, () => kept().pages[name]?.shown === true, () => false)
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

/** The pages whose panel fills the page, by name: for the page's life, not remembered. */
const expanded = new Map<string, true>()

/** Let the panel of the page with this name fill the page, or bring it back to its place. */
export function setPanelExpanded(name: string, fills: boolean): void {
  if (fills) expanded.set(name, true)
  else expanded.delete(name)
  for (const listener of listeners) listener()
}

/** Whether the panel of the page with this name fills the page, as reactive state. */
export function usePanelExpanded(name: string): boolean {
  return useSyncExternalStore(subscribe, () => expanded.has(name), () => false)
}

/** localStorage key: '0' once the Activity panel was put away; it stands beside the chat otherwise. */
const ACTIVITY_KEY = 'oa.activity'
/** What a browser that keeps nothing was last told of the Activity panel. */
let activityFallback: boolean | undefined

function activityShown(): boolean {
  if (activityFallback !== undefined) return activityFallback
  try {
    return globalThis.localStorage?.getItem(ACTIVITY_KEY) !== '0'
  } catch {
    return true
  }
}

/** Put the Activity panel beside the chat, or away, on every page, and remember it. */
export function setActivityShown(shown: boolean): void {
  try {
    globalThis.localStorage?.setItem(ACTIVITY_KEY, shown ? '1' : '0')
    activityFallback = undefined
  } catch {
    activityFallback = shown
  }
  for (const listener of listeners) listener()
}

/** Whether the Activity panel stands beside the chat while the side panel is closed, as reactive state. */
export function useActivityShown(): boolean {
  return useSyncExternalStore(subscribe, activityShown, () => true)
}

/** Forget every page's panes (for tests). */
export function forgetPanes(): void {
  expanded.clear()
  set = 0
  fallback = undefined
  activityFallback = undefined
  read = undefined
  try {
    globalThis.localStorage?.removeItem(PANES_KEY)
    globalThis.localStorage?.removeItem(ACTIVITY_KEY)
  } catch {
    // Nothing was kept.
  }
  for (const listener of listeners) listener()
}
