import type { ThemePreference } from './preferences.js'

// The look the page was last drawn in (the theme, the palette, the primary colour, the fonts), kept
// in this browser, so the next load puts it back before its first paint (the script at the top of
// index.html): the person's theme from the first frame, not the default's until their preferences
// come from the daemon, which flashed dark on a light page and faded every coloured part across.

/** Where the look is kept; index.html reads the same key. */
export const KEPT_LOOK = 'openagent:look'

/** The look as index.html puts it back: the theme to resolve against the OS, and the root's own attributes. */
export interface KeptLook {
  theme: ThemePreference
  palette?: string
  accent?: string
  /** The root's inline style: the fonts picked. */
  style?: string
}

/** Keep the look `root` is drawn in now, with the theme chosen. A browser that keeps nothing keeps nothing. */
export function keepLook(root: HTMLElement, theme: ThemePreference): void {
  const style = root.getAttribute('style')
  const look: KeptLook = {
    theme,
    ...(root.dataset['palette'] ? { palette: root.dataset['palette'] } : {}),
    ...(root.dataset['accent'] ? { accent: root.dataset['accent'] } : {}),
    ...(style ? { style } : {}),
  }
  try {
    localStorage.setItem(KEPT_LOOK, JSON.stringify(look))
  } catch {
    // Private windows and blocked storage: the next load starts from the default, as before.
  }
}
