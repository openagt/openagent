import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// What a pane puts in its own card's header, as Claude Code's panes do (Files: a button that hides
// the tree, and the opened files as tabs). The card keeps two
// places in its header: the title, where the pane's name stands until the pane puts something
// there, and the actions, before the buttons that let the pane fill the page and close it.

export interface PaneHeaderSlots {
  title: HTMLElement | null
  actions: HTMLElement | null
}

export const PaneHeaderContext = createContext<PaneHeaderSlots>({ title: null, actions: null })

/** In place of the pane's name in its card's header. */
export function PaneTitle({ children }: { children: ReactNode }) {
  const { title } = useContext(PaneHeaderContext)
  return title ? createPortal(children, title) : null
}

/** In the pane's card's header, before the buttons that let it fill the page and close it. */
export function PaneActions({ children }: { children: ReactNode }) {
  const { actions } = useContext(PaneHeaderContext)
  return actions ? createPortal(children, actions) : null
}
