import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils.js'

// A trimmed shadcn Textarea, beside the Input: the same border, focus ring and disabled look, for
// a text of several lines.
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'focus-ring flex min-h-16 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm transition-colors hover:border-input-hover',
        'placeholder:text-faint-foreground disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
