import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils.js'

// A trimmed shadcn input: its faint edge, a small shadow, and in dark a light fill.
export function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'focus-ring-field flex h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors hover:border-input-hover dark:bg-input/30',
        'placeholder:text-faint-foreground disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
