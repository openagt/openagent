import { createContext, useContext, useEffect, useRef } from 'react'

// A page inside a Settings entry: an entry that opens one of its things on a page of its own (a
// device of Settings › Devices) names it in the dialog's header, after the entry's own title, and
// the header's back arrow goes back to the entry.

/** The page inside an entry, as its header shows it. */
export interface SettingsCrumb {
  /** What the page is about: "Studio Mac". */
  title: string
  /** Back to the entry itself. */
  back: () => void
}

/** Set by the Settings dialog around an entry: how its page inside says it is open, and closed. */
export const SettingsCrumbContext = createContext<((crumb: SettingsCrumb | undefined) => void) | null>(null)

/**
 * Show a page inside a Settings entry: the header says its title after the entry's, and its back
 * arrow calls `back`. Nothing while `crumb` is undefined. Answers whether a header shows it: outside
 * the Settings dialog none does, and the page draws its own way back.
 */
export function useSettingsCrumb(crumb: SettingsCrumb | undefined): boolean {
  const set = useContext(SettingsCrumbContext)
  const back = useRef(crumb?.back)
  back.current = crumb?.back
  const title = crumb?.title
  useEffect(() => {
    if (!set) return
    set(title === undefined ? undefined : { title, back: () => back.current?.() })
    return () => set(undefined)
  }, [set, title])
  return set !== null
}
