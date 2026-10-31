import type { ComponentProps } from 'react'
import { cn } from './utils.js'

// A trimmed shadcn input.
export function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-9 w-full min-w-0 rounded-md border border-border bg-transparent px-3 py-1 text-sm shadow-sm outline-none transition-colors',
        'placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
