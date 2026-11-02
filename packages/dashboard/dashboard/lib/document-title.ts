import { useEffect } from 'react'

// The browser-tab title (#695/U3). A static "OpenAgent" hides which of several open tabs
// needs you; fold the "needs you" count and the selected project into document.title so the
// tab alone tells you, e.g. `(2) gemstack — OpenAgent`.

/** Compose the tab title from the needs-you count and the selected project name. */
export function openagentTitle(needsYou: number, projectName?: string | null): string {
  const prefix = needsYou > 0 ? `(${needsYou}) ` : ''
  const scope = projectName ? `${projectName} — ` : ''
  return `${prefix}${scope}OpenAgent`
}

/** Keep document.title in sync with the needs-you count and selected project (client-only). */
export function useDocumentTitle(needsYou: number, projectName?: string | null): void {
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.title = openagentTitle(needsYou, projectName)
  }, [needsYou, projectName])
}
