import { useEffect, useState } from 'react'

/**
 * Whether an element is narrower than `width` pixels, followed as it is resized: a pane beside the
 * chat is as wide as the person drags it, not as the window is. Pass the element through a state
 * setter used as its `ref`. Wide where the browser cannot measure.
 */
export function useNarrow(element: HTMLElement | null, width: number): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(([entry]) => entry && setNarrow(entry.contentRect.width < width))
    watch.observe(element)
    return () => watch.disconnect()
  }, [element, width])
  return narrow
}
