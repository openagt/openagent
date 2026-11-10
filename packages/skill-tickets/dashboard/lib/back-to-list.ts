import { useEffect } from 'react'
import type { ModuleHost } from '@openagt/dashboard/module'

// A ticket's page picks its project, so the list it was opened from (every project's) is reached by the browser's Back; one reached another way goes to its project's list.

/** The ticket page the list opened last, by its path under the page (`[file]` or `[file, 'plan']`), until that page has read it. */
let opened: string | null = null

/** Marks a page's history entry as opened from the list: the entry keeps it across Back, Forward and a reload. */
const FROM_LIST = 'skill-tickets:from-list'

/** The list opens the ticket page at `path`. */
export function openFromList(path: string[]): void {
  opened = path.join('/')
}

/** The way back to the list from the ticket page at `path`. */
export function useBackToList(host: ModuleHost, path: string[]): () => void {
  const key = path.join('/')
  useEffect(() => {
    if (opened !== key) return
    opened = null
    window.history.replaceState({ ...window.history.state, [FROM_LIST]: true }, '')
  }, [key])
  return () => (window.history.state?.[FROM_LIST] === true ? window.history.back() : host.openPage('tickets'))
}
