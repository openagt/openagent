import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils.js'

// shadcn/ui's ButtonGroup (base): controls that act on one thing — a button and the arrow holding
// its other choices, a count and the button it counts for — drawn as one control. The group squares
// its children's inner corners and drops the border between them through its own selectors, which
// outweigh a single class: a module's stylesheet, loaded after the dashboard's, redefines
// `.rounded-md` and would round a child's own `rounded-r-none` back off.
//
// Inner means beside another control, not "not the first or last child": an open menu puts hidden
// spans of its own next to its trigger (focus guards, and the span that owns its popup), and the
// arrow that is the group's last control would lose its outer corners while its menu is open.

export function ButtonGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="group"
      data-slot="button-group"
      className={cn(
        'flex w-fit shrink-0 items-stretch',
        '[&>*]:focus-visible:relative [&>*]:focus-visible:z-10',
        '[&>:not([data-base-ui-focus-guard],[aria-owns])~*]:rounded-l-none [&>:not([data-base-ui-focus-guard],[aria-owns])~*]:border-l-0',
        '[&>*:has(~:not([data-base-ui-focus-guard],[aria-owns]))]:rounded-r-none',
        className,
      )}
      {...props}
    />
  )
}

/** The line between two filled or ghost halves, which have no border of their own to tell them apart. */
export function ButtonGroupSeparator({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div role="separator" aria-orientation="vertical" data-slot="button-group-separator" className={cn('w-px shrink-0 self-stretch bg-current opacity-20', className)} {...props} />
}
