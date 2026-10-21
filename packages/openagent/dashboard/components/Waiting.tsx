import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '../lib/utils.js'

/** How long a read may take before the line saying it is waiting shows. */
const WAIT_MS = 500

/**
 * What a pane says while it waits on a read ("Reading the file…"), shown only once the read takes
 * a moment: a read that answers at once goes from nothing straight to what it read, with no line
 * flashing between. It keeps its room while unseen, so nothing moves when it shows.
 */
export function Waiting({ children, className }: { children: ReactNode; className?: string }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), WAIT_MS)
    return () => clearTimeout(timer)
  }, [])
  return <p className={cn('text-xs text-muted-foreground', !shown && 'invisible', className)}>{children}</p>
}
