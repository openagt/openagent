import { useSyncExternalStore } from 'react'
import { parseRoute, formatRoute, keepPageQuery, type ProjectAddresses, type Route } from './route.js'

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

function subscribe(listener: () => void): () => void {
  // `popstate` covers Back/Forward; the History API does not fire it for our own pushes, which is
  // why `go` notifies directly.
  if (listeners.size === 0) window.addEventListener('popstate', notify)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('popstate', notify)
  }
}

const currentUrl = (): string => window.location.pathname + window.location.search

/** The route, with its projects named by `projects`: what the address names changes when they do. */
export function useRoute(projects: ProjectAddresses): {
  route: Route
  /** Navigate to `next`. Replaces the current history entry when `replace` is set — for a
   *  correction, not a step you should be able to go Back to. Keeps what the page mirrored into
   *  the query when `keepQuery` is set — for a change of the picked project alone (#1513), or
   *  Settings opening or closing over the page. */
  go: (next: Route, options?: { replace?: boolean; keepQuery?: boolean }) => void
} {
  const current = useSyncExternalStore(subscribe, currentUrl, () => '/')
  const route = parseRoute(current, projects)

  const go = (next: Route, options?: { replace?: boolean; keepQuery?: boolean }) => {
    const url = options?.keepQuery ? keepPageQuery(formatRoute(next, projects), window.location.search) : formatRoute(next, projects)
    // Going where you already are is not a history entry.
    if (url === current) return
    if (options?.replace) window.history.replaceState(null, '', url)
    else window.history.pushState(null, '', url)
    notify()
  }

  return { route, go }
}
