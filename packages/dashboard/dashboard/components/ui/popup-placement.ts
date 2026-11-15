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

/**
 * How a menu, a popover or a tooltip comes and goes: it grows out of its trigger's edge in 140ms and
 * fades in 90ms; opened or closed from the keyboard (Base UI's `data-instant`) it is there at once.
 */
export const POPUP_MOTION_CLASS =
  'origin-(--transform-origin) transition-[opacity,scale] duration-140 data-[ending-style]:duration-90 data-[starting-style]:scale-97 data-[starting-style]:opacity-0 data-[ending-style]:scale-97 data-[ending-style]:opacity-0 data-instant:transition-none'
