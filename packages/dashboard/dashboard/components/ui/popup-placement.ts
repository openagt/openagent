import { createContext, useContext } from 'react'

// Where a popup is placed: against the page, so it scrolls along with what opened it, or against
// the window, for one opened from a part that stays put while the page scrolls (the sidebar).
// Placed against the page, such a popup is carried off by each scroll and pulled back a frame
// later: it jumps while the page scrolls under it.

export type PopupPlacement = 'absolute' | 'fixed'

/** The placement the popups opened inside take: the sidebar provides `fixed`. */
export const PopupPlacementContext = createContext<PopupPlacement>('absolute')

/** The placement of a popup opened here. */
export function usePopupPlacement(): PopupPlacement {
  return useContext(PopupPlacementContext)
}
