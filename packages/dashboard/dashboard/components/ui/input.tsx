import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils.js'

// A trimmed shadcn input.
export function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'focus-ring-field flex h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm transition-colors hover:border-input-hover',
        'placeholder:text-faint-foreground disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
