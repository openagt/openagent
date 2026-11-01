import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils.js'

// Minimal shadcn-style Badge for the event-kind / status pills.
export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs font-medium',
        className,
      )}
      {...props}
    />
  )
}
