import { useCallback, useEffect, useState, type HTMLAttributes } from 'react'
import { StaleReads } from '../lib/use-async.js'
import { cn } from '../lib/utils.js'

/** How long a part of the page shows what an earlier visit read at full strength: a fresh answer within it shows no fade, as a part faded and unfaded at once flickers. */
export const FADE_AFTER_MS = 1000

const NONE_STALE: ReadonlySet<object> = new Set()

/**
 * A part of the page (an Overview card, a page's list), faded while what it shows is only what an
 * earlier visit read and the fresh read has been out for {@link FADE_AFTER_MS}: the page opens with
 * the last answer at once, and one whose read is slow or failing says so. `stale` is a read its
 * caller made; a read inside tells it by itself ({@link StaleReads}).
 */
export function FadeWhileStale({ stale = false, className, children, ...props }: HTMLAttributes<HTMLDivElement> & { stale?: boolean }) {
  const [staleReads, setStaleReads] = useState(NONE_STALE)
  const told = useCallback((reader: object, readStale: boolean) => {
    setStaleReads(readers => {
      if (readers.has(reader) === readStale) return readers
      const next = new Set(readers)
      if (readStale) next.add(reader)
      else next.delete(reader)
      return next
    })
  }, [])
  const anyStale = stale || staleReads.size > 0
  const [late, setLate] = useState(false)
  useEffect(() => {
    if (!anyStale) return
    const timer = setTimeout(() => setLate(true), FADE_AFTER_MS)
    return () => {
      clearTimeout(timer)
      setLate(false)
    }
  }, [anyStale])
  const faded = anyStale && late
  return (
    <div {...props} data-stale={faded || undefined} className={cn(className, 'transition-opacity duration-300', faded && 'opacity-60')}>
      <StaleReads.Provider value={told}>{children}</StaleReads.Provider>
    </div>
  )
}
