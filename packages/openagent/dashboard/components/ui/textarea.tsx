import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils.js'

// A trimmed shadcn Textarea, beside the Input: the same border, focus ring and disabled look, for
// a text of several lines.
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex min-h-16 w-full min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm outline-none transition-colors',
        'placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
