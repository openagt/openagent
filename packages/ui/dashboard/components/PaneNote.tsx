import type { ReactNode } from 'react'

// What a pane says in its own room when it has nothing to show: one muted sentence in the pane's
// middle, and under it the one press that goes on from there, the same in every pane.

/** A pane's sentence in its middle, with its one action under it. */
export function PaneNote({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 self-stretch p-6 text-center">
      <p className="max-w-xs text-sm text-muted-foreground">{children}</p>
      {action}
    </div>
  )
}
