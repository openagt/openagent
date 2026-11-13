import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils.js'

// shadcn/ui's ButtonGroup (base): controls that act on one thing — a button and the arrow holding
// its other choices, a count and the button it counts for — drawn as one control. The group squares
// its children's inner corners and drops the border between them through its own selectors, which
// outweigh a single class: a module's stylesheet, loaded after the dashboard's, redefines
// `.rounded-md` and would round a child's own `rounded-r-none` back off.

export function ButtonGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="group"
      data-slot="button-group"
      className={cn(
        'flex w-fit shrink-0 items-stretch',
        '[&>*]:focus-visible:relative [&>*]:focus-visible:z-10',
        '[&>*:not(:first-child)]:rounded-l-none [&>*:not(:first-child)]:border-l-0 [&>*:not(:last-child)]:rounded-r-none',
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
