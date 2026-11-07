import { useEffect, type ReactNode } from 'react'
import { usePreferences, usePreferencesLoaded, themePreference, resolvedDark } from '../lib/preferences.js'
import { keepLook } from '../lib/kept-look.js'
import { applyAppearance } from '../lib/appearance.js'
import { ErrorBoundary } from './ErrorBoundary.js'
import { TooltipProvider } from './ui/tooltip.js'

// The dashboard's color theme (#725): system (default, follow the OS), light, or dark. The app is
// client-only, so toggling the `.dark` class in an effect is fine. The page is first drawn in the
// look it had last time (index.html puts it back, `kept-look.ts`), or the OS's for a first visit;
// nothing here changes it until the person's preferences arrive from the daemon, so their theme is
// the first frame's, with no default flashed in between.
export function AppFrame({ children }: { children: ReactNode }) {
  const preferences = usePreferences()
  const loaded = usePreferencesLoaded()
  const theme = themePreference(preferences)
  // The rest of the look (Settings › Appearance): the palette, the primary colour, the fonts.
  const { palette, accent, font, codeFont, documentFont } = preferences
  useEffect(() => {
    if (!loaded) return
    applyAppearance(document.documentElement, { palette, accent, font, codeFont, documentFont })
    keepLook(document.documentElement, theme)
  }, [loaded, palette, accent, font, codeFont, documentFont, theme])
  useEffect(() => {
    if (!loaded) return
    const root = document.documentElement
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => root.classList.toggle('dark', resolvedDark(theme, mql.matches))
    apply()
    // Only follow live OS changes while on `system`; light/dark are fixed choices.
    if (theme !== 'system') return
    mql.addEventListener('change', apply)
    return () => mql.removeEventListener('change', apply)
  }, [loaded, theme])
  // Everything dynamic renders below here — the live feed, the polled panels, the markdown — so the
  // error boundary (#1194) sits inside the themed shell: a caught crash shows its recoverable card on
  // the app's own background rather than the browser's blank white. The app's tooltips are one group:
  // once one has opened, the next opens at once (ui/tooltip.tsx).
  return (
    <div className="min-h-screen bg-background text-foreground">
      <TooltipProvider>
        <ErrorBoundary>{children}</ErrorBoundary>
      </TooltipProvider>
    </div>
  )
}
