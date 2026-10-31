import type { ComponentProps } from 'react'
import { cn } from '@openagt/skill-ui/module'

// A trimmed shadcn Label: the name of one field, tied to it by `htmlFor` or by wrapping it. One
// place for the size and the weight a field's name has, so a form reads the same on every page.
export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label data-slot="label" className={cn('flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm leading-snug has-[[data-disabled]]:opacity-50', className)} {...props} />
}
