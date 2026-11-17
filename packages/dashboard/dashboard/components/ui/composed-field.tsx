import type { ComponentProps } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '../../lib/utils.js'

/**
 * What is typed and the controls that send it, as one control: a card holding its text
 * ({@link ComposedFieldInput}) and under it a foot ({@link ComposedFieldFoot}) of what qualifies the
 * text, a line of what the press does, and the press. While the text has the keyboard the card's
 * edge is a field's focus, 2 wide in the focus colour, as the message box's is.
 */
// Its spacing is the look's rule (ui/look/spacing.md): a control in it stands 8 in from each edge it
// touches, and its words and marks start on the 16 inset.
export function ComposedField({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('rounded-lg border border-hairline bg-card p-2 shadow-sm transition-colors has-[[data-slot=composed-field-input]:focus-visible]:outline-2 has-[[data-slot=composed-field-input]:focus-visible]:-outline-offset-1 has-[[data-slot=composed-field-input]:focus-visible]:outline-focus', className)} {...props} />
}

/** The text of a {@link ComposedField}, after a plus that says it adds: no edge of its own, the card's is. */
export function ComposedFieldInput({ className, ...props }: ComponentProps<'input'>) {
  return (
    <div className="flex h-9 items-center gap-2 px-2 text-faint-foreground">
      <Plus className="size-4 shrink-0" aria-hidden />
      <input data-slot="composed-field-input" className={cn('h-full w-full min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-faint-foreground read-only:text-muted-foreground', className)} {...props} />
    </div>
  )
}

/** The row under a {@link ComposedField}'s text: its controls, a line of what the press does, the press. */
export function ComposedFieldFoot({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-wrap items-center gap-2', className)} {...props} />
}
