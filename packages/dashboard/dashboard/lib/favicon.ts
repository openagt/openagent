import { useEffect } from 'react'

// The tab icon follows the mark (#875): the black & white knot while nothing is running, the
// brand's animated colour variant while an agent is working. The static shell emits the initial
// `<link rel="icon">` (index.html), so the swap is a client-side href write.

/** The mark as shipped: the neutral ramp, with its own dark-mode fills inside the file. */
export const IDLE_FAVICON = '/logo.svg'

/** The brand's animated variant, plain SVG `<animate>` so it needs no script of its own. */
export const WORKING_FAVICON = '/logo-animated.svg'

/** Which icon file the given state wants. */
export function faviconHref(working: boolean): string {
  return working ? WORKING_FAVICON : IDLE_FAVICON
}

/** Point the tab icon at {@link faviconHref} (client-only). */
export function useFavicon(working: boolean): void {
  useEffect(() => {
    if (typeof document === 'undefined') return
    // `rel~=` because the emitted rel can carry more than one token.
    let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    const href = faviconHref(working)
    // Guarded: writing the same href re-fetches the icon in some browsers, which restarts the
    // animation on every render.
    if (link.getAttribute('href') !== href) link.setAttribute('href', href)
  }, [working])
}
