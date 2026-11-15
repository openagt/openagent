import { useLayoutEffect, useRef, useState, type ComponentProps } from 'react'
import { cn } from '../../lib/utils.js'

// A wait under this draws no skeleton (theme.css's `animate-skeleton`), and one drawn stays this long at least.
const SKELETON_WAIT = 200
const SKELETON_HOLD = 300

/** The shape of what is coming, pulsing, drawn only once a wait has lasted 200ms. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="skeleton" className={cn('animate-skeleton rounded-md bg-accent motion-reduce:animate-skeleton-still', className)} {...props} />
}

/**
 * Whether a {@link Skeleton} stands in for what is `waiting`: while it waits, and, once the skeleton
 * has shown, until it has shown 300ms, so an answer just after it appeared does not flash it away.
 */
export function useSkeleton(waiting: boolean): boolean {
  const [held, setHeld] = useState(false)
  const since = useRef<number | undefined>(undefined)
  // A layout effect, so the answer's first frame is the skeleton held, never the answer for a frame.
  useLayoutEffect(() => {
    if (waiting) {
      since.current = performance.now()
      setHeld(false)
      return
    }
    if (since.current === undefined) return
    const left = since.current + SKELETON_WAIT + SKELETON_HOLD - performance.now()
    const shown = performance.now() >= since.current + SKELETON_WAIT
    since.current = undefined
    if (!shown || left <= 0) return
    setHeld(true)
    const timer = setTimeout(() => setHeld(false), left)
    return () => clearTimeout(timer)
  }, [waiting])
  return waiting || held
}
