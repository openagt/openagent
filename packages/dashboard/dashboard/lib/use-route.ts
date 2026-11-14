import { useSyncExternalStore } from 'react'
import { SETTINGS_ITEM_PARAM, SETTINGS_PARAM, parseRoute, formatRoute, keepPageQuery, type Route } from './route.js'
import { NO_PROJECTS, type ProjectAddresses } from '../../src/project-address.js'

// The route as state (#784): read the current one, go to another. Back/Forward are free, and a
// session is a link you can paste, reload, and open twice.
//
// This was Vike's client router (F1). Its entire contribution here was a `usePageContext()` that
// exposed `urlPathname` and a `navigate()` — plus a catch-all `+route.ts` whose return value was
// deliberately never read, existing only so a navigation to any path resolved to the one page, and
// an `+onBeforePrerenderStart.ts` naming `/` so a shell got emitted at all. What is left is the
// History API, which is what those were wrapping.

/** Subscribers to the URL, woken by Back/Forward and by our own pushes. */
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/** Where an entry the dashboard writes keeps its place in the tab's list: how far a Back or Forward went. */
const STEP = 'openagent:step'

/** The place in the tab's list of the entry shown. */
let shown = 0

/** The place of the entry whose state is `state`; one the dashboard did not write lies behind the entry shown. */
function stepOf(state: unknown): number {
  const step = (state as Record<string, unknown> | null)?.[STEP]
  return typeof step === 'number' ? step : shown - 1
}

/** A new entry after the one shown, at `url`, with `state` beside its place. */
function push(url: string, state?: Record<string, unknown>): void {
  window.history.pushState({ ...state, [STEP]: shown + 1 }, '', url)
  shown += 1
}

/** The entry shown while it holds what leaving it would lose, and what asks before it goes. */
let held: { url: string; ask: (leave: () => void) => void } | null = null

/** Keep the entry shown when Back or Forward would leave it: the tab returns to it, and `ask` is handed the step that leaves; leaving the document, the browser asks. Until the returned function is called. */
export function holdEntry(ask: (leave: () => void) => void): () => void {
  const entry = { url: currentUrl(), ask }
  held = entry
  window.addEventListener('beforeunload', askBeforeUnload)
  return () => {
    if (held !== entry) return
    held = null
    window.removeEventListener('beforeunload', askBeforeUnload)
  }
}

/** Back past the dashboard's first entry, a reload or the tab closed, while an entry is held: the browser asks in its own words. */
function askBeforeUnload(event: BeforeUnloadEvent): void {
  event.preventDefault()
}

/** Back or Forward: the route is read again, and the page goes back to where it was scrolled on that entry.
 *  While an entry is held, the tab goes back to it by as many steps as it went, and leaving takes them again. */
function onPopState(): void {
  const arrived = stepOf(window.history.state)
  if (held) {
    // Back on the held entry: the return, or steps that came to nothing.
    if (arrived === shown) return
    const refused = arrived - shown
    window.history.go(-refused)
    return held.ask(() => window.history.go(refused))
  }
  stamp()
  notify()
  restoreScroll()
}

/** The entry shown is stamped with its place, the first one when the page starts. */
function stamp(): void {
  shown = stepOf(window.history.state)
  window.history.replaceState({ ...window.history.state, [STEP]: shown }, '')
}

function subscribe(listener: () => void): () => void {
  // `popstate` covers Back/Forward; the History API does not fire it for our own pushes, which is
  // why `go` notifies directly.
  if (listeners.size === 0) {
    stamp()
    window.addEventListener('popstate', onPopState)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('popstate', onPopState)
  }
}

/** Where a history entry keeps how far its page was scrolled when it was left. */
const SCROLL = 'openagent:scroll'

/** Leaving the page for another entry: the entry keeps how far the page was scrolled. */
function keepScroll(): void {
  window.history.replaceState({ ...window.history.state, [SCROLL]: window.scrollY }, '')
}

/** How long a restore waits for the page to be tall enough again: its lists read, or remembered. */
const RESTORE_WAIT_MS = 3000
/** What a person does to scroll themselves, which a pending restore yields to. */
const OWN_SCROLL = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const
let stopRestore = (): void => {}

