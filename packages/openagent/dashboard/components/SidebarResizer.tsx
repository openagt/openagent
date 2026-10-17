import { useRef } from 'react'
import { setSidebarWidth, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, useSidebarWidth } from '../lib/sidebar-width.js'

// The sidebar's right edge, dragged to make it wider or narrower, as the line between the chat and
// the panes is. A double click takes it back to its default width; the arrow keys move it too. A
// phone has no edge: there the sidebar is a sheet over the page.

/** How far one press of an arrow key moves the edge. */
const STEP = 16

export function SidebarResizer() {
  const width = useSidebarWidth()
  const drag = useRef<{ x: number; width: number } | null>(null)
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="The width of the sidebar"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      tabIndex={0}
      onPointerDown={event => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { x: event.clientX, width }
      }}
      onPointerMove={event => {
        if (drag.current) setSidebarWidth(drag.current.width + event.clientX - drag.current.x)
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={() => setSidebarWidth(undefined)}
      onKeyDown={event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          setSidebarWidth(width + (event.key === 'ArrowRight' ? STEP : -STEP))
        } else if (event.key === 'Enter' && width !== SIDEBAR_DEFAULT) setSidebarWidth(undefined)
      }}
      // A strip over the sidebar's own border, with a short bar while the pointer or the keyboard is on it, as the panes' lines show.
      className="group/edge absolute inset-y-0 -right-1 z-20 flex w-2 cursor-col-resize touch-none items-center justify-center outline-none"
    >
      <span aria-hidden className="h-10 w-0.5 rounded-full bg-transparent transition-colors group-hover/edge:bg-muted-foreground/50 group-focus-visible/edge:bg-muted-foreground/50 group-active/edge:bg-primary" />
    </div>
  )
}
