import { useEffect } from 'react'

// The browser-tab title (#695/U3). A static "OpenAgent" hides which of several open tabs
// needs you and what each shows; fold the "needs you" count, the page and the selected project
// into document.title so the tab alone tells you, e.g. `(2) Logs · gemstack — OpenAgent`.

/** Compose the tab title from the needs-you count, the page's own name and the selected project's. */
export function openagentTitle(needsYou: number, projectName?: string | null, pageName?: string | null): string {
  const prefix = needsYou > 0 ? `(${needsYou}) ` : ''
  const page = pageName ? `${pageName}${projectName ? ' · ' : ' — '}` : ''
  const scope = projectName ? `${projectName} — ` : ''
  return `${prefix}${page}${scope}OpenAgent`
}

/** Keep document.title in sync with the needs-you count, the page and the selected project (client-only). */
export function useDocumentTitle(needsYou: number, projectName?: string | null, pageName?: string | null): void {
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.title = openagentTitle(needsYou, projectName, pageName)
  }, [needsYou, projectName, pageName])
}
