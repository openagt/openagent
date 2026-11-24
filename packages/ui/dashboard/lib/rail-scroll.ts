import { useEffect, useState, type RefObject } from 'react'

/** A label's height: a part whose foot is this close to the top of the scroll has no row left in view. */
const LABEL_HEIGHT = 32

/** How the sidebar's one scroll stands: which part's label is held at its top, and whether what waits has left the view. */
export interface RailScroll {
  /** The parts whose label sticks at the top of the scroll now, its rows going under it. */
  stuck: ReadonlySet<string>
  /** "Waiting on you" is scrolled out above: its rows are not in view, and the Log's label says how many wait. */
  waitingGone: boolean
}

const AT_REST: RailScroll = { stuck: new Set(), waitingGone: false }

/**
 * Read from the page as it scrolls: an element under `content` with `data-rail-part` is a part of
 * the list (its label first, sticking at the top while its rows pass), and the scroll is the
 * nearest scroll area's. A label is held once its part's top has passed the top of the scroll; the
 * waiting part is gone once its foot is within a label's height of it. `parts` says what the list
 * holds, so a part that comes or goes is read at once.
 */
export function useRailScroll(content: RefObject<HTMLElement | null>, parts: string): RailScroll {
  const [scroll, setScroll] = useState(AT_REST)
  useEffect(() => {
    const viewport = content.current?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')
    if (!viewport) return
    const read = () => {
      const top = viewport.getBoundingClientRect().top
      const stuck = new Set<string>()
      let waitingGone = false
      for (const part of content.current?.querySelectorAll<HTMLElement>('[data-rail-part]') ?? []) {
        const box = part.getBoundingClientRect()
        const padding = Number.parseFloat(getComputedStyle(part).paddingTop) || 0
        if (viewport.scrollTop > 0 && box.top + padding < top && box.bottom > top) stuck.add(part.dataset['railPart']!)
        if (part.dataset['railPart'] === 'waiting') waitingGone = viewport.scrollTop > 0 && box.bottom - top <= LABEL_HEIGHT
      }
      setScroll(was => (was.waitingGone === waitingGone && was.stuck.size === stuck.size && [...stuck].every(part => was.stuck.has(part)) ? was : { stuck, waitingGone }))
    }
    read()
    viewport.addEventListener('scroll', read, { passive: true })
    return () => viewport.removeEventListener('scroll', read)
  }, [content, parts])
  return scroll
}
