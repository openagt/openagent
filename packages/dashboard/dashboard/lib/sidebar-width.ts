import { useSyncExternalStore } from 'react'

// How wide the sidebar is, as the person dragged its edge. Remembered in this browser, as the panes'
// sizes are (`panes.ts`): it is how one person left this screen, not a setting, and it is read at
// once, so the sidebar has its width from the first frame. Never set: the default.

const WIDTH_KEY = 'oa.sidebar-width'

/** The width it has until it is dragged, and the bounds a drag keeps to, in pixels. */
export const SIDEBAR_DEFAULT = 256
export const SIDEBAR_MIN = 224
export const SIDEBAR_MAX = 448

const listeners = new Set<() => void>()

export const clampWidth = (width: number): number => Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)))

function read(): number {
  try {
    const kept = Number(localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(kept) && kept > 0 ? clampWidth(kept) : SIDEBAR_DEFAULT
  } catch {
    return SIDEBAR_DEFAULT
  }
}

let width = read()

/** Set the sidebar's width; `undefined` takes it back to the default and forgets it. */
export function setSidebarWidth(next: number | undefined): void {
  width = next === undefined ? SIDEBAR_DEFAULT : clampWidth(next)
  try {
    if (next === undefined) localStorage.removeItem(WIDTH_KEY)
    else localStorage.setItem(WIDTH_KEY, String(width))
  } catch {
    // A browser that keeps nothing still resizes, for this page's life.
  }
  for (const listener of listeners) listener()
}

/** The sidebar's width, as reactive state. */
export function useSidebarWidth(): number {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => width,
  )
}

// Whether the sidebar is hidden (its button, or Cmd/Ctrl+B): remembered the same way, so a page
// opened again is laid out as it was left. A phone's sidebar is a sheet, closed until asked for,
// and never hidden this way.

const HIDDEN_KEY = 'oa.sidebar-hidden'

function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === 'true'
  } catch {
    return false
  }
}

let hidden = readHidden()

/** Hide the sidebar, or show it again. */
export function setSidebarHidden(next: boolean): void {
  hidden = next
  try {
    if (next) localStorage.setItem(HIDDEN_KEY, 'true')
    else localStorage.removeItem(HIDDEN_KEY)
  } catch {
    // A browser that keeps nothing still hides it, for this page's life.
  }
  for (const listener of listeners) listener()
}

/** Whether the sidebar is hidden, as reactive state. */
export function useSidebarHidden(): boolean {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => hidden,
  )
}
