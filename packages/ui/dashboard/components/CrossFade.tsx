import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '../lib/utils.js'

// Words that change in place, as the line under Claude Code on the web's chat changes them
// (measured frame by frame): the old words fade out rising a few pixels while the new ones fade in
// from a few pixels below, over the same spot, and whatever follows them on the line (the seconds,
// the arrow) glides to where the new words end rather than jumping there. The same words given
// again with new content inside (a count, say) change in place, with no fade; words shown first
// are there at once, as Claude Code's are.
//
// The width is the words' own except while it changes: taken from the old words' width to the new
// ones', then let go, so words with room on the line are never cut short by a rounded width.

/** How long the old words take to go and the new ones to come, and the line to take its new width. */
export const CROSS_FADE_MS = 160

const EASE = 'cubic-bezier(0.2, 0, 0, 1)'

export function CrossFade({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  const [shownId, setShownId] = useState(id)
  const [leaving, setLeaving] = useState<{ id: string; node: ReactNode }[]>([])
  // What was on screen last: the words that go when the id changes.
  const last = useRef<ReactNode>(children)
  if (shownId !== id) {
    setLeaving(was => [...was.filter(layer => layer.id !== id), { id: shownId, node: last.current }])
    setShownId(id)
  }
  useLayoutEffect(() => {
    last.current = children
  })
  useLayoutEffect(() => {
    if (leaving.length === 0) return
    const timer = setTimeout(() => setLeaving([]), CROSS_FADE_MS + 40)
    return () => clearTimeout(timer)
  }, [leaving])

  // The width the words had last, read after every render, to ease from when the words change.
  const box = useRef<HTMLSpanElement>(null)
  const width = useRef<number | undefined>(undefined)
  const seen = useRef(shownId)
  const easing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const changed = seen.current !== shownId
    seen.current = shownId
    if (!changed) {
      if (easing.current === undefined) width.current = el.getBoundingClientRect().width
      return
    }
    // The new words' own width, read with any easing still going let go.
    clearTimeout(easing.current)
    el.style.transition = ''
    el.style.width = ''
    const to = el.getBoundingClientRect().width
    const from = width.current
    width.current = to
    if (from === undefined || Math.abs(from - to) < 0.5 || typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    el.style.transition = 'none'
    el.style.width = `${from}px`
    void el.offsetWidth
    el.style.transition = `width ${CROSS_FADE_MS}ms ${EASE}`
    el.style.width = `${to}px`
    easing.current = setTimeout(() => {
      easing.current = undefined
      el.style.transition = ''
      el.style.width = ''
      width.current = el.getBoundingClientRect().width
    }, CROSS_FADE_MS + 20)
  })
  useLayoutEffect(() => () => clearTimeout(easing.current), [])

  return (
    <span ref={box} data-cross-fade="" className={cn('relative inline-block min-w-0 max-w-full align-bottom', className)}>
      {leaving.map(layer => (
        <span key={layer.id} aria-hidden="true" className="cross-fade-out pointer-events-none absolute top-0 left-0 inline-flex items-center gap-1.5 whitespace-nowrap">
          {layer.node}
        </span>
      ))}
      <span key={shownId} className={cn('inline-flex max-w-full items-center gap-1.5 whitespace-nowrap', leaving.length > 0 && 'cross-fade-in')}>
        {children}
      </span>
    </span>
  )
}
