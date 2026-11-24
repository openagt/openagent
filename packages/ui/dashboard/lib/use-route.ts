import { useSyncExternalStore } from 'react'
import { parseRoute, formatRoute, keepPageQuery, type Route } from './route.js'
import type { ProjectAddresses } from '../../src/project-address.js'

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
/** Where an entry the dashboard writes keeps the address it was entered from: what a return goes back to. */
const BEHIND = 'openagent:behind'
/** Where an entry opened beside another keeps how many entries back that address is; one where it says none. */
const BEHIND_BY = 'openagent:behind-by'

/** The place in the tab's list of the entry shown. */
let shown = 0

/** The place of the entry whose state is `state`; one the dashboard did not write lies behind the entry shown. */
function stepOf(state: unknown): number {
  const step = (state as Record<string, unknown> | null)?.[STEP]
  return typeof step === 'number' ? step : shown - 1
}

/** How many entries back the address the entry whose state is `state` was entered from is. */
function behindBy(state: Record<string, unknown> | null): number {
  const by = state?.[BEHIND_BY]
  return typeof by === 'number' ? by : 1
}

/** A new entry after the one shown, at `url`, entered from the entry shown; one `beside` it, a page of the same thing, from where the entry shown was, one entry further. */
function push(url: string, beside: boolean): void {
  const state = window.history.state as Record<string, unknown> | null
  const behind = state?.[BEHIND]
  const from = beside && typeof behind === 'string' ? { [BEHIND]: behind, [BEHIND_BY]: behindBy(state) + 1 } : { [BEHIND]: currentUrl() }
  window.history.pushState({ [STEP]: shown + 1, ...from }, '', url)
  shown += 1
}

/** Go back to the place the entry shown was entered from: by Back, as many entries as it is behind, when `isBehind` says the address it was entered from is that place, else by `otherwise`, a move. */
export function back(isBehind: (address: string) => boolean, otherwise: () => void): void {
  const state = window.history.state as Record<string, unknown> | null
  const behind = state?.[BEHIND]
  if (typeof behind === 'string' && isBehind(behind)) leaving(() => window.history.go(-behindBy(state)))
  else otherwise()
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

/** Take `step`, a move off the entry shown: now, or once the person says to leave what the entry holds. */
export function leaving(step: () => void): void {
  if (held) held.ask(step)
  else step()
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

/** A new entry of another page opens at its top: only Back and Forward bring a page back to where it was scrolled. */
function scrollToTop(): void {
  stopRestore()
  window.scrollTo(0, 0)
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

/** The route, with its projects named by `projects`: what the address names changes when they do. */
export function useRoute(projects: ProjectAddresses): {
  route: Route
  /** Navigate to `next`, a new history entry. Keeps what the page mirrored into the query when
   *  `keepQuery` is set — for a change of the picked project alone (#1513), or Settings opening or
   *  closing over the page. With `beside`, `next` is a page of the same thing as the one shown (a
   *  ticket's other tab): it is entered from where the one shown was, so a return goes there. */
  go: (next: Route, options?: { keepQuery?: boolean; beside?: boolean }) => void
  /** Write `next` in place of the current history entry, keeping what the page wrote to it: a
   *  correction or a pick the page keeps, not a step to go Back to. With `query`, that is the page's
   *  own query; without, the one it has stays. */
  adjust: (next: Route, query?: string) => void
} {
  const current = useSyncExternalStore(subscribe, shownUrl, () => '/')
  const route = parseRoute(current, projects)

  const go = (next: Route, options?: { keepQuery?: boolean; beside?: boolean }) => {
    const url = options?.keepQuery ? keepPageQuery(formatRoute(next, projects), window.location.search) : formatRoute(next, projects)
    // Going where you already are is not a history entry.
    if (url === current) return
    leaving(() => {
      // A new page opens at its top; Settings over the page and a change of the query alone leave it where it was scrolled.
      const otherPage = new URL(url, window.location.href).pathname !== window.location.pathname
      keepScroll()
      push(url, options?.beside ?? false)
      if (otherPage) scrollToTop()
      notify()
    })
  }

  const adjust = (next: Route, query = window.location.search) => {
    const url = keepPageQuery(formatRoute(next, projects), query)
    if (url === current) return
    window.history.replaceState(window.history.state, '', url)
    notify()
  }

  return { route, go, adjust }
}

/** The dashboard's own page of every account OpenAgent works with, at `/permissions`. */
export const PERMISSIONS_PAGE = 'permissions'
