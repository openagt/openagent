import { useLayoutEffect, useRef, type RefObject } from 'react'

/** How long a row takes to its new place. */
const GLIDE_MS = 460
const EASE = 'cubic-bezier(.22,.9,.24,1)'
/** A travelling row is drawn over the rows it passes, on the column's own fill, so their words do not show through it. */
const OVER = { zIndex: 20, backgroundColor: 'var(--sidebar)' }

/** Where a row stood when the list was last drawn: how far down the list, and in which of its parts. */
type Place = { top: number; part: string | undefined }

/**
 * A row that changes part of a list travels there (his pick, 2026-11-24): a session that asks a
 * question leaves the Log for "Waiting on you", and comes back once answered, and its own row is
 * seen going, lifted a little, while the rows it passes make room. Read from the page: an element
 * under `root` with `data-glide` is a row, by that key, and `data-glide-part` names its part. Only
 * a draw in which some row changed part moves anything, so a list read again, or scrolled, stays
 * still; a part that was not there before fades in. `data-glide-new` marks what a row gains with its
 * new part, which comes in on the way. Nothing moves for a person who asked for less motion.
 */
export function useGlide(root: RefObject<HTMLElement | null>): void {
  const before = useRef(new Map<string, Place>())
  // After every draw: the rows are measured against the list itself, so its scroll moves none.
  useLayoutEffect(() => {
    const list = root.current
    if (!list) return
    const origin = list.getBoundingClientRect().top
    const now = new Map<string, Place & { row: HTMLElement }>()
    for (const row of list.querySelectorAll<HTMLElement>('[data-glide]')) now.set(row.dataset['glide']!, { top: row.getBoundingClientRect().top - origin, part: row.dataset['glidePart'], row })
    const was = before.current
    before.current = new Map([...now].map(([key, { top, part }]) => [key, { top, part }]))
    const moved = [...now].filter(([key, place]) => was.has(key) && was.get(key)!.part !== place.part)
    if (moved.length === 0 || typeof list.animate !== 'function' || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) return
    const movers = new Set(moved.map(([key]) => key))
    for (const [key, { top, row }] of now) {
      const from = was.get(key)
      if (!from) {
        row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: GLIDE_MS * 0.7, easing: 'ease-out' })
        continue
      }
      const by = from.top - top
      if (by === 0) continue
      if (!movers.has(key)) {
        row.animate([{ transform: `translateY(${by}px)` }, { transform: 'none' }], { duration: GLIDE_MS, easing: EASE })
        continue
      }
      // Over the rows it passes, on a shadow, and a touch larger half way.
      row.animate(
        [
          { transform: `translateY(${by}px)`, ...OVER, boxShadow: '0 6px 18px rgb(0 0 0 / 0)' },
          { transform: `translateY(${by * 0.5}px) scale(1.02)`, ...OVER, boxShadow: '0 6px 18px rgb(0 0 0 / 0.28)', offset: 0.45 },
          { transform: 'none', ...OVER, boxShadow: '0 6px 18px rgb(0 0 0 / 0)' },
        ],
        { duration: GLIDE_MS, easing: EASE },
      )
      for (const gained of row.querySelectorAll<HTMLElement>('[data-glide-new]')) gained.animate([{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1 }], { duration: GLIDE_MS, easing: 'ease-out' })
    }
  })
}
