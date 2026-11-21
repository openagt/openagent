import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils.js'

/** What a status word says, by its colour. */
export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'primary'

const DOT: Record<BadgeTone, string> = {
  neutral: 'bg-muted-foreground',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  primary: 'bg-primary',
}

/**
 * A pill: a count or a short word (a topic) on a soft fill. With a `tone`, a status word instead:
 * its colour is a dot before it, and the word keeps the text's colour, readable on any surface.
 */
export function Badge({ tone, className, children, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone | undefined }) {
  if (tone !== undefined)
    return (
      <span className={cn('inline-flex shrink-0 items-center gap-1.5 text-xs font-medium whitespace-nowrap text-foreground', className)} {...props}>
        <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', DOT[tone])} />
        {children}
      </span>
    )
  return (
    <span
      className={cn('inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-muted px-2 text-xs font-medium whitespace-nowrap text-muted-foreground', className)}
      {...props}
    >
      {children}
    </span>
  )
}
