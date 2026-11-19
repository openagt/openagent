import { createContext, useContext, useEffect } from 'react'

// A change typed in a Settings entry and not saved yet: leaving the entry, picking another
// project or closing Settings asks first, so it is not thrown away without a word.

/** Set by the Settings dialog around an entry: how the entry says it holds a change, and no longer does. */
export const SettingsHoldContext = createContext<((held: boolean) => void) | null>(null)

/** Say while `held` that the entry holds a change not saved. Outside the Settings dialog, nothing. */
export function useSettingsHold(held: boolean): void {
  const set = useContext(SettingsHoldContext)
  useEffect(() => {
    if (!set) return
    set(held)
    return () => set(false)
  }, [set, held])
}