/** Scroll to where the entry was left once the page is tall enough again: drawn from its reads, it is short for a moment. */
function restoreScroll(): void {
  stopRestore()
  const y: unknown = window.history.state?.[SCROLL]
  if (typeof y !== 'number' || y <= 0) return
  const root = document.documentElement
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => tryNow())
  const timer = setTimeout(() => stopRestore(), RESTORE_WAIT_MS)
  const stop = (): void => {
    observer?.disconnect()
    clearTimeout(timer)
    for (const event of OWN_SCROLL) window.removeEventListener(event, stop)
    stopRestore = () => {}
  }
  const tryNow = (): void => {
    if (root.scrollHeight - window.innerHeight < y) return
    window.scrollTo(0, y)
    stop()
  }
  stopRestore = stop
  for (const event of OWN_SCROLL) window.addEventListener(event, stop, { passive: true })
  observer?.observe(document.body)
  tryNow()
}

const currentUrl = (): string => window.location.pathname + window.location.search

/** The address shown: while an entry is held, its own, also in the moment the tab is on the way back to it. */
const shownUrl = (): string => held?.url ?? currentUrl()

/** The projects the route was last read with, which name them for a part of the page that has no route to hand. */
let addresses: ProjectAddresses = NO_PROJECTS

/** Marks a history entry as Settings this tab opened over the page under it. */
const OVER_PAGE = 'openagent:settings-over-page'
const OVER_PAGE_STATE = { [OVER_PAGE]: true }

/** Settings is open over the page this tab showed before it: Back closes it onto that page's own entry, with what the page wrote to it. */
export function settingsOverPage(): boolean {
  return window.history.state?.[OVER_PAGE] === true
}

/** The route, with its projects named by `projects`: what the address names changes when they do. */
export function useRoute(projects: ProjectAddresses): {
  route: Route
  /** Navigate to `next`. Replaces the current history entry, keeping what the page wrote to it,
   *  when `replace` is set — for a correction, not a step you should be able to go Back to. Keeps
   *  what the page mirrored into the query when `keepQuery` is set — for a change of the picked
   *  project alone (#1513), or Settings opening or closing over the page. Marks the entry as
   *  Settings opened over the page when `overPage` is set ({@link settingsOverPage}). */
  go: (next: Route, options?: { replace?: boolean; keepQuery?: boolean; overPage?: boolean }) => void
} {
  addresses = projects
  const current = useSyncExternalStore(subscribe, shownUrl, () => '/')
  const route = parseRoute(current, projects)

  const go = (next: Route, options?: { replace?: boolean; keepQuery?: boolean; overPage?: boolean }) => {
    const url = options?.keepQuery ? keepPageQuery(formatRoute(next, projects), window.location.search) : formatRoute(next, projects)
    // Going where you already are is not a history entry.
    if (url === current) return
    if (options?.replace) window.history.replaceState(window.history.state, '', url)
    else {
      // Settings over the page leaves the page mounted, scrolled where it was.
      if (!options?.overPage) keepScroll()
      push(url, options?.overPage ? OVER_PAGE_STATE : undefined)
    }
    notify()
  }

  return { route, go }
}

/** The dashboard's own page of every account OpenAgent works with, at `/permissions`. */
export const PERMISSIONS_PAGE = 'permissions'

/** The dashboard's own page of the agents, each a name, skills and accounts, at `/agents`. */
export const AGENTS_PAGE = 'agents'

/** Go to the Agents page, from a part of the page that has no route to hand. */
export function openAgents(): void {
  openOwnPage(AGENTS_PAGE)
}

/** Go to the Permissions page, from a part of the page that has no route to hand. */
export function openPermissions(): void {
  openOwnPage(PERMISSIONS_PAGE)
}

/** Go to one of the dashboard's own pages with the project the address picks, as the sidebar's press does. */
function openOwnPage(page: string): void {
  const { scope } = parseRoute(currentUrl(), addresses)
  keepScroll()
  push(formatRoute({ projectId: null, agentId: null, page, ...(scope ? { scope } : {}) }, addresses))
  notify()
}

/** Open Settings at `entry` over the page you are on, from a part of the page that has no route to hand; with `item`, at that page inside it.
 *  From inside Settings, it moves to that entry in place, as the dialog's own list does: Back and closing still go to the page under it. */
export function openSettings(entry: string, item?: string): void {
  const url = new URL(window.location.href)
  const open = url.searchParams.has(SETTINGS_PARAM)
  url.searchParams.set(SETTINGS_PARAM, entry)
  if (item) url.searchParams.set(SETTINGS_ITEM_PARAM, item)
  else url.searchParams.delete(SETTINGS_ITEM_PARAM)
  if (open) window.history.replaceState(window.history.state, '', url.pathname + url.search)
  else push(url.pathname + url.search, OVER_PAGE_STATE)
  notify()
}
