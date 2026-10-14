import type { ComponentProps } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { cn } from '../../lib/utils.js'

// shadcn's `resizable`, ported (no components.json here): the styled wrappers over
// react-resizable-panels. A group lays its panels in a row or in a column, and the line between
// two of them is dragged to give one of them the other's room.
//
// Unlike upstream's, the line is a gap and no rule: what it parts here are cards with borders of
// their own. A short bar shows in the gap while the pointer or the keyboard is on it.

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
        'group/handle flex shrink-0 items-center justify-center outline-none',
        // The line between two columns stands, the line between two rows lies.
        'aria-[orientation=vertical]:w-2 aria-[orientation=horizontal]:h-2',
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          'rounded-full bg-transparent transition-colors',
          'group-aria-[orientation=vertical]/handle:h-10 group-aria-[orientation=vertical]/handle:w-0.5',
          'group-aria-[orientation=horizontal]/handle:h-0.5 group-aria-[orientation=horizontal]/handle:w-10',
          'group-data-[separator=hover]/handle:bg-muted-foreground/50 group-data-[separator=focus]/handle:bg-muted-foreground/50 group-data-[separator=active]/handle:bg-primary',
        )}
      />
    </Separator>
  )
}
