import { useSyncExternalStore } from 'react'

// Below this the screen is a phone's: the sidebar is a sheet over the page (shadcn's default), and
// the panes lie over the page. Word for word the question Tailwind's `max-md` asks, so the
// classes and this never disagree: a rem here follows the browser's own font size, as it does there.
const PHONE = '(width < 48rem)'

// jsdom has no matchMedia; not-mobile there rather than throwing.
const query = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(PHONE) : undefined)

/** Whether the screen is a phone's, now. */
export const isMobileScreen = () => query()?.matches ?? false

function subscribe(listener: () => void) {
  const mql = query()
  mql?.addEventListener('change', listener)
  return () => mql?.removeEventListener('change', listener)
}

/** Whether the screen is a phone's, read at the first paint: the app has no server render to agree with. */
export function useIsMobile() {
  return useSyncExternalStore(subscribe, isMobileScreen, () => false)
}
