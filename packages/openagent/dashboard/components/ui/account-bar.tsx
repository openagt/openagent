import { cn } from '../../lib/utils.js'

/** A bar as thin as a line, filled as far as the window is gone; amber near the end, red at it. */
export function AccountBar({ percent, className }: { percent: number | undefined; className?: string }) {
  const used = Math.min(100, Math.max(0, percent ?? 0))
  return (
    <span aria-hidden className={cn('relative block h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-muted-foreground/15', className)}>
      <span className={cn('absolute inset-y-0 left-0 rounded-full', used >= 100 ? 'bg-danger' : used >= 80 ? 'bg-warning' : 'bg-success')} style={{ width: `${used}%` }} />
    </span>
  )
}
