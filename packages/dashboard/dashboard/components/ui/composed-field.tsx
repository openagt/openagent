import type { ComponentProps } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '../../lib/utils.js'

/**
 * What is typed and the controls that send it, as one control: a card holding its text
 * ({@link ComposedFieldInput}) and under it a foot ({@link ComposedFieldFoot}) of what qualifies the
 * text, a line of what the press does, and the press. While the text has the keyboard the card's
 * edge darkens, as the message box's does.
 */
export function ComposedField({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('rounded-lg border border-hairline bg-card p-1.5 shadow-sm transition-colors has-[[data-slot=composed-field-input]:focus-visible]:border-input', className)} {...props} />
}

/** The text of a {@link ComposedField}, after a plus that says it adds: no edge of its own, the card's is. */
export function ComposedFieldInput({ className, ...props }: ComponentProps<'input'>) {
  return (
    <div className="flex h-10 items-center gap-2 px-3 text-faint-foreground">
      <Plus className="size-4 shrink-0" aria-hidden />
      <input data-slot="composed-field-input" className={cn('h-full w-full min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-faint-foreground read-only:text-muted-foreground', className)} {...props} />
    </div>
  )
}

/** The row under a {@link ComposedField}'s text: its controls, a line of what the press does, the press. */
export function ComposedFieldFoot({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 pl-1', className)} {...props} />
}
