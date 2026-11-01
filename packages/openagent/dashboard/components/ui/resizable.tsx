import type { ComponentProps } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { cn } from '../../lib/utils.js'

// shadcn's `resizable`, ported (no components.json here): the styled wrappers over
// react-resizable-panels. A group lays its panels in a row or in a column, and the line between
// two of them is dragged to give one of them the other's room.
//
// As in Claude Code, the line is a rule a pixel wide, in the border's tone, and the panes it parts
// have no border of their own. The group takes the pointer a few pixels either side of it. While
// the pointer or the keyboard is on it, it lights up in the primary tone along its whole length,
// a little wider, so it reads as something to drag.

export function ResizablePanelGroup({ className, ...props }: ComponentProps<typeof Group>) {
  return <Group data-slot="resizable-panel-group" className={cn('flex h-full w-full', className)} {...props} />
}

export function ResizablePanel(props: ComponentProps<typeof Panel>) {
  return <Panel data-slot="resizable-panel" {...props} />
}

export function ResizableHandle({ className, ...props }: ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="resizable-handle"
      className={cn(
        'group/handle relative shrink-0 bg-border outline-none',
        // The line between two columns stands, the line between two rows lies.
        'aria-[orientation=vertical]:w-px aria-[orientation=horizontal]:h-px',
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          'pointer-events-none absolute z-10 bg-transparent transition-colors',
          'group-aria-[orientation=vertical]/handle:inset-y-0 group-aria-[orientation=vertical]/handle:-left-px group-aria-[orientation=vertical]/handle:w-[3px]',
          'group-aria-[orientation=horizontal]/handle:inset-x-0 group-aria-[orientation=horizontal]/handle:-top-px group-aria-[orientation=horizontal]/handle:h-[3px]',
          'group-data-[separator=hover]/handle:bg-primary group-data-[separator=focus]/handle:bg-primary group-data-[separator=active]/handle:bg-primary',
        )}
      />
    </Separator>
  )
}
