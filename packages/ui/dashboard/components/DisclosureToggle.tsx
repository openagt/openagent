import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '../lib/utils.js'

// One collapsible-section toggle (#659), shared so every disclosure under the agent controls
// ("See actual prompt sent", "Context") reads the same: a chevron that rotates when open, then
// the label, muted until hovered. Keeping them in one place stops the styles drifting apart.
export function DisclosureToggle({
  open,
  onToggle,
  children,
  className,
}: {
  open: boolean
  onToggle: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn('flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground', className)}
    >
      <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
      {children}
    </button>
  )
}
