import type { MouseEvent } from 'react'

/** A link the dashboard follows itself: a plain left click runs `go`, any other click is the browser's. */
export function inPlace<T extends Element>(go: (event: MouseEvent<T>) => void): (event: MouseEvent<T>) => void {
  return event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    go(event)
  }
}
